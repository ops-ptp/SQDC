# SQDC Board — MVP

A digital replacement for the physical SQDC (Safety, Quality, Delivery, Cost) board.
Staff log in with their Employee ID, enter today's KPI results (with a reason if the
target was missed), and the dashboard renders each pillar with a large S/Q/D/C letter
mosaic, a run chart vs. target, a Pareto of reasons, and the pillar's action list.
A **Forward Looking** kanban board lets the team forecast leading KPIs 1–3 days out.

Stack: **React + TypeScript + Vite**, **Supabase** (Postgres + REST), deployed on **Vercel**.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region.
2. Once it's provisioned, open **SQL Editor** and run the two files in this repo, in order:
   - `supabase/schema.sql` — creates all tables, the view, Row Level Security policies,
     and the `is_leading` KPI flag + `forecast_cards` table used by Forward Looking.
   - `supabase/seed.sql` — loads the 4 pillars, the real terminal-ops KPI catalog (20
     lagging KPIs tracked daily + 7 leading KPIs for Forward Looking — see below), 8
     sample employees, curated reason lists, ~20 days of demo daily entries, a couple of
     demo actions, and a few demo forecast cards — so the app is fully demoable
     immediately.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

You can re-run `seed.sql` any time to reset demo data back to a clean state — it clears
its own tables first.

## 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Then locally:

```bash
npm install
npm run dev
```

Open the printed localhost URL. Try logging in with one of the seeded Employee IDs:
`E001` (Nasser), `E004` (Farah), `E005` (Hassan), `E006` (Zaid), etc. — see
`supabase/seed.sql` for the full list and which KPIs each is assigned.

## 3. Push to GitHub

This project is already a git repo with an initial commit. Create an empty repo on
GitHub (no README/license — keep it empty so the push doesn't conflict), then:

```bash
cd sqdc-mvp
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git push -u origin main
```

Don't worry about accidentally committing your Supabase keys — `.env.local` is already
in `.gitignore`, so only `.env.example` (placeholders) goes to GitHub.

## 4. Deploy to Vercel (via GitHub)

1. In Vercel: **Add New → Project** → **Import Git Repository** → pick the repo you just
   pushed. Vercel auto-detects the Vite framework preset — no changes needed.
2. Before the first deploy, add the two environment variables (**Environment Variables**
   step in the import wizard, or **Project Settings → Environment Variables** after):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy. `vercel.json` is already set up to rewrite all routes to `index.html` so the
   client-side router (`/entry`, `/actions`, `/login`) works on refresh/direct links.
4. From here on, every `git push` to `main` auto-deploys — that's the whole workflow:
   edit code → push to GitHub → Vercel redeploys automatically, no CLI needed on your end.

## The KPI catalog (from `OPS_SQDC_-_Aug_2026.xlsx`)

The board now tracks your real terminal-ops KPIs instead of the generic template
example set:

| Pillar | Lagging KPIs (tracked daily on the Board) |
|---|---|
| **S — Safety** | Accident During Operation (Day/Night) |
| **Q — Quality** | Delay – Waiting for CHE (L&D), Overall Mixing Yard, Labour Supply as Required – QC Gang (each Day/Night) |
| **D — Delivery** | Moves, GMPH Mainliner, GMPH Feeder, Mainliner Load GMPH, Gate Truck Waiting Time >1 hour (each Day/Night) |
| **C — Cost** | QC Preventive Maintenance & Service, Average Litres per Vessel Call (single daily figure, no shift split) |

| Pillar | Leading KPIs (forecast on Forward Looking, +1/+2/+3 days) |
|---|---|
| **Q** | QC Gang - Projection Next Shift |
| **D** | Moves - Projection Day/Night Shift, TEUs Run Rate (Forecast), Lashing - Projection Next Shift |
| **C** | QC PM & Service - MTD, QC PM & Service - Projection Next Day |

A few modeling decisions worth knowing about:

- **Day/Night shift split**: most lagging KPIs are tracked separately per shift in
  your source sheet, so each is modeled as two KPI rows (e.g. "Moves (Day)" /
  "Moves (Night)") — `daily_entries` is one row per KPI per calendar day, so a shift
  dimension needs its own KPI row rather than an extra column.
- **Ratio-style KPIs** (Delay – Waiting for CHE, Overall Mixing Yard, Gate Truck
  Waiting Time) are stored as percentages (raw sheet value × 100) for readability —
  e.g. the sheet's `0.11` target is `11` in the app.
- **Moves** has a Projected/Actual/Variant structure in your sheet — the day's target
  itself moves day to day. This MVP tracks Actual against a fixed representative
  target (~the Aug-2026 average projection) rather than a day-by-day editable target.
  If you want the daily projection itself editable (so the target moves with it),
  that's a reasonable v2 addition — say the word.
- **Leading KPIs have no daily target/actual** — in your sheet they're forecast/
  discussion items with no data columns, which maps directly onto `forecast_cards`
  (Forward Looking) rather than `daily_entries`.
- The demo `daily_entries` seeded by `seed.sql` are **synthetic** (deterministic
  pseudo-random values around each KPI's target), not the literal Aug-2026 numbers
  from your workbook. Let me know if you'd like the real historical figures imported
  instead.

## How the data model maps

| Concept | Table |
|---|---|
| 4 pillars (Safety/Quality/Delivery/Cost) | `pillars` |
| Each pillar's KPI(s), unit, target, higher/lower-is-good, leading/lagging | `kpis` (`is_leading` flag) |
| Who's responsible for updating a KPI | `kpi_assignments` (lagging KPIs only) |
| Daily Value vs. Target, one row per KPI per day | `daily_entries` |
| Curated reasons feeding the Pareto, picked when a daily entry misses target | `reasons` |
| Action list (Related reason/issue, Action, Owner, Deadline, Status) | `actions` (`status`: not_started / in_progress / dropped / completed) |
| Forward Looking forecast cards (+1/+2/+3 days, leading KPIs only) | `forecast_cards` |

Most lagging KPIs are still stored as two DB rows — e.g. `kpis` rows named
`"Moves (Day)"` and `"Moves (Night)"` — but the **Board only shows one pill per
KPI**: `PillarQuadrant` groups any `"X (Day)"` / `"X (Night)"` pair client-side
into a single pill labeled `"X"`, with the Day and Night numbers shown split out
in the headline (never as separate pills/tabs). KPIs with no shift split (e.g.
"QC Preventive Maintenance & Service") are their own single-member group.

The Pareto chart is computed **per KPI** (i.e. per pill, combining its Day+Night
entries), not mashed together for the whole pillar, over the same window as the
trend chart (see below).

## The S/Q/D/C letter mosaic

Each quadrant's hero is the pillar's letter (S/Q/D/C) made of a **fixed
31-cell layout on an 8-column x 9-row grid that never changes**, each cell
labeled with its date. A cell's color is the combined Day+Night average for
that KPI on that date, compared to target — so unlike a typical dot-mosaic,
every cell maps to a specific real day rather than an arbitrary decorative
pixel. This always shows the full current calendar month regardless of the
Daily/Weekly toggle below (the toggle only changes the trend chart's window).

The layout is **hand-authored, fixed data** in `PillarLetterGrid.tsx` — not
computed at runtime — so it's identical every time for a given letter, with
no dependency on the browser (`<canvas>`, fonts, etc.). Shorter months
(28–30 days) don't get a differently-shaped/differently-sized letter — the
trailing cells that have no matching date (e.g. cell #29 onward in February)
are simply blackened, no number shown, on the exact same 31-cell shape.
Verified by rendering the exact same coordinate data to PNG (via a script,
independent of this repo) and visually confirming all 4 letters read
correctly, including the 28-day blackening behavior.

## App structure

- **`/` — Board (Dashboard)**: the 4-quadrant SQDC view of **lagging** KPIs, no
  login required (meant to be left open on a shared screen/TV, like the
  physical board). **Reviews the most recently completed day (yesterday), not
  today** — matches how the real SQDC huddle works: you discuss what actually
  happened yesterday, not a day still in progress. A blue "Reviewing
  &lt;date&gt;" badge next to the page title makes this explicit, since the
  page header's own date is today's calendar date. The letter mosaic, pill
  outlines, and headline numbers all reflect yesterday. Deliberately
  monochrome — hero background and Pareto chart are neutral grey, so the only
  color is each KPI pill's green/red **outline** (yesterday's pass/fail) and
  the selected pill's reverse fill. A **Daily / Weekly** toggle switches the
  trend chart and Pareto window — the letter mosaic always shows the full
  calendar month containing the reviewed day, regardless of the toggle:
  - **Daily**: trend chart covers the last 7 days; Pareto covers the same
    window.
  - **Weekly**: trend chart covers the **last 8 ISO weeks** (Monday–Sunday,
    per ISO 8601 week numbering — the x-axis is labeled "Wk 34" etc., not a
    date), each point a simple average of that week's logged days. Two line
    styles: **Overall** (thicker, solid) and **Day / Night** where
    applicable (thinner, dashed, smaller dots) — Overall is the primary
    read, Day/Night are the secondary breakdown. Pareto covers the same
    8-week window. The **Remarks/Summary section is hidden** in Weekly view,
    since remarks are per-day free text and don't meaningfully aggregate to
    a week.

  Each quadrant's hero/pills/headline/[remarks]/trend/Pareto/actions
  sections align row-by-row across all 4 pillars (CSS subgrid); the grid's
  row count adjusts automatically between Daily (7 rows) and Weekly (6 rows,
  no remarks row).
- **`/forward-looking` — Forward Looking**: a kanban-style board for **leading**
  KPIs with three columns — **Today, Tomorrow, Day After** — the flip side of
  the Board reviewing yesterday: the same huddle that looks back at
  yesterday's results looks forward starting from today. Requires an Employee
  ID. Add, edit, or delete a forecast card per column, or use the ←/→ buttons
  on a card to shift it a day earlier/later. Requires at least one KPI with
  `is_leading = true`.
- **`/entry` — Enter KPI Data**: requires an Employee ID. Has its own date
  picker (defaults to **yesterday**, capped at today — staff typically log
  yesterday's completed shift each morning, but same-day entry is still
  allowed). Day/Night KPI pairs appear as **one card with a Day/Night
  toggle** (matching the Board's pill grouping) rather than two separate
  cards. Each entry captures: the actual value, a **Remarks** field, and — if
  the value misses target — a required reason category (with an explicit
  "Other, please specify" option) **and** required remarks explaining what
  happened. Remarks show up on the Board's Daily-view Remarks/Summary
  section.
- **`/actions` — Action Log**: view/add actions across all pillars, filter by
  pillar, and change each action's status (Not started / In progress /
  Dropped / Completed) from a dropdown.

## Administering KPIs, targets, and assignments (MVP — via SQL)

This MVP doesn't ship an admin UI yet. To add/change KPIs, targets, reason lists, or who's
assigned to what, use the Supabase **Table Editor** (Project → Table Editor) or SQL Editor
directly on `pillars`, `kpis`, `kpi_assignments`, `reasons`, and `forecast_cards`.
`supabase/seed.sql` is a good reference for the shape of each insert. To mark a KPI as
leading (so it shows up on Forward Looking instead of the main Board), set
`kpis.is_leading = true`.

## Security — read before relying on this beyond a demo

Employee ID login has **no password**. There is no Supabase Auth session — the browser
talks to Postgres using the public `anon` key, and the Row Level Security policies in
`schema.sql` allow that anon key to read everything and write to `daily_entries` and
`actions`. This is intentional for an MVP used on a trusted shop-floor terminal/network
(matches the "anyone on shift can update the board" behavior of the physical board), but
it means:

- Anyone who has the app URL and knows (or guesses) an Employee ID can enter data for it.
- Anyone with the anon key (visible in browser dev tools — it's meant to be public) can
  read and write `daily_entries`/`actions` directly via the API, not just through the UI.

Before using this for anything beyond an internal pilot, consider upgrading to real
Supabase Auth (email/password or magic link per employee) and rewriting the RLS policies
to check `auth.uid()` against `kpi_assignments`/`employees` so writes are actually scoped
to the logged-in person.

## What's intentionally out of scope for this MVP

- Admin UI for managing pillars/KPIs/targets/reasons/employees (use Supabase Table Editor
  for now).
- Editing/deleting past daily entries beyond today's (the app only lets you enter/update
  *today's* value per KPI — `daily_entries` is unique per `kpi_id, entry_date` so a
  correction just re-saves that day).
- A day-by-day editable target for "Moves" — currently tracked against a fixed
  representative target rather than the sheet's daily-changing Projected figure.
- Multi-site / multi-board support (one board, one Supabase project).
- Push notifications, email digests, or export.
