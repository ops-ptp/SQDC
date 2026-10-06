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
