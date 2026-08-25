import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, getDaysInMonth, startOfWeek, subWeeks, subDays, addDays, getISOWeek, getISOWeekYear } from 'date-fns';
import { fetchActions, fetchEntriesForKpi, fetchEntriesForKpisOnDate, fetchReasonsForKpi, fetchWeeklyEntriesForKpiBase } from '../lib/data';
import { useEmployee } from '../context/EmployeeContext';
import { metTarget, PILLAR_COLORS, type ActionItem, type DailyEntry, type Kpi, type Pillar, type PerformanceStatus, type WeeklyEntry } from '../types';
import KpiRunChart, { type RunPoint } from './KpiRunChart';
import ParetoChart, { type ParetoDatum } from './ParetoChart';
import ActionTable from './ActionTable';
import PillarLetterGrid, { type DayStatus } from './PillarLetterGrid';

export type Granularity = 'daily' | 'weekly';

interface Props {
  pillar: Pillar;
  kpis: Kpi[];
  granularity?: Granularity;
  /** Daily view only — controlled by one board-wide toggle button in
   * Dashboard.tsx so all 4 quadrants show/hide together. Weekly view always
   * shows both regardless of this prop. */
  showParetoActions?: boolean;
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

/** Pass/fail vs. target. Pass `targetOverride` (an entry's own snapshotted
 * `target`) whenever a real DailyEntry is available — some KPIs (e.g.
 * Moves, whose target is the day's uploaded Projection figure, not a fixed
 * catalog value) have a target that varies by date, so the live `g.target`
 * from the KPI catalog is only a fallback for when no entry exists yet. */
function groupMetTarget(g: KpiGroup, actual: number, targetOverride?: number): boolean {
  return metTarget({ is_higher_better: g.isHigherBetter }, targetOverride ?? g.target, actual);
}

export default function PillarQuadrant({ pillar, kpis, granularity = 'daily', showParetoActions = true }: Props) {
  const navigate = useNavigate();
  const { employee } = useEmployee();
  const colors = PILLAR_COLORS[pillar.code] ?? PILLAR_COLORS.S;
  const groups = useMemo(() => buildGroups(kpis), [kpis]);
  const [selectedKey, setSelectedKey] = useState<string>(groups[0]?.key ?? '');
  const selectedGroup = groups.find((g) => g.key === selectedKey) ?? groups[0];

  const [referenceEntries, setReferenceEntries] = useState<DailyEntry[]>([]);
  const [monthEntries, setMonthEntries] = useState<DailyEntry[]>([]);
  const [windowEntries, setWindowEntries] = useState<DailyEntry[]>([]);
  // Pareto has its own lookback window, independent of the Trend chart's —
  // daily view: same last-7-days window as the chart. Weekly view: last 2
  // weeks (the chart stays at last 8 ISO weeks) — see item 8 of the spec.
  const [paretoEntries, setParetoEntries] = useState<DailyEntry[]>([]);
  // Fallback source for the Weekly trend — uploaded weekly figures, used only
  // for ISO weeks that have no live daily_entries to aggregate (item 1/8).
  const [weeklyFallback, setWeeklyFallback] = useState<WeeklyEntry[]>([]);
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
    // Pareto window: daily reuses the chart's 7-day window; weekly is a
    // shorter last-2-weeks lookback, not the chart's 8-week one.
    const paretoSince =
      granularity === 'weekly'
        ? format(subWeeks(startOfWeek(referenceDate, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')
        : windowSince;

    Promise.all([
      Promise.all(ids.map((id) => fetchEntriesForKpi(id, monthSince))),
      Promise.all(ids.map((id) => fetchEntriesForKpi(id, windowSince))),
      granularity === 'weekly' ? Promise.all(ids.map((id) => fetchEntriesForKpi(id, paretoSince))) : null,
      Promise.all(ids.map((id) => fetchReasonsForKpi(id))),
    ])
      .then(([monthByKpi, windowByKpi, paretoByKpi, reasonsByKpi]) => {
        if (cancelled) return;
        setMonthEntries(monthByKpi.flat());
        setWindowEntries(windowByKpi.flat());
        setParetoEntries(paretoByKpi ? paretoByKpi.flat() : windowByKpi.flat());
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

  // Weekly fallback figures — only needed in Weekly view.
  useEffect(() => {
    if (granularity !== 'weekly' || !selectedGroup) {
      setWeeklyFallback([]);
      return;
    }
    fetchWeeklyEntriesForKpiBase(pillar.id, selectedGroup.label)
      .then(setWeeklyFallback)
      .catch(() => setWeeklyFallback([]));
  }, [granularity, selectedGroup?.key, pillar.id, selectedGroup?.label]);

  // ---- Pill status (reference day's combined Day+Night average vs target) -
  // Target is averaged from each entry's own snapshotted `target`, not the
  // live KPI catalog value — correct for KPIs like Moves whose target
  // varies by date (the day's uploaded Projection figure).
  function groupStatus(g: KpiGroup): PerformanceStatus {
    const ids = groupKpiIds(g);
    const entries = referenceEntries.filter((e) => ids.includes(e.kpi_id));
    if (entries.length === 0) return 'nodata';
    const avgActual = mean(entries.map((e) => e.actual))!;
    const avgTarget = mean(entries.map((e) => e.target))!;
    return groupMetTarget(g, avgActual, avgTarget) ? 'met' : 'missed';
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
      const dayEntries = [dayIdx.get(dateStr), nightIdx.get(dateStr), singleIdx.get(dateStr)].filter(
        (e): e is DailyEntry => e !== undefined
      );
      if (dayEntries.length === 0) {
        result.push({ day, status: 'nodata' });
        continue;
      }
      const avgActual = mean(dayEntries.map((e) => e.actual))!;
      const avgTarget = mean(dayEntries.map((e) => e.target))!;
      result.push({ day, status: groupMetTarget(selectedGroup, avgActual, avgTarget) ? 'met' : 'missed' });
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
        const dayEntry = dayIdx.get(dateStr) ?? singleIdx.get(dateStr);
        const nightEntry = nightIdx.get(dateStr);
        const dayVal = dayEntry?.actual ?? null;
        const nightVal = nightEntry?.actual ?? null;
        const vals = [dayVal, nightVal].filter((v): v is number => v !== null);
        const avgVal = mean(vals);
        // Point target: averaged from whichever entries exist for this date
        // (so a day-varying target like Moves' daily Projection is honored),
        // falling back to the live catalog target when no entry exists yet.
        const pointTargets = [dayEntry?.target, nightEntry?.target].filter(
          (t): t is number => t !== undefined
        );
        const pointTarget = pointTargets.length > 0 ? mean(pointTargets)! : selectedGroup.target;
        points.push({
          label: format(d, 'EEE d'),
          date: dateStr,
          dayActual: dayVal,
          nightActual: nightVal,
          avgActual: avgVal,
          target: pointTarget,
          dayMet: dayVal === null ? null : groupMetTarget(selectedGroup, dayVal, dayEntry?.target),
          nightMet: nightVal === null ? null : groupMetTarget(selectedGroup, nightVal, nightEntry?.target),
          avgMet: avgVal === null ? null : groupMetTarget(selectedGroup, avgVal, pointTarget),
        });
      }
      return points;
    }

    // Weekly: last 8 ISO weeks (Mon-Sun), simple average of all logged days per week.
    const currentIsoWeekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
    const fallbackByWeek = new Map(weeklyFallback.map((w) => [`${w.iso_year}-${w.iso_week}`, w]));
    const points: RunPoint[] = [];
    for (let w = 7; w >= 0; w--) {
      const weekStart = subWeeks(currentIsoWeekStart, w);
      const dayVals: number[] = [];
      const nightVals: number[] = [];
      const targetVals: number[] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(weekStart, d);
        if (date > referenceDate) break;
        const dateStr = format(date, 'yyyy-MM-dd');
        const dEntry = dayIdx.get(dateStr) ?? singleIdx.get(dateStr);
        const nEntry = nightIdx.get(dateStr);
        if (dEntry !== undefined) {
          dayVals.push(dEntry.actual);
          targetVals.push(dEntry.target);
        }
        if (nEntry !== undefined) {
          nightVals.push(nEntry.actual);
          targetVals.push(nEntry.target);
        }
      }
      let dayAvg = mean(dayVals);
      let nightAvg = mean(nightVals);
      // Week target: averaged from every entry's own snapshotted target
      // (so a day-varying target like Moves' daily Projection is honored),
      // falling back to the live catalog target when no entry exists yet.
      let weekTarget = targetVals.length > 0 ? mean(targetVals)! : selectedGroup.target;
      // No daily entries logged at all for this ISO week — fall back to the
      // uploaded Weekly figure if one exists. That figure is already blended
      // (the source sheet has no Day/Night split), so with only Day/Night
      // lines left on this chart it's plotted on both — the best available
      // stand-in for a number the upload never split out. Its own snapshotted
      // target also replaces the live catalog value for the same reason.
      if (dayAvg === null && nightAvg === null) {
        const fb = fallbackByWeek.get(`${getISOWeekYear(weekStart)}-${getISOWeek(weekStart)}`);
        if (fb) {
          dayAvg = fb.actual;
          nightAvg = fb.actual;
          weekTarget = fb.target;
        }
      }
      const both = [dayAvg, nightAvg].filter((v): v is number => v !== null);
      const avgVal = mean(both);
      points.push({
        label: `Wk ${getISOWeek(weekStart)}`,
        date: format(weekStart, 'yyyy-MM-dd'),
        dayActual: dayAvg,
        nightActual: nightAvg,
        avgActual: avgVal,
        target: weekTarget,
        dayMet: dayAvg === null ? null : groupMetTarget(selectedGroup, dayAvg, weekTarget),
        nightMet: nightAvg === null ? null : groupMetTarget(selectedGroup, nightAvg, weekTarget),
        avgMet: avgVal === null ? null : groupMetTarget(selectedGroup, avgVal, weekTarget),
      });
    }
    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowEntries, weeklyFallback, selectedGroup?.key, granularity]);

  // ---- Pareto: missed-target reasons within the Pareto-specific window ---
  const paretoData: ParetoDatum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of paretoEntries) {
      if (e.met_target) continue;
      const label = e.reason_other?.trim() || (e.reason_id ? reasonLabelById.get(e.reason_id) : undefined) || 'Unspecified';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [paretoEntries, reasonLabelById]);

  // ---- Remarks/Summary block: highlight + deep-link into Enter Remarks for
  // any shift that missed target and still has no remark logged. Passed
  // (or no data at all) shifts render as plain, non-interactive text.
  function renderRemarksBlock(label: string, entry: DailyEntry | undefined) {
    const text = entry?.remarks?.trim() || 'No remarks logged for this date.';
    const needsRemark = Boolean(entry) && entry!.met_target === false && !entry!.remarks?.trim();
    if (!needsRemark) {
      return (
        <div className="remarks-block" key={label}>
          <span className="remarks-block-label">{label}</span>
          <p className="remarks-text">{text}</p>
        </div>
      );
    }
    // Only logged-in employees can be deep-linked into Enter Remarks — the
    // board itself stays viewable without login on a shared screen.
    const clickable = Boolean(employee) && Boolean(selectedGroup);
    return (
      <button
        type="button"
        key={label}
        className="remarks-block remarks-block-missing"
        disabled={!clickable}
        onClick={() =>
          clickable &&
          navigate('/entry', {
            state: { pillarId: pillar.id, label: selectedGroup!.label, date: referenceDateStr },
          })
        }
      >
        <span className="remarks-block-label">{label}</span>
        <p className="remarks-text">
          {text}
          {clickable && <span className="remarks-cta"> — click to add remark →</span>}
        </p>
      </button>
    );
  }

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
                Target {selectedGroup.target} {selectedGroup.unit}
              </span>
            </div>
            <div className="headline-values">
              {selectedGroup.single ? (
                <div className={`headline-value ${referenceSingleEntry ? (groupMetTarget(selectedGroup, referenceSingleEntry.actual, referenceSingleEntry.target) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                  {referenceSingleEntry ? referenceSingleEntry.actual : '—'}
                  <span className="headline-unit">{selectedGroup.unit}</span>
                </div>
              ) : (
                <>
                  <div className="headline-shift">
                    <span className="headline-shift-label">Day</span>
                    <span className={`headline-value ${referenceDayEntry ? (groupMetTarget(selectedGroup, referenceDayEntry.actual, referenceDayEntry.target) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                      {referenceDayEntry ? referenceDayEntry.actual : '—'}
                      <span className="headline-unit">{selectedGroup.unit}</span>
                    </span>
                  </div>
                  <div className="headline-shift">
                    <span className="headline-shift-label">Night</span>
                    <span className={`headline-value ${referenceNightEntry ? (groupMetTarget(selectedGroup, referenceNightEntry.actual, referenceNightEntry.target) ? 'value-good' : 'value-bad') : 'value-nodata'}`}>
                      {referenceNightEntry ? referenceNightEntry.actual : '—'}
                      <span className="headline-unit">{selectedGroup.unit}</span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

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

          {granularity === 'daily' && (
            <div className="quadrant-section">
              <div className="quadrant-block-title">Remarks / Summary</div>
              <div className="remarks-summary">
                {selectedGroup.single
                  ? renderRemarksBlock(format(referenceDate, 'EEE d MMM'), referenceSingleEntry)
                  : (
                    <>
                      {renderRemarksBlock('Day', referenceDayEntry)}
                      {renderRemarksBlock('Night', referenceNightEntry)}
                    </>
                  )}
              </div>
            </div>
          )}

          {(granularity === 'weekly' || showParetoActions) && (
            <>
              <div className="quadrant-section">
                <div className="quadrant-block-title">
                  Pareto of reasons — {granularity === 'weekly' ? 'last 2 weeks' : 'last 7 days'}
                </div>
                <ParetoChart data={paretoData} barColor={colors.base} />
              </div>

              <div className="quadrant-section quadrant-section-fill">
                <div className="quadrant-block-title">Actions</div>
                <ActionTable actions={actions} compact />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
