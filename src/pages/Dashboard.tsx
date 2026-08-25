import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { fetchKpis, fetchPillars } from '../lib/data';
import type { Kpi, Pillar } from '../types';
import PillarQuadrant, { type Granularity } from '../components/PillarQuadrant';

export default function Dashboard() {
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('daily');
  // Single toggle hiding/showing Pareto + Actions across all 4 pillars at
  // once — Daily view only; Weekly view always shows both regardless.
  const [showParetoActions, setShowParetoActions] = useState(true);

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
        <div>
          <h1>SQDC Board</h1>
          <span className="muted">{format(new Date(), 'EEEE, d MMMM yyyy')}</span>
          <span className="board-reviewing-badge">Reviewing {format(subDays(new Date(), 1), 'EEEE, d MMMM')}</span>
        </div>
        <div className="board-page-controls">
          <div className="segmented">
            <button
              className={`segmented-btn ${granularity === 'daily' ? 'segmented-btn-active' : ''}`}
              onClick={() => setGranularity('daily')}
            >
              Daily
            </button>
            <button
              className={`segmented-btn ${granularity === 'weekly' ? 'segmented-btn-active' : ''}`}
              onClick={() => setGranularity('weekly')}
            >
              Weekly
            </button>
          </div>
          {granularity === 'daily' && (
            <button
              type="button"
              className="btn btn-ghost-light"
              onClick={() => setShowParetoActions((s) => !s)}
              aria-expanded={showParetoActions}
            >
              {showParetoActions ? 'Hide Pareto & Actions ▲' : 'Show Pareto & Actions ▼'}
            </button>
          )}
        </div>
      </div>
      <div className={`board-grid ${granularity === 'weekly' ? 'board-grid-weekly' : ''}`}>
        {pillars.map((p) => (
          <PillarQuadrant
            key={p.id}
            pillar={p}
            kpis={kpis.filter((k) => k.pillar_id === p.id)}
            granularity={granularity}
            showParetoActions={showParetoActions}
          />
        ))}
      </div>
    </div>
  );
}
