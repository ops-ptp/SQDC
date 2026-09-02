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
  role           text,                     -- optional, e.g. "Shift Supervisor"
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
--   * forecast_cards — one card = one forecast/commitment for a specific
--     future date, tied to a leading KPI. The kanban's three columns
--     (+1 day, +2 days, +3 days) are computed in the app from
--     target_date - current_date, so cards naturally roll from "+3" toward
--     "+1" as days pass without any batch job.
-- ----------------------------------------------------------------------------

alter table kpis add column if not exists is_leading boolean not null default false;

create table if not exists forecast_cards (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references kpis(id) on delete cascade,
  pillar_id    uuid not null references pillars(id) on delete cascade,
  target_date  date not null,          -- the day being forecast (usually today+1..today+3)
  note         text not null,          -- the forecast / what's expected / what to watch
  owner_name   text,
  created_by   uuid references employees(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_forecast_cards_target_date on forecast_cards(target_date);
create index if not exists idx_forecast_cards_kpi on forecast_cards(kpi_id);

drop trigger if exists trg_forecast_cards_updated_at on forecast_cards;
create trigger trg_forecast_cards_updated_at
  before update on forecast_cards
  for each row execute function set_updated_at();

alter table forecast_cards enable row level security;

drop policy if exists anon_all_forecast_cards on forecast_cards;
create policy anon_all_forecast_cards on forecast_cards for all using (true) with check (true);

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
