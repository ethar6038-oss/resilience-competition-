(function () {
  const slug = window.location.pathname.split('/').filter(Boolean)[1];
  const app = document.getElementById('app');
  const teamLabel = document.getElementById('teamLabel');

  if (!slug) {
    app.innerHTML = '<div class="error-msg">No team specified in the link.</div>';
    return;
  }

  const api = (path, opts) => fetch(`/api/team/${slug}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  }).then(async r => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const err = new Error(body.error || 'Request failed');
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return r.json();
  });

  let teamInfo = null;
  let domains = [];
  let currentOrder = [];     // current arranged key order, e.g. ['b','a','c']
  let selectedForSwap = null;
  let timerInterval = null;
  let deadline = null;
  let locked = false;        // true once submitted or time's up

  async function boot() {
    try {
      const [info, domainList] = await Promise.all([
        api('/info'),
        api('/domains'),
      ]);
      teamInfo = info;
      domains = domainList;
      teamLabel.textContent = info.name;
      await refreshState();
    } catch (e) {
      app.innerHTML = `<div class="error-msg">Couldn't load this team's competition. ${e.body && e.body.error ? e.body.error : ''}</div>`;
    }
  }

  async function refreshState() {
    const state = await api('/state');
    if (state.completed) {
      renderCompletion(state);
      return;
    }
    renderGame(state);
  }

  function domainIndexFor(name) {
    return domains.findIndex(d => d.name === name);
  }

  function renderShell(state) {
    const q = state.question;
    const activeDomainIdx = domainIndexFor(q.domain);

    const trackHtml = domains.map((d, i) => {
      let cls = 'domain-step';
      if (i < activeDomainIdx) cls += ' done';
      if (i === activeDomainIdx) cls += ' active';
      return `
        <div class="${cls}">
          <div class="num">${String(i + 1).padStart(2, '0')} — ${d.count} scenarios</div>
          <div class="name">${d.name}</div>
        </div>`;
    }).join('');

    app.innerHTML = `
      <div class="hero-panel">
        <div class="team-name">${teamInfo.name}</div>
        <div class="team-sub">Sequence each response correctly across 3 domains · 12 scenarios total</div>
        <div class="domain-track">${trackHtml}</div>
      </div>

      <div class="status-row">
        <div class="q-counter">Question <span>${q.index + 1}</span> of ${q.total}</div>
        <div class="score-chip">Score: ${state.totalScore} pts</div>
      </div>

      <div class="assist-bar" id="assistBar"></div>

      <div class="question-card" id="questionCard"></div>
    `;
  }

  function renderAssistBar(state) {
    const bar = document.getElementById('assistBar');
    const a = state.assistance;
    bar.innerHTML = `
      <button class="assist-btn" id="hintBtn" ${a.hints.used >= a.hints.max || locked ? 'disabled' : ''}>
        💡 Hint <span class="count">${a.hints.max - a.hints.used}/${a.hints.max}</span>
      </button>
      <button class="assist-btn" id="revealBtn" ${a.reveals.used >= a.reveals.max || locked ? 'disabled' : ''}>
        🔎 Reveal First Step <span class="count">${a.reveals.max - a.reveals.used}/${a.reveals.max}</span>
      </button>
      <button class="assist-btn" id="friendBtn" ${a.friend.used >= a.friend.max || locked ? 'disabled' : ''}>
        ☎ Ask a Friend <span class="count">${a.friend.max - a.friend.used}/${a.friend.max}</span>
      </button>
    `;
    document.getElementById('hintBtn').addEventListener('click', useHint);
    document.getElementById('revealBtn').addEventListener('click', useReveal);
    document.getElementById('friendBtn').addEventListener('click', confirmFriend);
  }

  function renderQuestionCard(state) {
    const q = state.question;
    const card = document.getElementById('questionCard');
    currentOrder = q.steps.map(s => s.key);
    locked = q.attempted;

    card.innerHTML = `
      <div class="q-domain-tag">${q.domain}</div>
      <div class="q-scenario">${escapeHtml(q.scenario)}</div>
      <div class="timer-wrap">
        <div class="timer-ring" id="timerRing">--:--</div>
        <div class="timer-label">Time remaining for this scenario</div>
      </div>
      <div id="hintBannerWrap"></div>
      <div class="steps-label">Tap two steps to swap them — arrange in the correct order (1 → 2 → 3):</div>
      <ul class="steps-list" id="stepsList"></ul>
      <div id="resultWrap"></div>
      <div class="action-row">
        <button class="submit-btn" id="submitBtn">Submit answer</button>
        <div id="nextWrap"></div>
      </div>
    `;

    if (q.hintText) showHintBanner(q.hintText);

    renderSteps(q);

    document.getElementById('submitBtn').addEventListener('click', () => submitAnswer(q.index));

    if (q.attempted) {
      lockStepsVisual(q);
      showResult(q);
      document.getElementById('submitBtn').style.display = 'none';
      renderNextButton(state);
    } else {
      startTimer(q.secondsRemaining, q.index);
    }
  }

  function renderSteps(q) {
    const list = document.getElementById('stepsList');
    list.innerHTML = '';
    currentOrder.forEach((key, pos) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.draggable = !locked;
      li.dataset.key = key;
      if (q.revealedFirstStep && key === q.revealedFirstStep) {
        li.classList.add('first-step-revealed');
      }
      li.innerHTML = `
        <span class="order-num">${pos + 1}</span>
        <span class="handle">⠿</span>
        <span class="text">${escapeHtml(q.steps.find(s => s.key === key).text)}</span>
      `;
      if (!locked) {
        li.addEventListener('click', () => onStepTap(li));
        li.addEventListener('dragstart', () => li.classList.add('dragging'));
        li.addEventListener('dragend', () => {
          li.classList.remove('dragging');
          document.querySelectorAll('.step-item').forEach(el => el.classList.remove('drag-over'));
        });
        li.addEventListener('dragover', e => {
          e.preventDefault();
          li.classList.add('drag-over');
        });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', e => {
          e.preventDefault();
          const draggingEl = document.querySelector('.step-item.dragging');
          if (!draggingEl || draggingEl === li) return;
          swapKeys(draggingEl.dataset.key, li.dataset.key, q);
        });
      }
      list.appendChild(li);
    });
  }

  function onStepTap(li) {
    if (selectedForSwap === null) {
      selectedForSwap = li.dataset.key;
      li.style.borderColor = 'var(--cyan-400)';
      return;
    }
    if (selectedForSwap === li.dataset.key) {
      selectedForSwap = null;
      li.style.borderColor = '';
      return;
    }
    swapKeys(selectedForSwap, li.dataset.key, currentQuestionRef);
    selectedForSwap = null;
  }

  let currentQuestionRef = null;

  function swapKeys(keyA, keyB, q) {
    const iA = currentOrder.indexOf(keyA);
    const iB = currentOrder.indexOf(keyB);
    if (iA === -1 || iB === -1) return;
    [currentOrder[iA], currentOrder[iB]] = [currentOrder[iB], currentOrder[iA]];
    renderSteps(q);
  }

  function startTimer(secondsRemaining, index) {
    clearInterval(timerInterval);
    let remaining = secondsRemaining;
    const ring = document.getElementById('timerRing');
    const tick = () => {
      const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
      const ss = String(remaining % 60).padStart(2, '0');
      if (ring) {
        ring.textContent = `${mm}:${ss}`;
        ring.classList.toggle('low', remaining <= 15);
      }
      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (!locked) submitAnswer(index, true);
        return;
      }
      remaining -= 1;
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  async function submitAnswer(index, timedOut) {
    if (locked) return;
    locked = true;
    clearInterval(timerInterval);
    document.getElementById('submitBtn').disabled = true;
    try {
      const result = await api('/answer', {
        method: 'POST',
        body: JSON.stringify({ index, order: currentOrder }),
      });
      applySubmitResult(result, index);
    } catch (e) {
      locked = false;
      document.getElementById('submitBtn').disabled = false;
      alert(e.body && e.body.error ? e.body.error : 'Could not submit. Please try again.');
    }
  }

  function applySubmitResult(result, index) {
    document.querySelectorAll('.step-item').forEach((li, i) => {
      li.draggable = false;
      const ok = result.perStepCorrect[i];
      li.classList.add(ok ? 'correct' : 'incorrect');
    });
    document.getElementById('submitBtn').style.display = 'none';
    showResultInline(result);
    document.getElementById('resultWrap').dataset.filled = '1';
    renderNextButtonFromResult(result, index);
    updateScoreChip(result.totalScore);
  }

  function updateScoreChip(score) {
    const chip = document.querySelector('.score-chip');
    if (chip) chip.textContent = `Score: ${score} pts`;
  }

  function showResultInline(result) {
    const wrap = document.getElementById('resultWrap');
    const pct = result.pointsEarned;
    const headClass = pct === 15 ? 'ok' : (pct === 0 ? 'bad' : 'partial');
    const headText = pct === 15 ? 'All steps correct' : (pct === 0 ? 'Sequence incorrect' : 'Partially correct');
    wrap.innerHTML = `
      <div class="result-panel">
        <div class="result-head ${headClass}">${headText} — +${pct} pts</div>
        <p>${escapeHtml(pct >= 10 ? result.ifCorrect : result.ifWrong)}</p>
        <p><strong>Why this order:</strong> ${escapeHtml(result.rationale)}</p>
      </div>
    `;
  }

  function showResult(q) {
    const wrap = document.getElementById('resultWrap');
    const pct = q.pointsEarned;
    const headClass = pct === 15 ? 'ok' : (pct === 0 ? 'bad' : 'partial');
    const headText = pct === 15 ? 'All steps correct' : (pct === 0 ? 'Sequence incorrect' : 'Partially correct');
    wrap.innerHTML = `
      <div class="result-panel">
        <div class="result-head ${headClass}">${headText} — +${pct} pts</div>
        <p>${escapeHtml(pct >= 10 ? q.ifCorrect : q.ifWrong)}</p>
        <p><strong>Why this order:</strong> ${escapeHtml(q.rationale)}</p>
      </div>
    `;
  }

  function lockStepsVisual(q) {
    document.querySelectorAll('.step-item').forEach((li, i) => {
      li.draggable = false;
      if (q.perStepCorrect) {
        li.classList.add(q.perStepCorrect[i] ? 'correct' : 'incorrect');
      }
    });
  }

  function renderNextButton(state) {
    const wrap = document.getElementById('nextWrap');
    if (state.question.index + 1 >= state.question.total) return;
    wrap.innerHTML = `<button class="next-btn" id="nextBtn">Next scenario →</button>`;
    document.getElementById('nextBtn').addEventListener('click', refreshState);
  }

  function renderNextButtonFromResult(result, index) {
    const wrap = document.getElementById('nextWrap');
    if (result.completed) {
      wrap.innerHTML = `<button class="next-btn" id="finishBtn">View final results →</button>`;
      document.getElementById('finishBtn').addEventListener('click', refreshState);
    } else {
      wrap.innerHTML = `<button class="next-btn" id="nextBtn">Next scenario →</button>`;
      document.getElementById('nextBtn').addEventListener('click', refreshState);
    }
  }

  function showHintBanner(text) {
    const wrap = document.getElementById('hintBannerWrap');
    if (wrap) wrap.innerHTML = `<div class="hint-banner">💡 ${escapeHtml(text)}</div>`;
  }

  async function useHint() {
    const state = await api('/state');
    try {
      const res = await api('/assist/hint', {
        method: 'POST',
        body: JSON.stringify({ index: state.question.index }),
      });
      showHintBanner(res.hintText);
      await refreshAssistOnly(res.assistance);
    } catch (e) {
      alert(e.body && e.body.error ? e.body.error : 'Could not use hint.');
    }
  }

  async function useReveal() {
    const state = await api('/state');
    try {
      const res = await api('/assist/reveal', {
        method: 'POST',
        body: JSON.stringify({ index: state.question.index }),
      });
      document.querySelectorAll('.step-item').forEach(li => {
        li.classList.toggle('first-step-revealed', li.dataset.key === res.revealedFirstStep);
      });
      await refreshAssistOnly(res.assistance);
    } catch (e) {
      alert(e.body && e.body.error ? e.body.error : 'Could not reveal first step.');
    }
  }

  async function refreshAssistOnly(assistance) {
    const state = await api('/state');
    renderAssistBar(state);
  }

  function confirmFriend() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box">
        <h4>Use your Ask a Friend?</h4>
        <p>This is your team's only Ask a Friend for the whole competition. Once confirmed, you'll get 60 seconds to consult someone outside your team.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="cancelFriend">Cancel</button>
          <button class="btn btn-orange" id="confirmFriend">Yes, use it</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.getElementById('cancelFriend').addEventListener('click', () => backdrop.remove());
    document.getElementById('confirmFriend').addEventListener('click', async () => {
      try {
        const res = await api('/assist/friend', { method: 'POST' });
        backdrop.innerHTML = `
          <div class="modal-box">
            <h4>Ask a Friend — in progress</h4>
            <div class="friend-countdown" id="friendCountdown">01:00</div>
            <div class="modal-actions"><button class="btn btn-primary" id="closeFriend">Close</button></div>
          </div>
        `;
        let secs = 60;
        const cd = document.getElementById('friendCountdown');
        const iv = setInterval(() => {
          secs -= 1;
          cd.textContent = `00:${String(Math.max(secs, 0)).padStart(2, '0')}`;
          if (secs <= 0) clearInterval(iv);
        }, 1000);
        document.getElementById('closeFriend').addEventListener('click', () => { clearInterval(iv); backdrop.remove(); });
        await refreshAssistOnly(res.assistance);
      } catch (e) {
        backdrop.remove();
        alert(e.body && e.body.error ? e.body.error : 'Could not use Ask a Friend.');
      }
    });
  }

  function renderGame(state) {
    renderShell(state);
    currentQuestionRef = state.question;
    renderAssistBar(state);
    renderQuestionCard(state);
  }

  function renderCompletion(state) {
    clearInterval(timerInterval);
    const max = teamInfo.totalQuestions * 15;
    app.innerHTML = `
      <div class="hero-panel completion-panel">
        <div class="q-domain-tag">Competition completed</div>
        <h1>Nice work, ${teamInfo.name}</h1>
        <div class="final-score">${state.totalScore}</div>
        <div class="final-max">out of ${max} points</div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  boot();
})();
