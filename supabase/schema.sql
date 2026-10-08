-- ============================================================================
-- SQDC Board MVP — Supabase schema
-- ============================================================================
-- Run this whole file once in the Supabase SQL editor (Project > SQL Editor
-- > New query), on a fresh project. Safe to re-run (uses IF NOT EXISTS /
-- DROP ... IF EXISTS guards) while you're iterating.
--
-- Design notes:
--   * Auth model is intentionally lightweight: staff identify themselves by
--     "Employee ID" only (no password), matching the physical board where
--     anyone on shift can walk up and update their pillar. There is no
--     Supabase Auth session — the app talks to Postgres with the public
--     anon key, so RLS policies below allow the anon role to read/write.
--     This is fine for an internal MVP on a trusted network/terminal, but
--     it is NOT per-user access control. See README "Security" section
--     before using this for anything sensitive.
--   * Pareto-of-reasons is scored per KPI (each KPI has its own curated
--     reason list) — matches the "4 - Pareto - Simple" example in your
--     template, which does a Pareto for a specific KPI (TTT), not a mashed
--     -together one for the whole pillar. The dashboard lets you pick which
--     KPI's Pareto to show per pillar quadrant.
--   * daily_entries.target is a snapshot of the KPI's target at the time of
--     entry, so historical charts stay correct even if you retarget later.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- PILLARS  (fixed: Safety, Quality, Delivery, Cost)
-- ----------------------------------------------------------------------------
create table if not exists pillars (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- 'S' | 'Q' | 'D' | 'C'
  name        text not null,               -- 'Safety' | 'Quality' | 'Delivery' | 'Cost'
  sort_order  int not null default 0
);

-- ----------------------------------------------------------------------------
-- EMPLOYEES
-- ----------------------------------------------------------------------------
create table if not exists employees (
  id             uuid primary key default gen_random_uuid(),
  employee_code  text not null unique,     -- what they type in at login, e.g. "000042" (6 digits, zero-padded)
  name           text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- KPIS
-- ----------------------------------------------------------------------------
create table if not exists kpis (
  id               uuid primary key default gen_random_uuid(),
  pillar_id        uuid not null references pillars(id) on delete cascade,
  name             text not null,               -- 'LTI (Lost time injury)'
  unit             text not null default '',    -- 'Minutes', '%', 'Count'
  is_higher_better boolean not null default true,
  target           numeric not null default 0,  -- current/default target
  info             text,                        -- "what is this KPI telling us"
  active           boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

-- Which employees are responsible for keeping a given KPI updated.
create table if not exists kpi_assignments (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references kpis(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  unique (kpi_id, employee_id)
);

-- ----------------------------------------------------------------------------
-- REASONS  (curated per-KPI reason list, feeds the Pareto chart)
-- ----------------------------------------------------------------------------
create table if not exists reasons (
  id          uuid primary key default gen_random_uuid(),
  kpi_id      uuid not null references kpis(id) on delete cascade,
  label       text not null,
  active      boolean not null default true,
  sort_order  int not null default 0
);

-- ----------------------------------------------------------------------------
-- DAILY ENTRIES  (one row per KPI per day)
-- ----------------------------------------------------------------------------
create table if not exists daily_entries (
  id             uuid primary key default gen_random_uuid(),
  kpi_id         uuid not null references kpis(id) on delete cascade,
  entry_date     date not null,
  target         numeric not null,       -- snapshot of kpis.target at entry time
  actual         numeric not null,
  met_target     boolean not null,       -- computed client-side from actual/target/direction
  reason_id      uuid references reasons(id),
  reason_other   text,                   -- free text if reason_id is null / "Other"
  entered_by     uuid references employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (kpi_id, entry_date)
);

-- ----------------------------------------------------------------------------
-- ACTIONS  (action log per pillar, optionally linked to a KPI/reason)
-- ----------------------------------------------------------------------------
create table if not exists actions (
  id               uuid primary key default gen_random_uuid(),
  pillar_id        uuid not null references pillars(id) on delete cascade,
  kpi_id           uuid references kpis(id) on delete set null,
  related_issue    text not null,   -- "Related reason / issue"
  action           text not null,
  owner_name       text not null,
  deadline         date,
  done             boolean not null default false,
  completed_at     timestamptz,
  created_by       uuid references employees(id),
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Convenience view: today's board = latest entry per KPI per day, with pillar
-- ----------------------------------------------------------------------------
-- Dropped first (not just CREATE OR REPLACE) because `k.*` means this view's
-- column list changes whenever a column is added to kpis — and Postgres
-- won't let CREATE OR REPLACE VIEW change an existing column list/order.
drop view if exists v_kpi_with_pillar;
create view v_kpi_with_pillar as
  select k.*, p.code as pillar_code, p.name as pillar_name, p.sort_order as pillar_sort_order
  from kpis k
  join pillars p on p.id = k.pillar_id;

-- ----------------------------------------------------------------------------
-- updated_at trigger for daily_entries
-- ----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_daily_entries_updated_at on daily_entries;
create trigger trg_daily_entries_updated_at
  before update on daily_entries
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table pillars enable row level security;
alter table employees enable row level security;
alter table kpis enable row level security;
alter table kpi_assignments enable row level security;
alter table reasons enable row level security;
alter table daily_entries enable row level security;
alter table actions enable row level security;

-- MVP policy: the anon key (used by the browser app) can read everything and
-- write to the operational tables. There's no per-employee row ownership
-- check because there's no real login session — see README "Security".
drop policy if exists anon_select_pillars on pillars;
create policy anon_select_pillars on pillars for select using (true);

drop policy if exists anon_select_employees on employees;
create policy anon_select_employees on employees for select using (true);

drop policy if exists anon_select_kpis on kpis;
create policy anon_select_kpis on kpis for select using (true);

drop policy if exists anon_select_kpi_assignments on kpi_assignments;
create policy anon_select_kpi_assignments on kpi_assignments for select using (true);

drop policy if exists anon_select_reasons on reasons;
create policy anon_select_reasons on reasons for select using (true);

drop policy if exists anon_all_daily_entries on daily_entries;
create policy anon_all_daily_entries on daily_entries for all using (true) with check (true);

drop policy if exists anon_all_actions on actions;
create policy anon_all_actions on actions for all using (true) with check (true);

-- ============================================================================
-- MIGRATION (2026-08-21): leading/lagging KPIs + Forward Looking board
-- ============================================================================
-- Safe to re-run. Adds:
--   * kpis.is_leading — marks a KPI as a "leading" indicator. The Forward
--     Looking kanban only lets you forecast against leading KPIs (lagging
--     KPIs measure results after the fact, so they don't belong on a
--     +1/+2/+3-day forecast board).
-- (forecast_cards, the original kanban-card table this migration also
-- created, was archived in a later cleanup once leading_entries replaced
-- it entirely — see the "database cleanup" migration near the end of this
-- file.)
-- ----------------------------------------------------------------------------

alter table kpis add column if not exists is_leading boolean not null default false;

-- ============================================================================
-- MIGRATION (2026-08-22): action status (not_started/in_progress/dropped/completed)
-- ============================================================================
-- Replaces the old actions.done boolean with a 4-state status, matching the
-- board's status dropdown. Safe to re-run.
-- ----------------------------------------------------------------------------

alter table actions add column if not exists status text not null default 'not_started';

do $$ begin
  alter table actions add constraint actions_status_check
    check (status in ('not_started', 'in_progress', 'dropped', 'completed'));
exception
  when duplicate_object then null;
end $$;

alter table actions drop column if exists done;

-- ============================================================================
-- MIGRATION (2026-08-24): daily_entries.remarks
-- ============================================================================
-- Free-text remarks/summary, separate from the curated reason category.
-- App-level rule (not a DB constraint, to keep this flexible): remarks are
-- required when a daily entry misses target. Safe to re-run.
-- ----------------------------------------------------------------------------

alter table daily_entries add column if not exists remarks text;

-- ============================================================================
-- MIGRATION (2026-08-25): Admin Excel upload + Enter Remarks rework
-- ============================================================================
-- Adds everything needed for the new data-entry model:
--   * employees.is_admin — gates the Admin tab (Daily/Weekly Excel upload).
--     Only admins/superusers see and use it.
--   * daily_entries.is_manual_override — set true whenever a value was typed
--     in by a person via Enter Remarks, for one of the 3 KPIs that still get
--     manual Performance entry (Accident During Operation, QC Preventive
--     Maintenance & Service, Average Litres per Vessel Call). The Admin
--     upload writes these 3 KPIs' columns too (they exist in the source
--     spreadsheet), but only as a FALLBACK — it must never overwrite a row
--     with is_manual_override = true. Upload-written rows always set this
--     to false.
--   * weekly_entries — new table backing the uploaded OPS SQDC Weekly.xlsx
--     ("Weekly Database" sheet — ISO week rows, one column per KPI, a
--     coarser subset of the daily KPI catalog with no Day/Night split).
--     The Weekly board view prefers live daily_entries aggregation when
--     available for a given ISO week, and falls back to this table when it
--     isn't (e.g. weeks predating daily tracking, or a week uploaded here
--     but never logged day-by-day). Keyed by (pillar, kpi BASE name) rather
--     than a strict kpi_id FK, because the sheet's figures are already
--     blended across Day/Night while most of this app's kpis rows are the
--     Day/Night-split variants (there's no single "combined" kpi row to
--     reference) — kpi_base_name matches the same base-name grouping the
--     app already computes (KPI name with any trailing " (Day)"/" (Night)"
--     stripped), e.g. "GMPH Mainliner".
-- Safe to re-run.
-- ----------------------------------------------------------------------------

alter table employees add column if not exists is_admin boolean not null default false;

-- kpis.manual_entry marks the 3 KPIs that keep manual Performance-value entry
-- in Enter Remarks (Accident During Operation, QC Preventive Maintenance &
-- Service, Average Litres per Vessel Call) — everything else becomes
-- remarks-only once the Admin upload is populating it. Driven by this flag
-- rather than hardcoded KPI names in the app, so it stays configurable.
alter table kpis add column if not exists manual_entry boolean not null default false;

alter table daily_entries add column if not exists is_manual_override boolean not null default false;

create table if not exists weekly_entries (
  id             uuid primary key default gen_random_uuid(),
  pillar_id      uuid not null references pillars(id) on delete cascade,
  kpi_base_name  text not null,          -- e.g. "GMPH Mainliner" — matches the app's Day/Night-stripped grouping
  iso_year       int not null,
  iso_week       int not null,           -- 1-53
  target         numeric not null,       -- snapshot at upload time
  actual         numeric not null,
  met_target     boolean not null,
  uploaded_by    uuid references employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (pillar_id, kpi_base_name, iso_year, iso_week)
);

drop trigger if exists trg_weekly_entries_updated_at on weekly_entries;
create trigger trg_weekly_entries_updated_at
  before update on weekly_entries
  for each row execute function set_updated_at();

alter table weekly_entries enable row level security;

drop policy if exists anon_all_weekly_entries on weekly_entries;
create policy anon_all_weekly_entries on weekly_entries for all using (true) with check (true);

-- Convenience: mark your own account (or any employee) as admin, e.g.:
--   update employees set is_admin = true where employee_code = '000001';

-- ============================================================================
-- MIGRATION (2026-08-25b): employee_code is a 6-digit, zero-padded number
-- ============================================================================
-- Enforces the real-world ID format at the DB level so a bad value can't be
-- inserted via the Table Editor/SQL by mistake. If you already have
-- employees seeded with the old "E001"-style codes, re-run seed.sql (it
-- deletes and reloads the employees table) or update the existing rows to
-- 6-digit codes yourself before this constraint is added, or the ALTER
-- below will fail on the existing data.
do $$ begin
  alter table employees add constraint employees_employee_code_format
    check (employee_code ~ '^[0-9]{6}$');
exception
  when duplicate_object then null;
end $$;

-- ============================================================================
-- MIGRATION (2026-08-26): leading_entries — numeric daily values for leading
-- KPIs, sourced from the Admin Daily Excel upload's "Next 24hrs" tab
-- ============================================================================
-- Leading KPIs (the Next 24 Hours board) now get their numbers from the same
-- Daily Excel upload as the lagging KPIs, instead of manually-typed forecast
-- cards. One row per (kpi_id, entry_date) — there's no target/pass-fail here,
-- just the day's projected figure exactly as entered in the sheet.

create table if not exists leading_entries (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references kpis(id) on delete cascade,
  entry_date   date not null,
  value        numeric not null,
  uploaded_by  uuid references employees(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kpi_id, entry_date)
);

drop trigger if exists trg_leading_entries_updated_at on leading_entries;
create trigger trg_leading_entries_updated_at
  before update on leading_entries
  for each row execute function set_updated_at();

alter table leading_entries enable row level security;

drop policy if exists anon_all_leading_entries on leading_entries;
create policy anon_all_leading_entries on leading_entries for all using (true) with check (true);

-- Leading KPIs were seeded with unit = '' (no distinction existed until the
-- sheet's real figures showed the actual mix — raw counts/rates for most,
-- and the two QC PM & Service ones being %-style like the app's other ratio
-- KPIs). Safe to re-run.
update kpis set unit = 'Moves' where name in ('Moves - Projection Day Shift', 'Moves - Projection Night Shift');
update kpis set unit = 'TEUs' where name = 'TEUs Run Rate (Forecast)';
update kpis set unit = 'Gangs' where name in ('QC Gang - Projection Next Shift', 'Lashing - Projection Next Shift');
update kpis set unit = '%' where name in ('QC PM & Service - MTD', 'QC PM & Service - Projection Next Day');

-- ============================================================================
-- MIGRATION (2026-08-27): per-date/shift Target sheet, Mainliner Load GMPH
-- old-calculation secondary metric, and Admin KPI catalog management
-- ============================================================================
-- Three changes, all driven by the restructured OPS_SQDC_-_Daily.xlsx
-- (now 3 tabs: Daily Database / Target / Next 24hrs, all in one file):
--
--   * kpi_daily_targets — the Target tab is no longer a single flat target
--     row; it's now Date+Shift rows just like Daily Database, so a KPI's
--     target can genuinely change over time (confirmed from the real file —
--     e.g. Labour Supply's target steps down mid-month). This table holds
--     that per-(kpi, date) target, populated by the Admin Daily upload.
--     daily_entries.target keeps meaning "snapshot at entry time" — the
--     Admin upload looks up this table first and falls back to the kpis.target
--     catalog value only when no row exists yet (same fallback pattern the
--     Moves KPI already used before this table existed). Manual-entry KPIs
--     (Accident, QC PM & Service, Litres/Vessel) also read their target from
--     here now — Enter Remarks looks it up for the date being entered.
--
--   * kpis.is_secondary — marks a KPI as a secondary/comparison metric that
--     should never appear as its own selectable item in Enter Remarks or the
--     Action Log's KPI picker, and is excluded from "needs a remark" counts.
--     Used for "Mainliner Load GMPH (Old)", added below: the sheet's old
--     calculation method, kept only as a dimmed secondary line/number next
--     to the current ("new calculation") figure — never itself judged
--     pass/fail. The existing "Mainliner Load GMPH (Day)"/"(Night)" rows are
--     unchanged and keep meaning the new calculation.
--
--   * Admin's new combined KPI Management screen (show/hide + edit) needs no
--     new schema — it reads/writes the existing kpis.active, unit, target,
--     is_higher_better, pillar_id columns directly. "Save view" is a single
--     global state (kpis.active), not per-admin presets, per your answer.
-- ----------------------------------------------------------------------------

alter table kpis add column if not exists is_secondary boolean not null default false;

create table if not exists kpi_daily_targets (
  id          uuid primary key default gen_random_uuid(),
  kpi_id      uuid not null references kpis(id) on delete cascade,
  entry_date  date not null,
  target      numeric not null,
  updated_at  timestamptz not null default now(),
  unique (kpi_id, entry_date)
);

drop trigger if exists trg_kpi_daily_targets_updated_at on kpi_daily_targets;
create trigger trg_kpi_daily_targets_updated_at
  before update on kpi_daily_targets
  for each row execute function set_updated_at();

alter table kpi_daily_targets enable row level security;

drop policy if exists anon_all_kpi_daily_targets on kpi_daily_targets;
create policy anon_all_kpi_daily_targets on kpi_daily_targets for all using (true) with check (true);

-- "Mainliner Load GMPH (Old) (Day)"/"(Night)" — created from the existing
-- new-calculation rows so pillar/unit/target/shift-split match exactly.
-- Guarded by NOT EXISTS so this is safe to re-run.
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading, manual_entry, is_secondary)
select k.pillar_id,
       replace(k.name, 'Mainliner Load GMPH', 'Mainliner Load GMPH (Old)'),
       k.unit, k.is_higher_better, k.target,
       'Superseded calculation method, shown for comparison only — "Mainliner Load GMPH" (new calculation) is the current figure and the one judged against target.',
       k.sort_order, k.is_leading, k.manual_entry, true
from kpis k
where k.name in ('Mainliner Load GMPH (Day)', 'Mainliner Load GMPH (Night)')
  and not exists (
    select 1 from kpis k2 where k2.name = replace(k.name, 'Mainliner Load GMPH', 'Mainliner Load GMPH (Old)')
  );

-- kpis was select-only for the anon key until now (2026-08-25's
-- anon_select_kpis policy) because nothing in the app ever wrote to it
-- before this round — the catalog was managed via SQL/Table Editor only.
-- The new Admin features write to it directly: auto-creating a KPI when
-- the upload detects a brand-new spreadsheet column, and KPI Management's
-- "Save changes" (pillar/unit/target/direction/active edits). Adds
-- insert/update without touching the existing select policy or removing
-- delete protection (the app never deletes a kpis row).
drop policy if exists anon_insert_kpis on kpis;
create policy anon_insert_kpis on kpis for insert with check (true);

drop policy if exists anon_update_kpis on kpis;
create policy anon_update_kpis on kpis for update using (true) with check (true);

-- ============================================================================
-- MIGRATION: "QC PM & Service - Projection Next Day" renamed to
-- "QC PM & Service - Projection Today", unit changed from % to absolute
-- number (sheet's "2" now means 2, not 200%).
-- IMPORTANT — this KPI's name must exactly match its column header in the
-- Next 24hrs sheet (leading KPIs are matched by name, not a translation
-- table). Rename that column in OPS SQDC Daily.xlsx to the exact string
-- below too, or the next upload won't find it and will auto-create a
-- duplicate KPI instead of updating this one. Safe to re-run.
-- ============================================================================
update kpis
set name = 'QC PM & Service - Projection Today',
    unit = '',
    info = 'Forecast of preventive maintenance & service planned for today.'
where name = 'QC PM & Service - Projection Next Day';
-- (Naturally safe to re-run: once renamed, this WHERE clause no longer
-- matches anything. The one-off rescale of already-uploaded values for
-- this KPI — needed once, NOT idempotent — is a separate script, not part
-- of this file: rename_qc_pm_service_today.sql.)

-- ============================================================================
-- MIGRATION: friendly display numbers (kpi_no / action_no / employee_no).
-- Purely additive, purely for humans — the real id (uuid) still does every
-- bit of actual referencing (every foreign key, every upsert conflict
-- target) and nothing about it changes. These are just a short, readable
-- number to look at in the Table Editor or in a SQL result instead of a
-- uuid — "KPI #14" instead of "a3f0cf39-e9d4-427a-8fe3-8e157e76eb30".
-- GENERATED ALWAYS AS IDENTITY backfills existing rows automatically and
-- refuses a manual insert trying to set its own number, so it can never
-- collide with anything the app does. Safe to re-run (no-ops once added).
-- ============================================================================
alter table kpis add column if not exists kpi_no integer generated always as identity unique;
alter table actions add column if not exists action_no integer generated always as identity unique;
alter table employees add column if not exists employee_no integer generated always as identity unique;

-- ============================================================================
-- MIGRATION: database cleanup — remove genuinely unused schema, without
-- touching anything a person actually typed in.
--
--   * employees.role — never read anywhere in the app. Backed up (any
--     non-null value) into employees_role_backup before being dropped, so
--     a job title someone entered isn't silently thrown away, then the
--     column itself is actually removed.
--   * forecast_cards — the pre-leading_entries Next 24 Hours kanban-card
--     table, confirmed unreferenced anywhere in the app since that page was
--     rewritten. Renamed (not dropped) to archived_forecast_cards, so nothing
--     in it is lost and it's trivially reversible (just rename it back) —
--     unlike a column, an entire table's contents felt worth keeping
--     physically intact rather than copying into a backup table.
--   * kpis.info was also considered (never shown in the UI) but is NOT
--     touched here — seed.sql populates it with real explanatory text for
--     nearly every KPI, so it's written-but-not-yet-surfaced, not dead.
--
-- Safe to re-run: each step only acts if there's still something to act on.
-- ============================================================================

create table if not exists employees_role_backup (
  employee_id    uuid not null,
  employee_code  text not null,
  role           text not null,
  backed_up_at   timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'role') then
    insert into employees_role_backup (employee_id, employee_code, role)
    select id, employee_code, role from employees where role is not null and role <> '';
    alter table employees drop column role;
  end if;
end $$;

alter table if exists forecast_cards rename to archived_forecast_cards;

-- ============================================================================
-- MIGRATION: AI-assisted categorization (Insights page).
-- An admin exports missed-target remarks as CSV, runs them through whatever
-- AI model they have access to (outside this app — no API integration, no
-- token cost to this project) with a prompt asking it to add a "category"
-- column, then re-uploads the completed CSV. This just stores that
-- category back on the entry it came from — purely additive, doesn't
-- affect pass/fail, targets, or anything else already in daily_entries.
-- ============================================================================
alter table daily_entries add column if not exists ai_category text;

-- ============================================================================
-- MIGRATION: saved custom Paretos (Insights pivot builder -> Board).
-- Stores the PIVOT CONFIGURATION an admin built in Insights (which field is
-- in Rows/Columns/Filters, which filter values are included) — not a
-- snapshot of computed counts. The Board re-runs this same configuration
-- against whatever's currently categorized every time it renders, so a
-- saved chart keeps reflecting new categorization work automatically
-- rather than going stale the moment more entries get categorized.
--
-- One saved Pareto per (pillar, KPI) — "Save" and "Update" are the same
-- upsert; kpi_base_name matches baseNameOf(kpi.name) so it covers a split
-- KPI's Day+Night rows as one entry, same grouping the board itself uses.
-- ============================================================================
create table if not exists custom_paretos (
  id             uuid primary key default gen_random_uuid(),
  pillar_id      uuid not null references pillars(id) on delete cascade,
  kpi_base_name  text not null,
  title          text not null,
  row_field      text not null,
  column_field   text,
  filter_field   text,
  filter_values  text[],
  created_by     uuid references employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (pillar_id, kpi_base_name)
);

drop trigger if exists trg_custom_paretos_updated_at on custom_paretos;
create trigger trg_custom_paretos_updated_at
  before update on custom_paretos
  for each row execute function set_updated_at();

alter table custom_paretos enable row level security;

drop policy if exists anon_all_custom_paretos on custom_paretos;
create policy anon_all_custom_paretos on custom_paretos for all using (true) with check (true);

-- ============================================================================
-- MIGRATION: employees insert/update policies for Admin's Employee
-- Management (add/edit staff from the UI instead of SQL). Same story as
-- kpis above -- employees was select-only for the anon key because nothing
-- in the app ever wrote to it before now (new hires were added via SQL run
-- directly against the table). Adds insert/update without touching the
-- existing select policy or adding delete -- Employee Management never
-- hard-deletes a row (see EmployeeManagementSection in Admin.tsx); "Active"
-- is the retire-someone path instead, since daily_entries.entered_by has no
-- cascade-delete.
-- ============================================================================
drop policy if exists anon_insert_employees on employees;
create policy anon_insert_employees on employees for insert with check (true);

drop policy if exists anon_update_employees on employees;
create policy anon_update_employees on employees for update using (true) with check (true);


-- ============================================================================
-- MIGRATION: multi-category tagging for the Weekly / Bi-weekly Pareto.
-- Safe to re-run. Purely additive — nothing existing is altered or dropped.
--
-- kpi_categories   — the pick-list of categories per logical KPI (keyed by
--                    pillar + base name, so Day/Night share one list) and
--                    per dimension. Most KPIs have a single "Cause"
--                    dimension; Accident During Operation has three
--                    (Location / Equipment / Symptom), each its own Pareto.
-- entry_categories — the tags on one daily entry (one shift). A shift can
--                    carry several categories, and the Pareto counts tags,
--                    not shifts — same as the source weekly_paretto.xlsx.
--
-- entry_categories.category is plain text, not an FK to kpi_categories, so
-- renaming/merging a list item later never silently rewrites history.
-- daily_entries upserts keep their row id, so tags survive re-uploads.
-- ============================================================================
create table if not exists kpi_categories (
  id             uuid primary key default gen_random_uuid(),
  pillar_id      uuid not null references pillars(id) on delete cascade,
  kpi_base_name  text not null,
  dimension      text not null default 'Cause',
  label          text not null,
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (pillar_id, kpi_base_name, dimension, label)
);

create table if not exists entry_categories (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references daily_entries(id) on delete cascade,
  dimension   text not null default 'Cause',
  category    text not null,
  created_by  uuid references employees(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (entry_id, dimension, category)
);

create index if not exists entry_categories_entry_id_idx on entry_categories (entry_id);

alter table kpi_categories enable row level security;
alter table entry_categories enable row level security;

drop policy if exists anon_all_kpi_categories on kpi_categories;
create policy anon_all_kpi_categories on kpi_categories for all using (true) with check (true);

drop policy if exists anon_all_entry_categories on entry_categories;
create policy anon_all_entry_categories on entry_categories for all using (true) with check (true);

-- ============================================================================
-- MIGRATION (2026-10-06): multi-department SQDC
-- ============================================================================
-- Turns the single Operations board into one SQDC board per department,
-- managed entirely from the app:
--
--   * departments          — one row per department board. The very first
--                            department (created here) is Operations, and
--                            every existing KPI / action / weekly figure /
--                            Pareto setting is backfilled into it.
--   * department_members   — who belongs to which department and as what:
--                            'admin' (manages that department's KPIs,
--                            uploads, members and settings) or 'member'
--                            (enters data/remarks for it). One person can be
--                            in several departments.
--   * employees.is_site_admin — site admins create/archive departments and
--                            appoint department admins. Bootstrap the first
--                            one by hand (see the bottom of this file).
--   * department_id on kpis, actions, weekly_entries, custom_paretos and
--                            kpi_categories. daily_entries, kpi_daily_targets,
--                            leading_entries, reasons and entry_categories
--                            don't need it — they hang off a kpi (or an
--                            entry), which already belongs to a department.
--   * kpis.track_weekly / kpis.weekly_agg — which KPIs appear on the Weekly
--                            view (was a hard-coded list of 7 in the code),
--                            and how a department WITHOUT a weekly workbook
--                            rolls daily values up into a week (avg or sum).
--   * update_kpi_group()   — renames a KPI and/or moves it to another pillar
--                            in one transaction, carrying its weekly figures,
--                            saved Paretos and category pick-lists along
--                            (those are keyed by pillar + KPI name).
--   * kpis delete policy   — KPI Management's "Delete" button never actually
--                            worked in production: there was no RLS policy
--                            allowing it, so it silently deleted nothing.
--
-- BACKWARD COMPATIBLE WITH THE CURRENT (main-branch) APP: every new
-- department_id column defaults to the first department (Operations), so the
-- old code keeps writing into Operations exactly as before. The only things
-- the old code can't do after this runs are the three upserts whose
-- conflict key now includes department_id (Weekly upload, Insights "Save to
-- Board", adding a Pareto category) — so run this right before merging the
-- multi-department code to main, not days ahead of it.
--
-- Safe to re-run: every step is guarded, and the one-off backfills (OPS
-- membership, weekly KPI list) only run the first time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create table if not exists departments (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,         -- URL: /d/<slug>
  name           text not null,
  active         boolean not null default true, -- false = archived (hidden, data kept)
  -- How performance values get in:
  --   'upload' — Excel upload (Admin tab); Enter page is remarks-only except
  --              KPIs individually flagged kpis.manual_entry
  --   'manual' — typed in the app (Enter Data page); no upload
  --   'both'   — either; a typed value is never overwritten by an upload
  entry_mode     text not null default 'manual',
  -- Which workbook the upload expects:
  --   'ops'      — the original OPS SQDC Daily/Weekly workbooks (Operations)
  --   'template' — the per-department template the app generates
  upload_format  text not null default 'template',
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  constraint departments_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint departments_entry_mode_check check (entry_mode in ('upload', 'manual', 'both')),
  constraint departments_upload_format_check check (upload_format in ('ops', 'template'))
);

insert into departments (slug, name, entry_mode, upload_format, sort_order)
select 'ops', 'Operations Division', 'upload', 'ops', 1
where not exists (select 1 from departments);

-- The department everything pre-existing belongs to, and the default for
-- rows written by code that doesn't know about departments yet.
create or replace function default_department_id() returns uuid
language sql stable set search_path = public as $$
  select id from departments order by created_at, sort_order limit 1
$$;

alter table departments enable row level security;
drop policy if exists anon_all_departments on departments;
create policy anon_all_departments on departments for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Site admins + department membership
-- ---------------------------------------------------------------------------
alter table employees add column if not exists is_site_admin boolean not null default false;

create table if not exists department_members (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references departments(id) on delete cascade,
  employee_id    uuid not null references employees(id) on delete cascade,
  role           text not null default 'member',
  created_at     timestamptz not null default now(),
  constraint department_members_role_check check (role in ('admin', 'member')),
  unique (department_id, employee_id)
);
create index if not exists department_members_employee_id_idx on department_members (employee_id);

alter table department_members enable row level security;
drop policy if exists anon_all_department_members on department_members;
create policy anon_all_department_members on department_members for all using (true) with check (true);

-- One-off: everyone already on the roster joins Operations; today's admins
-- (employees.is_admin) become Operations department admins. Only runs while
-- the table is still empty, so re-running this file later never re-adds
-- someone who was deliberately removed from Operations.
insert into department_members (department_id, employee_id, role)
select default_department_id(), e.id, case when e.is_admin then 'admin' else 'member' end
from employees e
where not exists (select 1 from department_members);

-- employees.is_admin is superseded by department_members.role and is no
-- longer read by the app. Left in place (not dropped) so the main-branch
-- app keeps working until the new code is deployed.

-- ---------------------------------------------------------------------------
-- department_id on department-owned tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['kpis', 'actions', 'weekly_entries', 'custom_paretos', 'kpi_categories'] loop
    execute format('alter table %I add column if not exists department_id uuid references departments(id)', t);
    execute format('update %I set department_id = default_department_id() where department_id is null', t);
    execute format('alter table %I alter column department_id set default default_department_id()', t);
    execute format('alter table %I alter column department_id set not null', t);
    execute format('create index if not exists %I on %I (department_id)', t || '_department_id_idx', t);
  end loop;
end $$;

-- Unique keys that identified a KPI by (pillar, name) now need the
-- department too — two departments can both have a "Safety Incidents" KPI.
alter table weekly_entries drop constraint if exists weekly_entries_pillar_id_kpi_base_name_iso_year_iso_week_key;
alter table custom_paretos drop constraint if exists custom_paretos_pillar_id_kpi_base_name_key;
alter table kpi_categories drop constraint if exists kpi_categories_pillar_id_kpi_base_name_dimension_label_key;
do $$ begin
  alter table weekly_entries add constraint weekly_entries_dept_kpi_week_key unique (department_id, pillar_id, kpi_base_name, iso_year, iso_week);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table custom_paretos add constraint custom_paretos_dept_kpi_key unique (department_id, pillar_id, kpi_base_name);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table kpi_categories add constraint kpi_categories_dept_kpi_label_key unique (department_id, pillar_id, kpi_base_name, dimension, label);
exception when duplicate_object or duplicate_table then null; end $$;

-- ---------------------------------------------------------------------------
-- KPI settings that used to be hard-coded
-- ---------------------------------------------------------------------------
-- Same grouping the app's baseNameOf() uses: strips " (Day)"/" (Night)" and
-- then " (Old)".
create or replace function kpi_base_name(n text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(n, '\s*\((Day|Night)\)\s*$', '', 'i'), '\s*\(Old\)\s*$', '', 'i'))
$$;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'kpis' and column_name = 'track_weekly') then
    alter table kpis add column track_weekly boolean not null default false;
    -- One-off: the 7 KPIs the OPS Weekly workbook tracks (formerly the
    -- WEEKLY_HEADER_TO_BASE constant in src/lib/weeklyKpis.ts).
    update kpis set track_weekly = true
    where kpi_base_name(name) in (
      'Accident During Operation', 'Delay – Waiting for CHE (L&D)', 'Overall Mixing Yard',
      'GMPH Mainliner', 'GMPH Feeder', 'Mainliner Load GMPH', 'QC Preventive Maintenance & Service'
    );
  end if;
end $$;

-- How a department without a weekly workbook turns daily values into a
-- weekly figure: 'avg' (rates, %, productivity) or 'sum' (counts, totals).
alter table kpis add column if not exists weekly_agg text not null default 'avg';
do $$ begin
  alter table kpis add constraint kpis_weekly_agg_check check (weekly_agg in ('avg', 'sum'));
exception when duplicate_object then null; end $$;

drop policy if exists anon_delete_kpis on kpis;
create policy anon_delete_kpis on kpis for delete using (true);

-- ---------------------------------------------------------------------------
-- Rename and/or re-pillar one logical KPI (all its Day/Night/Old rows)
-- ---------------------------------------------------------------------------
create or replace function update_kpi_group(
  p_department_id uuid,
  p_pillar_id     uuid,
  p_base          text,
  p_new_pillar_id uuid,
  p_new_base      text
) returns void
language plpgsql set search_path = public as $$
begin
  p_new_base := btrim(p_new_base);
  if p_new_base is null or p_new_base = '' then
    raise exception 'KPI name cannot be empty';
  end if;
  if p_new_base ~* '\((Day|Night|Old)\)\s*$' then
    raise exception 'KPI name cannot end in (Day), (Night) or (Old) — those are added automatically';
  end if;
  if (p_new_base <> p_base or p_new_pillar_id <> p_pillar_id) and exists (
    select 1 from kpis
    where department_id = p_department_id
      and lower(kpi_base_name(name)) = lower(p_new_base)
      and not (pillar_id = p_pillar_id and kpi_base_name(name) = p_base)
  ) then
    raise exception 'A KPI called "%" already exists in this department', p_new_base;
  end if;

  update kpis
     set pillar_id = p_new_pillar_id,
         name = p_new_base || substr(name, length(p_base) + 1)
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name(name) = p_base;

  update weekly_entries set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;
  update custom_paretos set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;
  update kpi_categories set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;

  -- Actions linked to this KPI follow it to its new pillar.
  update actions set pillar_id = p_new_pillar_id
   where department_id = p_department_id
     and kpi_id in (select id from kpis where department_id = p_department_id
                    and pillar_id = p_new_pillar_id and kpi_base_name(name) = p_new_base);
end $$;

-- ---------------------------------------------------------------------------
-- Bootstrap the first site admin (run once, by hand, with the real ID):
--   update employees set is_site_admin = true where employee_code = '011955';
-- After that, site admins are granted from the app (Site Admin > Site admins).
-- ---------------------------------------------------------------------------
-- ============================================================================
-- MIGRATION (2026-10-06): Pareto angles per KPI
-- ============================================================================
-- An "angle" (stored as `dimension`, the name entry_categories and
-- kpi_categories already use) is one way of looking at a KPI's missed-target
-- remarks: Cause, Equipment, Location, Crew… Each angle has its own category
-- pick-list (kpi_categories) and its own Pareto. Until now an angle only
-- existed once it had at least one category; this table lets a department
-- admin create one from Insights and remembers its settings:
--
--   multi_tag — whether the AI may give a remark up to 3 tags in this angle
--               (e.g. a delay that was both "CHE breakdown" and "Manpower")
--               or exactly one (e.g. Location). People tagging by hand in
--               Enter Remarks can always pick several, as before.
--
-- Additive and backward compatible: angles that already exist only through
-- kpi_categories keep working with multi_tag = false.
-- ============================================================================

create table if not exists kpi_dimensions (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null default default_department_id() references departments(id) on delete cascade,
  pillar_id      uuid not null references pillars(id) on delete cascade,
  kpi_base_name  text not null,
  dimension      text not null,
  multi_tag      boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  constraint kpi_dimensions_dimension_not_blank check (btrim(dimension) <> ''),
  constraint kpi_dimensions_dept_kpi_dimension_key unique (department_id, pillar_id, kpi_base_name, dimension)
);
create index if not exists kpi_dimensions_department_id_idx on kpi_dimensions (department_id);

alter table kpi_dimensions enable row level security;
drop policy if exists anon_all_kpi_dimensions on kpi_dimensions;
create policy anon_all_kpi_dimensions on kpi_dimensions for all using (true) with check (true);

-- Renaming / re-pillaring a KPI now carries its angle settings along too.
create or replace function update_kpi_group(
  p_department_id uuid,
  p_pillar_id     uuid,
  p_base          text,
  p_new_pillar_id uuid,
  p_new_base      text
) returns void
language plpgsql set search_path = public as $$
begin
  p_new_base := btrim(p_new_base);
  if p_new_base is null or p_new_base = '' then
    raise exception 'KPI name cannot be empty';
  end if;
  if p_new_base ~* '\((Day|Night|Old)\)\s*$' then
    raise exception 'KPI name cannot end in (Day), (Night) or (Old) — those are added automatically';
  end if;
  if (p_new_base <> p_base or p_new_pillar_id <> p_pillar_id) and exists (
    select 1 from kpis
    where department_id = p_department_id
      and lower(kpi_base_name(name)) = lower(p_new_base)
      and not (pillar_id = p_pillar_id and kpi_base_name(name) = p_base)
  ) then
    raise exception 'A KPI called "%" already exists in this department', p_new_base;
  end if;

  update kpis
     set pillar_id = p_new_pillar_id,
         name = p_new_base || substr(name, length(p_base) + 1)
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name(name) = p_base;

  update weekly_entries set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;
  update custom_paretos set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;
  update kpi_categories set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;
  update kpi_dimensions set pillar_id = p_new_pillar_id, kpi_base_name = p_new_base
   where department_id = p_department_id and pillar_id = p_pillar_id and kpi_base_name = p_base;

  update actions set pillar_id = p_new_pillar_id
   where department_id = p_department_id
     and kpi_id in (select id from kpis where department_id = p_department_id
                    and pillar_id = p_new_pillar_id and kpi_base_name(name) = p_new_base);
end $$;
-- ============================================================================
-- MIGRATION (2026-10-07): retire the Insights CSV cycle + unused leftovers
-- ============================================================================
-- The Insights "Download CSV → any AI tool → re-import" cycle wrote one
-- free-text category per entry into daily_entries.ai_category. The built-in
-- AI tagging (Pareto tags per angle, entry_categories) replaces it, so:
--
--   Phase 1 (safe while the old app is still live): every ai_category that
--   isn't already a tag on that entry becomes a tag under a "Category"
--   angle — with that angle and its labels added to the KPI's lists — so
--   nothing categorised so far is lost.
--
--   Phase 2 (run only AFTER the new app is deployed — the old one still
--   reads these): drop daily_entries.ai_category, the never-used
--   kpi_assignments table, and employees.is_admin (replaced by
--   department_members.role on 2026-10-06).
-- ============================================================================

-- ---- Phase 1 ---------------------------------------------------------------
with csv as (
  select d.id as entry_id, btrim(d.ai_category) as label, k.department_id, k.pillar_id, kpi_base_name(k.name) as base
  from daily_entries d
  join kpis k on k.id = d.kpi_id
  where d.ai_category is not null and btrim(d.ai_category) <> ''
    and not exists (
      select 1 from entry_categories t where t.entry_id = d.id and lower(t.category) = lower(btrim(d.ai_category))
    )
),
angles as (
  insert into kpi_dimensions (department_id, pillar_id, kpi_base_name, dimension, multi_tag)
  select distinct department_id, pillar_id, base, 'Category', false from csv
  on conflict (department_id, pillar_id, kpi_base_name, dimension) do nothing
  returning 1
),
labels as (
  insert into kpi_categories (department_id, pillar_id, kpi_base_name, dimension, label, sort_order)
  select distinct department_id, pillar_id, base, 'Category', label, 999 from csv
  on conflict (department_id, pillar_id, kpi_base_name, dimension, label) do nothing
  returning 1
)
insert into entry_categories (entry_id, dimension, category)
select entry_id, 'Category', label from csv
on conflict (entry_id, dimension, category) do nothing;

-- ---- Phase 2 (after the new app is live) ------------------------------------
alter table daily_entries drop column if exists ai_category;
drop table if exists kpi_assignments;
alter table employees drop column if exists is_admin;


-- =============================================================================
-- Audit clean-up (7 Oct 2026). Safe to run more than once, on any project.
--
--   1. Drop leftovers nothing reads any more: the v_kpi_with_pillar view
--      (flagged SECURITY DEFINER by the Supabase advisor), and the empty
--      archived_forecast_cards / employees_role_backup tables (dropped only
--      if still empty).
--   2. Pin set_updated_at()'s search_path (advisor warning).
--   3. The CSV-cycle clean-up's phase 2 (already done on production):
--      daily_entries.ai_category, kpi_assignments, employees.is_admin.
--   4. Delete Pareto tags on Old-calculation (secondary) KPI entries — no
--      Pareto ever counts them.
--   5. Merge tags and pick-list labels that differ only by case
--      ("QC breakdown" / "QC Breakdown") onto one spelling per department and
--      angle: the spelling used most, ties to the one with more capitals.
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
drop view if exists public.v_kpi_with_pillar;

do $$
declare
  t text;
  has_rows boolean;
begin
  foreach t in array array['archived_forecast_cards', 'employees_role_backup'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into has_rows;
      if not has_rows then
        execute format('drop table public.%I', t);
      end if;
    end if;
  end loop;
end $$;

-- 2 ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = '';

-- 3 ---------------------------------------------------------------------------
alter table public.daily_entries drop column if exists ai_category;
drop table if exists public.kpi_assignments;
alter table public.employees drop column if exists is_admin;

-- 4 ---------------------------------------------------------------------------
delete from public.entry_categories ec
using public.daily_entries d, public.kpis k
where d.id = ec.entry_id and k.id = d.kpi_id and k.is_secondary;

-- 5 ---------------------------------------------------------------------------
-- One DO block, so the helper table lives in the same session as the
-- statements that read it (the SQL Editor may run separate statements on
-- separate connections, where a temporary table is not visible).
do $$
begin
  drop table if exists pg_temp.tag_spelling;
  create temporary table tag_spelling on commit drop as
  with uses as (
    select k.department_id, ec.dimension, lower(btrim(ec.category)) as lkey, btrim(ec.category) as spelling, count(*) as n
    from public.entry_categories ec
    join public.daily_entries d on d.id = ec.entry_id
    join public.kpis k on k.id = d.kpi_id
    group by 1, 2, 3, 4
    union all
    select kc.department_id, kc.dimension, lower(btrim(kc.label)), btrim(kc.label), 0
    from public.kpi_categories kc
  ), ranked as (
    select department_id, dimension, lkey, spelling,
           row_number() over (
             partition by department_id, dimension, lkey
             order by sum(n) desc, spelling collate "C" asc
           ) as rn
    from uses
    group by department_id, dimension, lkey, spelling
  )
  select department_id, dimension, lkey, spelling from ranked where rn = 1;

  -- Tags: keep one row per entry/angle/spelling, then rename to the canonical spelling.
  delete from public.entry_categories ec
  using (
    select ec2.id,
           row_number() over (
             partition by ec2.entry_id, ec2.dimension, lower(btrim(ec2.category))
             order by (btrim(ec2.category) = ts.spelling) desc, ec2.created_at, ec2.id
           ) as rn
    from public.entry_categories ec2
    join public.daily_entries d on d.id = ec2.entry_id
    join public.kpis k on k.id = d.kpi_id
    join pg_temp.tag_spelling ts on ts.department_id = k.department_id and ts.dimension = ec2.dimension and ts.lkey = lower(btrim(ec2.category))
  ) dup
  where ec.id = dup.id and dup.rn > 1;

  update public.entry_categories ec
  set category = ts.spelling
  from public.daily_entries d, public.kpis k, pg_temp.tag_spelling ts
  where d.id = ec.entry_id and k.id = d.kpi_id
    and ts.department_id = k.department_id and ts.dimension = ec.dimension and ts.lkey = lower(btrim(ec.category))
    and ec.category <> ts.spelling;

  -- Pick lists: keep one label per KPI/angle/spelling (lowest sort order), then rename.
  delete from public.kpi_categories kc
  using (
    select kc2.id,
           row_number() over (
             partition by kc2.department_id, kc2.pillar_id, kc2.kpi_base_name, kc2.dimension, lower(btrim(kc2.label))
             order by (btrim(kc2.label) = ts.spelling) desc, kc2.sort_order, kc2.created_at, kc2.id
           ) as rn
    from public.kpi_categories kc2
    join pg_temp.tag_spelling ts on ts.department_id = kc2.department_id and ts.dimension = kc2.dimension and ts.lkey = lower(btrim(kc2.label))
  ) dup
  where kc.id = dup.id and dup.rn > 1;

  update public.kpi_categories kc
  set label = ts.spelling
  from pg_temp.tag_spelling ts
  where ts.department_id = kc.department_id and ts.dimension = kc.dimension and ts.lkey = lower(btrim(kc.label))
    and kc.label <> ts.spelling;

  drop table if exists pg_temp.tag_spelling;
end $$;


-- =============================================================================
-- Next 24 Hours targets (8 Oct 2026): a leading KPI can be compared with its
-- target / is_higher_better, which colours its card green or red.
-- =============================================================================
alter table kpis add column if not exists has_target boolean not null default false;
-- A Next 24 Hours card can follow a board KPI's daily target instead of a fixed number.
alter table kpis add column if not exists target_kpi_id uuid references kpis(id) on delete set null;
