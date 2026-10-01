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
