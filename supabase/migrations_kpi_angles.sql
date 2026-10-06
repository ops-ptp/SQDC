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
