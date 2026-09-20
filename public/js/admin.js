(function () {
  const grid = document.getElementById('teamGrid');
  const refreshBtn = document.getElementById('refreshBtn');
  const leaderboard = document.getElementById('leaderboard');
  let teams = [];

  async function loadTeams() {
    const res = await fetch('/api/admin/teams');
    teams = await res.json();
    render();
    loadProgress();
  }

  async function loadProgress() {
    try {
      const res = await fetch('/api/admin/progress');
      const progress = await res.json();
      renderLeaderboard(progress);
      progress.forEach(p => {
        const card = document.querySelector(`.team-card[data-slug="${p.slug}"]`);
        if (!card) return;
        const bar = card.querySelector('.progress-bar > span');
        const meta = card.querySelector('.meta');
        const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (meta) {
  if (!p.started) {
    meta.innerHTML = `
      <div>Not started yet</div>
      <div class="admin-details">
        Current Question: —<br>
        💡 Hints: 0/3 · 👁 Reveals: 0/2 · ☎ Friend: 0/1<br>
        🔀 Hidden Q12: Not used
      </div>
    `;
  } else {
    meta.innerHTML = `
      <div>
        ${p.answered}/${p.total} answered · ${p.score} pts
        ${p.completed ? ' · Completed' : ''}
      </div>

      <div class="admin-details">
        Current Question:
        ${p.completed ? 'Completed' : `Q${p.currentQuestion}`}
        <br>
        💡 Hints: ${p.hints.used}/${p.hints.max}
        · 👁 Reveals: ${p.reveals.used}/${p.reveals.max}
        · ☎ Friend: ${p.friend.used}/${p.friend.max}
        <br>
        🔀 Hidden Q12: ${p.hiddenUsed ? 'Used' : 'Not used'}
      </div>
    `;
  }
        }
      });
    } catch (e) { /* non-fatal */ }
  }
function renderLeaderboard(progress) {
  if (!leaderboard) return;

  const ranked = [...progress].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.answered - a.answered;
  });

  leaderboard.innerHTML = ranked.map((team, index) => {
    const rank = index + 1;

    let medal = '';
    if (rank === 1) medal = '🥇';
    else if (rank === 2) medal = '🥈';
    else if (rank === 3) medal = '🥉';

    return `
      <div class="leaderboard-row ${rank <= 3 ? 'top-three' : ''}">
        <div class="leaderboard-rank">
          ${medal || rank}
        </div>

        <div class="leaderboard-team">
          <strong>${team.name}</strong>
          <span>${team.answered}/${team.total} questions answered</span>
        </div>

        <div class="leaderboard-score">
          ${team.score} <span>pts</span>
        </div>
      </div>
    `;
  }).join('');
}
  function render() {
    grid.innerHTML = '';
    teams.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'team-card';
      card.dataset.slug = t.slug;
      const origin = window.location.origin;
      const link = `${origin}/team/${t.slug}`;
      card.innerHTML = `
        <div class="idx">TEAM ${String(i + 1).padStart(2, '0')}</div>
        <h3>${t.name}</h3>
        <div class="meta">Loading progress…</div>
        <div class="progress-bar"><span style="width:0%"></span></div>
        <div class="actions">
  <a class="btn btn-primary" href="${link}" target="_blank">Open team link</a>
  <button type="button" class="btn btn-orange" data-action="copy">Copy link</button>
</div>
<input type="text" class="link-reveal show" readonly value="${link}" />
      `;
      const linkInput = card.querySelector('.link-reveal');

const copyBtn = card.querySelector('[data-action="copy"]');



linkInput.addEventListener('click', () => {
  linkInput.select();
});

copyBtn.addEventListener('click', async () => {
  linkInput.classList.add('show');

  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link);
      copied = true;
    }
  } catch (e) {
    copied = false;
  }

  if (!copied) {
    try {
      linkInput.focus();
      linkInput.select();
      linkInput.setSelectionRange(0, link.length);
      copied = document.execCommand('copy');
    } catch (e) {
      copied = false;
    }
  }

  copyBtn.textContent = copied ? 'Copied!' : 'Select & copy below';

  setTimeout(() => {
    copyBtn.textContent = 'Copy';
  }, 1800);

  if (!copied) {
    linkInput.focus();
    linkInput.select();
  }
});
      grid.appendChild(card);
    });
  }

  refreshBtn.addEventListener('click', loadProgress);
  setInterval(loadProgress, 15000);
  loadTeams();
})();
