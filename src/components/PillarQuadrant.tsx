import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, getDaysInMonth, startOfWeek, subWeeks, subDays, addDays, getISOWeek } from 'date-fns';
import { fetchActions, fetchEntriesForKpi, fetchEntriesForKpisOnDate, fetchReasonsForKpi } from '../lib/data';
import { metTarget, PILLAR_COLORS, type ActionItem, type DailyEntry, type Kpi, type Pillar, type PerformanceStatus } from '../types';
import KpiRunChart, { type RunPoint } from './KpiRunChart';
import ParetoChart, { type ParetoDatum } from './ParetoChart';
import ActionTable from './ActionTable';
import PillarLetterGrid, { type DayStatus } from './PillarLetterGrid';

export type Granularity = 'daily' | 'weekly';

interface Props {
  pillar: Pillar;
  kpis: Kpi[];
  granularity?: Granularity;
}

/** One logical KPI as shown on the board: a single pill, backed by up to a
 * Day entry, a Night entry, or (for KPIs with no shift split) one entry. */
interface KpiGroup {
  key: string;
  label: string;
  target: number;
  unit: string;
  isHigherBetter: boolean;
  sortOrder: number;
  day?: Kpi;
  night?: Kpi;
  single?: Kpi;
}

function baseNameOf(name: string): string {
  return name.replace(/\s*\((Day|Night)\)\s*$/i, '').trim();
}

function buildGroups(kpis: Kpi[]): KpiGroup[] {
  const map = new Map<string, KpiGroup>();
  for (const k of kpis) {
    const isDay = /\(Day\)\s*$/i.test(k.name);
    const isNight = /\(Night\)\s*$/i.test(k.name);
    const base = baseNameOf(k.name);
    let g = map.get(base);
    if (!g) {
      g = { key: base, label: base, target: k.target, unit: k.unit, isHigherBetter: k.is_higher_better, sortOrder: k.sort_order };
      map.set(base, g);
    }
    g.sortOrder = Math.min(g.sortOrder, k.sort_order);
    if (isDay) g.day = k;
    else if (isNight) g.night = k;
    else g.single = k;
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function groupKpiIds(g: KpiGroup): string[] {
  return [g.day?.id, g.night?.id, g.single?.id].filter((id): id is string => Boolean(id));
}

function indexByDate(entries: DailyEntry[]): Map<string, DailyEntry> {
  const m = new Map<string, DailyEntry>();
  for (const e of entries) m.set(e.entry_date, e);
  return m;
}

const mean = (nums: number[]) => (nums.length === 0 ? null : nums.reduce((s, n) => s + n, 0) / nums.length);

function groupMetTarget(g: KpiGroup, actual: number): boolean {
  return metTarget({ is_higher_better: g.isHigherBetter }, g.target, actual);
}

export default function PillarQuadrant({ pillar, kpis, granularity = 'daily' }: Props) {
  const colors = PILLAR_COLORS[pillar.code] ?? PILLAR_COLORS.S;
  const groups = useMemo(() => buildGroups(kpis), [kpis]);
  const [selectedKey, setSelectedKey] = useState<string>(groups[0]?.key ?? '');
  const selectedGroup = groups.find((g) => g.key === selectedKey) ?? groups[0];

  const [referenceEntries, setReferenceEntries] = useState<DailyEntry[]>([]);
  const [monthEntries, setMonthEntries] = useState<DailyEntry[]>([]);
  const [windowEntries, setWindowEntries] = useState<DailyEntry[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [reasonLabelById, setReasonLabelById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.key === selectedKey)) {
      setSelectedKey(groups[0].key);
    }
  }, [groups, selectedKey]);

  // The board reviews the most recently COMPLETED day, not the day in
  // progress — the SQDC huddle discusses what happened yesterday.
  const today = new Date();
  const referenceDate = subDays(today, 1);
  const referenceDateStr = format(referenceDate, 'yyyy-MM-dd');
  const referenceDay = referenceDate.getDate();

  // Reference-day entries for EVERY KPI in the pillar — drives the red/green
  // outline on every pill, not just the selected one.
  useEffect(() => {
    const ids = kpis.map((k) => k.id);
    if (ids.length === 0) {
      setReferenceEntries([]);
      return;
    }
    fetchEntriesForKpisOnDate(ids, referenceDateStr)
      .then(setReferenceEntries)
      .catch(() => setReferenceEntries([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpis]);

  // Actions for this pillar — independent of which KPI pill is selected.
  useEffect(() => {
    fetchActions({ pillarId: pillar.id }).then(setActions);
  }, [pillar.id]);

  // Month entries (letter grid — always the full calendar month containing
  // the reference day, regardless of the Daily/Weekly toggle) + window
  // entries (chart/Pareto — 7 days or 4 work-weeks ending on the reference
  // day) + reasons, for the selected KPI.
  useEffect(() => {
    if (!selectedGroup) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const ids = groupKpiIds(selectedGroup);
    const monthSince = format(startOfMonth(referenceDate), 'yyyy-MM-dd');
    const windowSince =
      granularity === 'weekly'
        ? format(subWeeks(startOfWeek(referenceDate, { weekStartsOn: 1 }), 7), 'yyyy-MM-dd')
        : format(subDays(referenceDate, 6), 'yyyy-MM-dd');

    Promise.all([
      Promise.all(ids.map((id) => fetchEntriesForKpi(id, monthSince))),
      Promise.all(ids.map((id) => fetchEntriesForKpi(id, windowSince))),
      Promise.all(ids.map((id) => fetchReasonsForKpi(id))),
    ])
      .then(([monthByKpi, windowByKpi, reasonsByKpi]) => {
        if (cancelled) return;
        setMonthEntries(monthByKpi.flat());
        setWindowEntries(windowByKpi.flat());
        const map = new Map<string, string>();
        for (const list of reasonsByKpi) for (const r of list) map.set(r.id, r.label);
        setReasonLabelById(map);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.key, granularity]);

  // ---- Pill status (reference day's combined Day+Night average vs target) -
  function groupStatus(g: KpiGroup): PerformanceStatus {
    const ids = groupKpiIds(g);
    const vals = referenceEntries.filter((e) => ids.includes(e.kpi_id)).map((e) => e.actual);
    if (vals.length === 0) return 'nodata';
    const avg = mean(vals)!;
    return groupMetTarget(g, avg) ? 'met' : 'missed';
  }

  // ---- Letter grid: one cell per calendar day, combined Day+Night average -
  const daysInMonth = getDaysInMonth(referenceDate);
  const dayStatuses: DayStatus[] = useMemo(() => {
    if (!selectedGroup) return [];
    const dayIdx = indexByDate(monthEntries.filter((e) => e.kpi_id === selectedGroup.day?.id));
    const nightIdx = indexByDate(monthEntries.filter((e) => e.kpi_id === selectedGroup.night?.id));
    const singleIdx = indexByDate(monthEntries.filter((e) => e.kpi_id === selectedGroup.single?.id));
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const result: DayStatus[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      if (day > referenceDay) {
        result.push({ day, status: 'future' });
        continue;
      }
      const dateStr = format(new Date(year, month, day), 'yyyy-MM-dd');
      const vals = [dayIdx.get(dateStr)?.actual, nightIdx.get(dateStr)?.actual, singleIdx.get(dateStr)?.actual].filter(
        (v): v is number => v !== undefined
      );
      if (vals.length === 0) {
        result.push({ day, status: 'nodata' });
        continue;
      }
      const avg = mean(vals)!;
      result.push({ day, status: groupMetTarget(selectedGroup, avg) ? 'met' : 'missed' });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthEntries, selectedGroup?.key, daysInMonth, referenceDay]);

  // ---- Headline: reference day's Day / Night actuals, shown as two numbers
  const referenceDayEntry = selectedGroup ? referenceEntries.find((e) => e.kpi_id === selectedGroup.day?.id) : undefined;
  const referenceNightEntry = selectedGroup ? referenceEntries.find((e) => e.kpi_id === selectedGroup.night?.id) : undefined;
  const referenceSingleEntry = selectedGroup ? referenceEntries.find((e) => e.kpi_id === selectedGroup.single?.id) : undefined;

  // ---- Chart: Day / Night / Average lines, last 7 days or last 4 work-weeks
  const chartPoints: RunPoint[] = useMemo(() => {
    if (!selectedGroup) return [];
    const dayIdx = indexByDate(windowEntries.filter((e) => e.kpi_id === selectedGroup.day?.id));
    const nightIdx = indexByDate(windowEntries.filter((e) => e.kpi_id === selectedGroup.night?.id));
    const singleIdx = indexByDate(windowEntries.filter((e) => e.kpi_id === selectedGroup.single?.id));

    if (granularity === 'daily') {
      const points: RunPoint[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = subDays(referenceDate, i);
        const dateStr = format(d, 'yyyy-MM-dd');
        const dayVal = dayIdx.get(dateStr)?.actual ?? singleIdx.get(dateStr)?.actual ?? null;
        const nightVal = nightIdx.get(dateStr)?.actual ?? null;
        const vals = [dayVal, nightVal].filter((v): v is number => v !== null);
        points.push({
          label: format(d, 'EEE d'),
          date: dateStr,
          dayActual: dayVal,
          nightActual: nightVal,
          avgActual: mean(vals),
          target: selectedGroup.target,
        });
      }
      return points;
    }

    // Weekly: last 8 ISO weeks (Mon-Sun), simple average of all logged days per week.
    const currentIsoWeekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const points: RunPoint[] = [];
    for (let w = 7; w >= 0; w--) {
      const weekStart = subWeeks(currentIsoWeekStart, w);
      const dayVals: number[] = [];
      const nightVals: number[] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(weekStart, d);
        if (date > referenceDate) break;
        const dateStr = format(date, 'yyyy-MM-dd');
        const dv = dayIdx.get(dateStr)?.actual ?? singleIdx.get(dateStr)?.actual;
        const nv = nightIdx.get(dateStr)?.actual;
        if (dv !== undefined) dayVals.push(dv);
        if (nv !== undefined) nightVals.push(nv);
      }
      const dayAvg = mean(dayVals);
      const nightAvg = mean(nightVals);
      const both = [dayAvg, nightAvg].filter((v): v is number => v !== null);
      points.push({
        label: `Wk ${getISOWeek(weekStart)}`,
        date: format(weekStart, 'yyyy-MM-dd'),
        dayActual: dayAvg,
        nightActual: nightAvg,
        avgActual: mean(both),
        target: selectedGroup.target,
      });
    }
    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowEntries, selectedGroup?.key, granularity]);

  // ---- Pareto: missed-target reasons within the same chart window --------
  const paretoData: ParetoDatum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of windowEntries) {
      if (e.met_target) continue;
      const label = e.reason_other?.trim() || (e.reason_id ? reasonLabelById.get(e.reason_id) : undefined) || 'Unspecified';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [windowEntries, reasonLabelById]);

  const hero = (
    <div className="quadrant-hero" style={{ background: colors.soft }}>
      <PillarLetterGrid letter={pillar.code} days={dayStatuses} todayDay={referenceDay} height={300} />
      <span className="quadrant-hero-name">{pillar.name}</span>
    </div>
  );

  if (groups.length === 0) {
    return (
      <section className="quadrant">
        {hero}
        <div className="empty-state">No KPIs configured for this pillar yet.</div>
      </section>
    );
  }

  return (
    <section className="quadrant">
      {hero}

      <div className="kpi-pills">
        {groups.map((g) => {
          const status = groupStatus(g);
          const isSelected = g.key === selectedKey;
          const color = status === 'met' ? 'var(--good)' : status === 'missed' ? 'var(--bad)' : '#94a3b8';
          return (
            <button
              key={g.key}
              className="kpi-pill"
              style={
                isSelected
                  ? { background: color, borderColor: color, color: 'white' }
                  : { background: 'white', borderColor: color, color }
              }
              onClick={() => setSelectedKey(g.key)}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {selectedGroup && (
        <>
          <div className="kpi-headline">
            <div>
              <h3>{selectedGroup.label}</h3>
              <span className="muted">
                Target {selectedGroup.target} {selectedGroup.unit} · {selectedGroup.isHigherBetter ? 'higher is good' : 'lower is good'}
                {' · '}
                <strong>{format(referenceDate, 'EEE d MMM')}</strong>
              </span>
            </div>
            <div className="headline-values">
              {selectedGroup.single ? (
                <div className={`headline-value ${referenceSingleEntry ? (groupMetTarget(selectedGroup, referenceSingleEntry.actual) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                  {referenceSingleEntry ? referenceSingleEntry.actual : '—'}
                  <span className="headline-unit">{selectedGroup.unit}</span>
                </div>
              ) : (
                <>
                  <div className="headline-shift">
                    <span className="headline-shift-label">Day</span>
                    <span className={`headline-value ${referenceDayEntry ? (groupMetTarget(selectedGroup, referenceDayEntry.actual) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                      {referenceDayEntry ? referenceDayEntry.actual : '—'}
                      <span className="headline-unit">{selectedGroup.unit}</span>
                    </span>
                  </div>
                  <div className="headline-shift">
                    <span className="headline-shift-label">Night</span>
                    <span className={`headline-value ${referenceNightEntry ? (groupMetTarget(selectedGroup, referenceNightEntry.actual) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                      {referenceNightEntry ? referenceNightEntry.actual : '—'}
                      <span className="headline-unit">{selectedGroup.unit}</span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {granularity === 'daily' && (
            <div className="quadrant-section">
              <div className="quadrant-block-title">Remarks / Summary</div>
              <div className="remarks-summary">
                {selectedGroup.single ? (
                  <div className="remarks-block">
                    <span className="remarks-block-label">{format(referenceDate, 'EEE d MMM')}</span>
                    <p className="remarks-text">{referenceSingleEntry?.remarks?.trim() || 'No remarks logged for this date.'}</p>
                  </div>
                ) : (
                  <>
                    <div className="remarks-block">
                      <span className="remarks-block-label">Day</span>
                      <p className="remarks-text">{referenceDayEntry?.remarks?.trim() || 'No remarks logged for this date.'}</p>
                    </div>
                    <div className="remarks-block">
                      <span className="remarks-block-label">Night</span>
                      <p className="remarks-text">{referenceNightEntry?.remarks?.trim() || 'No remarks logged for this date.'}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="quadrant-section">
            <div className="quadrant-block-title">
              {granularity === 'weekly' ? 'Trend — last 8 ISO weeks' : 'Trend — last 7 days'}
            </div>
            {loading ? (
              <div className="empty-state">Loading…</div>
            ) : (
              <KpiRunChart points={chartPoints} unit={selectedGroup.unit} showDayNight={!selectedGroup.single} />
            )}
          </div>

          <div className="quadrant-section">
            <div className="quadrant-block-title">
              Pareto of reasons — {granularity === 'weekly' ? 'last 8 ISO weeks' : 'last 7 days'}
            </div>
            <ParetoChart data={paretoData} background={colors.soft} />
          </div>

          <div className="quadrant-section quadrant-section-fill">
            <div className="quadrant-block-title">Actions</div>
            <ActionTable actions={actions} compact />
          </div>
        </>
      )}
    </section>
  );
}
