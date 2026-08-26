import { supabase } from './supabaseClient';
import type { ActionItem, DailyEntry, Employee, Kpi, KpiWithPillar, LeadingEntry, Pillar, Reason, WeeklyEntry } from '../types';

export async function fetchPillars(): Promise<Pillar[]> {
  const { data, error } = await supabase.from('pillars').select('*').order('sort_order');
  if (error) throw error;
  return data as Pillar[];
}

/** Lagging KPIs only — the ones tracked daily with target/actual on the main Board. */
export async function fetchKpis(): Promise<Kpi[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*')
    .eq('active', true)
    .eq('is_leading', false)
    .order('sort_order');
  if (error) throw error;
  return data as Kpi[];
}

/** Leading (process) KPIs only — these are the ones forecastable on the Forward Looking board. */
export async function fetchLeadingKpis(): Promise<KpiWithPillar[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*, pillar:pillars(code, name)')
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
export async function fetchKpisForUpload(): Promise<Kpi[]> {
  return fetchKpis();
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

export interface UploadWeeklyRow {
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
      .upsert(chunk, { onConflict: 'pillar_id,kpi_base_name,iso_year,iso_week' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

/** All uploaded weekly figures for one pillar's KPI base name — the Weekly
 * board's fallback source for ISO weeks with no live daily_entries. */
export async function fetchWeeklyEntriesForKpiBase(pillarId: string, kpiBaseName: string): Promise<WeeklyEntry[]> {
  const { data, error } = await supabase
    .from('weekly_entries')
    .select('*')
    .eq('pillar_id', pillarId)
    .eq('kpi_base_name', kpiBaseName)
    .order('iso_year')
    .order('iso_week');
  if (error) throw error;
  return data as WeeklyEntry[];
}

export async function fetchActions(filters?: { pillarId?: string; kpiId?: string }): Promise<ActionItem[]> {
  let query = supabase.from('actions').select('*').order('deadline', { ascending: true, nullsFirst: false });
  if (filters?.pillarId) query = query.eq('pillar_id', filters.pillarId);
  if (filters?.kpiId) query = query.eq('kpi_id', filters.kpiId);
  const { data, error } = await query;
  if (error) throw error;
  return data as ActionItem[];
}

export interface NewActionInput {
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

export async function setActionStatus(id: string, status: ActionItem['status']): Promise<void> {
  const { error } = await supabase
    .from('actions')
    .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data as Employee[];
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
