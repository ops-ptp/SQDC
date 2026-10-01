import { supabase } from './supabaseClient';
import type { DailyEntry } from '../types';
import { cleanLabel } from './categoryCore';

export { DEFAULT_DIMENSION, cleanLabel, computeParetoRows, orderedDimensions, type ParetoRow } from './categoryCore';

// ---------------------------------------------------------------------------
// Category tagging for the Weekly / Bi-weekly Pareto.
//
// kpi_categories   — pick-list per logical KPI (pillar + base name, so Day
//                    and Night share it) and per dimension.
// entry_categories — tags on one daily entry (one shift). A shift may carry
//                    several categories; the Pareto counts TAGS, not shifts,
//                    matching the team's weekly_paretto.xlsx.
// Most KPIs have one dimension ("Cause"). Accident During Operation has
// three (Location / Equipment / Symptom), each its own Pareto tab.
// ---------------------------------------------------------------------------

export interface KpiCategory {
  id: string;
  pillar_id: string;
  kpi_base_name: string;
  dimension: string;
  label: string;
  sort_order: number;
}

export interface EntryCategory {
  id: string;
  entry_id: string;
  dimension: string;
  category: string;
}

/** A tag joined to the entry it sits on — what the Pareto and its drill-down
 * list are built from. */
export interface TaggedEntryRow {
  tagId: string;
  dimension: string;
  category: string;
  entry: Pick<DailyEntry, 'id' | 'kpi_id' | 'entry_date' | 'actual' | 'target' | 'remarks'>;
}

export async function fetchKpiCategories(pillarId: string, kpiBaseName: string): Promise<KpiCategory[]> {
  const { data, error } = await supabase
    .from('kpi_categories')
    .select('*')
    .eq('pillar_id', pillarId)
    .eq('kpi_base_name', kpiBaseName)
    .order('sort_order')
    .order('label');
  if (error) throw error;
  return data as KpiCategory[];
}

/** Adds a category to a KPI's pick-list. If one with the same text already
 * exists (ignoring case), that existing label is returned instead, so a
 * new tag can never introduce another casing variant going forward. */
export async function addKpiCategory(
  pillarId: string,
  kpiBaseName: string,
  dimension: string,
  rawLabel: string,
  existing: KpiCategory[]
): Promise<string> {
  const label = cleanLabel(rawLabel);
  const match = existing.find((c) => c.dimension === dimension && c.label.toLowerCase() === label.toLowerCase());
  if (match) return match.label;
  const { error } = await supabase
    .from('kpi_categories')
    .upsert(
      { pillar_id: pillarId, kpi_base_name: kpiBaseName, dimension, label, sort_order: 999 },
      { onConflict: 'pillar_id,kpi_base_name,dimension,label', ignoreDuplicates: true }
    );
  if (error) throw error;
  return label;
}

export async function fetchEntryCategories(entryIds: string[]): Promise<EntryCategory[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await supabase.from('entry_categories').select('id, entry_id, dimension, category').in('entry_id', entryIds);
  if (error) throw error;
  return data as EntryCategory[];
}

export async function addEntryCategory(entryId: string, dimension: string, category: string, createdBy: string | null): Promise<void> {
  const { error } = await supabase
    .from('entry_categories')
    .upsert(
      { entry_id: entryId, dimension, category, created_by: createdBy },
      { onConflict: 'entry_id,dimension,category', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function removeEntryCategory(entryId: string, dimension: string, category: string): Promise<void> {
  const { error } = await supabase
    .from('entry_categories')
    .delete()
    .eq('entry_id', entryId)
    .eq('dimension', dimension)
    .eq('category', category);
  if (error) throw error;
}

/** Every tag on the given KPIs' entries within [from, to] (inclusive dates),
 * with the entry it belongs to — one query, filtered on the joined entry. */
export async function fetchTaggedEntries(kpiIds: string[], from: string, to: string): Promise<TaggedEntryRow[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase
    .from('entry_categories')
    .select('id, dimension, category, entry:daily_entries!inner(id, kpi_id, entry_date, actual, target, remarks)')
    .in('entry.kpi_id', kpiIds)
    .gte('entry.entry_date', from)
    .lte('entry.entry_date', to);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    dimension: string;
    category: string;
    entry: TaggedEntryRow['entry'];
  }[];
  return rows.map((r) => ({ tagId: r.id, dimension: r.dimension, category: r.category, entry: r.entry }));
}


// ---------------------------------------------------------------------------
// Bulk helpers for the Admin Pareto-workbook import. All additive: list
// items and tags are inserted with ignoreDuplicates, and remarks are only
// written where the entry has none yet — re-importing never deletes or
// overwrites anything people have entered in the app.
// ---------------------------------------------------------------------------

export interface EntryLiteRow {
  id: string;
  kpi_id: string;
  entry_date: string;
  actual: number;
  remarks: string | null;
}

export async function fetchEntriesLite(kpiIds: string[], from: string, to: string): Promise<EntryLiteRow[]> {
  if (kpiIds.length === 0) return [];
  const { data, error } = await supabase
    .from('daily_entries')
    .select('id, kpi_id, entry_date, actual, remarks')
    .in('kpi_id', kpiIds)
    .gte('entry_date', from)
    .lte('entry_date', to);
  if (error) throw error;
  return data as EntryLiteRow[];
}

const CHUNK = 400;

export async function bulkAddKpiCategories(
  rows: { pillar_id: string; kpi_base_name: string; dimension: string; label: string; sort_order: number }[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('kpi_categories')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'pillar_id,kpi_base_name,dimension,label', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function bulkAddEntryCategories(
  rows: { entry_id: string; dimension: string; category: string; created_by: string | null }[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('entry_categories')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'entry_id,dimension,category', ignoreDuplicates: true });
    if (error) throw error;
  }
}

/** Writes a remark onto entries that don't have one yet. The `.is('remarks',
 * null)` guard makes this safe even if someone added a remark in the app
 * between the import's read and its write. */
export async function fillEmptyRemarks(updates: { id: string; remarks: string }[]): Promise<number> {
  let written = 0;
  for (const u of updates) {
    const { data, error } = await supabase.from('daily_entries').update({ remarks: u.remarks }).eq('id', u.id).is('remarks', null).select('id');
    if (error) throw error;
    written += data?.length ?? 0;
  }
  return written;
}
