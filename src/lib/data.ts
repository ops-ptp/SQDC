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
export async function fetchAllKpisAdmin(): Promise<KpiWithPillar[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*, pillar:pillars(code, name)')
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
  pillar_id: string;
  name: string;
  unit: string;
  is_higher_better: boolean;
  target: number;
  is_leading: boolean;
  sort_order: number;
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
