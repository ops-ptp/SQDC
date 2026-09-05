import { useEffect, useMemo, useState } from 'react';
import { endOfMonth, format, subDays, subMonths } from 'date-fns';
import { fetchKpis, fetchPillars } from '../lib/data';
import type { Kpi, Pillar } from '../types';
import { errorMessage } from '../types';
import PillarQuadrant, { type Granularity } from '../components/PillarQuadrant';

const MONTH_OPTIONS_COUNT = 12;

export default function Dashboard() {
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('daily');
  // Single toggle hiding/showing Pareto + Actions across all 4 pillars at
  // once — Daily view only; Weekly view always shows both regardless.
  const [showParetoActions, setShowParetoActions] = useState(true);
  // 0 = current month (the live board), 1 = last month, etc. Kept as an
  // offset rather than a Date so "today" is always recomputed fresh rather
  // than captured once at mount.
  const [monthOffset, setMonthOffset] = useState(0);
  // A specific day picked by clicking a letter-grid cell, overriding the
  // month's own default reviewed day (yesterday for the current month, the
  // last day for a past one). Cleared whenever the month picker changes, so
  // switching months always starts from that month's own default day.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([fetchPillars(), fetchKpis()])
      .then(([p, k]) => {
        setPillars(p);
        setKpis(k);
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load board')))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const isCurrentMonth = monthOffset === 0;
  // Live board reviews yesterday, same as always. A past month has no
  // "yesterday" to speak of — review it as of its own last day instead.
  const defaultReferenceDate = isCurrentMonth ? subDays(today, 1) : endOfMonth(subMonths(today, monthOffset));
  const referenceDate = selectedDay !== null ? new Date(defaultReferenceDate.getFullYear(), defaultReferenceDate.getMonth(), selectedDay) : defaultReferenceDate;

  const monthOptions = useMemo(
    () =>
      Array.from({ length: MONTH_OPTIONS_COUNT }, (_, i) => {
        const d = subMonths(today, i);
        return { offset: i, label: i === 0 ? 'This month' : format(d, 'MMMM yyyy') };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleMonthChange(offset: number) {
    setMonthOffset(offset);
    setSelectedDay(null);
  }

  // Clicking any pillar's letter grid pivots the WHOLE board — every
  // quadrant's headline, target, trend window, remarks, Pareto, and Actions
  // — to review that exact date, not just that one cell's own pillar/KPI.
  function handleDayClick(day: number) {
    setSelectedDay(day);
  }

  // Weekly view doesn't make sense for a past month's one-time review — lock
  // to Daily and grey out the toggle whenever a non-current month is picked.
  useEffect(() => {
    if (!isCurrentMonth) setGranularity('daily');
  }, [isCurrentMonth]);

  if (loading) return <div className="page-loading">Loading board…</div>;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="board-page">
      <div className="board-page-header">
        <div>
          <h1>SQDC Board</h1>
          <span className="muted">{format(today, 'EEEE, d MMMM yyyy')}</span>
          <span className="board-reviewing-badge">Reviewing {format(referenceDate, 'EEEE, d MMMM yyyy')}</span>
          {selectedDay !== null && (
            <button type="button" className="board-reviewing-reset" onClick={() => setSelectedDay(null)}>
              × back to {isCurrentMonth ? 'yesterday' : 'month end'}
            </button>
          )}
        </div>
        <div className="board-page-controls">
          <select
            className="board-month-select"
            value={monthOffset}
            onChange={(e) => handleMonthChange(Number(e.target.value))}
            aria-label="Select month to review"
          >
            {monthOptions.map((m) => (
              <option key={m.offset} value={m.offset}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="segmented" title={isCurrentMonth ? undefined : 'Only available for the current month'}>
            <button
              className={`segmented-btn ${granularity === 'daily' ? 'segmented-btn-active' : ''}`}
              disabled={!isCurrentMonth}
              onClick={() => setGranularity('daily')}
            >
              Daily
            </button>
            <button
              className={`segmented-btn ${granularity === 'weekly' ? 'segmented-btn-active' : ''}`}
              disabled={!isCurrentMonth}
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
            referenceDate={referenceDate}
            latestAvailableDate={defaultReferenceDate}
            onDayClick={handleDayClick}
          />
        ))}
      </div>
    </div>
  );
}
