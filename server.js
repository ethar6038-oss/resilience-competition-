/**
 * Cybersecurity Competition — Server
 * ------------------------------------------------------------
 * 11 visible scenarios + 1 hidden replacement scenario.
 * Server-side scoring, assistance limits, branching and reports.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const SCENARIOS_DIR = path.join(DATA_DIR, 'scenarios');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');

const QUESTION_SECONDS = 120;
const POINTS_PER_STEP = 5;

const MAX_HINTS = 3;
const MAX_REVEALS = 2;
const MAX_FRIEND = 1;

const VISIBLE_QUESTIONS = 11;

// ---------- Load static data ----------

const TEAMS = JSON.parse(
  fs.readFileSync(TEAMS_FILE, 'utf8')
);

const TEAM_BY_SLUG = Object.fromEntries(
  TEAMS.map(t => [t.slug, t])
);

const SCENARIOS_BY_SLUG = {};

for (const t of TEAMS) {
  SCENARIOS_BY_SLUG[t.slug] = JSON.parse(
    fs.readFileSync(
      path.join(SCENARIOS_DIR, `${t.slug}.json`),
      'utf8'
    )
  );
}

// ---------- Session storage ----------

let sessions = {};

if (fs.existsSync(SESSIONS_FILE)) {
  try {
    sessions = JSON.parse(
      fs.readFileSync(SESSIONS_FILE, 'utf8')
    );
  } catch (e) {
    sessions = {};
  }
}

function persistSessions() {
  fs.writeFile(
    SESSIONS_FILE,
    JSON.stringify(sessions, null, 2),
    () => {}
  );
}

// ---------- Helpers ----------

function shuffle(arr) {
  const a = arr.slice();

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function buildQuestionObject(sc) {
  const keyed = [
    { key: 'a', text: sc.steps[0] },
    { key: 'b', text: sc.steps[1] },
    { key: 'c', text: sc.steps[2] },
  ];

  return {
    domain: sc.domain,
    scenario: sc.scenario,

    correctOrder: ['a', 'b', 'c'],

    displayOrder: shuffle(keyed).map(s => s.key),

    textByKey: Object.fromEntries(
      keyed.map(s => [s.key, s.text])
    ),

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
}

function newSession(slug) {
  const scenarios = SCENARIOS_BY_SLUG[slug];

  // Q1–Q11 are visible.
  const visibleScenarios = scenarios.slice(
    0,
    VISIBLE_QUESTIONS
  );

  // Q12 is hidden and only used as replacement Q3.
  const hiddenScenario = scenarios[VISIBLE_QUESTIONS];

  const questions = visibleScenarios.map(
    buildQuestionObject
  );

  return {
    slug,
    createdAt: Date.now(),

    currentIndex: 0,
    totalScore: 0,

    hintsUsed: 0,
    revealsUsed: 0,
    friendUsed: 0,

    hintsGivenFor: {},
    revealsGivenFor: {},

    completed: false,

    questions,

    hiddenScenario,
    hiddenUsed: false,
  };
}

function getSession(sessionId, slug) {
  if (
    sessionId &&
    sessions[sessionId] &&
    sessions[sessionId].slug === slug
  ) {
    return {
      id: sessionId,
      session: sessions[sessionId],
    };
  }

  const id = crypto
    .randomBytes(16)
    .toString('hex');

  sessions[id] = newSession(slug);

  persistSessions();

  return {
    id,
    session: sessions[id],
  };
}

function publicQuestion(session, index) {
  const q = session.questions[index];

  if (!q) return null;

  if (!q.startedAt) {
    q.startedAt = Date.now();
    persistSessions();
  }

  const elapsed = Math.floor(
    (Date.now() - q.startedAt) / 1000
  );

  const remaining = Math.max(
    0,
    QUESTION_SECONDS - elapsed
  );

  return {
    index,
    total: session.questions.length,

    domain: q.domain,
    scenario: q.scenario,

    steps: q.displayOrder.map(key => ({
      key,
      text: q.textByKey[key],
    })),

    attempted: q.attempted,
    pointsEarned: q.pointsEarned,
    perStepCorrect: q.perStepCorrect,

    ifCorrect: q.attempted
      ? q.ifCorrect
      : null,

    ifWrong: q.attempted
      ? q.ifWrong
      : null,

    rationale: q.attempted
      ? q.rationale
      : null,

    timerSeconds: QUESTION_SECONDS,

    secondsRemaining: q.attempted
      ? 0
      : remaining,

    hintText:
      session.hintsGivenFor[index] || null,

    revealedFirstStep:
      session.revealsGivenFor[index] || null,
  };
}

function assistanceState(session) {
  return {
    hints: {
      used: session.hintsUsed,
      max: MAX_HINTS,
    },

    reveals: {
      used: session.revealsUsed,
      max: MAX_REVEALS,
    },

    friend: {
      used: session.friendUsed,
      max: MAX_FRIEND,
    },
  };
}

// ---------- Middleware ----------

app.use(cookieParser());
app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

function sessionCookieName(slug) {
  return `session_${slug}`;
}

app.use(
  '/api/team/:slug',
  (req, res, next) => {
    const { slug } = req.params;

    if (!TEAM_BY_SLUG[slug]) {
      return res
        .status(404)
        .json({ error: 'Unknown team' });
    }

    const cookieName =
      sessionCookieName(slug);

    const existingId =
      req.cookies[cookieName];

    const { id, session } =
      getSession(existingId, slug);

    if (id !== existingId) {
      res.cookie(cookieName, id, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge:
          1000 * 60 * 60 * 12,
      });
    }

    req.teamSlug = slug;
    req.sessionId = id;
    req.gameSession = session;

    next();
  }
);
// ---------- API: Admin ----------

app.get('/api/admin/teams', (req, res) => {
  res.json(
    TEAMS.map(t => ({
      name: t.name,
      slug: t.slug,
      totalQuestions: VISIBLE_QUESTIONS,
    }))
  );
});

app.get('/api/admin/progress', (req, res) => {
  const progress = TEAMS.map(t => {
    const entries = Object
      .values(sessions)
      .filter(s => s.slug === t.slug);

    if (entries.length === 0) {
      return {
        slug: t.slug,
        name: t.name,

        started: false,
        answered: 0,
        total: VISIBLE_QUESTIONS,
        score: 0,
        completed: false,

        currentQuestion: null,

        hints: {
          used: 0,
          max: MAX_HINTS,
        },

        reveals: {
          used: 0,
          max: MAX_REVEALS,
        },

        friend: {
          used: 0,
          max: MAX_FRIEND,
        },
      };
    }

    const s = entries.sort((a, b) => {
  const answeredA = a.questions.filter(q => q.attempted).length;
  const answeredB = b.questions.filter(q => q.attempted).length;

  if (answeredB !== answeredA) {
    return answeredB - answeredA;
  }

  return b.createdAt - a.createdAt;
})[0];

    const answered =
      s.questions.filter(
        q => q.attempted
      ).length;

    return {
      slug: t.slug,
      name: t.name,

      started: true,
      answered,
      total: s.questions.length,
      score: s.totalScore,
      completed: s.completed,

      currentQuestion:
        s.completed
          ? null
          : s.currentIndex + 1,

      hints: {
        used: s.hintsUsed,
        max: MAX_HINTS,
      },

      reveals: {
        used: s.revealsUsed,
        max: MAX_REVEALS,
      },

      friend: {
        used: s.friendUsed,
        max: MAX_FRIEND,
      },
    };
  });

  res.json(progress);
});

// RESET ALL TEAMS + ALL PROGRESS

app.post('/api/admin/reset', (req, res) => {
  sessions = {};

  persistSessions();

  res.json({
    ok: true,
  });
});

// ---------- API: Team gameplay ----------

app.get('/api/team/:slug/info', (req, res) => {
  const t =
    TEAM_BY_SLUG[req.teamSlug];

  res.json({
    name: t.name,
    slug: t.slug,
    totalQuestions: VISIBLE_QUESTIONS,
  });
});

// Only the 11 visible scenarios appear in domains/progress.

app.get('/api/team/:slug/domains', (req, res) => {
  const scenarios =
    SCENARIOS_BY_SLUG[
      req.teamSlug
    ].slice(
      0,
      VISIBLE_QUESTIONS
    );

  const order = [];
  const counts = {};

  scenarios.forEach(sc => {
    if (!counts[sc.domain]) {
      counts[sc.domain] = 0;
      order.push(sc.domain);
    }

    counts[sc.domain] += 1;
  });

  res.json(
    order.map(name => ({
      name,
      count: counts[name],
    }))
  );
});

app.get('/api/team/:slug/state', (req, res) => {
  const s = req.gameSession;

  res.json({
    currentIndex: s.currentIndex,
    totalScore: s.totalScore,
    completed: s.completed,

    assistance:
      assistanceState(s),

    question:
      publicQuestion(
        s,
        s.currentIndex
      ),
  });
});

function resetQuestion(q) {
  q.attempted = false;
  q.pointsEarned = 0;
  q.perStepCorrect = null;
  q.submittedOrder = null;
  q.startedAt = null;

  q.displayOrder =
    shuffle(['a', 'b', 'c']);
}
// ---------- Submit answer ----------

app.post('/api/team/:slug/answer', (req, res) => {
  const s = req.gameSession;

  const {
    index,
    order,
  } = req.body;

  if (
    typeof index !== 'number' ||
    index !== s.currentIndex
  ) {
    return res
      .status(400)
      .json({
        error:
          'Not the current question',
      });
  }

  const q =
    s.questions[index];

  if (!q) {
    return res
      .status(404)
      .json({
        error:
          'Question not found',
      });
  }

  if (q.attempted) {
    return res
      .status(409)
      .json({
        error:
          'Already attempted',

        question:
          publicQuestion(
            s,
            index
          ),
      });
  }

  if (
    !Array.isArray(order) ||
    order.length !== 3 ||
    new Set(order).size !== 3
  ) {
    return res
      .status(400)
      .json({
        error:
          'Invalid order submitted',
      });
  }

  const perStepCorrect =
    order.map(
      (key, pos) =>
        key ===
        q.correctOrder[pos]
    );

  const fullyCorrect =
    perStepCorrect.every(Boolean);

  const pointsEarned =
    perStepCorrect
      .filter(Boolean)
      .length *
    POINTS_PER_STEP;

  q.attempted = true;
  q.submittedOrder = order;
  q.perStepCorrect =
    perStepCorrect;
  q.pointsEarned =
    pointsEarned;

  s.totalScore +=
    pointsEarned;

  let sentBackTo = null;
  let bonusAwarded = null;

  // --------------------------------------------------
  // Q4 RULE
  //
  // index 3 = visible Question 4.
  //
  // If ANY step in Q4 is wrong:
  // - remove old Q3 points
  // - hidden Q12 replaces Q3
  // - old Q3 assistance display is removed
  // - Q4 attempt/points are cancelled
  // - team returns to the NEW Q3
  // --------------------------------------------------

  if (
    index === 3 &&
    !fullyCorrect
  ) {
    const oldQ3 =
      s.questions[2];

    if (oldQ3.attempted) {
      s.totalScore -=
        oldQ3.pointsEarned;
    }

    const replacement =
      buildQuestionObject(
        s.hiddenScenario
      );

    // Hidden scenario becomes
    // the new visible Scenario 3.
    replacement.domain =
      oldQ3.domain;

    s.questions[2] =
      replacement;

    s.hiddenUsed = true;

    // IMPORTANT:
    // No previous Q3 assistance remains
    // when the team returns to new Q3.
    delete s.hintsGivenFor[2];
    delete s.revealsGivenFor[2];

    // Q4 does not keep points
    // from this failed attempt.
    s.totalScore -=
      pointsEarned;

    resetQuestion(q);

    s.currentIndex = 2;
    sentBackTo = 2;
  }

  // --------------------------------------------------
  // Q7 RULE
  //
  // index 6 = Question 7.
  //
  // If Q7 is 100% correct:
  // - Q8 is skipped
  // - Q8 gets full 15 points
  // - team goes directly to Q9
  // --------------------------------------------------

  else if (
    index === 6 &&
    fullyCorrect
  ) {
    const q8 =
      s.questions[7];

    if (!q8.attempted) {
      q8.attempted = true;

      q8.perStepCorrect = [
        true,
        true,
        true,
      ];

      q8.pointsEarned = 15;

      q8.submittedOrder =
        q8.correctOrder.slice();

      s.totalScore += 15;

      bonusAwarded = {
        index: 7,
        points: 15,
      };
    }

    s.currentIndex = 8;
  }

  // ---------- Final question ----------

  else if (
    index ===
    s.questions.length - 1
  ) {
    s.completed = true;
  }

  // ---------- Normal progression ----------

  else {
    s.currentIndex =
      index + 1;
  }

  persistSessions();

  res.json({
    perStepCorrect,

    pointsEarned:
      sentBackTo !== null
        ? 0
        : pointsEarned,

    totalScore:
      s.totalScore,

    ifCorrect:
      q.ifCorrect,

    ifWrong:
      q.ifWrong,

    rationale:
      q.rationale,

    completed:
      s.completed,

    nextIndex:
      s.completed
        ? null
        : s.currentIndex,

    sentBackTo,
    bonusAwarded,
  });
});

// ---------- Assistance: Hint ----------

app.post(
  '/api/team/:slug/assist/hint',
  (req, res) => {
    const s =
      req.gameSession;

    const { index } =
      req.body;

    const q =
      s.questions[index];

    if (!q) {
      return res
        .status(404)
        .json({
          error:
            'Question not found',
        });
    }

    if (q.attempted) {
      return res
        .status(409)
        .json({
          error:
            'Question already answered',
        });
    }

    if (
      s.hintsGivenFor[index]
    ) {
      return res.json({
        hintText:
          s.hintsGivenFor[index],

        assistance:
          assistanceState(s),
      });
    }

    if (
      s.hintsUsed >=
      MAX_HINTS
    ) {
      return res
        .status(403)
        .json({
          error:
            'No hints remaining',
        });
    }

    s.hintsUsed += 1;

    const hintText =
      `Think about: ${q.areaMeasured}`;

    s.hintsGivenFor[index] =
      hintText;

    persistSessions();

    res.json({
      hintText,

      assistance:
        assistanceState(s),
    });
  }
);

// ---------- Assistance: Reveal First Step ----------

app.post(
  '/api/team/:slug/assist/reveal',
  (req, res) => {
    const s =
      req.gameSession;

    const { index } =
      req.body;

    const q =
      s.questions[index];

    if (!q) {
      return res
        .status(404)
        .json({
          error:
            'Question not found',
        });
    }

    if (q.attempted) {
      return res
        .status(409)
        .json({
          error:
            'Question already answered',
        });
    }

    if (
      s.revealsGivenFor[index]
    ) {
      return res.json({
        revealedFirstStep:
          s.revealsGivenFor[index],

        assistance:
          assistanceState(s),
      });
    }

    if (
      s.revealsUsed >=
      MAX_REVEALS
    ) {
      return res
        .status(403)
        .json({
          error:
            'No reveals remaining',
        });
    }

    s.revealsUsed += 1;

    const firstKey =
      q.correctOrder[0];

    s.revealsGivenFor[index] =
      firstKey;

    persistSessions();

    res.json({
      revealedFirstStep:
        firstKey,

      assistance:
        assistanceState(s),
    });
  }
);

// ---------- Assistance: Ask a Friend ----------

app.post(
  '/api/team/:slug/assist/friend',
  (req, res) => {
    const s =
      req.gameSession;

    if (
      s.friendUsed >=
      MAX_FRIEND
    ) {
      return res
        .status(403)
        .json({
          error:
            'Ask a Friend already used',
        });
    }

    s.friendUsed += 1;

    persistSessions();

    res.json({
      assistance:
        assistanceState(s),
    });
  }
);
// ---------- Reporting ----------

function buildReportRows() {
  return TEAMS.map(t => {
    const entries =
      Object.values(sessions)
        .filter(
          s =>
            s.slug === t.slug
        );

    const s =
      entries.length
        ? entries.sort(
            (a, b) =>
              b.createdAt -
              a.createdAt
          )[0]
        : null;

    if (!s) {
      return {
        name: t.name,
        slug: t.slug,

        started: false,

        totalScore: 0,
        maxScore:
          VISIBLE_QUESTIONS * 15,

        answered: 0,
        total:
          VISIBLE_QUESTIONS,

        completed: false,
        currentQuestion: null,

        hiddenUsed: false,

        hintsUsed: 0,
        revealsUsed: 0,
        friendUsed: 0,

        questions: [],
      };
    }

    return {
      name: t.name,
      slug: t.slug,

      started: true,

      totalScore:
        s.totalScore,

      maxScore:
        s.questions.length * 15,

      answered:
        s.questions.filter(
          q => q.attempted
        ).length,

      total:
        s.questions.length,

      completed:
        s.completed,

      currentQuestion:
        s.completed
          ? null
          : s.currentIndex + 1,

      hiddenUsed:
        !!s.hiddenUsed,

      hintsUsed:
        s.hintsUsed,

      revealsUsed:
        s.revealsUsed,

      friendUsed:
        s.friendUsed,

      questions:
        s.questions.map(
          (q, i) => ({
            index: i + 1,

            domain:
              q.domain,

            attempted:
              q.attempted,

            pointsEarned:
              q.pointsEarned,

            maxPoints: 15,

            submittedOrder:
              q.submittedOrder
                ? q.submittedOrder.join('-')
                : '',

            correctOrder:
              q.correctOrder.join('-'),
          })
        ),
    };
  });
}

// ---------- Excel Report ----------

app.get(
  '/api/admin/report.xlsx',
  async (req, res) => {
    const rows =
      buildReportRows();

    const wb =
      new ExcelJS.Workbook();

    const summary =
      wb.addWorksheet(
        'Summary'
      );

    summary.columns = [
      {
        header: 'Team',
        key: 'name',
        width: 24,
      },
      {
        header: 'Score',
        key: 'totalScore',
        width: 10,
      },
      {
        header: 'Max Score',
        key: 'maxScore',
        width: 10,
      },
      {
        header: 'Answered',
        key: 'answered',
        width: 10,
      },
      {
        header: 'Total Qs',
        key: 'total',
        width: 10,
      },
      {
        header: 'Current Q',
        key: 'currentQuestion',
        width: 10,
      },
      {
        header: 'Completed',
        key: 'completed',
        width: 10,
      },
      {
        header:
          'Used Hidden Q12?',
        key: 'hiddenUsed',
        width: 16,
      },
      {
        header:
          'Hints Used (/3)',
        key: 'hintsUsed',
        width: 14,
      },
      {
        header:
          'Reveals Used (/2)',
        key: 'revealsUsed',
        width: 16,
      },
      {
        header:
          'Ask-a-Friend Used (/1)',
        key: 'friendUsed',
        width: 20,
      },
    ];

    rows.forEach(
      r =>
        summary.addRow(r)
    );

    summary.getRow(1).font = {
      bold: true,
    };

    rows.forEach(r => {
      const sheetName =
        r.name
          .replace(
            /[\\/*?:[\]]/g,
            ''
          )
          .slice(0, 31) ||
        r.slug;

      const sheet =
        wb.addWorksheet(
          sheetName
        );

      sheet.columns = [
        {
          header: 'Q#',
          key: 'index',
          width: 6,
        },
        {
          header: 'Domain',
          key: 'domain',
          width: 34,
        },
        {
          header: 'Attempted',
          key: 'attempted',
          width: 10,
        },
        {
          header: 'Points',
          key: 'pointsEarned',
          width: 8,
        },
        {
          header: 'Max',
          key: 'maxPoints',
          width: 6,
        },
        {
          header:
            'Submitted Order',
          key:
            'submittedOrder',
          width: 16,
        },
        {
          header:
            'Correct Order',
          key:
            'correctOrder',
          width: 14,
        },
      ];

      r.questions.forEach(
        q =>
          sheet.addRow(q)
      );

      sheet.getRow(1).font = {
        bold: true,
      };
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="competition-report.xlsx"'
    );

    await wb.xlsx.write(res);

    res.end();
  }
);

// ---------- PDF Report ----------

app.get(
  '/api/admin/report.pdf',
  (req, res) => {
    const rows =
      buildReportRows();

    const doc =
      new PDFDocument({
        margin: 40,
        size: 'A4',
      });

    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="competition-report.pdf"'
    );

    doc.pipe(res);

    doc
      .fontSize(18)
      .text(
        'Cybersecurity Competition — Report',
        {
          align: 'center',
        }
      );

    doc.moveDown(1);

    rows.forEach(
      (r, i) => {
        if (i > 0) {
          doc.addPage();
        }

        doc
          .fontSize(14)
          .text(
            r.name,
            {
              underline: true,
            }
          );

        doc.moveDown(0.3);

        doc
          .fontSize(10)
          .text(
            `Score: ${r.totalScore} / ${r.maxScore}    Answered: ${r.answered}/${r.total}    Current: ${
              r.currentQuestion
                ? 'Q' +
                  r.currentQuestion
                : '—'
            }    Completed: ${
              r.completed
                ? 'Yes'
                : 'No'
            }`
          );

        doc.text(
          `Assistance used — Hints: ${r.hintsUsed}/3    Reveals: ${r.revealsUsed}/2    Ask a Friend: ${r.friendUsed}/1`
        );

        doc.text(
          `Used hidden Q12 replacement: ${
            r.hiddenUsed
              ? 'Yes'
              : 'No'
          }`
        );

        doc.moveDown(0.5);

        if (
          r.questions.length ===
          0
        ) {
          doc
            .fontSize(10)
            .fillColor('#888')
            .text(
              'Not started yet.'
            );

          doc.fillColor('#000');
        } else {
          r.questions.forEach(
            q => {
              const line =
                q.attempted
                  ? `Q${q.index} (${q.domain}): ${q.pointsEarned}/15 pts — submitted ${q.submittedOrder}, correct ${q.correctOrder}`
                  : `Q${q.index} (${q.domain}): not attempted`;

              doc
                .fontSize(9)
                .text(line);
            }
          );
        }
      }
    );

    doc.end();
  }
);
// ---------- Page routes ----------

app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'public',
      'admin',
      'index.html'
    )
  );
});

app.get(
  '/team/:slug',
  (req, res) => {
    if (
      !TEAM_BY_SLUG[
        req.params.slug
      ]
    ) {
      return res
        .status(404)
        .send(
          'Team link not found.'
        );
    }

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'team',
        'index.html'
      )
    );
  }
);

app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ---------- Start server ----------

app.listen(PORT, () => {
  console.log(
    `Cyber competition server running on port ${PORT}`
  );
});
