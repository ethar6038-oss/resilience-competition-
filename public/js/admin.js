(function () {
  const grid = document.getElementById('teamGrid');
  const refreshBtn = document.getElementById('refreshBtn');
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
      progress.forEach(p => {
        const card = document.querySelector(`.team-card[data-slug="${p.slug}"]`);
        if (!card) return;
        const bar = card.querySelector('.progress-bar > span');
        const meta = card.querySelector('.meta');
        const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (meta) {
          meta.textContent = p.started
            ? `${p.answered}/${p.total} answered · ${p.score} pts${p.completed ? ' · Completed' : ''}`
            : 'Not started yet';
        }
      });
    } catch (e) { /* non-fatal */ }
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
          <button class="btn btn-primary" data-action="reveal">Get link</button>
          <button class="btn btn-orange" data-action="copy">Copy</button>
          </div>
<input type="text" class="link-reveal" readonly value="${link}" />
      `;
      card.querySelector('[data-action="reveal"]').addEventListener('click', () => {
        card.querySelector('.link-reveal').classList.toggle('show');
      });
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
