import { supabase } from './supabaseClient';
import type { ActionItem, DailyEntry, Employee, ForecastCardWithRefs, Kpi, KpiWithPillar, Pillar, Reason } from '../types';

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
  entered_by: string;
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
// Forward Looking board — forecast cards for leading KPIs, +1/+2/+3 days out
// ---------------------------------------------------------------------------

const FORECAST_CARD_SELECT = '*, kpi:kpis(name, unit), pillar:pillars(code, name)';

export async function fetchForecastCards(fromDate: string, toDate: string): Promise<ForecastCardWithRefs[]> {
  const { data, error } = await supabase
    .from('forecast_cards')
    .select(FORECAST_CARD_SELECT)
    .gte('target_date', fromDate)
    .lte('target_date', toDate)
    .order('target_date')
    .order('created_at');
  if (error) throw error;
  return data as unknown as ForecastCardWithRefs[];
}

export interface NewForecastCardInput {
  kpi_id: string;
  pillar_id: string;
  target_date: string;
  note: string;
  owner_name: string | null;
  created_by: string | null;
}

export async function createForecastCard(input: NewForecastCardInput): Promise<ForecastCardWithRefs> {
  const { data, error } = await supabase.from('forecast_cards').insert(input).select(FORECAST_CARD_SELECT).single();
  if (error) throw error;
  return data as unknown as ForecastCardWithRefs;
}

export interface UpdateForecastCardInput {
  kpi_id?: string;
  pillar_id?: string;
  target_date?: string;
  note?: string;
  owner_name?: string | null;
}

export async function updateForecastCard(id: string, patch: UpdateForecastCardInput): Promise<ForecastCardWithRefs> {
  const { data, error } = await supabase
    .from('forecast_cards')
    .update(patch)
    .eq('id', id)
    .select(FORECAST_CARD_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as ForecastCardWithRefs;
}

export async function deleteForecastCard(id: string): Promise<void> {
  const { error } = await supabase.from('forecast_cards').delete().eq('id', id);
  if (error) throw error;
}
