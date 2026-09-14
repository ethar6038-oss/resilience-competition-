/**
 * Cybersecurity Competition — Server
 * ------------------------------------------------------------
 * - Serves the Admin Dashboard (12 team cards -> per-team link)
 * - Serves a single dynamic Team Page at /team/:slug
 * - All scoring / shuffling / "one attempt" / hint-limits are
 *   enforced SERVER-SIDE so a team can never see the answer key
 *   by inspecting the page source or network tab.
 * - Session state is kept in memory AND mirrored to a JSON file
 *   (data/sessions.json) so progress survives a server restart.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const SCENARIOS_DIR = path.join(DATA_DIR, 'scenarios');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');

const QUESTION_SECONDS = 120;          // 2-minute timer per scenario
const POINTS_PER_STEP = 5;             // 5 points per correctly placed step
const MAX_HINTS = 3;                   // "Hint" — 3 uses per team, whole competition
const MAX_REVEALS = 2;                 // "Reveal First Step" — 2 uses per team
const MAX_FRIEND = 1;                  // "Ask a Friend" — 1 use per team

// ---------- Load static data ----------
const TEAMS = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
const TEAM_BY_SLUG = Object.fromEntries(TEAMS.map(t => [t.slug, t]));
const SCENARIOS_BY_SLUG = {};
for (const t of TEAMS) {
  SCENARIOS_BY_SLUG[t.slug] = JSON.parse(
    fs.readFileSync(path.join(SCENARIOS_DIR, `${t.slug}.json`), 'utf8')
  );
}

// ---------- Session store (in-memory + file-backed) ----------
let sessions = {};
if (fs.existsSync(SESSIONS_FILE)) {
  try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) { sessions = {}; }
}
function persistSessions() {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), () => {});
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newSession(slug) {
  const scenarios = SCENARIOS_BY_SLUG[slug];
  const questions = scenarios.map(sc => {
    // steps stored as {key:'a'|'b'|'c', text}. correctOrder = ['a','b','c']
    const keyed = [
      { key: 'a', text: sc.steps[0] },
      { key: 'b', text: sc.steps[1] },
      { key: 'c', text: sc.steps[2] },
    ];
    return {
      domain: sc.domain,
      scenario: sc.scenario,
      correctOrder: ['a', 'b', 'c'],
      displayOrder: shuffle(keyed).map(s => s.key), // order shown to the player
      textByKey: Object.fromEntries(keyed.map(s => [s.key, s.text])),
      rationale: sc.rationale,
      areaMeasured: sc.areaMeasured,
      ifCorrect: sc.ifCorrect,
      ifWrong: sc.ifWrong,
      attempted: false,
      pointsEarned: 0,
      submittedOrder: null,
      perStepCorrect: null,
      startedAt: null,
    };
  });
  return {
    slug,
    createdAt: Date.now(),
    currentIndex: 0,
    totalScore: 0,
    hintsUsed: 0,
    revealsUsed: 0,
    friendUsed: 0,
    hintsGivenFor: {},   // index -> hint text already revealed
    revealsGivenFor: {}, // index -> revealed first-step key
    completed: false,
    questions,
  };
}

function getSession(sessionId, slug) {
  if (sessionId && sessions[sessionId] && sessions[sessionId].slug === slug) {
    return { id: sessionId, session: sessions[sessionId] };
  }
  const id = crypto.randomBytes(16).toString('hex');
  sessions[id] = newSession(slug);
  persistSessions();
  return { id, session: sessions[id] };
}

// Public-safe view of a question (never leaks correctOrder)
function publicQuestion(session, index) {
  const q = session.questions[index];
  if (!q) return null;
  if (!q.startedAt) { q.startedAt = Date.now(); persistSessions(); }
  const elapsed = Math.floor((Date.now() - q.startedAt) / 1000);
  const remaining = Math.max(0, QUESTION_SECONDS - elapsed);
  return {
    index,
    total: session.questions.length,
    domain: q.domain,
    scenario: q.scenario,
    steps: q.displayOrder.map(key => ({ key, text: q.textByKey[key] })),
    attempted: q.attempted,
    pointsEarned: q.pointsEarned,
    perStepCorrect: q.perStepCorrect,
    ifCorrect: q.attempted ? q.ifCorrect : null,
    ifWrong: q.attempted ? q.ifWrong : null,
    rationale: q.attempted ? q.rationale : null,
    timerSeconds: QUESTION_SECONDS,
    secondsRemaining: q.attempted ? 0 : remaining,
    hintText: session.hintsGivenFor[index] || null,
    revealedFirstStep: session.revealsGivenFor[index] || null,
  };
}

function assistanceState(session) {
  return {
    hints: { used: session.hintsUsed, max: MAX_HINTS },
    reveals: { used: session.revealsUsed, max: MAX_REVEALS },
    friend: { used: session.friendUsed, max: MAX_FRIEND },
  };
}

// ---------- Middleware ----------
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sessionCookieName(slug) { return `session_${slug}`; }

app.use('/api/team/:slug', (req, res, next) => {
  const { slug } = req.params;
  if (!TEAM_BY_SLUG[slug]) return res.status(404).json({ error: 'Unknown team' });
  const cookieName = sessionCookieName(slug);
  const existingId = req.cookies[cookieName];
  const { id, session } = getSession(existingId, slug);
  if (id !== existingId) {
    res.cookie(cookieName, id, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 });
  }
  req.teamSlug = slug;
  req.sessionId = id;
  req.gameSession = session;
  next();
});

// ---------- API: Admin ----------
app.get('/api/admin/teams', (req, res) => {
  res.json(TEAMS.map(t => ({ name: t.name, slug: t.slug, totalQuestions: t.totalQuestions })));
});

// Lightweight live-progress view for the admin dashboard
app.get('/api/admin/progress', (req, res) => {
  const progress = TEAMS.map(t => {
    const entries = Object.values(sessions).filter(s => s.slug === t.slug);
    if (entries.length === 0) {
      return { slug: t.slug, name: t.name, started: false, answered: 0, total: t.totalQuestions, score: 0, completed: false };
    }
    // Assume one active session per team during a live event; take the most recently created
    const s = entries.sort((a, b) => b.createdAt - a.createdAt)[0];
    const answered = s.questions.filter(q => q.attempted).length;
    return { slug: t.slug, name: t.name, started: true, answered, total: s.questions.length, score: s.totalScore, completed: s.completed };
  });
  res.json(progress);
});

// ---------- API: Team gameplay ----------
app.get('/api/team/:slug/info', (req, res) => {
  const t = TEAM_BY_SLUG[req.teamSlug];
  res.json({ name: t.name, slug: t.slug, totalQuestions: t.totalQuestions });
});

// Domain names/order only — never scenario content — used to render the progress track
app.get('/api/team/:slug/domains', (req, res) => {
  const scenarios = SCENARIOS_BY_SLUG[req.teamSlug];
  const order = [];
  const counts = {};
  scenarios.forEach(sc => {
    if (!counts[sc.domain]) { counts[sc.domain] = 0; order.push(sc.domain); }
    counts[sc.domain] += 1;
  });
  res.json(order.map(name => ({ name, count: counts[name] })));
});

app.get('/api/team/:slug/state', (req, res) => {
  const s = req.gameSession;
  res.json({
    currentIndex: s.currentIndex,
    totalScore: s.totalScore,
    completed: s.completed,
    assistance: assistanceState(s),
    question: publicQuestion(s, s.currentIndex),
  });
});

app.post('/api/team/:slug/answer', (req, res) => {
  const s = req.gameSession;
  const { index, order } = req.body; // order: array of 3 keys e.g. ['b','a','c']
  if (typeof index !== 'number' || index !== s.currentIndex) {
    return res.status(400).json({ error: 'Not the current question' });
  }
  const q = s.questions[index];
  if (!q) return res.status(404).json({ error: 'Question not found' });
  if (q.attempted) return res.status(409).json({ error: 'Already attempted', question: publicQuestion(s, index) });
  if (!Array.isArray(order) || order.length !== 3 || new Set(order).size !== 3) {
    return res.status(400).json({ error: 'Invalid order submitted' });
  }

  const perStepCorrect = order.map((key, pos) => key === q.correctOrder[pos]);
  const pointsEarned = perStepCorrect.filter(Boolean).length * POINTS_PER_STEP;

  q.attempted = true;
  q.submittedOrder = order;
  q.perStepCorrect = perStepCorrect;
  q.pointsEarned = pointsEarned;
  s.totalScore += pointsEarned;

  if (index === s.questions.length - 1) {
    s.completed = true;
  } else {
    s.currentIndex = index + 1;
  }
  persistSessions();

  res.json({
    perStepCorrect,
    pointsEarned,
    totalScore: s.totalScore,
    ifCorrect: q.ifCorrect,
    ifWrong: q.ifWrong,
    rationale: q.rationale,
    completed: s.completed,
    nextIndex: s.completed ? null : s.currentIndex,
  });
});

app.post('/api/team/:slug/assist/hint', (req, res) => {
  const s = req.gameSession;
  const { index } = req.body;
  const q = s.questions[index];
  if (!q) return res.status(404).json({ error: 'Question not found' });
  if (q.attempted) return res.status(409).json({ error: 'Question already answered' });
  if (s.hintsGivenFor[index]) return res.json({ hintText: s.hintsGivenFor[index], assistance: assistanceState(s) });
  if (s.hintsUsed >= MAX_HINTS) return res.status(403).json({ error: 'No hints remaining' });

  s.hintsUsed += 1;
  // Hint = the "areaMeasured" framing, nudges thinking without giving the answer away
  const hintText = `Think about: ${q.areaMeasured}`;
  s.hintsGivenFor[index] = hintText;
  persistSessions();
  res.json({ hintText, assistance: assistanceState(s) });
});

app.post('/api/team/:slug/assist/reveal', (req, res) => {
  const s = req.gameSession;
  const { index } = req.body;
  const q = s.questions[index];
  if (!q) return res.status(404).json({ error: 'Question not found' });
  if (q.attempted) return res.status(409).json({ error: 'Question already answered' });
  if (s.revealsGivenFor[index]) return res.json({ revealedFirstStep: s.revealsGivenFor[index], assistance: assistanceState(s) });
  if (s.revealsUsed >= MAX_REVEALS) return res.status(403).json({ error: 'No reveals remaining' });

  s.revealsUsed += 1;
  const firstKey = q.correctOrder[0];
  s.revealsGivenFor[index] = firstKey;
  persistSessions();
  res.json({ revealedFirstStep: firstKey, assistance: assistanceState(s) });
});

app.post('/api/team/:slug/assist/friend', (req, res) => {
  const s = req.gameSession;
  if (s.friendUsed >= MAX_FRIEND) return res.status(403).json({ error: 'Ask a Friend already used' });
  s.friendUsed += 1;
  persistSessions();
  res.json({ assistance: assistanceState(s) });
});

// ---------- Page routes ----------
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/team/:slug', (req, res) => {
  if (!TEAM_BY_SLUG[req.params.slug]) return res.status(404).send('Team link not found.');
  res.sendFile(path.join(__dirname, 'public', 'team', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`Cyber competition server running on port ${PORT}`);
});
