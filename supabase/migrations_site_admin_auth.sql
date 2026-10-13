-- =============================================================================
-- Site-admin password sign-in — phase 1 (13 Oct 2026)
-- Safe to re-run.
--
-- Before this, "site admin" was a flag anyone could switch on for themselves
-- with the public website key. Now:
--   * each site admin has a real Supabase Auth account (Employee ID +
--     password), linked by employees.auth_user_id;
--   * the database only lets a SIGNED-IN site admin grant/remove site admin,
--     activate/deactivate people, edit a site admin's own record, create,
--     archive, reorder or delete departments;
--   * auth_user_id can only be set by the site-admin-auth Edge Function
--     (service role) or the SQL Editor.
--
-- Not covered yet (phase 2): department admins are still Employee ID only,
-- so department_members, KPIs and entries stay open to the website key.
--
-- After running this, every site admin has to sign in with a password before
-- the database treats them as one. Set the first password in the Supabase
-- dashboard (see README → "Site-admin passwords"); that admin then sets the
-- others from Site Admin → Employees.
-- =============================================================================

create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter table public.employees
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- True only when the request carries a signed-in session that belongs to an
-- active site admin. Lives in the private (not web-exposed) schema.
create or replace function private.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = (select auth.uid())
      and e.is_site_admin
      and e.active
  );
$$;
revoke all on function private.is_site_admin() from public;
grant execute on function private.is_site_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- employees: guard the site-admin columns
-- Only website requests (anon / authenticated) are checked; the Edge Function
-- (service role) and the SQL Editor (postgres) pass straight through.
-- ---------------------------------------------------------------------------
create or replace function private.guard_employee_admin_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.auth_user_id is not null then
      raise exception 'Sign-in accounts are linked by the password function only.' using errcode = '42501';
    end if;
    if new.is_site_admin and not private.is_site_admin() then
      raise exception 'Only a signed-in site admin can appoint a site admin.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Sign-in accounts are linked by the password function only.' using errcode = '42501';
  end if;
  if (new.is_site_admin is distinct from old.is_site_admin
      or new.active is distinct from old.active
      or old.is_site_admin)
     and not private.is_site_admin() then
    raise exception 'Only a signed-in site admin can change site admins or activate/deactivate people.' using errcode = '42501';
  end if;
  -- Never leave the site without an active site admin who can sign in.
  if old.is_site_admin and old.active and not (new.is_site_admin and new.active)
     and not exists (
       select 1 from public.employees e
       where e.id <> old.id and e.is_site_admin and e.active and e.auth_user_id is not null
     ) then
    raise exception 'Keep at least one other active site admin with a password before removing this one.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_guard_admin_columns on public.employees;
create trigger employees_guard_admin_columns
  before insert or update on public.employees
  for each row execute function private.guard_employee_admin_columns();

-- ---------------------------------------------------------------------------
-- departments: creating, archiving, reordering and deleting are site-admin
-- jobs. Department admins can still edit name / web address / entry mode /
-- upload format from their own Settings tab.
-- ---------------------------------------------------------------------------
create or replace function private.guard_department_admin_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or private.is_site_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Only a signed-in site admin can create a department.' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'Only a signed-in site admin can delete a department.' using errcode = '42501';
  elsif new.active is distinct from old.active or new.sort_order is distinct from old.sort_order then
    raise exception 'Only a signed-in site admin can archive, restore or reorder departments.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists departments_guard_admin_changes on public.departments;
create trigger departments_guard_admin_changes
  before insert or update or delete on public.departments
  for each row execute function private.guard_department_admin_changes();
