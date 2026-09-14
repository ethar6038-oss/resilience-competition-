# Cybersecurity Competition — 12 Teams

A scenario-sequencing cybersecurity competition for 12 teams, each with its own
12 scenarios (3 domains × 4 scenarios), drag-and-order steps, a 2-minute timer
per scenario, one attempt per scenario, partial-credit scoring, and a shared
pool of limited assistance (3 Hints / 2 Reveal First Step / 1 Ask a Friend)
per team for the whole competition.

Scoring and the answer key are enforced **server-side** — a team can never see
the correct order by viewing page source or the network tab. They only learn
whether each step was right after they submit.

## What's in this repo

```
server.js                 Express server — routing, sessions, scoring, hints
package.json
data/
  teams.json               The 12 teams and their slugs
  scenarios/<slug>.json     12 scenarios per team, generated from your Excel file
  sessions.json             Created automatically at runtime (git-ignored)
public/
  admin/index.html          Administrator Dashboard (12 team cards → link)
  team/index.html            Dynamic team competition page (shared by all 12 teams)
  css/style.css              Shared theme
  js/admin.js                 Admin dashboard logic
  js/competition.js           Competition gameplay logic
```

## Visual identity

The palette (deep navy background, bright cyan for interactive/progress
elements, orange accent) is inspired by the reference identity you shared. As
agreed, **the site does not display the company name or logo anywhere** —
only the color and layout language.

## Run it locally

```bash
npm install
npm start
```
Then open:
- `http://localhost:3000/admin` — Administrator Dashboard
- `http://localhost:3000/team/<slug>` — a specific team's competition (slugs are in `data/teams.json`)

## Deploying — GitHub → Railway

1. **Create a GitHub repo** and push this folder:
   ```bash
   git init
   git add .
   git commit -m "Cybersecurity competition site"
   git branch -M main
   git remote add origin https://github.com/<your-org>/<repo-name>.git
   git push -u origin main
   ```
2. **On Railway**: New Project → *Deploy from GitHub repo* → select the repo.
   Railway detects `package.json` and runs `npm install && npm start`
   automatically — no extra config needed.
3. Once deployed, Railway gives you a public URL, e.g.
   `https://your-project.up.railway.app`.
   - Administrator Dashboard: `https://your-project.up.railway.app/admin`
   - Team links: `https://your-project.up.railway.app/team/<slug>`
4. Any time you push a change to `main`, Railway redeploys automatically.

### Team links (slugs)

| Team | Link path |
|---|---|
| Shared Services | `/team/shared-services` |
| Manufacturing | `/team/manufacturing` |
| Corporate Affairs | `/team/corporate-affairs` |
| Corporate Finance | `/team/corporate-finance` |
| Polymers SBU | `/team/polymers-sbu` |
| Corporate Governance | `/team/corporate-governance` |
| Corporate HR | `/team/corporate-hr` |
| Chemicals SBU | `/team/chemicals-sbu` |
| Internal Audit | `/team/internal-audit` |
| E&PM | `/team/epm` |
| T&I | `/team/ti` |
| Agri-Nutrient | `/team/agri-nutrient` |

You don't need to hand these out manually — the Admin Dashboard's **Get
link / Copy** buttons generate the full URL for whichever host you deployed
to.

## How the game logic works

- **Session per browser**: the first time someone opens a team link, the
  server sets an httpOnly cookie and creates a session for that team. As long
  as they use the same browser, refreshing resumes exactly where they left
  off (current question, score, hints used).
- **Step order**: each scenario's 3 correct steps are shuffled server-side
  per session, so the display order looks different across teams/sessions,
  but the correct sequence is never sent to the browser — only after
  submission.
- **Scoring**: 5 points per step placed in the correct position (max 15 per
  scenario, 180 total across 12 scenarios).
- **One attempt**: `POST /api/team/:slug/answer` is rejected once a question
  has already been attempted — including if the 2-minute timer runs out,
  which auto-submits whatever order is currently arranged.
- **No skip**: the "Next scenario" control only appears after a submission.
- **Assistance** (shared across all 12 scenarios, not per-question):
  - **Hint** ×3 — surfaces the "area measured" framing for the current
    scenario without giving the answer.
  - **Reveal First Step** ×2 — reveals which step is correct in position 1.
  - **Ask a Friend** ×1 — a 60-second countdown modal; doesn't change scoring
    itself, just gives the team a moment to consult someone.
  - None of these deduct points — the constraint is purely that each is very
    limited across the whole competition.
- **Admin Dashboard** also shows live progress (questions answered, score,
  completed) per team, refreshing every 15 seconds — useful for facilitators
  watching the room.

## Updating scenario content later

If wording needs to change after this build, edit the relevant file directly
in `data/scenarios/<slug>.json` (same shape as the others: `domain`,
`scenario`, `steps` in **correct** order, `rationale`, `areaMeasured`,
`ifCorrect`, `ifWrong`). No other code changes are needed — the server reads
this file at startup, so redeploy after editing.

## Regenerating scenario data from a new Excel file

The `data/scenarios/*.json` files were generated from
`Copy_of_Scenarios_Sep_2026.xlsx` (one sheet per team, columns: Domain,
Scenario, Step 1, Step 2, Step 3, Rationale, Area measured, If correct, If
wrong — Steps given in the *correct* order). If you get an updated Excel
file, re-run the same extraction logic against it to refresh the JSON files. 
