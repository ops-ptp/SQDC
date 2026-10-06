import { supabase } from './supabaseClient';
import { baseNameOf, metTarget } from '../types';
import type {
  ActionItem,
  DailyEntry,
  Department,
  DepartmentMember,
  DepartmentRole,
  Employee,
  EntryMode,
  Kpi,
  KpiWithPillar,
  LeadingEntry,
  Pillar,
  Reason,
  UploadFormat,
  WeeklyEntry,
} from '../types';

export async function fetchPillars(): Promise<Pillar[]> {
  const { data, error } = await supabase.from('pillars').select('*').order('sort_order');
  if (error) throw error;
  return data as Pillar[];
}

/** Lagging KPIs only — the ones tracked daily with target/actual on the main Board. */
export async function fetchKpis(departmentId: string): Promise<Kpi[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*')
    .eq('department_id', departmentId)
    .eq('active', true)
    .eq('is_leading', false)
    .order('sort_order');
  if (error) throw error;
  return data as Kpi[];
}

/** Leading (process) KPIs only — these are the ones forecastable on the Forward Looking board. */
export async function fetchLeadingKpis(departmentId: string): Promise<KpiWithPillar[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*, pillar:pillars(code, name)')
    .eq('department_id', departmentId)
    .eq('active', true)
    .eq('is_leading', true)
    .order('sort_order');
  if (error) throw error;
  return data as unknown as KpiWithPillar[];
}

export async function fetchKpisForEmployee(employeeId: string): Promise<KpiWithPillar[]> {
  const { data, error } = await supabase
    .from('kpi_assignments')
    .select('kpi:kpis(*, pillar:pillars(code, name))')
    .eq('employee_id', employeeId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { kpi: KpiWithPillar }[];
  return rows.map((r) => r.kpi).filter((k) => k && k.active);
}

export async function fetchReasonsForKpi(kpiId: string): Promise<Reason[]> {
  const { data, error } = await supabase
    .from('reasons')
    .select('*')
    .eq('kpi_id', kpiId)
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data as Reason[];
}

export async function fetchEntriesForKpi(kpiId: string, sinceDate: string): Promise<DailyEntry[]> {
  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('kpi_id', kpiId)
    .gte('entry_date', sinceDate)
    .order('entry_date');
  if (error) throw error;
  return data as DailyEntry[];
}

/** Every entry for a set of KPIs from `sinceDate` on — the Weekly view's
 * source for departments whose weekly figures are rolled up from daily
 * values (see lib/weeklyRollup.ts). */
export async function fetchEntriesForKpis(kpiIds: string[], sinceDate: string): Promise<DailyEntry[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase.from('daily_entries').select('*').in('kpi_id', kpiIds).gte('entry_date', sinceDate).order('entry_date');
  if (error) throw error;
  return data as DailyEntry[];
}

/** All entries for a set of KPIs on one specific date — used to color KPI pills by "today's" status. */
export async function fetchEntriesForKpisOnDate(kpiIds: string[], date: string): Promise<DailyEntry[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase.from('daily_entries').select('*').in('kpi_id', kpiIds).eq('entry_date', date);
  if (error) throw error;
  return data as DailyEntry[];
}

export async function fetchEntryForKpiAndDate(kpiId: string, date: string): Promise<DailyEntry | null> {
  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('kpi_id', kpiId)
    .eq('entry_date', date)
    .maybeSingle();
  if (error) throw error;
  return (data as DailyEntry) ?? null;
}

export interface UpsertEntryInput {
  kpi_id: string;
  entry_date: string;
  target: number;
  actual: number;
  met_target: boolean;
  reason_id: string | null;
  reason_other: string | null;
  remarks: string | null;
  entered_by: string;
  /** true when this write comes from a person manually entering a
   * Performance value (one of the 3 manual_entry KPIs) — protects the row
   * from being overwritten by a later Admin Excel upload. Defaults to false
   * (remarks-only edits on an upload-sourced row never set this). */
  is_manual_override?: boolean;
}

export async function upsertDailyEntry(input: UpsertEntryInput): Promise<DailyEntry> {
  const { data, error } = await supabase
    .from('daily_entries')
    .upsert(input, { onConflict: 'kpi_id,entry_date' })
    .select('*')
    .single();
  if (error) throw error;
  return data as DailyEntry;
}

// ---------------------------------------------------------------------------
// Admin Excel upload — Daily/Weekly bulk upsert
// ---------------------------------------------------------------------------

/** All lagging KPIs (active, non-leading), regardless of manual_entry — the
 * full catalog the Admin upload needs to map spreadsheet columns against. */
/** KPIs the Weekly upload matches its columns against: every lagging KPI,
 * visible AND hidden. "Visible" in KPI Management is a Daily-board concept
 * only — the Weekly board always shows its 7 tracked KPIs regardless — so
 * filtering to active KPIs here silently dropped hidden ones' weekly figures
 * (e.g. Delay – Waiting for CHE, QC Preventive Maintenance & Service). */
export async function fetchKpisForUpload(departmentId: string): Promise<Kpi[]> {
  const { data, error } = await supabase.from('kpis').select('*').eq('department_id', departmentId).eq('is_leading', false).order('sort_order');
  if (error) throw error;
  return data as Kpi[];
}

/** Which (kpi_id, entry_date) pairs already carry a person-typed value for a
 * manual_entry KPI — the upload must never overwrite these. Pass the full
 * candidate set; only the ones actually flagged come back. */
export async function fetchManualOverrideKeys(kpiIds: string[], dates: string[]): Promise<Set<string>> {
  if (kpiIds.length === 0 || dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from('daily_entries')
    .select('kpi_id, entry_date')
    .in('kpi_id', kpiIds)
    .in('entry_date', dates)
    .eq('is_manual_override', true);
  if (error) throw error;
  return new Set((data as { kpi_id: string; entry_date: string }[]).map((r) => `${r.kpi_id}|${r.entry_date}`));
}

export interface UploadDailyRow {
  kpi_id: string;
  entry_date: string;
  target: number;
  actual: number;
  met_target: boolean;
  entered_by: string | null;
}

/** Bulk upsert daily_entries from an Admin upload. Rows are written with
 * is_manual_override = false (upload-sourced) and reason/remarks left
 * untouched — chunked to stay well under PostgREST's request size limits. */
export async function bulkUpsertDailyEntriesFromUpload(rows: UploadDailyRow[]): Promise<number> {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, is_manual_override: false }));
    const { error } = await supabase.from('daily_entries').upsert(chunk, { onConflict: 'kpi_id,entry_date' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Per-date/shift KPI targets (from the Daily workbook's "Target" sheet) —
// every lagging KPI's target can now vary by day, not just Moves. Admin
// upload upserts here; daily_entries.target snapshots from this (or the
// kpis.target catalog fallback) at write time; Enter Remarks looks here up
// too for the 3 manual-entry KPIs so a manually-typed value is judged
// against the right day's target.
// ---------------------------------------------------------------------------

export interface UploadTargetRow {
  kpi_id: string;
  entry_date: string;
  target: number;
}

export async function bulkUpsertKpiDailyTargets(rows: UploadTargetRow[]): Promise<number> {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('kpi_daily_targets').upsert(chunk, { onConflict: 'kpi_id,entry_date' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

/** The per-day target for one KPI, if the Admin upload has ever supplied
 * one for that date — falls back to the KPI catalog's fixed target when
 * there's no row yet (e.g. before the first Target-sheet upload). */
export async function fetchKpiDailyTarget(kpiId: string, date: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('kpi_daily_targets')
    .select('target')
    .eq('kpi_id', kpiId)
    .eq('entry_date', date)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as { target: number }).target : null;
}

/** Same idea as fetchKpiDailyTarget, batched — the Board's target display
 * needs this independent of whether an actual has been entered for that
 * date yet. Targets are typically uploaded well ahead of actuals (the
 * Target sheet is filled in for months in advance), so a KPI can have a
 * known target for a date with no daily_entries row at all — reading the
 * target only off daily_entries (as met/missed pass-fail correctly does,
 * since that's meaningless without an actual anyway) would show a stale
 * catalog default on any date the day's actual hasn't been uploaded yet. */
export async function fetchKpiDailyTargetsForDate(kpiIds: string[], date: string): Promise<Map<string, number>> {
  if (kpiIds.length === 0) return new Map();
  const { data, error } = await supabase.from('kpi_daily_targets').select('kpi_id, target').in('kpi_id', kpiIds).eq('entry_date', date);
  if (error) throw error;
  return new Map((data as { kpi_id: string; target: number }[]).map((r) => [r.kpi_id, r.target]));
}

// ---------------------------------------------------------------------------
// Admin KPI catalog management — combined lagging + leading list, show/hide,
// and auto-creating a KPI when the upload detects a brand-new spreadsheet
// column.
// ---------------------------------------------------------------------------

/** Every KPI regardless of active/leading status — the full catalog for the
 * Admin KPI Management screen (unlike fetchKpis/fetchLeadingKpis, which
 * only return active ones for the live board). */
export async function fetchAllKpisAdmin(departmentId: string): Promise<KpiWithPillar[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*, pillar:pillars(code, name)')
    .eq('department_id', departmentId)
    .order('is_leading')
    .order('sort_order');
  if (error) throw error;
  return data as unknown as KpiWithPillar[];
}

export interface KpiAdminUpdate {
  id: string;
  active: boolean;
  is_higher_better: boolean;
}

/** Saves the Admin KPI Management screen's pending show/hide and pass/fail-
 * direction changes — "save view" is one global state stored directly on
 * `kpis`, not per-admin presets. Pillar/unit/target still aren't editable
 * here by design — that still goes through the Supabase Table Editor, same
 * as the rest of the catalog. */
export async function saveKpiAdminUpdates(updates: KpiAdminUpdate[]): Promise<void> {
  for (const u of updates) {
    const { error } = await supabase.from('kpis').update({ active: u.active, is_higher_better: u.is_higher_better }).eq('id', u.id);
    if (error) throw error;
  }
}

/** Permanently deletes a KPI and every row that references it — daily
 * entries, leading entries, per-day targets, reasons, and assignments all
 * cascade via the schema's `on delete cascade` foreign keys (only the
 * Action Log survives, with its kpi_id nulled out rather than the action
 * itself removed). There is no undo — Admin.tsx is responsible for making
 * the person confirm this explicitly before calling it. */
export async function deleteKpis(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('kpis').delete().in('id', ids);
  if (error) throw error;
}

export interface NewKpiInput {
  department_id: string;
  pillar_id: string;
  name: string;
  unit: string;
  is_higher_better: boolean;
  target: number;
  is_leading: boolean;
  sort_order: number;
  manual_entry?: boolean;
  track_weekly?: boolean;
  weekly_agg?: 'avg' | 'sum';
}

/** Auto-creates a catalog row for a brand-new spreadsheet column detected
 * during Admin upload — best-guess settings (pillar from the sheet's
 * category header, unit inferred by sampling the column's own values,
 * higher-is-better, target 0) so that upload's value shows up right away.
 * A wrong guess is corrected via the Supabase Table Editor — KPI Management
 * only offers show/hide, not a full editor. */
export async function createKpi(input: NewKpiInput): Promise<Kpi> {
  const { data, error } = await supabase.from('kpis').insert(input).select('*').single();
  if (error) throw error;
  return data as Kpi;
}

export interface UploadWeeklyRow {
  department_id: string;
  pillar_id: string;
  kpi_base_name: string;
  iso_year: number;
  iso_week: number;
  target: number;
  actual: number;
  met_target: boolean;
  uploaded_by: string | null;
}

export async function bulkUpsertWeeklyEntriesFromUpload(rows: UploadWeeklyRow[]): Promise<number> {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('weekly_entries')
      .upsert(chunk, { onConflict: 'department_id,pillar_id,kpi_base_name,iso_year,iso_week' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

/** All uploaded weekly figures for one pillar's KPI base name — the Weekly
 * board's fallback source for ISO weeks with no live daily_entries. */
/** Every uploaded weekly figure for one pillar (all its KPIs) — lets the
 * Weekly board colour every KPI pill from its weekly result in one query. */
export async function fetchWeeklyEntriesForPillar(departmentId: string, pillarId: string): Promise<WeeklyEntry[]> {
  const { data, error } = await supabase
    .from('weekly_entries')
    .select('*')
    .eq('department_id', departmentId)
    .eq('pillar_id', pillarId)
    .order('iso_year')
    .order('iso_week');
  if (error) throw error;
  return data as WeeklyEntry[];
}

export async function fetchWeeklyEntriesForKpiBase(departmentId: string, pillarId: string, kpiBaseName: string): Promise<WeeklyEntry[]> {
  const { data, error } = await supabase
    .from('weekly_entries')
    .select('*')
    .eq('department_id', departmentId)
    .eq('pillar_id', pillarId)
    .eq('kpi_base_name', kpiBaseName)
    .order('iso_year')
    .order('iso_week');
  if (error) throw error;
  return data as WeeklyEntry[];
}

export async function fetchActions(departmentId: string, filters?: { pillarId?: string; kpiId?: string }): Promise<ActionItem[]> {
  let query = supabase.from('actions').select('*').eq('department_id', departmentId).order('deadline', { ascending: true, nullsFirst: false });
  if (filters?.pillarId) query = query.eq('pillar_id', filters.pillarId);
  if (filters?.kpiId) query = query.eq('kpi_id', filters.kpiId);
  const { data, error } = await query;
  if (error) throw error;
  return data as ActionItem[];
}

export interface NewActionInput {
  department_id: string;
  pillar_id: string;
  kpi_id: string | null;
  related_issue: string;
  action: string;
  owner_name: string;
  deadline: string | null;
  created_by: string | null;
}

export async function createAction(input: NewActionInput): Promise<ActionItem> {
  const { data, error } = await supabase.from('actions').insert(input).select('*').single();
  if (error) throw error;
  return data as ActionItem;
}

export interface UpdateActionInput {
  id: string;
  pillar_id: string;
  kpi_id: string | null;
  related_issue: string;
  action: string;
  owner_name: string;
  deadline: string | null;
}

export async function updateAction(input: UpdateActionInput): Promise<ActionItem> {
  const { id, ...rest } = input;
  const { data, error } = await supabase.from('actions').update(rest).eq('id', id).select('*').single();
  if (error) throw error;
  return data as ActionItem;
}

export async function setActionStatus(id: string, status: ActionItem['status']): Promise<void> {
  const { error } = await supabase
    .from('actions')
    .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Employees — one global roster (an Employee ID is a person, whichever
// departments they belong to). Department membership and roles live in
// department_members; site admin is a flag on the employee.
// ---------------------------------------------------------------------------

/** Everyone, active or not, for Site Admin's employee directory and the
 * department member pickers. */
export async function fetchAllEmployeesAdmin(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').order('name');
  if (error) throw error;
  return data as Employee[];
}

export async function findEmployeeByCode(code: string): Promise<Employee | null> {
  const { data, error } = await supabase.from('employees').select('*').eq('employee_code', code).maybeSingle();
  if (error) throw error;
  return (data as Employee) ?? null;
}

export interface NewEmployeeInput {
  employee_code: string;
  name: string;
}

export async function createEmployee(input: NewEmployeeInput): Promise<Employee> {
  const { data, error } = await supabase.from('employees').insert(input).select('*').single();
  if (error) throw error;
  return data as Employee;
}

export interface EmployeeIdentityUpdate {
  id: string;
  employee_code: string;
  name: string;
}

/** Employee ID and name double as the login credential, so they're edited
 * through their own explicit popup rather than inline. */
export async function updateEmployeeIdentity(input: EmployeeIdentityUpdate): Promise<void> {
  const { error } = await supabase.from('employees').update({ employee_code: input.employee_code, name: input.name }).eq('id', input.id);
  if (error) throw error;
}

export interface EmployeeSiteUpdate {
  id: string;
  active: boolean;
  is_site_admin: boolean;
}

export async function saveEmployeeSiteUpdates(updates: EmployeeSiteUpdate[]): Promise<void> {
  for (const u of updates) {
    const { error } = await supabase.from('employees').update({ active: u.active, is_site_admin: u.is_site_admin }).eq('id', u.id);
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Departments + membership
// ---------------------------------------------------------------------------

/** Every department, archived ones included (callers filter on `active`). */
export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select('*').order('sort_order').order('name');
  if (error) throw error;
  return data as Department[];
}

export interface NewDepartmentInput {
  slug: string;
  name: string;
  entry_mode: EntryMode;
  upload_format: UploadFormat;
  sort_order: number;
}

export async function createDepartment(input: NewDepartmentInput): Promise<Department> {
  const { data, error } = await supabase.from('departments').insert(input).select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`The web address "${input.slug}" is already used by another department.`);
    throw error;
  }
  return data as Department;
}

export type DepartmentUpdate = Partial<Pick<Department, 'slug' | 'name' | 'active' | 'entry_mode' | 'upload_format' | 'sort_order'>>;

export async function updateDepartment(id: string, patch: DepartmentUpdate): Promise<Department> {
  const { data, error } = await supabase.from('departments').update(patch).eq('id', id).select('*').single();
  if (error) {
    if (error.code === '23505') throw new Error(`The web address "${patch.slug}" is already used by another department.`);
    throw error;
  }
  return data as Department;
}

/** Every membership row — small (people x departments), used for the
 * logged-in person's own roles and for Site Admin's overview. */
export async function fetchMemberships(filter?: { employeeId?: string; departmentId?: string }): Promise<DepartmentMember[]> {
  let q = supabase.from('department_members').select('id, department_id, employee_id, role');
  if (filter?.employeeId) q = q.eq('employee_id', filter.employeeId);
  if (filter?.departmentId) q = q.eq('department_id', filter.departmentId);
  const { data, error } = await q;
  if (error) throw error;
  return data as DepartmentMember[];
}

/** Adds someone to a department, or changes their role if they're already
 * in it. */
export async function upsertDepartmentMember(departmentId: string, employeeId: string, role: DepartmentRole): Promise<void> {
  const { error } = await supabase
    .from('department_members')
    .upsert({ department_id: departmentId, employee_id: employeeId, role }, { onConflict: 'department_id,employee_id' });
  if (error) throw error;
}

export async function removeDepartmentMember(id: string): Promise<void> {
  const { error } = await supabase.from('department_members').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// KPI catalog editing (department admin)
// ---------------------------------------------------------------------------

export type KpiSettingsPatch = Partial<
  Pick<Kpi, 'unit' | 'target' | 'is_higher_better' | 'active' | 'manual_entry' | 'track_weekly' | 'weekly_agg' | 'info'>
>;

/** Applies the same settings to every row of one logical KPI (its Day,
 * Night and Old variants). */
export async function updateKpis(ids: string[], patch: KpiSettingsPatch): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('kpis').update(patch).in('id', ids);
  if (error) throw error;
}

/** Renames and/or re-pillars one logical KPI in a single transaction (the
 * update_kpi_group database function), carrying along everything keyed by
 * pillar + KPI name: weekly figures, saved Paretos, category pick-lists. */
export async function renameKpiGroup(departmentId: string, pillarId: string, baseName: string, newPillarId: string, newBaseName: string): Promise<void> {
  const { error } = await supabase.rpc('update_kpi_group', {
    p_department_id: departmentId,
    p_pillar_id: pillarId,
    p_base: baseName,
    p_new_pillar_id: newPillarId,
    p_new_base: newBaseName,
  });
  if (error) throw error;
}

/** Logical KPIs (Day/Night folded) per department, visible or not. */
export async function fetchKpiCountsByDepartment(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('kpis').select('department_id, name, is_secondary');
  if (error) throw error;
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const k of data as { department_id: string; name: string; is_secondary: boolean }[]) {
    if (k.is_secondary) continue;
    const key = `${k.department_id}|${baseNameOf(k.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(k.department_id, (out.get(k.department_id) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// All-boards rollup — one line of pass/fail counts per department for a day
// ---------------------------------------------------------------------------

export interface BoardRollup {
  kpiCount: number;
  met: number;
  missed: number;
  noData: number;
}

/** Per department: how many of its visible Board KPIs (Day/Night folded
 * into one, like the board's own pills) met, missed, or have no figure for
 * `date`. A KPI counts as missed if any shift missed — same rule as the
 * board's pill colours. Pass/fail is recomputed live from the KPI's current
 * direction, never the stored met_target snapshot. */
export async function fetchBoardRollups(date: string): Promise<Map<string, BoardRollup>> {
  const { data: kpiData, error: kErr } = await supabase
    .from('kpis')
    .select('id, department_id, name, is_higher_better')
    .eq('active', true)
    .eq('is_leading', false)
    .eq('is_secondary', false);
  if (kErr) throw kErr;
  const kpis = kpiData as Pick<Kpi, 'id' | 'department_id' | 'name' | 'is_higher_better'>[];
  const entries: Pick<DailyEntry, 'kpi_id' | 'actual' | 'target'>[] = [];
  const ids = kpis.map((k) => k.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('daily_entries').select('kpi_id, actual, target').in('kpi_id', ids.slice(i, i + 150)).eq('entry_date', date);
    if (error) throw error;
    entries.push(...(data as Pick<DailyEntry, 'kpi_id' | 'actual' | 'target'>[]));
  }
  const entriesByKpi = new Map<string, Pick<DailyEntry, 'kpi_id' | 'actual' | 'target'>[]>();
  for (const e of entries) entriesByKpi.set(e.kpi_id, [...(entriesByKpi.get(e.kpi_id) ?? []), e]);

  // Fold Day/Night rows into one logical KPI per department.
  const groups = new Map<string, { departmentId: string; status: 'met' | 'missed' | 'nodata' }>();
  for (const k of kpis) {
    const key = `${k.department_id}|${baseNameOf(k.name)}`;
    const g = groups.get(key) ?? { departmentId: k.department_id, status: 'nodata' as const };
    for (const e of entriesByKpi.get(k.id) ?? []) {
      const ok = metTarget(k, e.target, e.actual);
      if (!ok) g.status = 'missed';
      else if (g.status === 'nodata') g.status = 'met';
    }
    groups.set(key, g);
  }
  const out = new Map<string, BoardRollup>();
  for (const g of groups.values()) {
    const r = out.get(g.departmentId) ?? { kpiCount: 0, met: 0, missed: 0, noData: 0 };
    r.kpiCount++;
    if (g.status === 'met') r.met++;
    else if (g.status === 'missed') r.missed++;
    else r.noData++;
    out.set(g.departmentId, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Next 24 Hours board — leading KPI numeric values (from the Admin Daily
// Excel upload's "Next 24hrs" tab). Read-only on the board; no manual
// add/edit/delete — the number always comes from the latest upload.
// ---------------------------------------------------------------------------

/** The latest entry per KPI (up to `sinceDate`, inclusive) for a set of
 * leading KPIs — "latest" because different KPIs can in principle lag each
 * other by a day if an upload is partial; each is picked independently
 * rather than assuming they all share the same most-recent date. */
export async function fetchLatestLeadingEntries(kpiIds: string[], sinceDate: string): Promise<LeadingEntry[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase
    .from('leading_entries')
    .select('*')
    .in('kpi_id', kpiIds)
    .lte('entry_date', sinceDate)
    .order('entry_date', { ascending: false });
  if (error) throw error;
  const rows = data as LeadingEntry[];
  const latestByKpi = new Map<string, LeadingEntry>();
  for (const row of rows) {
    if (!latestByKpi.has(row.kpi_id)) latestByKpi.set(row.kpi_id, row);
  }
  return Array.from(latestByKpi.values());
}

export interface UploadLeadingRow {
  kpi_id: string;
  entry_date: string;
  value: number;
  uploaded_by: string | null;
}

export async function bulkUpsertLeadingEntriesFromUpload(rows: UploadLeadingRow[]): Promise<number> {
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('leading_entries').upsert(chunk, { onConflict: 'kpi_id,entry_date' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Insights — CSV export → external AI categorize → re-import → pivot view.
// No AI/API integration lives in this app; an admin runs the exported CSV
// through whatever model they already have access to, by hand, outside the
// app entirely. This layer only ever reads/writes daily_entries.ai_category.
// ---------------------------------------------------------------------------

export interface RawEntryRow {
  id: string;
  entry_date: string;
  shift: 'Day' | 'Night' | null;
  actual: number;
  target: number;
  unit: string;
  reason: string;
  remarks: string;
  ai_category: string | null;
}

function shiftFromKpiName(name: string): 'Day' | 'Night' | null {
  if (/\(Day\)\s*$/i.test(name)) return 'Day';
  if (/\(Night\)\s*$/i.test(name)) return 'Night';
  return null;
}

/** Missed-target entries for one logical KPI (its Day + Night catalog rows
 * combined, if split) — feeds the Insights export table, scoped to
 * whichever KPI the admin picked via the pillar/KPI pills rather than a
 * date-range-across-everything export.
 *
 * Pass/fail is recomputed live via metTarget()+the KPI's *current*
 * is_higher_better, not read from the stored met_target column — that
 * column is a snapshot taken when the row was written. If a KPI's
 * direction is corrected later, every entry written before that change
 * would otherwise keep the old, now-wrong verdict, and this export would
 * silently disagree with the Board (which already recomputes live). */
export async function fetchMissedEntriesForKpiIds(kpiIds: string[], sinceDate: string): Promise<RawEntryRow[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase
    .from('daily_entries')
    .select('id, entry_date, actual, target, remarks, reason_other, ai_category, reason:reasons(label), kpi:kpis(name, unit, is_higher_better)')
    .in('kpi_id', kpiIds)
    .gte('entry_date', sinceDate)
    .order('entry_date', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    entry_date: string;
    actual: number;
    target: number;
    remarks: string | null;
    reason_other: string | null;
    ai_category: string | null;
    reason: { label: string } | null;
    kpi: { name: string; unit: string; is_higher_better: boolean } | null;
  }[];
  return rows
    .filter((r) => !metTarget({ is_higher_better: r.kpi?.is_higher_better ?? true }, r.target, r.actual))
    .map((r) => ({
      id: r.id,
      entry_date: r.entry_date,
      shift: r.kpi ? shiftFromKpiName(r.kpi.name) : null,
      actual: r.actual,
      target: r.target,
      unit: r.kpi?.unit ?? '',
      reason: r.reason_other?.trim() || r.reason?.label || '',
      remarks: r.remarks ?? '',
      ai_category: r.ai_category,
    }));
}

export interface CategoryImportRow {
  id: string;
  category: string;
}

/** Writes back only `ai_category`, one row at a time by id — deliberately
 * not a bulk upsert, since that would require sending every other column
 * back too (risking accidentally clobbering actual/target/remarks with
 * stale values from the exported CSV if a row got edited in the app in the
 * meantime). Fine at this volume: a biweekly categorization batch is
 * dozens of rows, not thousands. */
export async function bulkUpdateAiCategories(rows: CategoryImportRow[]): Promise<number> {
  let written = 0;
  for (const r of rows) {
    const { error } = await supabase.from('daily_entries').update({ ai_category: r.category }).eq('id', r.id);
    if (error) throw error;
    written++;
  }
  return written;
}

export interface CategorizedEntryRow {
  id: string;
  entry_date: string;
  shift: 'Day' | 'Night' | null;
  /** The single category from the CSV export → re-import cycle (ai_category). */
  category: string | null;
  /** Pareto tags per angle (entry_categories), e.g. { Cause: ['QC breakdown', 'Manpower'] }. */
  tags: Record<string, string[]>;
}

const PAGE = 1000;

/** Reads every row of a PostgREST query, a page at a time (the API caps a
 * single response at 1,000 rows). */
async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Already-categorised entries for one logical KPI (Day + Night ids
 * combined) — feeds the pivot/Pareto builder in Insights and the board's
 * saved Pareto card. An entry comes back when it has a CSV category or at
 * least one Pareto tag (from Enter Remarks, the AI review or the Pareto
 * workbook import); anything not categorised yet is simply absent rather
 * than showing up as a misleading "Uncategorised" bucket. */
export async function fetchCategorizedEntriesForKpiIds(kpiIds: string[]): Promise<CategorizedEntryRow[]> {
  if (kpiIds.length === 0) return [];
  type EntryRow = { id: string; entry_date: string; ai_category: string | null; kpi: { name: string } | null };
  type TagRow = { dimension: string; category: string; entry: EntryRow };
  const [withCategory, tagRows] = await Promise.all([
    fetchAllPages<EntryRow>((a, b) =>
      supabase.from('daily_entries').select('id, entry_date, ai_category, kpi:kpis(name)').in('kpi_id', kpiIds).not('ai_category', 'is', null).order('id').range(a, b)
    ),
    fetchAllPages<TagRow>((a, b) =>
      supabase
        .from('entry_categories')
        .select('dimension, category, entry:daily_entries!inner(id, entry_date, ai_category, kpi_id, kpi:kpis(name))')
        .in('entry.kpi_id', kpiIds)
        .order('id')
        .range(a, b)
    ),
  ]);

  const byId = new Map<string, CategorizedEntryRow>();
  const ensure = (r: EntryRow) => {
    let row = byId.get(r.id);
    if (!row) {
      row = { id: r.id, entry_date: r.entry_date, shift: r.kpi ? shiftFromKpiName(r.kpi.name) : null, category: r.ai_category, tags: {} };
      byId.set(r.id, row);
    }
    return row;
  };
  for (const r of withCategory) ensure(r);
  for (const t of tagRows) {
    const row = ensure(t.entry);
    const list = (row.tags[t.dimension] ??= []);
    if (!list.includes(t.category)) list.push(t.category);
  }
  return Array.from(byId.values()).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
}

/** Pareto tags on the given entries, grouped per entry and angle — for the
 * Tags column of the Insights remarks table. */
export async function fetchTagsByEntry(entryIds: string[]): Promise<Map<string, Record<string, string[]>>> {
  const out = new Map<string, Record<string, string[]>>();
  for (let i = 0; i < entryIds.length; i += 200) {
    const { data, error } = await supabase.from('entry_categories').select('entry_id, dimension, category').in('entry_id', entryIds.slice(i, i + 200));
    if (error) throw error;
    for (const t of (data ?? []) as { entry_id: string; dimension: string; category: string }[]) {
      const rec = out.get(t.entry_id) ?? {};
      (rec[t.dimension] ??= []).push(t.category);
      out.set(t.entry_id, rec);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Custom Paretos — a pivot configuration built in Insights, saved so it also
// shows up (live-recomputed, not a frozen snapshot) as an additional Pareto
// card on the Board. One per (pillar, KPI); Insights is the only place that
// can create, update, or delete one — the Board only ever reads.
// ---------------------------------------------------------------------------

export interface CustomPareto {
  id: string;
  pillar_id: string;
  kpi_base_name: string;
  title: string;
  row_field: string;
  column_field: string | null;
  filter_field: string | null;
  filter_values: string[] | null;
}

export interface CustomParetoInput {
  department_id: string;
  pillar_id: string;
  kpi_base_name: string;
  title: string;
  row_field: string;
  column_field: string | null;
  filter_field: string | null;
  filter_values: string[] | null;
  created_by: string | null;
}

/** Every saved custom Pareto for a pillar, in one call — used by the Board,
 * which needs to check "does the currently-selected KPI have one of these"
 * without a fresh query on every KPI-pill click. */
export async function fetchCustomParetosForPillar(departmentId: string, pillarId: string): Promise<CustomPareto[]> {
  const { data, error } = await supabase.from('custom_paretos').select('*').eq('department_id', departmentId).eq('pillar_id', pillarId);
  if (error) throw error;
  return data as CustomPareto[];
}

/** Create-or-replace, keyed on (pillar_id, kpi_base_name) — Insights uses
 * the same button and the same call for both "Save" (nothing exists yet)
 * and "Update" (overwrite the existing one); which label to show is just
 * about whether fetchCustomParetosForPillar already returned one. */
export async function saveCustomPareto(input: CustomParetoInput): Promise<CustomPareto> {
  const { data, error } = await supabase
    .from('custom_paretos')
    .upsert(input, { onConflict: 'department_id,pillar_id,kpi_base_name' })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomPareto;
}

export async function deleteCustomPareto(id: string): Promise<void> {
  const { error } = await supabase.from('custom_paretos').delete().eq('id', id);
  if (error) throw error;
}
