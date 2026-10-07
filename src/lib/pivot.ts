import { getISOWeek, getISOWeekYear, parseISO } from 'date-fns';
import type { CategorizedEntryRow } from './data';
import type { ParetoDatum } from '../components/ParetoChart';

// ---------------------------------------------------------------------------
// Pivot over categorised entries — shared by Insights and the board's saved
// Pareto card, so the two can never disagree.
//
// Fields:
//   angle:<name>  — the Pareto tags in one angle (entry_categories with that
//                   dimension: Cause, Equipment, Location…). A remark can
//                   carry several tags in one angle, so a field can have
//                   several VALUES per entry: the entry counts once under
//                   each of them (Pareto of tags, like the Weekly Pareto).
//   shift, week   — from the entry itself
// An entry with no value for the Group-by field is left out (not tagged
// from that angle yet) rather than shown as an "Untagged" bar.
// ---------------------------------------------------------------------------

interface PivotFieldDef {
  key: string;
  label: string;
}

const ANGLE_PREFIX = 'angle:';
const angleField = (angle: string) => `${ANGLE_PREFIX}${angle}`;

const BASE_FIELDS: PivotFieldDef[] = [
  { key: 'shift', label: 'Shift' },
  { key: 'week', label: 'Week' },
];

/** Fields that have data in these entries: each angle found in their tags
 * (Cause first), then Shift and Week. */
export function pivotFieldsFor(entries: CategorizedEntryRow[]): PivotFieldDef[] {
  const angles = new Set<string>();
  for (const e of entries) {
    for (const [angle, tags] of Object.entries(e.tags)) if (tags.length) angles.add(angle);
  }
  const angleFields = Array.from(angles)
    .sort((a, b) => (a === 'Cause' ? -1 : b === 'Cause' ? 1 : a.localeCompare(b)))
    .map((a) => ({ key: angleField(a), label: a }));
  return [...angleFields, ...BASE_FIELDS];
}

export function pivotFieldLabel(key: string): string {
  if (key.startsWith(ANGLE_PREFIX)) return key.slice(ANGLE_PREFIX.length);
  return BASE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Every value an entry has for a field — none, one, or (for an angle with
 * several tags) more than one. */
function pivotDimValues(e: CategorizedEntryRow, key: string): string[] {
  if (key.startsWith(ANGLE_PREFIX)) return e.tags[key.slice(ANGLE_PREFIX.length)] ?? [];
  switch (key) {
    case 'shift':
      return [e.shift ?? 'Unspecified'];
    case 'week': {
      // ISO year + zero-padded week ("2026-W07"): weeks from different years
      // stay apart and the labels sort in time order.
      const d = parseISO(e.entry_date);
      return [`${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`];
    }
    default:
      return [];
  }
}

/** Kept an entry when ANY of its values for the filter field is ticked. */
export function applyPivotFilter(entries: CategorizedEntryRow[], filterField: string | null | undefined, filterValues: string[] | null | undefined): CategorizedEntryRow[] {
  if (!filterField || !filterValues || filterValues.length === 0) return entries;
  const set = new Set(filterValues);
  return entries.filter((e) => pivotDimValues(e, filterField).some((v) => set.has(v)));
}

export function pivotFilterOptions(entries: CategorizedEntryRow[], filterField: string): string[] {
  return Array.from(new Set(entries.flatMap((e) => pivotDimValues(e, filterField)))).sort();
}

export function computeChartData(entries: CategorizedEntryRow[], rowField: string): ParetoDatum[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const label of pivotDimValues(e, rowField)) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

/** How many entries have at least one value for the field, and whether any
 * has more than one (then bars add up to more than the entries behind them). */
export function pivotCoverage(entries: CategorizedEntryRow[], field: string): { entries: number; multi: boolean } {
  let n = 0;
  let multi = false;
  for (const e of entries) {
    const v = pivotDimValues(e, field);
    if (v.length) n++;
    if (v.length > 1) multi = true;
  }
  return { entries: n, multi };
}

interface CrossTab {
  rows: string[];
  cols: string[];
  grid: Map<string, number>;
}

/** Every row value × column value an entry has counts once — so Cause ×
 * Equipment shows which equipment comes up with which cause. */
export function computeCrossTab(entries: CategorizedEntryRow[], rowField: string, colField: string): CrossTab {
  const rowLabels = new Set<string>();
  const colLabels = new Set<string>();
  const grid = new Map<string, number>();
  for (const e of entries) {
    const rs = pivotDimValues(e, rowField);
    const cs = pivotDimValues(e, colField);
    for (const r of rs) {
      for (const c of cs) {
        rowLabels.add(r);
        colLabels.add(c);
        grid.set(`${r}\u0000${c}`, (grid.get(`${r}\u0000${c}`) ?? 0) + 1);
      }
    }
  }
  return { rows: Array.from(rowLabels).sort(), cols: Array.from(colLabels).sort(), grid };
}
