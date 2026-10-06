import { getISOWeek, getISOWeekYear, parseISO } from 'date-fns';
import { baseNameOf, metTarget, type DailyEntry, type Kpi, type WeeklyEntry } from '../types';

/** Weekly figures for departments that don't upload a weekly workbook:
 * each logical KPI's daily values (all its shifts) in an ISO week, rolled up
 * by the KPI's own `weekly_agg` — 'avg' for rates/percentages/productivity,
 * 'sum' for counts and totals. Targets roll up the same way, over the same
 * days, so a summed KPI is judged against its summed daily targets.
 *
 * Returns the same shape as an uploaded weekly_entries row, so the Weekly
 * view doesn't care which source a department uses. Old-calculation
 * (secondary) rows never contribute — same rule as everywhere else. */
export function rollUpWeekly(kpis: Kpi[], entries: DailyEntry[]): WeeklyEntry[] {
  const kpiById = new Map(kpis.filter((k) => !k.is_secondary).map((k) => [k.id, k]));
  const buckets = new Map<string, { kpi: Kpi; base: string; year: number; week: number; actuals: number[]; targets: number[] }>();
  for (const e of entries) {
    const kpi = kpiById.get(e.kpi_id);
    if (!kpi) continue;
    const d = parseISO(e.entry_date);
    const year = getISOWeekYear(d);
    const week = getISOWeek(d);
    const base = baseNameOf(kpi.name);
    const key = `${kpi.pillar_id}|${base}|${year}|${week}`;
    let b = buckets.get(key);
    if (!b) {
      b = { kpi, base, year, week, actuals: [], targets: [] };
      buckets.set(key, b);
    }
    b.actuals.push(Number(e.actual));
    b.targets.push(Number(e.target));
  }
  const out: WeeklyEntry[] = [];
  for (const [key, b] of buckets) {
    const combine = (xs: number[]) => {
      const total = xs.reduce((s, x) => s + x, 0);
      return b.kpi.weekly_agg === 'sum' ? total : total / xs.length;
    };
    const actual = combine(b.actuals);
    const target = combine(b.targets);
    out.push({
      id: `rollup:${key}`,
      department_id: b.kpi.department_id,
      pillar_id: b.kpi.pillar_id,
      kpi_base_name: b.base,
      iso_year: b.year,
      iso_week: b.week,
      actual,
      target,
      met_target: metTarget(b.kpi, target, actual),
      uploaded_by: null,
      created_at: '',
      updated_at: '',
    });
  }
  return out.sort((a, b) => a.iso_year - b.iso_year || a.iso_week - b.iso_week);
}
