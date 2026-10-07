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
