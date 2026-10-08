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
also from the Admin Excel upload, no manual entry needed. An **Insights** page lets a
department admin tag missed-target remarks from several angles with AI suggestions
(Google Gemini) they review, analyse what drives the misses, and pin a live-updating
chart of it to the Board.

Stack: React + TypeScript + Vite, Supabase (Postgres + REST), deployed on Vercel.

**Multi-department.** Every department has its own board at `/d/<web address>` (e.g.
`/d/ops` for Operations), with its own KPIs, team, uploads, actions and Insights. The
navbar title is a department switcher; **All boards** (`/boards`) lists every department
with yesterday's met/missed count. Three roles, all managed in the app:

| Role | Can do |
|---|---|
| **Site admin** | Site Admin page: create/archive departments and name each one's first department admin; company-wide employee roster; make other site admins. Can also act as admin in every department. |
| **Department admin** | Their department's Admin page: KPIs (add, rename, re-pillar, target, direction, Day/Night, Weekly view, hide, delete), Members (add/remove, roles), Uploads, Settings (how data gets in). Also Insights and Action Log status. |
| **Member** | Enter Data / Enter Remarks for their department. |
| Anyone (no login) | View any board, Next 24 Hours and Action Log. |

Each department picks how data gets in (Admin → Settings): **typed in the app**, **Excel
upload**, or **both** (a value typed in the app is never overwritten by an upload). Excel
upload uses either a **template the app generates from the department's own KPI list**
(Admin → Uploads → Download template) or — for Operations — the original OPS SQDC
Daily/Weekly workbooks. Operations' Weekly view reads its Weekly workbook; every other
department's Weekly view rolls up its daily values (average or total, set per KPI).

The old single-board links (`/`, `/actions`, `/entry`, …) still work: they open the same
page of the last department that screen viewed, else Operations — so existing bookmarks
and TV screens keep showing the Operations board.

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

- Creating a new department and naming its admin (Site Admin)
- Setting up a department's KPIs from scratch — name, pillar, unit, target, direction,
  Day/Night split, Weekly view — and renaming or moving one to another pillar later
  (Admin → KPIs)
- Adding people to a department and choosing who's admin (Admin → Members)
- Choosing how a department's data gets in, and downloading its upload template
  (Admin → Settings / Uploads)
- Uploading the Daily/Weekly Excel files
- Reviewing a newly auto-created KPI's pillar guess and pass/fail direction (see below)
- Hiding/showing a KPI, or deleting one entirely
- Adding a new employee, editing an ID/name, making someone a site admin, or
  deactivating a leaver (Site Admin → Employees)
- Entering data and remarks, managing the Action Log
- Tagging remarks in Insights (AI-assisted), analysing them and pinning a chart to the
  Board

### What still needs someone comfortable with SQL or code

- Adding/editing pillars or reasons
- Bootstrapping the very first site admin (nobody can open Site Admin to grant it until
  at least one account already is one): `update employees set is_site_admin = true where
  employee_code = '0000XX';`
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

To bootstrap the very first site admin (before anyone can log into the not-yet-deployed
app to use Site Admin): update employees set is_site_admin = true where employee_code =
'0000XX'; — once the app is deployed and that person can log in, every further
department, hire, ID/name edit, or admin promotion goes through the app instead.

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
- Moves' target moves day to day - it comes from the Target sheet's per-day, per-shift
  Moves column. It usually equals the Next 24hrs projection but not always (some Night
  shifts differ).
- Leading KPIs (Next 24 Hours) have a Target setting in Admin → KPIs: none, a fixed
  number, or follow a board KPI's target for the DAY BEFORE the projection's date (a
  projection for today is planned against yesterday's target; kpis.has_target +
  kpis.target_kpi_id).
  With a target, the card turns green or red and shows "Target X · N above/below".

---

## How the data model maps

pillars: the 4 pillars.
kpis: every KPI - pillar, unit, target, direction, leading/lagging, visible. kpi_no is a
friendly display number, not the real id.
daily_entries: one row per KPI per day. is_manual_override protects a person-typed
value from the upload.
weekly_entries: the Board's Weekly-view source of truth for the 7 KPIs the Weekly
workbook tracks, keyed by pillar + KPI base name + ISO year + ISO week (not kpi_id,
since the sheet's figures are already blended, no Day/Night split).
reasons: curated reasons feeding the Pareto.
actions: the action list. action_no is a friendly number. Overdue is derived, not
stored.
leading_entries: Next 24 Hours values, one row per KPI per day.
kpi_daily_targets: per-day/shift target from the Target sheet, falls back to kpis.target.
departments: one row per department board (slug = its /d/<slug> address, entry_mode,
upload_format). department_members: employee x department x role (admin/member).
employees: one company-wide roster; is_site_admin marks site admins. kpis, actions, weekly_entries,
custom_paretos and kpi_categories carry department_id; everything keyed by kpi_id
inherits its KPI's department.
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

For departments using the OPS workbook format (Operations), the Admin → Uploads tab has
these upload widgets. Other departments get the generated template instead
(src/lib/templateUpload.ts). Parsing logic lives in
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
  preview step, unlike Daily. The sheet's week labels carry no year at all, and a real
  export can span more than one calendar year (week numbers reset from ~52 back to 01
  partway through) — the upload infers each row's actual year from where those resets
  happen, anchored to today's date (the most recent row is assumed to be at-or-before
  today, never in the future), and flags the inferred year range in its warnings so it
  can be spot-checked rather than trusted blindly.
- The Board's Daily/Weekly toggle sources the Weekly view directly from weekly_entries
  for exactly the 7 KPIs the Weekly workbook tracks (Accident During Operation, Delay –
  Waiting for CHE, Overall Mixing Yard, GMPH Mainliner, GMPH Feeder, Mainliner Load
  GMPH, QC Preventive Maintenance & Service) — not aggregated from daily data. Every
  other KPI (Moves, anything Daily-only or auto-created) is hidden from the KPI pills
  while Weekly is selected, since it has no weekly figure to show. The headline number,
  its target, and the Trend chart's 8-week window all read from this table. The letter
  mosaic and Pareto chart are unaffected by this — they stay exactly as in Daily view,
  still built from daily_entries, since remarks/reasons only exist at the daily level
  and the letter grid's day-by-day layout doesn't map onto weeks.

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

## Insights - AI-assisted tagging and analysis

Insights works on one KPI at a time (pillar pills, then KPI pills). A summary strip shows
its missed-target remarks over the last 180 days, how many are tagged, and how many per
angle. Three tabs, in the order you'd use them:

### 1 · Tag remarks (Google Gemini)

Sends the KPI's missed-target remarks (a date range, up to 300 at a time) to Google
Gemini and asks it to tag each remark from one or more ANGLES at once (up to 5) — e.g.
Cause, Equipment, Location, Crew. An angle is a Pareto "dimension": it has its own
category pick-list (kpi_categories) and its own Pareto tab in the Weekly view. Admins can
add a new angle right there ("+ New angle"); its settings live in kpi_dimensions. Each
angle is either single-tag (one answer per remark, e.g. Location) or multi-tag ("Up to 3
tags per remark", e.g. a delay caused by both a CHE breakdown and a manpower shortage).

Gemini only SUGGESTS tags, each with a confidence and the words behind it. The
department admin reviews every row — removes or adds tags per angle, unticks rows —
sees each angle's preview Pareto, and only "Save" writes anything: the tags
(entry_categories — the same tags Enter Remarks and the Weekly Pareto use), any new
category into that angle's pick-list, and the angle settings. Saving only adds tags; it
never removes ones already on a remark.

The Gemini key never reaches the browser. It lives in the Supabase Edge Function
supabase/functions/categorize-remarks as a secret: Supabase dashboard → Edge Functions →
Secrets → GEMINI_API_KEY (and optionally GEMINI_MODEL, default gemini-3.8-flash; GEMINI_FALLBACK_MODELS, default gemini-3.7-flash,gemini-3.5-flash-lite — used when the main model is overloaded). With no
key set, the section says the feature is switched off. The function only serves
department admins of that department (and site admins), checked server-side by Employee
ID. Use a paid (billing-enabled) Google AI Studio key for live data: on the free tier
Google may use prompts and responses to improve its products. Deploy changes to the
function with the Supabase CLI (supabase functions deploy categorize-remarks) or the
dashboard.

### 2 · Analyse

Group by any angle (or Shift / Week) for a Pareto, Split by a second field for a shaded
cross-tab (e.g. Cause × Equipment), and Filter by a third. A remark with several tags in
one angle counts once under each; the chart then labels each bar with its share of
remarks ("2 · 67%"). "Pin to Board" saves that view as an extra chart on the KPI's Board
card (custom_paretos) — live, recomputed from the tags whenever the Board loads. Remove
only exists here, never on the Board page itself.

### 3 · Remarks

Every missed-target remark of the last 180 days with its tags — an Excel-style
sortable/filterable table (AutoFilter-style dropdown per column, with search).

The old CSV export → external AI → re-import cycle was retired on 2026-10-07; the
categories it had written became tags under a "Category" angle
(supabase/migrations_cleanup_csv_cycle.sql).

Shared pivot math lives in src/lib/pivot.ts - if a saved chart ever renders differently
on the Board than in Insights, check there first.

---

## App structure

- Every department page lives under /d/:slug (DepartmentLayout in
  src/context/DepartmentContext.tsx provides the current department via useDepartment()).
  Below, paths are relative to it.
- /boards All boards, /site-admin Site Admin (site admins only).
- / Board: 4-quadrant view, no login required. Reviews yesterday by default, or a past
  month/specific date via the controls above. Quadrant sections align row by row across
  all 4 pillars via CSS subgrid - the section count per quadrant must match the
  subgrid's row count in index.css or sections overlap. The custom-Pareto slot is always
  rendered, even empty, for exactly this reason.
- /next-24-hours Next 24 Hours: no login required to view; in departments that type
  their data in the app, members update today's figure on each card.
- /admin: department admins (and site admins). Uploads, KPIs, Members, Settings
  (src/pages/admin/).
- /insights: department admins.
- /entry Enter Data / Enter Remarks: requires an Employee ID that's a member of the
  department. Pass/fail and "needs a remark" are computed live from current direction, not read
  from a stored snapshot.
- /actions Action Log: no login required to view or add; status changes are department-admin only.

---

## Administering things that still require SQL/Table Editor

- Pillars, reasons - Table Editor or SQL following seed.sql's shape.
- Bootstrapping the very first site admin: update employees set is_site_admin = true
  where employee_code = '...'; (only needed once, before anyone can open Site Admin).

Everything about a KPI is in its department's Admin → KPIs. Employees - adding, ID/name
edits, site admin, deactivating - are in Site Admin → Employees (department admins add
people to their own team in Admin → Members); there's no hard delete by design
(daily_entries.entered_by has no cascade-delete, so it stays attributed to whoever really
entered it - "Active" is how you retire someone).

Database changes for departments are in supabase/migrations_multi_department.sql
(also appended to schema.sql). It's backward compatible with the pre-department app
apart from three upserts, so run it right before deploying the department code.

---

## Security - read before relying on this beyond a trusted internal pilot

Employee ID login has no password, and only gates /entry, /admin, and /insights. There
is no Supabase Auth session - the browser talks to Postgres using the public anon key,
and RLS policies allow that key to read everything and write to most tables. This is
intentional for a trusted shop-floor terminal/network, but it means anyone with the app
URL can log an entry as any employee for any KPI, anyone with the anon key (visible in
browser dev tools, meant to be public) can read/write those tables directly via the API,
and the site admin / department admin / member gates are client-side convenience, not
a security boundary — one department can't see another's admin pages in the app, but
nothing in the database stops a determined person with the anon key from writing to
another department's rows.

Before relying on this beyond an internal pilot, consider real Supabase Auth with RLS
policies checking auth.uid() against employees/department_members.

## What's intentionally out of scope

- Real per-user auth/RLS scoping
- Editing/deleting past daily entries beyond today's, outside KPI Management's delete
- Push notifications, email digests, scheduled exports
