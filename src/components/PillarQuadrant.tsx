import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, getDaysInMonth, startOfWeek, subWeeks, addDays, parseISO } from 'date-fns';
import { fetchActions, fetchEntriesForKpi, fetchReasonsForKpi } from '../lib/data';
import { PILLAR_COLORS, metTarget, type ActionItem, type DailyEntry, type Kpi, type Pillar, type Reason } from '../types';
import KpiRunChart from './KpiRunChart';
import ParetoChart, { type ParetoDatum } from './ParetoChart';
import ActionTable from './ActionTable';
import PillarLetterGrid, { type DayStatus } from './PillarLetterGrid';

export type Granularity = 'daily' | 'weekly';

interface Props {
  pillar: Pillar;
  kpis: Kpi[];
  granularity?: Granularity;
}

// How many trailing weeks the "Weekly" view covers (~6 months).
const WEEKLY_WEEKS = 26;

export default function PillarQuadrant({ pillar, kpis, granularity = 'daily' }: Props) {
  const colors = PILLAR_COLORS[pillar.code];
  const [selectedKpiId, setSelectedKpiId] = useState<string>(kpis[0]?.id ?? '');
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);

  const selectedKpi = kpis.find((k) => k.id === selectedKpiId) ?? kpis[0];

  useEffect(() => {
    if (kpis.length > 0 && !kpis.some((k) => k.id === selectedKpiId)) {
      setSelectedKpiId(kpis[0].id);
    }
  }, [kpis, selectedKpiId]);

  // Entries for the currently selected KPI — drives the run chart, Pareto,
  // AND the S/Q/D/C letter mosaic, so switching KPI tabs updates all three
  // together. Range depends on granularity: this calendar month for Daily,
  // trailing ~6 months (bucketed by week) for Weekly.
  useEffect(() => {
    if (!selectedKpi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const since =
      granularity === 'weekly'
        ? format(startOfWeek(subWeeks(new Date(), WEEKLY_WEEKS - 1), { weekStartsOn: 1 }), 'yyyy-MM-dd')
        : format(startOfMonth(new Date()), 'yyyy-MM-dd');
    Promise.all([
      fetchEntriesForKpi(selectedKpi.id, since),
      fetchActions({ pillarId: pillar.id }),
      fetchReasonsForKpi(selectedKpi.id),
    ])
      .then(([e, a, r]) => {
        if (cancelled) return;
        setEntries(e);
        setActions(a);
        setReasons(r);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedKpi, pillar.id, granularity]);

  const today = new Date();
  const todayDay = today.getDate();

  const dailyStatuses: DayStatus[] = useMemo(() => {
    const byDate = new Map(entries.map((e) => [e.entry_date, e.met_target]));
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = getDaysInMonth(today);
    const result: DayStatus[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      if (day > todayDay) {
        result.push({ day, status: 'future' });
        continue;
      }
      const dateStr = format(new Date(year, month, day), 'yyyy-MM-dd');
      const met = byDate.get(dateStr);
      result.push({ day, status: met === undefined ? 'nodata' : met ? 'met' : 'missed' });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Weekly buckets: one status per ISO week (Mon–Sun), oldest → most recent,
  // "met" when the majority of that week's logged entries hit target.
  const weeklyBuckets = useMemo(() => {
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekStarts: Date[] = [];
    for (let i = WEEKLY_WEEKS - 1; i >= 0; i--) {
      weekStarts.push(subWeeks(currentWeekStart, i));
    }
    const byWeek = new Map<string, { met: number; total: number }>();
    for (const e of entries) {
      const key = format(startOfWeek(parseISO(e.entry_date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const bucket = byWeek.get(key) ?? { met: 0, total: 0 };
      bucket.total += 1;
      if (e.met_target) bucket.met += 1;
      byWeek.set(key, bucket);
    }
    return weekStarts.map((ws, i) => {
      const key = format(ws, 'yyyy-MM-dd');
      const bucket = byWeek.get(key);
      const status: DayStatus['status'] = !bucket || bucket.total === 0 ? 'nodata' : bucket.met / bucket.total >= 0.5 ? 'met' : 'missed';
      return { weekStart: ws, weekLabel: format(ws, 'd MMM'), day: i + 1, status };
    });
  }, [entries]);

  const dayStatuses: DayStatus[] = granularity === 'weekly' ? weeklyBuckets.map(({ day, status }) => ({ day, status })) : dailyStatuses;
  const gridTodayDay = granularity === 'weekly' ? WEEKLY_WEEKS : todayDay;

  // For the weekly run chart: one aggregated point per week (average actual
  // / average target), oldest → most recent.
  const weeklyEntries: DailyEntry[] = useMemo(() => {
    if (granularity !== 'weekly') return [];
    const byWeek = new Map<string, DailyEntry[]>();
    for (const e of entries) {
      const key = format(startOfWeek(parseISO(e.entry_date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const arr = byWeek.get(key) ?? [];
      arr.push(e);
      byWeek.set(key, arr);
    }
    return weeklyBuckets
      .filter((b) => byWeek.has(format(b.weekStart, 'yyyy-MM-dd')))
      .map((b) => {
        const weekEntries = byWeek.get(format(b.weekStart, 'yyyy-MM-dd'))!;
        const avg = (nums: number[]) => nums.reduce((s, n) => s + n, 0) / nums.length;
        const actual = Math.round(avg(weekEntries.map((e) => e.actual)) * 100) / 100;
        const target = Math.round(avg(weekEntries.map((e) => e.target)) * 100) / 100;
        const metCount = weekEntries.filter((e) => e.met_target).length;
        return {
          id: b.weekLabel,
          kpi_id: selectedKpi?.id ?? '',
          entry_date: format(addDays(b.weekStart, 3), 'yyyy-MM-dd'), // mid-week, for a centered x position
          target,
          actual,
          met_target: metCount / weekEntries.length >= 0.5,
          reason_id: null,
          reason_other: null,
          entered_by: null,
          created_at: '',
          updated_at: '',
        } satisfies DailyEntry;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, weeklyBuckets, granularity, selectedKpi?.id]);

  const chartEntries = granularity === 'weekly' ? weeklyEntries : entries;

  const latest = entries.length > 0 ? entries[entries.length - 1] : null;

  const reasonLabelById = useMemo(() => new Map(reasons.map((r) => [r.id, r.label])), [reasons]);

  const paretoData: ParetoDatum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.met_target) continue;
      const label = e.reason_other?.trim() || (e.reason_id ? reasonLabelById.get(e.reason_id) : undefined) || 'Unspecified';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [entries, reasonLabelById]);

  const hero = (
    <div className="quadrant-hero" style={{ background: colors.soft }}>
      <PillarLetterGrid
        letter={pillar.code}
        days={dayStatuses}
        todayDay={gridTodayDay}
        height={208}
        periodLabel={granularity === 'weekly' ? 'Week' : 'Day'}
      />
      <span className="quadrant-hero-name" style={{ color: colors.text }}>
        {pillar.name}
      </span>
      {selectedKpi && kpis.length > 1 && <span className="quadrant-hero-kpi">{selectedKpi.name}</span>}
    </div>
  );

  if (kpis.length === 0) {
    return (
      <section className="quadrant" style={{ borderTopColor: colors.base }}>
        {hero}
        <div className="empty-state">No KPIs configured for this pillar yet.</div>
      </section>
    );
  }

  return (
    <section className="quadrant" style={{ borderTopColor: colors.base }}>
      {hero}

      {kpis.length > 1 && (
        <div className="kpi-tabs">
          {kpis.map((k) => (
            <button
              key={k.id}
              className={`kpi-tab ${k.id === selectedKpiId ? 'kpi-tab-active' : ''}`}
              style={k.id === selectedKpiId ? { borderColor: colors.base, color: colors.text } : undefined}
              onClick={() => setSelectedKpiId(k.id)}
            >
              {k.name}
            </button>
          ))}
        </div>
      )}

      {selectedKpi && (
        <>
          <div className="kpi-headline">
            <div>
              <h3>{selectedKpi.name}</h3>
              <span className="muted">
                Target {selectedKpi.target} {selectedKpi.unit} · {selectedKpi.is_higher_better ? 'higher is good' : 'lower is good'}
              </span>
            </div>
            {latest && (
              <div className={`headline-value ${metTarget(selectedKpi, latest.target, latest.actual) ? 'value-good' : 'value-bad'}`}>
                {latest.actual}
                <span className="headline-unit">{selectedKpi.unit}</span>
              </div>
            )}
          </div>

          <div className="quadrant-block-title">KPI — {granularity === 'weekly' ? 'by week, last 6 months' : 'this month'}</div>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : (
            <KpiRunChart kpi={selectedKpi} entries={chartEntries} color={colors.base} granularity={granularity} />
          )}

          <div className="quadrant-block-title">
            Pareto of reasons — {granularity === 'weekly' ? 'last 6 months' : 'this month'}
          </div>
          <ParetoChart data={paretoData} color={colors.base} />

          <div className="quadrant-block-title">Actions</div>
          <ActionTable actions={actions} compact />
        </>
      )}
    </section>
  );
}
