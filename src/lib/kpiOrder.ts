import { baseNameOf, type Kpi } from '../types';

// ---------------------------------------------------------------------------
// KPI display order (kpis.sort_order) — pure helpers, no I/O.
//
// Every screen that lists KPIs shows them per pillar, sorted by sort_order
// (the Board's pills, Next 24 Hours' cards, Enter Remarks, Admin → KPIs,
// the upload template). A Day/Night KPI is several rows sharing a base
// name, so it is reordered as one unit. Saving renumbers a pillar's units
// 10, 20, 30… with each unit's own rows kept together inside its step —
// Day +0, Night +1, Old Day +2, Old Night +3 — which also cleans up the
// duplicate and 999 values left by earlier imports.
// ---------------------------------------------------------------------------

const STEP = 10;

/** Day, Night, then the "(Old)" comparison rows. */
function roleRank(name: string): number {
  const old = /\(Old\)/i.test(name) ? 2 : 0;
  if (/\(Night\)\s*$/i.test(name)) return old + 1;
  return old;
}

/** The order the screens show: lowest sort_order of each base name first,
 * ties broken by name so it is stable on every screen. */
export function orderedBaseNames(kpis: Pick<Kpi, 'name' | 'sort_order'>[]): string[] {
  const min = new Map<string, number>();
  for (const k of kpis) {
    const base = baseNameOf(k.name);
    min.set(base, Math.min(min.get(base) ?? Infinity, k.sort_order));
  }
  return Array.from(min.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([base]) => base);
}

/**
 * New sort_order for one pillar's KPIs, given the units in their new order.
 * `units` lists each unit's KPI rows (one row for a plain KPI, several for
 * Day/Night/Old). Rows of the pillar not in any unit — e.g. hidden KPIs not
 * shown while arranging — follow after, in their existing order. Returns
 * only the rows whose sort_order actually changes.
 */
export function renumberKpis<K extends Pick<Kpi, 'id' | 'name' | 'sort_order'>>(units: K[][], allPillarKpis: K[]): { id: string; sort_order: number }[] {
  const placed = new Set(units.flat().map((k) => k.id));
  const rest = allPillarKpis.filter((k) => !placed.has(k.id));
  // Hidden rows keep their own grouping (by base name) and relative order.
  const restUnits = orderedBaseNames(rest).map((base) => rest.filter((k) => baseNameOf(k.name) === base));
  const updates: { id: string; sort_order: number }[] = [];
  [...units, ...restUnits].forEach((unit, i) => {
    const rows = [...unit].sort((a, b) => roleRank(a.name) - roleRank(b.name) || a.name.localeCompare(b.name));
    rows.forEach((k, j) => {
      const sort_order = (i + 1) * STEP + Math.min(j, STEP - 1);
      if (k.sort_order !== sort_order) updates.push({ id: k.id, sort_order });
    });
  });
  return updates;
}

/** Moves the item at `from` to `to` (array positions), returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
