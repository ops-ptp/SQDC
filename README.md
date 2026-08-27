# SQDC Board — MVP

A digital replacement for the physical SQDC (Safety, Quality, Delivery, Cost) board.
An Admin/Superuser uploads the daily and weekly Excel exports (**Admin** tab), which
populates each KPI's Performance value automatically; staff then log in with their
Employee ID and use **Enter Remarks** to add the remark/reason for any KPI that missed
target — 3 KPIs (Accident During Operation, QC Preventive Maintenance & Service,
Average Litres per Vessel Call) still get their Performance value typed in manually,
since they aren't reliably captured by the upload. The dashboard renders each pillar
with a large S/Q/D/C letter mosaic, a run chart vs. target, a Pareto of reasons, and the
pillar's action list. A **Next 24 Hours** board shows the day's leading KPI projections —
also from the Admin Excel upload, no manual entry needed.

Stack: **React + TypeScript + Vite**, **Supabase** (Postgres + REST), deployed on **Vercel**.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region.
2. Once it's provisioned, open **SQL Editor** and run the two files in this repo, in order:
   - `supabase/schema.sql` — creates all tables, the view, Row Level Security policies,
     the `is_leading` KPI flag, and (2026-08-25/26 migrations) `employees.is_admin`,
     `kpis.manual_entry`, `daily_entries.is_manual_override`, the `weekly_entries` table
     used by the Admin upload, and the `leading_entries` table used by the Next 24 Hours
     board — see "Admin Excel upload" below. **Already ran schema.sql on an existing
     project?** It's safe to re-run in full — every statement is guarded (`if not exists`
     / `drop ... if exists`), so it just applies the new migration at the bottom without
     touching your existing data.
   - `supabase/seed.sql` — loads the 4 pillars, the real terminal-ops KPI catalog (20
     lagging KPIs tracked daily + 7 leading KPIs for Next 24 Hours — see below, 3 of the
     20 flagged `manual_entry = true`), 8 sample employees (one, `000003`/Aiman, seeded as
     `is_admin = true` — the demo Admin/Superuser), curated reason lists, ~20 days of
     demo daily entries, a couple of demo actions, and one day of demo leading KPI figures
     — so the app is fully demoable immediately. Employee IDs are 6-digit, zero-padded
     numbers (`000001`, `000002`, …) — enforced by a check constraint in `schema.sql`.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

You can re-run `seed.sql` any time to reset demo data back to a clean state — it clears
its own tables first. To make a *real* employee an Admin/Superuser (rather than the demo
000003), run: `update employees set is_admin = true where employee_code = '0000XX';`

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
`000001` (Nasser), `000004` (Farah), `000005` (Hassan), `000006` (Zaid), etc. — see
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
   client-side router (`/entry`, `/actions`, `/admin`, `/login`) works on refresh/direct
   links.
4. From here on, every `git push` to `main` auto-deploys — that's the whole workflow:
   edit code → push to GitHub → Vercel redeploys automatically, no CLI needed on your end.

## The KPI catalog (from `OPS_SQDC_-_Aug_2026.xlsx`)

The board now tracks your real terminal-ops KPIs instead of the generic template
example set:

| Pillar | Lagging KPIs (tracked daily on the Board) | Performance value source |
|---|---|---|
| **S — Safety** | Accident During Operation (Day/Night) | **Manual entry** (Enter Remarks) |
| **Q — Quality** | Delay – Waiting for CHE (L&D), Overall Mixing Yard, Labour Supply as Required – QC Gang (each Day/Night) | Admin Excel upload |
| **D — Delivery** | Moves, GMPH Mainliner, GMPH Feeder, Mainliner Load GMPH, Gate Truck Waiting Time >1 hour (each Day/Night) | Admin Excel upload |
| **C — Cost** | QC Preventive Maintenance & Service, Average Litres per Vessel Call (single daily figure, no shift split) | **Manual entry** (Enter Remarks) |

The 3 manual-entry KPIs are flagged `kpis.manual_entry = true` — everything else is
remarks-only once the Admin upload is populating it. See "Admin Excel upload" below.

| Pillar | Leading KPIs (Next 24 Hours board) | Unit |
|---|---|---|
| **Q** | QC Gang - Projection Next Shift | Gangs |
| **D** | Moves - Projection Day/Night Shift | Moves |
| **D** | TEUs Run Rate (Forecast) | TEUs |
| **D** | Lashing - Projection Next Shift | Gangs |
| **C** | QC PM & Service - MTD, QC PM & Service - Projection Next Day | % |

Leading KPIs are read-only on the board — their numbers come from the Admin Daily
upload's **"Next 24hrs"** tab (see "Admin Excel upload" below), not manual entry.

A few modeling decisions worth knowing about:

- **Day/Night shift split**: most lagging KPIs are tracked separately per shift in
  your source sheet, so each is modeled as two KPI rows (e.g. "Moves (Day)" /
  "Moves (Night)") — `daily_entries` is one row per KPI per calendar day, so a shift
  dimension needs its own KPI row rather than an extra column.
- **Ratio-style KPIs** (Delay – Waiting for CHE, Overall Mixing Yard, Gate Truck
  Waiting Time) are stored as percentages (raw sheet value × 100) for readability —
  e.g. the sheet's `0.11` target is `11` in the app.
- **Moves** has a Projected/Actual/Variant structure in your sheet — the day's target
  itself moves day to day. The Admin Excel upload now reads the sheet's own
  **Projection** column and writes it as that row's `daily_entries.target`, so pass/
  fail, the Board pill, the letter grid, and the Trend chart's target line all follow
  the real day-by-day projection instead of a fixed catalog value. (If a row's Actual
  is present but Projection is blank, the upload falls back to the catalog's fixed
  target for just that row and flags it in the upload warnings.) The Trend chart shows
  the target as a dashed line that moves with the data for Moves, and stays a flat
  reference line for every other KPI, whose target genuinely is fixed.
- **Leading KPIs have no target, just a daily projected value** — one number per KPI
  per day, sourced from the "Next 24hrs" tab into `leading_entries` (a separate table
  from `daily_entries` since there's no target/pass-fail to compute, just a figure to
  display). The Next 24 Hours board shows each KPI's latest uploaded value, independent
  per KPI (if one KPI's column is missing from an upload, the others still update). The
  older `forecast_cards` table (manually-typed forecast notes) still exists in the
  schema but the app no longer reads or writes it — safe to ignore or drop if you don't
  need it.
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
| Daily Value vs. Target, one row per KPI per day | `daily_entries` (`is_manual_override` = true when a person typed the value in, protecting it from the Admin upload) |
| Blended weekly figures from the Weekly Excel upload (fallback for the Weekly board) | `weekly_entries` (keyed by pillar + KPI base name, not `kpi_id` — see below) |
| Curated reasons feeding the Pareto, picked when a daily entry misses target | `reasons` |
| Action list (Related reason/issue, Action, Owner, Deadline, Status) | `actions` (`status`: not_started / in_progress / dropped / completed — "Overdue" is a 5th *display* state derived client-side from `status` + `deadline`, not stored) |
| Next 24 Hours leading KPI values, one row per KPI per day | `leading_entries` |
| Per-day/shift KPI target, from the Daily workbook's Target sheet | `kpi_daily_targets` (falls back to `kpis.target` when no row exists yet) |
| Who can see/use the Admin tab | `employees.is_admin` |

`kpis.is_secondary` marks a comparison-only metric (currently just Mainliner
Load GMPH's old-calculation pair) — shown on the Board as a dimmed secondary
number/line, but excluded from Enter Remarks and the Action Log's KPI picker.

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
31-cell layout on a 7-column x 8-row grid that never changes**, each cell
labeled with its date. A cell's color is the combined Day+Night average for
that KPI on that date, compared to target — so unlike a typical dot-mosaic,
every cell maps to a specific real day rather than an arbitrary decorative
pixel. This always shows the full current calendar month regardless of the
Daily/Weekly toggle below (the toggle only changes the trend chart's window).

The layout is **hand-authored, fixed data** in `PillarLetterGrid.tsx` — not
computed at runtime — transcribed cell-by-cell from the "SQDC Letter Grid &
Sequence" reference diagram (programmatic green/white pixel sampling per
cell, cross-checked against zoomed crops of every row of every letter, not
eyeballed — two of the four letters number a few cells out of simple
row-major order, e.g. Cost's bottom hook is numbered 19-20-**31**-then-
21-22-**29**-**30**-then-23-28, which is easy to misread by eye). Shorter
months (28–30 days) don't get a differently-shaped/differently-sized letter
— the trailing cells that have no matching date (e.g. cell #29 onward in
February) are simply blackened, no number shown, on the exact same 31-cell
shape.

## Admin Excel upload

The **Admin** tab (visible only to `employees.is_admin = true`) has two upload
widgets — one for `OPS SQDC Daily.xlsx`, one for `OPS SQDC Weekly.xlsx` —
parsed entirely in the browser (via `exceljs`, see "Why exceljs, not xlsx"
below) and written straight to Supabase. Parsing logic lives in
`src/lib/excelUpload.ts`.

- **Daily upload** reads three tabs from one workbook — **Daily Database**,
  **Target**, and **Next 24hrs** — in that order, since Target's values feed
  Daily Database's own target snapshot. Date is column A, Shift is column B
  in the real file (detected by header text, not hardcoded, since an earlier
  version of the sheet had them one column over — worth knowing if the
  layout ever shifts again). **Upserts `daily_entries` by `(kpi_id,
  entry_date)`** — re-uploading updates matching rows only, every other date
  is untouched. A handful of column headers don't match this app's KPI names
  1:1 (documented in `excelUpload.ts`) — e.g. "Labour Supply (QC Gang)" →
  "Labour Supply as Required – QC Gang", "Truck Turnaround Time >1 hour" →
  "Gate Truck Waiting Time >1 hour". Percentage-style KPIs are converted the
  same way as the seed data (raw × 100).
- **Target sheet → per-day/shift targets, for every KPI.** Unlike a single
  flat target row, this tab is Date+Shift rows just like Daily Database, so a
  KPI's target can genuinely change over time (confirmed from the real
  file — several KPIs step to a new target partway through). Parsed into
  `kpi_daily_targets` (`kpi_id`, `entry_date`, `target`); the Daily upload
  looks a row up there first when snapshotting each `daily_entries.target`,
  falling back to the `kpis.target` catalog value only when no Target-sheet
  row exists yet. Enter Remarks does the same lookup for the 3 manual-entry
  KPIs, so a manually-typed value is judged against the right day's target.
  A textual threshold like "≤425" (seen on Average Litres per Vessel Call)
  has its numeric part extracted automatically.
- **Mainliner Load GMPH — both calculations captured.** The sheet's "(old
  calculation)" and "(new calculation)" columns are both written now (the
  old calculation used to be discarded, keeping only new). New calculation
  goes to the existing "Mainliner Load GMPH (Day)"/"(Night)" KPIs (unchanged
  meaning — this is what drives the letter grid and remark-required logic);
  old calculation goes to new `is_secondary = true` KPIs, "Mainliner Load
  GMPH (Old) (Day)"/"(Night)", shown as a dimmed secondary number on the
  headline and two dimmed/thinner lines on the same trend chart. Secondary
  KPIs never appear in Enter Remarks or the Action Log's KPI picker, and the
  Target sheet's single "Mainliner Load GMPH" column applies to both.
- **The 3 manual-entry KPIs are still read from the Daily upload** (their
  columns exist in the sheet) **but only as a fallback** — before writing,
  the upload checks which `(kpi_id, date)` pairs already have
  `is_manual_override = true` and skips those rows entirely, so a value a
  person typed into Enter Remarks is never silently overwritten by a later
  upload. The upload's own writes always set `is_manual_override = false`.
- **New spreadsheet columns are auto-created in the catalog.** If Daily
  Database or Next 24hrs has a column whose header doesn't match any known
  KPI (e.g. a newly added "Yard Density Projection"), the upload creates a
  best-guess `kpis` row for it before parsing the rest of the file — pillar
  guessed from the merged category header above the column ("QUALITY" →
  Quality), unit blank, target 0, higher-is-better — so that same upload's
  values land immediately. Review/fix the guessed fields afterward in the
  Admin page's **KPI Management** table.
- **Weekly upload** reads the "Weekly Database" sheet (ISO week rows, e.g.
  "Week 27") and **upserts `weekly_entries` by `(pillar_id, kpi_base_name,
  iso_year, iso_week)`**. Two things worth knowing: the sheet's week labels
  carry no year, so the upload assumes the **current ISO year** (surfaced as
  a warning after each upload); and the sheet's figures are already blended
  (no Day/Night split) while most KPIs only exist as split rows in `kpis` —
  so `weekly_entries` is keyed by KPI *base name* + pillar instead of a
  `kpi_id` FK. The Weekly upload's target is still a flat catalog value —
  the per-date Target sheet above is a Daily-workbook-only concept for now.
- **The Weekly board view** aggregates live from `daily_entries` first (same
  as before); for any of the last-8-ISO-weeks that has **no daily data
  logged at all**, it falls back to `weekly_entries` if a row exists for that
  week. Since that fallback number is blended, it's plotted on **both** the
  Day and Night lines (the best available stand-in for a number the upload
  never split out) — a documented simplification, not a data quality claim.
- **The same Daily upload also reads the "Next 24hrs" sheet** (one row per
  date, one column per leading KPI) and **upserts `leading_entries` by
  `(kpi_id, entry_date)`** — no separate button, since it's the same
  workbook. Column headers are matched directly against `kpis.name` (they're
  the exact KPI names in this sheet, not a translated header like the Daily
  Database mapping above), and % KPIs get the same raw × 100 conversion as
  everywhere else. A date row with some KPI columns still blank (not yet
  entered) only writes the columns that have a value — it doesn't clear or
  skip the others. The Next 24 Hours board always shows each KPI's most
  recently uploaded value, so re-uploading with a new day's row just
  advances the board forward. Sections are shown in Quality → Delivery →
  Cost order.

### KPI Management (Admin page)

One combined, editable list of every KPI — Board (lagging) and Next 24 Hours
(leading) together — for showing/hiding and fixing up auto-created entries.
"Visible" maps straight to `kpis.active`: it's **one global setting for the
whole board**, not a per-admin saved view, since this is a shared shift
screen. Edits (pillar, unit, target, higher/lower-is-good, visibility) are
staged locally and committed together via "Save changes". A KPI flagged
`is_secondary` (currently just Mainliner Load GMPH's old-calculation pair) is
labeled as such in the list — it's a real, editable catalog row, just never
offered as its own remarks/action target elsewhere in the app.

### Why exceljs, not xlsx

The obvious npm package for this is `xlsx` (SheetJS) — but the npm registry
build has [two known high-severity advisories](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
with no fix published to npm (SheetJS ships the patched build from their own
CDN instead, which this sandbox's network policy couldn't reach while
building this). Since Admin uploads are trusted-user-only, not
arbitrary-internet-input, the risk bar is lower than a public upload form —
but `exceljs` sidesteps the issue entirely with no equivalent advisory in its
direct parsing path, so that's what's wired in. If you'd rather use
SheetJS's actual patched build, install it from their CDN
(`npm install https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`) and
swap the `import ExcelJS from 'exceljs'` calls in `src/lib/excelUpload.ts`
for the SheetJS `read`/`utils.sheet_to_json` API.

## App structure

- **`/` — Board (Dashboard)**: the 4-quadrant SQDC view of **lagging** KPIs, no
  login required (meant to be left open on a shared screen/TV, like the
  physical board). **Reviews the most recently completed day (yesterday), not
  today** — matches how the real SQDC huddle works: you discuss what actually
  happened yesterday, not a day still in progress. A blue "Reviewing
  &lt;date&gt;" badge next to the page title makes this explicit, since the
  page header's own date is today's calendar date. The letter mosaic, pill
  outlines, and headline numbers all reflect yesterday. Each pillar's letter
  mosaic **background** and **Pareto chart background** are tinted with that
  pillar's color (same palette as the Action Log's pillar chips/filters) —
  everything else on the Board stays neutral: KPI pill outlines are still
  green/red by pass/fail (not pillar-colored). Each KPI's subtitle line just
  reads "Target &lt;value&gt; &lt;unit&gt;" — the "higher/lower is good" phrase and the
  reviewed date were dropped to keep it clean and consistent across every
  pillar's KPIs (the date is still shown once, in the page-level "Reviewing
  &lt;date&gt;" badge). The trend chart shows only **Day** (dark orange) and
  **Night** (dark blue) lines — no separate "Overall" line — with each
  point's dot colored red/green by that point's own pass/fail, and the
  Y-axis auto-padded to the data's actual range instead of a fixed
  0-anchored scale, so the shape of the trend stays visible even for a KPI
  that only moves in a narrow band. A **Daily / Weekly** toggle switches the
  trend chart and Pareto window — the letter mosaic always shows the full
  calendar month containing the reviewed day, regardless of the toggle:
  - **Daily**: trend chart covers the last 7 days; Pareto covers the same
    window. The Trend chart is followed by **Remarks/Summary** — any shift
    that missed target and still has no remark logged is highlighted red
    and, for a logged-in employee, clickable straight into `/entry` with
    that pillar/KPI/date pre-selected. One **"Hide/Show Pareto & Actions"**
    button in the page header (not per-quadrant) collapses Pareto + Actions
    across all 4 pillars together.
  - **Weekly**: trend chart covers the **last 8 ISO weeks** (Monday–Sunday,
    per ISO 8601 week numbering — the x-axis is labeled "Wk 34" etc., not a
    date), each point a simple average of that week's logged days (falling
    back to the uploaded Weekly figure for a week with no daily data at all
    — see "Admin Excel upload" above). **Pareto covers a separate, shorter
    last-2-weeks window** — deliberately not the trend's 8-week window. The
    Remarks/Summary section and the Pareto/Actions toggle are both
    Daily-only — Weekly always shows Pareto + Actions with no toggle.

  Each quadrant's hero/pills/headline/[remarks]/trend/Pareto/actions
  sections align row-by-row across all 4 pillars (CSS subgrid) — the section
  count per quadrant must match the subgrid's row count (`repeat(7, auto)`
  daily / `repeat(6, auto)` weekly in `index.css`) or the extra section
  overlaps the next one; keep that in mind before adding/removing a section.
- **`/forward-looking` — Next 24 Hours**: a read-only board for **leading**
  KPIs — each one's most recently uploaded value (see "Admin Excel upload"
  above), grouped by pillar. No forms, no login required at all — like the
  Board, it's meant to be left open on a shared screen. A KPI with no
  `leading_entries` row yet shows "No data uploaded yet" instead of a blank
  or zero. Requires at least one KPI with `is_leading = true`.
- **`/admin` — Admin**: gated by `employees.is_admin` (a logged-in non-admin
  is bounced back to the Board; a logged-out visitor goes to Login first).
  Two file-upload widgets for the Daily/Weekly Excel exports — see "Admin
  Excel upload" above for the full parsing/upsert behavior.
- **`/entry` — Enter Remarks**: requires an Employee ID (to attribute the
  entry), but **any logged-in employee can update any KPI** —
  `kpi_assignments` is no longer used to restrict which KPIs someone can
  enter, only `fetchKpisForEmployee()` (still in `lib/data.ts`, just unused
  by this page now) reads it. Flow: pick a **date** (defaults to yesterday,
  capped at today), pick a **pillar** (pills, not a dropdown), pick a **KPI**
  (pills, not a dropdown). Pills are **grey until that KPI has an entry for
  the selected date**, switch to the pillar's color once logged and passing,
  and turn **red with a "!"** when the entry missed target and still has no
  remark — a banner at the top of the page also counts how many KPIs are in
  that state for the selected date. The **pillar pills** carry the same
  grey-until-complete logic one level up: a pillar pill stays grey until
  every one of its KPIs that missed target has a remark filled in, then
  switches to that pillar's color. Arriving via the Board's "no remarks
  logged" highlight pre-selects the matching pillar, KPI, and date. For the
  3 `manual_entry` KPIs (Accident
  During Operation, QC Preventive Maintenance & Service, Average Litres per
  Vessel Call), the flow is unchanged from before: enter the actual value
  directly (saved with `is_manual_override = true`, protecting it from the
  Admin upload). For every other KPI, the Performance value is **read-only**
  (sourced from the Admin upload) and the form only lets you add
  **Remarks** and — if the value missed target — a required reason category
  (with an explicit "Other, please specify" option) **and** required remarks
  explaining what happened; if no Admin upload has reached that KPI/date
  yet, the form says so instead of showing a blank value. Remarks show up on
  the Board's Daily-view Remarks/Summary section.
- **`/actions` — Action Log**: **no login required to view or add** —
  anyone, logged in or not, can view the log and submit a new action.
  Changing an existing action's status (Not started / In progress / Dropped
  / Completed, via a dropdown) is restricted to logged-in **Admins**
  (`employees.is_admin`); everyone else sees the status as a plain
  read-only badge instead of a dropdown. Filter by pillar. A 5th
  state, **Overdue, is derived rather than stored** — computed from
  `(status, deadline)` client-side, since an action can be simultaneously
  "In progress" *and* overdue (completed/dropped items are never shown as
  overdue, since they're already closed out). Rows are background-tinted by
  this derived status (red for overdue, blue for in-progress, faded
  strikethrough for completed/dropped) so the list is scannable at a glance
  without reading every deadline.

## Administering KPIs, targets, and assignments (MVP — via SQL)

This MVP doesn't ship an admin UI yet. To add/change KPIs, targets, reason lists, or who's
assigned to what, use the Supabase **Table Editor** (Project → Table Editor) or SQL Editor
directly on `pillars`, `kpis`, `kpi_assignments`, and `reasons`.
`supabase/seed.sql` is a good reference for the shape of each insert. To mark a KPI as
leading (so it shows up on Next 24 Hours instead of the main Board), set
`kpis.is_leading = true` — its numbers then come from the Daily upload's "Next 24hrs"
sheet, so its `kpis.name` needs to exactly match that sheet's column header.

## Security — read before relying on this beyond a demo

Employee ID login has **no password**, and only gates `/entry` and `/admin`
— `/` (Board), `/forward-looking` (Next 24 Hours), and `/actions` (Action
Log) never required login to *view* and still don't; `/forward-looking` is
now fully read-only for everyone (no login-gated actions on that page at
all — see "Admin Excel upload" above). There is no Supabase Auth session —
the browser talks to Postgres using the public `anon` key, and the Row Level
Security policies in `schema.sql` allow that anon key to read everything and
write to `daily_entries`/`actions`/`weekly_entries`/`leading_entries`. This is
intentional for an MVP used on a trusted shop-floor terminal/network (matches
the "anyone on shift can update the board" behavior of the physical board),
but it means:

- Anyone who has the app URL and knows (or guesses) an Employee ID can log an
  entry as them — for **any** KPI, not just ones "assigned" to them.
  `kpi_assignments` exists in the schema and is seeded, but `/entry` no
  longer reads it to restrict access; it's vestigial unless you wire it back
  in.
- Anyone with the anon key (visible in browser dev tools — it's meant to be
  public) can read and write `daily_entries`/`actions`/`weekly_entries`
  directly via the API, not just through the UI.
- The `/admin` route's `is_admin` gate is a **client-side UI convenience,
  not a security boundary** — it hides the Admin nav link and redirects
  non-admins away from the page, but the same anon key that powers the rest
  of the app can call `bulkUpsertDailyEntriesFromUpload`/
  `bulkUpsertWeeklyEntriesFromUpload`'s underlying Supabase calls directly
  from any browser console, `is_admin` or not. Treat "who can upload the
  Daily/Weekly Excel files" as advisory until real Supabase Auth + RLS
  scoping (see below) is in place. Same caveat applies to `leading_entries` —
  it's written by the same upload flow and shares the same permissive RLS
  policy.

Before using this for anything beyond an internal pilot, consider upgrading to real
Supabase Auth (email/password or magic link per employee) and rewriting the RLS policies
to check `auth.uid()` against `kpi_assignments`/`employees` so writes are actually scoped
to the logged-in person.

## What's intentionally out of scope for this MVP

- Admin UI for managing pillars/KPIs/targets/reasons/employees — the `/admin` tab
  only covers *daily performance data* (via the Daily/Weekly Excel upload); adding or
  editing pillars, KPI definitions/targets, reasons, or employees (including promoting
  someone to `is_admin`) still requires the Supabase Table Editor.
- Editing/deleting past daily entries beyond today's (the app only lets you enter/update
  *today's* value per KPI — `daily_entries` is unique per `kpi_id, entry_date` so a
  correction just re-saves that day).
- Multi-site / multi-board support (one board, one Supabase project).
- Push notifications, email digests, or export.
