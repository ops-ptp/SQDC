import { supabase } from './supabaseClient';
import type { ActionItem, DailyEntry, Employee, Kpi, KpiWithPillar, Pillar, Reason } from '../types';

export async function fetchPillars(): Promise<Pillar[]> {
  const { data, error } = await supabase.from('pillars').select('*').order('sort_order');
  if (error) throw error;
  return data as Pillar[];
}

export async function fetchKpis(): Promise<Kpi[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) throw error;
  return data as Kpi[];
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
  let query = supabase.from('actions').select('*').order('done').order('deadline', { ascending: true, nullsFirst: false });
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

export async function setActionDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('actions')
    .update({ done, completed_at: done ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data as Employee[];
}
