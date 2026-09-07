# SQDC Board

A digital replacement for the physical SQDC (Safety, Quality, Delivery, Cost) board.
An Admin/Superuser uploads the daily and weekly Excel exports (**Admin** tab), which
populates each KPI's Performance value automatically; staff then log in with their
Employee ID and use **Enter Remarks** to add the remark/reason for any KPI that missed
target — 3 KPIs (Accident During Operation, QC Preventive Maintenance & Service,
Average Litres per Vessel Call) still get their Performance value typed in manually,
since they aren't reliably captured by the upload. The dashboard renders each pillar
with a large S/Q/D/C letter mosaic, a run chart vs. target, a Pareto of reasons, and the
pillar's action list. A **Next 24 Hours** board shows the day's leading KPI projections —
also from the Admin Excel upload, no manual entry needed. An **Insights** page lets an
admin export missed-target remarks, run them through any AI tool of their choice
(outside this app — no API cost to this project), re-import the categorized result, and
optionally pin a live-updating breakdown of it as an extra chart on the Board itself.

Stack: React + TypeScript + Vite, Supabase (Postgres + REST), deployed on Vercel.

---

## Start here if you're new to this project

This section exists so that whoever is reading this can figure out what's going on and
what to do next, without needing to ask the original developer.

### Where everything actually lives

| Thing | Where |
|---|---|
| Source code | GitHub - ops-ptp/SQDC |
| Hosting / build | Vercel - auto-deploys on every push to main |
| Database | Supabase (Postgres) - one project |
| This document | README.md, at the root of the repo |

All three accounts should be under a shared/company-owned account, not any one person's
personal login. If you're not sure whether that's actually true, check it now - go to
each platform's account/organization settings and confirm at least two people have
Owner or Admin access. This matters more than anything else in this document.

### What you can do without touching any code

Everything in the app's own UI (Admin tab, Enter Remarks, Action Log, Insights) is meant
to be operated with no code or SQL involved. Day to day, that covers:

- Uploading the Daily/Weekly Excel files
- Reviewing a newly auto-created KPI's pillar guess and pass/fail direction (see below)
- Hiding/showing a KPI, or deleting one entirely, in KPI Management
- Entering remarks, managing the Action Log
- Running an Insights export, AI categorize, re-import, pivot cycle, and pinning a chart
  to the Board

### What still needs someone comfortable with SQL or code

- Adding/editing pillars, reasons, or employees (including promoting someone to admin)
- Correcting a KPI's pillar or unit if an upload's auto-guess got it wrong
- Anything that's a genuine bug, or a new feature

If this comes up with no one in-house available: this is a standard React + Supabase +
Vercel stack, which any web developer can pick up. Point them at this README and
supabase/schema.sql first.

### If something looks wrong, check here before assuming it's a new bug

- "I uploaded/pushed but the site still shows the old version." Almost always either:
  GitHub's web upload was used with the whole unzipped folder dragged in as one item
  (nests files one level too deep instead of overwriting them - drag in the folder's
  contents, not the folder itself, and check the file list before committing); or
  Vercel's last deploy actually failed and it's silently still serving the previous
  build - check the Deployments tab.
- "A new KPI shows up twice in KPI Management." Usually means the deployed code and the
  repo have drifted apart - confirm the deploy actually landed before assuming a fresh
  bug.
- "A KPI's colors look wrong after changing its direction." Pass/fail is computed live
  everywhere that matters, but daily_entries.met_target is a snapshot written at upload
  time. Changing direction doesn't retroactively rewrite old rows unless something
  recomputes them - this mostly self-heals as rows get re-saved, and a full backfill is
  a short SQL UPDATE if ever needed.
- "The Board's pillar columns are misaligned." The 4 quadrants use CSS subgrid to stay
  aligned row by row - every quadrant must render the same number of top-level sections
  regardless of content. See the comment above .board-grid in index.css before adding or
  removing a section.

### Review this after every Daily upload

A newly auto-created KPI gets two best-guesses that cannot be inferred from the Excel
file alone:

1. Pillar - guessed from the category header above the column. Usually right.
2. Direction (higher/lower is better) - always defaults to "higher is better", since
   nothing in the sheet says which way is good for a metric never seen before. A KPI
   like a delay or waiting time (where lower is better) will show the wrong colors until
   corrected.

Both are one click to fix in KPI Management. The upload's review screen also names every
new KPI before you confirm, which is the best moment to catch a pillar mistake.

---

## 1. Create the Supabase project

1. Go to supabase.com, New project.
2. In SQL Editor, run supabase/schema.sql then supabase/seed.sql. schema.sql is safe to
   re-run in full at any time (every statement is guarded).
3. Project Settings, API - copy the Project URL and anon public key.

To make a real employee an Admin: update employees set is_admin = true where
employee_code = '0000XX';

## 2. Configure the app

Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and
VITE_SUPABASE_ANON_KEY. Then npm install and npm run dev.

## 3. Push to GitHub

Standard git remote add / push. If pushing via the GitHub website instead: unzip the
delivered file, open the unzipped folder so you're looking at its contents (src, public,
supabase, package.json), select all of that, and drag those items onto GitHub's Upload
files page - not the outer folder itself. Check the file list before committing: paths
should read src/pages/Insights.tsx, not sqdc-repo/src/pages/Insights.tsx. Getting this
wrong is the most common reason a push appears to succeed but the site never changes.

## 4. Deploy to Vercel

Import the GitHub repo, add the two env vars before first deploy, deploy. Every push to
main auto-deploys after that.

---

## The KPI catalog

Pillars: Safety, Quality, Delivery, Cost, each with lagging KPIs tracked daily and
(Quality/Delivery/Cost) leading KPIs on the Next 24 Hours board. The live catalog in KPI
Management is the current source of truth - several KPIs have been auto-created from new
spreadsheet columns since launch (e.g. ITT SLA Delivery, Yard Density) and aren't in the
original template list.

A few modeling decisions worth knowing:

- A lagging KPI whose column genuinely carries distinct values under both Day and Night
  shift rows is modeled as two KPI rows. This is detected from the sheet's actual data,
  not guessed from the header - there's no way to tell from the header alone.
- Percentage-style KPIs are stored as raw value times 100. The upload reads the Excel
  cell's actual number format first, falling back to a magnitude heuristic only when a
  cell has no explicit format.
- Moves' target moves day to day - the upload reads the sheet's own Projection column
  and writes it as that row's snapshot target.
- Leading KPIs have no target, just a daily projected value.

---

## How the data model maps

pillars: the 4 pillars.
kpis: every KPI - pillar, unit, target, direction, leading/lagging, visible. kpi_no is a
friendly display number, not the real id.
kpi_assignments: who's responsible for a KPI (currently unused by Enter Remarks).
daily_entries: one row per KPI per day. is_manual_override protects a person-typed
value from the upload. ai_category is the Insights categorization tag, if any.
weekly_entries: blended weekly fallback figures, keyed by pillar + KPI base name.
reasons: curated reasons feeding the Pareto.
actions: the action list. action_no is a friendly number. Overdue is derived, not
stored.
leading_entries: Next 24 Hours values, one row per KPI per day.
kpi_daily_targets: per-day/shift target from the Target sheet, falls back to kpis.target.
employees: is_admin gates Admin/Insights. employee_no is a friendly number.
custom_paretos: a saved Insights pivot chart pinned to the Board - stores the
configuration, not a snapshot, so it stays live as more entries get categorized.
employees_role_backup: backup of the deprecated employees.role column's data.

kpis.info has real explanatory text for most seeded KPIs but the app doesn't currently
display it anywhere.

kpis.is_secondary marks a comparison-only metric (Mainliner Load GMPH's old-calculation
pair) - shown dimmed on the Board, excluded from Enter Remarks and the Action Log.

The old forecast_cards table was renamed to archived_forecast_cards during a database
cleanup - fully preserved, just unused.

Most lagging KPIs are stored as two DB rows ("Moves (Day)" / "Moves (Night)") but the
Board only shows one pill per KPI - grouped client-side via baseNameOf() in
src/types.ts. Anywhere new that needs to treat a split KPI as one logical thing should
use that shared helper rather than re-deriving the base name locally - one place
recognizing a split KPI and another not has caused real bugs before.

---

## The S/Q/D/C letter mosaic

Each quadrant's hero is the pillar's letter made of a fixed 31-cell layout on a 7x8
grid, each cell colored by that day's combined Day+Night average vs target. The layout
is hand-authored fixed data in PillarLetterGrid.tsx.

Clicking a cell pivots the entire Board, not just that pillar, to review that exact
date - headline, target, trend window, remarks, Pareto, and Actions across all 4 pillars
switch together, handled by Dashboard.tsx's selectedDay state. A cell is only clickable
once it has real data and isn't in the future - that cutoff is pinned to the actual
latest available day and does not move just because you clicked an earlier day.

## Reviewing a past month

A month dropdown next to the Daily/Weekly toggle lets you review any of the last 12
months. Selecting a past month locks the view to Daily and reviews that month's last day
by default, or whichever day you click in the letter grid.

---

## Admin Excel upload

The Admin tab (is_admin only) has two upload widgets. Parsing logic lives in
src/lib/excelUpload.ts.

The Daily upload reads the file first and shows a preview of exactly what would change -
which KPIs would be newly created, and which existing ones are no longer in the file and
would be hidden (never deleted) - before anything is written.

- Reads Daily Database, Target, and Next 24hrs tabs in that order. Upserts
  daily_entries by (kpi_id, entry_date).
- Target sheet feeds per-day/shift targets for every KPI, including newly auto-created
  ones - matched against the live catalog the same way the Daily Database values are.
  This specific consistency was once a real, shipped bug: a target's column-matching
  used an older, separate check than the value-matching, so a split KPI's target
  silently never got read. Worth checking that both use the same isKnownBase() helper
  if a future KPI's target mysteriously doesn't show up on the Trend chart.
- New spreadsheet columns are auto-created - pillar guessed from the category header,
  unit guessed from the Excel cell's number format, and whether it needs a Day/Night
  split is detected from the sheet's actual data. Direction always defaults to higher
  is better.
- The 3 manual-entry KPIs are read from the upload only as a fallback - a person-typed
  value is never overwritten.
- Mainliner Load GMPH - both old and new calculation columns are captured, old goes to
  dimmed secondary KPIs.
- Weekly upload reads Weekly Database and upserts weekly_entries by (pillar_id,
  kpi_base_name, iso_year, iso_week). Never auto-creates or hides catalog KPIs, so no
  preview step, unlike Daily.
- The Weekly board view falls back to weekly_entries for any of the last 8 ISO weeks
  with no daily data logged at all.

### KPI Management

One combined, grouped list of every KPI - lagging and leading together, Day/Night
folded into one row per logical KPI. Columns: Pillar, KPI Name, Higher/Lower is better
(dropdown, applies to every underlying variant at once), Visible (kpis.active, one
shared setting for the whole board), and Delete (permanent, behind a confirmation that
names exactly what it erases - every entry, target, remark, reason - no undo). Shows
about 10 rows before scrolling.

Pillar and unit are still not editable here - a wrong auto-guess for either still needs
the Supabase Table Editor.

### Why exceljs, not xlsx

The obvious npm package, xlsx (SheetJS), has known high-severity advisories with no npm
fix. Since Admin uploads are trusted-user-only, exceljs was used instead.

---

## Insights - AI-assisted categorization and pivot builder

Slices missed-target remarks by any angle using an AI tool the admin already has access
to. No AI/API integration lives in this app, and it never sends data anywhere on its
own.

1. Pick a pillar and KPI.
2. Export table - an Excel-style sortable/filterable table (AutoFilter-style dropdown
   per column, with search) of missed-target entries over the last 180 days. Download
   CSV exports exactly what's currently visible. A copyable, editable prompt tells the
   AI which angle to categorize by.
3. Re-import the completed CSV - matched by a hidden id column, only the category field
   is written.
4. Pivot builder - drag-and-drop field panel (Category / Shift / Week) into Filters /
   Rows / Columns, next to a live Pareto chart or cross-tab table.
5. Save to Board (or Update) pins that pivot configuration as an extra chart on the
   Board for that KPI - it re-runs live against whatever's currently categorized, not a
   frozen snapshot. Delete only exists in Insights, never on the Board page itself.

Shared pivot math lives in src/lib/pivot.ts - if a saved chart ever renders differently
on the Board than in Insights, check there first.

---

## App structure

- / Board: 4-quadrant view, no login required. Reviews yesterday by default, or a past
  month/specific date via the controls above. Quadrant sections align row by row across
  all 4 pillars via CSS subgrid - the section count per quadrant must match the
  subgrid's row count in index.css or sections overlap. The custom-Pareto slot is always
  rendered, even empty, for exactly this reason.
- /forward-looking Next 24 Hours: read-only, no login required.
- /admin: gated by is_admin. Excel upload, KPI Management.
- /insights: also gated by is_admin.
- /entry Enter Remarks: requires an Employee ID, any logged-in employee can update any
  KPI. Pass/fail and "needs a remark" are computed live from current direction, not read
  from a stored snapshot.
- /actions Action Log: no login required to view or add; status changes are admin-only.

---

## Administering things that still require SQL/Table Editor

- Pillars, reasons, employees - Table Editor or SQL following seed.sql's shape.
- A KPI's pillar or unit, if auto-detected wrong - Table Editor.
- Promoting someone to Admin: update employees set is_admin = true where employee_code
  = '...';

Everything else about a KPI - direction, visibility, deletion - is in KPI Management.

---

## Security - read before relying on this beyond a trusted internal pilot

Employee ID login has no password, and only gates /entry, /admin, and /insights. There
is no Supabase Auth session - the browser talks to Postgres using the public anon key,
and RLS policies allow that key to read everything and write to most tables. This is
intentional for a trusted shop-floor terminal/network, but it means anyone with the app
URL can log an entry as any employee for any KPI, anyone with the anon key (visible in
browser dev tools, meant to be public) can read/write those tables directly via the API,
and the is_admin gates are client-side convenience, not a security boundary.

Before relying on this beyond an internal pilot, consider real Supabase Auth with RLS
policies checking auth.uid() against employees/kpi_assignments.

## What's intentionally out of scope

- Real per-user auth/RLS scoping
- Editing/deleting past daily entries beyond today's, outside KPI Management's delete
- Multi-site / multi-board support
- Push notifications, email digests, scheduled exports
