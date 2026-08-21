import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth, getDaysInMonth } from 'date-fns';
import { fetchActions, fetchEntriesForKpi, fetchReasonsForKpi } from '../lib/data';
import { PILLAR_COLORS, metTarget, type ActionItem, type DailyEntry, type Kpi, type Pillar, type Reason } from '../types';
import KpiRunChart from './KpiRunChart';
import ParetoChart, { type ParetoDatum } from './ParetoChart';
import ActionTable from './ActionTable';
import PillarLetterGrid, { type DayStatus } from './PillarLetterGrid';

interface Props {
  pillar: Pillar;
  kpis: Kpi[];
}

export default function PillarQuadrant({ pillar, kpis }: Props) {
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

  // Entries for the currently selected KPI, fetched from the 1st of the
  // current calendar month — drives the run chart, Pareto, AND the S/Q/D/C
  // letter mosaic, so switching KPI tabs updates all three together.
  useEffect(() => {
    if (!selectedKpi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const since = format(startOfMonth(new Date()), 'yyyy-MM-dd');
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
  }, [selectedKpi, pillar.id]);

  const today = new Date();
  const todayDay = today.getDate();

  const dayStatuses: DayStatus[] = useMemo(() => {
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
      <PillarLetterGrid letter={pillar.code} days={dayStatuses} todayDay={todayDay} height={116} />
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

          <div className="quadrant-block-title">KPI — this month</div>
          {loading ? <div className="empty-state">Loading…</div> : <KpiRunChart kpi={selectedKpi} entries={entries} color={colors.base} />}

          <div className="quadrant-block-title">Pareto of reasons — this month</div>
          <ParetoChart data={paretoData} color={colors.base} />

          <div className="quadrant-block-title">Actions</div>
          <ActionTable actions={actions} compact />
        </>
      )}
    </section>
  );
}
