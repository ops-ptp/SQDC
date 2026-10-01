/** Pure category helpers — no I/O, safe to import anywhere (incl. tests). */

export const DEFAULT_DIMENSION = 'Cause';

/** Collapses whitespace and trims — the only normalisation applied to a
 * category label. Case and wording are deliberately kept exactly as typed
 * (merging near-duplicates like "QC breakdown"/"QC Breakdown" was deferred
 * by the user). */
export function cleanLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Dimensions for a KPI, in a stable order: the default "Cause" first, then
 * any others alphabetically except that Accident's three keep their
 * spreadsheet order. Falls back to ["Cause"] when the KPI has no list yet. */
const DIMENSION_ORDER = ['Cause', 'Location', 'Equipment', 'Symptom'];
export function orderedDimensions(categories: { dimension: string }[]): string[] {
  const set = new Set(categories.map((c) => c.dimension));
  if (set.size === 0) return [DEFAULT_DIMENSION];
  return Array.from(set).sort((a, b) => {
    const ia = DIMENSION_ORDER.indexOf(a);
    const ib = DIMENSION_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}


// ---------------------------------------------------------------------------
// Pure Pareto computation — no I/O, so it's unit-testable against the
// spreadsheet's own "Week 36 & 37" summary tabs.
// ---------------------------------------------------------------------------

export interface ParetoRow {
  rank: number;
  category: string;
  count: number;
  /** Running share of all tags, 0-100, rounded to 1 decimal. */
  cumulativePct: number;
}

/** Counts tags per category (one dimension), sorted by count desc then name,
 * with rank and cumulative %. Ties share the order the spreadsheet would
 * give them only loosely — rank is simply position in the sorted list. */
export function computeParetoRows(tags: { category: string }[]): ParetoRow[] {
  const counts = new Map<string, number>();
  for (const t of tags) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const total = tags.length;
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let running = 0;
  return sorted.map(([category, count], i) => {
    running += count;
    return { rank: i + 1, category, count, cumulativePct: total > 0 ? Math.round((running / total) * 1000) / 10 : 0 };
  });
}

// ---------------------------------------------------------------------------
// Review periods for the Weekly view's Pareto: one ISO week, or a fixed
// two-week pair. Pairs are anchored so they line up with the team's own
// naming ("Week 36 & 37", then 38 & 39, …) and keep alternating cleanly
// across a year boundary, rather than being a rolling "last 14 days".
// ---------------------------------------------------------------------------

export type ParetoSpan = 1 | 2;

export interface ParetoPeriod {
  from: string; // yyyy-mm-dd, a Monday
  to: string; // yyyy-mm-dd, a Sunday
  label: string; // e.g. "Wk 38 & 39 · 14–27 Sep"
}

const DAY_MS = 86400000;
/** Monday of ISO week 36, 2026 — the start of the team's "Week 36 & 37". */
const PAIR_ANCHOR_UTC = Date.UTC(2026, 7, 31);

function utcDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoWeekOfUtc(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday decides the ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function shortRange(fromMs: number, toMs: number): string {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}

/** The period containing `reference`, stepped back `offset` periods
 * (0 = the period the reviewed day falls in). */
export function paretoPeriod(reference: Date, span: ParetoSpan, offset: number): ParetoPeriod {
  const refMs = utcDay(reference);
  const refMonday = refMs - (((new Date(refMs).getUTCDay() + 6) % 7) * DAY_MS);
  let start: number;
  if (span === 1) {
    start = refMonday - offset * 7 * DAY_MS;
  } else {
    const weeksSinceAnchor = Math.round((refMonday - PAIR_ANCHOR_UTC) / (7 * DAY_MS));
    const pairStart = PAIR_ANCHOR_UTC + Math.floor(weeksSinceAnchor / 2) * 2 * 7 * DAY_MS;
    start = pairStart - offset * 2 * 7 * DAY_MS;
  }
  const end = start + (span * 7 - 1) * DAY_MS;
  const w1 = isoWeekOfUtc(start);
  const weeks = span === 1 ? `Wk ${w1}` : `Wk ${w1} & ${isoWeekOfUtc(start + 7 * DAY_MS)}`;
  return { from: ymd(start), to: ymd(end), label: `${weeks} · ${shortRange(start, end)}` };
}
