import { useEffect, useMemo, useState } from 'react';
import { subDays, format } from 'date-fns';
import { fetchActions, fetchEntriesForKpi, fetchReasonsForKpi } from '../lib/data';
import { PILLAR_COLORS, metTarget, type ActionItem, type DailyEntry, type Kpi, type Pillar, type Reason } from '../types';
import KpiRunChart from './KpiRunChart';
import ParetoChart, { type ParetoDatum } from './ParetoChart';
import ActionTable from './ActionTable';

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

  useEffect(() => {
    if (!selectedKpi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const since = format(subDays(new Date(), 30), 'yyyy-MM-dd');
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

  if (kpis.length === 0) {
    return (
      <section className="quadrant" style={{ borderTopColor: colors.base }}>
        <header className="quadrant-header" style={{ background: colors.base }}>
          {pillar.name}
        </header>
        <div className="empty-state">No KPIs configured for this pillar yet.</div>
      </section>
    );
  }

  return (
    <section className="quadrant" style={{ borderTopColor: colors.base }}>
      <header className="quadrant-header" style={{ background: colors.base }}>
        {pillar.name}
      </header>

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

          <div className="quadrant-block-title">KPI — last 30 days</div>
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

