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
  employee_code  text not null unique,     -- what they type in at login, e.g. "E1042"
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
