import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { fetchLatestLeadingEntries, fetchLeadingKpis } from '../lib/data';
import { PILLAR_COLORS, round2, type KpiWithPillar, type LeadingEntry } from '../types';

const TODAY = new Date();

/** '%' KPIs get a % sign; everything else is a plain thousands-separated
 * number with its unit suffixed. Both are capped at 2 decimal places. */
function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${round2(value)}%`;
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
}

export default function ForwardLooking() {
  const [kpis, setKpis] = useState<KpiWithPillar[]>([]);
  const [entries, setEntries] = useState<LeadingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayStr = format(TODAY, 'yyyy-MM-dd');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLeadingKpis()
      .then((k) => {
        if (cancelled) return [];
        setKpis(k);
        return fetchLatestLeadingEntries(
          k.map((x) => x.id),
          todayStr
        );
      })
      .then((e) => !cancelled && setEntries(e))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load Next 24 Hours board'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entryByKpi = useMemo(() => new Map(entries.map((e) => [e.kpi_id, e])), [entries]);

  // Group the leading KPI catalog by pillar, in catalog sort order.
  const groups = useMemo(() => {
    const byPillar = new Map<string, { pillar: KpiWithPillar['pillar']; kpis: KpiWithPillar[] }>();
    for (const k of kpis) {
      const key = k.pillar.code;
      if (!byPillar.has(key)) byPillar.set(key, { pillar: k.pillar, kpis: [] });
      byPillar.get(key)!.kpis.push(k);
    }
    return Array.from(byPillar.values());
  }, [kpis]);

  if (loading) return <div className="page-loading">Loading Next 24 Hours board…</div>;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="page fl-page">
      <div className="page-header">
        <h1>Next 24 Hours</h1>
        <p className="muted">
          Leading indicators for the day ahead.
        </p>
      </div>

      {kpis.length === 0 ? (
        <div className="empty-state">
          No leading KPIs are configured yet. Mark a KPI as leading (<code>kpis.is_leading = true</code>) to show it
          here.
        </div>
      ) : (
        <div className="fl-board">
          {groups.map((g) => {
            const colors = PILLAR_COLORS[g.pillar.code] ?? PILLAR_COLORS.S;
            return (
              <div key={g.pillar.code} className="fl-column">
                <div className="fl-column-header">
                  <span className="fl-column-title">{g.pillar.name}</span>
                </div>
                <div className="fl-column-body">
                  {g.kpis.map((k) => {
                    const entry = entryByKpi.get(k.id);
                    return (
                      <div key={k.id} className="fl-card" style={{ borderLeftColor: colors.base }}>
                        <div className="fl-card-kpi">{k.name}</div>
                        {entry ? (
                          <>
                            <div className="fl-card-value">
                              {formatValue(entry.value, k.unit)}
                              {k.unit && k.unit !== '%' && <span className="fl-card-unit">{k.unit}</span>}
                            </div>
                            <div className="fl-card-asof">
                              As of {entry.entry_date === todayStr ? 'today' : format(parseISO(entry.entry_date), 'EEE, d MMM')}
                            </div>
                          </>
                        ) : (
                          <div className="fl-card-nodata">No data uploaded yet</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
