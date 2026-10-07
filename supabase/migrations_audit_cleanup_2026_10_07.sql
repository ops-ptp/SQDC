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
