# SQDC Board — MVP

A digital replacement for the physical SQDC (Safety, Quality, Delivery, Cost) board.
Staff log in with their Employee ID, enter today's KPI results (with a reason if the
target was missed), and the dashboard renders each pillar exactly like the board:
a run chart vs. target, a Pareto of reasons, and the pillar's action list.

Stack: **React + TypeScript + Vite**, **Supabase** (Postgres + REST), deployed on **Vercel**.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region.
2. Once it's provisioned, open **SQL Editor** and run the two files in this repo, in order:
   - `supabase/schema.sql` — creates all tables, the view, and Row Level Security policies.
   - `supabase/seed.sql` — loads the 4 pillars, 8 example KPIs (from your template — LTI,
     TTT, First Pass Yield, etc.), 8 sample employees, curated reason lists, ~20 days of
     demo daily entries, and a couple of demo actions, so the app is fully demoable
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

## How the data model maps to your template

| Template concept | Table |
|---|---|
| 4 pillars (Safety/Quality/Delivery/Cost) | `pillars` |
| Each pillar's KPI(s), unit, target, higher/lower-is-good | `kpis` |
| Who's responsible for updating a KPI | `kpi_assignments` |
| Daily Value ↓ / Day 1-31 grid, vs. Target | `daily_entries` (one row per KPI per day) |
| "Reason # / Reason description" feeding the Pareto | `reasons` (curated per-KPI list) picked when a daily entry misses target |
| Action list (Related reason/issue, Action, Owner, Deadline, Done?) | `actions` |

The Pareto chart on the dashboard is computed **per KPI** (matching your
"4 - Pareto - Simple" TTT example), not mashed together for the whole pillar. If a
pillar has more than one KPI, use the tabs at the top of its quadrant to switch which
KPI's run chart and Pareto are shown.

## App structure

- **`/` — Board (Dashboard)**: the 4-quadrant SQDC view, no login required (meant to be
  left open on a shared screen/TV, like the physical board).
- **`/entry` — Enter KPI Data**: requires an Employee ID. Shows only the KPIs assigned
  to that employee for today. If a value misses target, a reason is required before it
  can be saved (feeds the Pareto chart).
- **`/actions` — Action Log**: view/add actions across all pillars, filter by pillar,
  and check items off as done.

## Administering KPIs, targets, and assignments (MVP — via SQL)

This MVP doesn't ship an admin UI yet. To add/change KPIs, targets, reason lists, or who's
assigned to what, use the Supabase **Table Editor** (Project → Table Editor) or SQL Editor
directly on `pillars`, `kpis`, `kpi_assignments`, and `reasons`. `supabase/seed.sql` is a
good reference for the shape of each insert.

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
- Multi-site / multi-board support (one board, one Supabase project).
- Push notifications, email digests, or export.
