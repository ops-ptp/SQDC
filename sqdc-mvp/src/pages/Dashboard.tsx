import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fetchKpis, fetchPillars } from '../lib/data';
import type { Kpi, Pillar } from '../types';
import PillarQuadrant from '../components/PillarQuadrant';

export default function Dashboard() {
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPillars(), fetchKpis()])
      .then(([p, k]) => {
        setPillars(p);
        setKpis(k);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load board'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading board…</div>;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="board-page">
      <div className="board-page-header">
        <h1>SQDC Board</h1>
        <span className="muted">{format(new Date(), 'EEEE, d MMMM yyyy')}</span>
      </div>
      <div className="board-grid">
        {pillars.map((p) => (
          <PillarQuadrant key={p.id} pillar={p} kpis={kpis.filter((k) => k.pillar_id === p.id)} />
        ))}
      </div>
    </div>
  );
}
