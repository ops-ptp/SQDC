import { useEffect, useMemo, useState } from 'react';
import { endOfMonth, format, parseISO, subDays, subMonths } from 'date-fns';
import { Link } from 'react-router-dom';
import { fetchAllKpisAdmin, fetchPillars, saveKpiOrder } from '../lib/data';
import { useDepartment, useDeptPath } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import type { Kpi, Pillar } from '../types';
import { baseNameOf, errorMessage } from '../types';
import { orderedBaseNames, renumberKpis } from '../lib/kpiOrder';
import { useTodayString } from '../lib/useToday';
import ArrangeBar from '../components/ArrangeBar';
import PillarQuadrant, { type Granularity } from '../components/PillarQuadrant';
import { paretoPeriod as computeParetoPeriod, type ParetoSpan } from '../lib/categoryCore';
import { SegmentedControl } from '@progress/kendo-react-buttons';
import { chevronDownIcon, chevronLeftIcon, chevronRightIcon, chevronUpIcon, dragAndDropIcon, xIcon } from '@progress/kendo-svg-icons';
import { Button, PageLoader, Select } from '../components/ui';

const MONTH_OPTIONS_COUNT = 12;

export default function Dashboard() {
  const department = useDepartment();
  const deptPath = useDeptPath();
  const { isDeptAdmin } = useEmployee();
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chosenGranularity, setGranularity] = useState<Granularity>('daily');
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
  // Weekly view's Pareto period: one ISO week or a two-week pair (default,
  // matching the team's "Week 36 & 37" sheets). Offset counts periods back
  // from the one containing the reviewed day; null = the default, which is
  // the latest COMPLETED period (a review looks back at a finished week).
  const [paretoSpan, setParetoSpan] = useState<ParetoSpan>(2);
  const [paretoOffset, setParetoOffset] = useState<number | null>(null);
  // Arrange mode (department admins): each pillar's KPI base names in the
  // order being arranged; null when not arranging.
  const [arrange, setArrange] = useState<Record<string, string[]> | null>(null);
  const [arrangeDirty, setArrangeDirty] = useState(false);
  const [arrangeSaving, setArrangeSaving] = useState(false);
  const [arrangeError, setArrangeError] = useState<string | null>(null);

  useEffect(() => {
    // Fetches every lagging KPI, active AND hidden — the Board itself
    // filters by active for the Daily view's pills, but the Weekly view
    // deliberately ignores that flag entirely (see PillarQuadrant's groups
    // computation): "Visible" in KPI Management is a Daily-board concept
    // only, since the Weekly view's KPI set is fixed by what the Weekly
    // workbook actually tracks, not by an admin's show/hide choice.
    Promise.all([fetchPillars(), fetchAllKpisAdmin(department.id)])
      .then(([p, k]) => {
        setPillars(p);
        setKpis(k.filter((kpi) => !kpi.is_leading));
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load board')))
      .finally(() => setLoading(false));
  }, [department.id]);

  // Re-renders just after midnight (and when the tab is shown again), so a
  // board left open on a screen overnight moves on to review the new
  // "yesterday" instead of staying on the old day.
  const todayStr = useTodayString();
  const today = useMemo(() => parseISO(todayStr), [todayStr]);
  const isCurrentMonth = monthOffset === 0;
  // Weekly view doesn't make sense for a past month's one-time review — a
  // past month is always shown Daily (the toggle is greyed out).
  const granularity: Granularity = isCurrentMonth ? chosenGranularity : 'daily';
  // Live board reviews yesterday, same as always. A past month has no
  // "yesterday" to speak of — review it as of its own last day instead.
  const defaultReferenceDate = isCurrentMonth ? subDays(today, 1) : endOfMonth(subMonths(today, monthOffset));
  const referenceDate = selectedDay !== null ? new Date(defaultReferenceDate.getFullYear(), defaultReferenceDate.getMonth(), selectedDay) : defaultReferenceDate;

  const referenceYmd = format(referenceDate, 'yyyy-MM-dd');
  const currentParetoPeriod = computeParetoPeriod(referenceDate, paretoSpan, 0);
  const defaultParetoOffset = currentParetoPeriod.to > referenceYmd ? 1 : 0;
  const effectiveParetoOffset = paretoOffset ?? defaultParetoOffset;
  const paretoPeriod = computeParetoPeriod(referenceDate, paretoSpan, effectiveParetoOffset);
  const paretoInProgress = paretoPeriod.to > referenceYmd;

  const monthOptions = useMemo(
    () =>
      Array.from({ length: MONTH_OPTIONS_COUNT }, (_, i) => {
        const d = subMonths(today, i);
        return { offset: i, label: i === 0 ? 'This month' : format(d, 'MMMM yyyy') };
      }),
    [today]
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


  // One stable array per pillar, so a quadrant doesn't refetch everything
  // whenever the page re-renders (e.g. toggling Pareto & Actions).
  const kpisByPillar = useMemo(() => new Map(pillars.map((p) => [p.id, kpis.filter((k) => k.pillar_id === p.id)])), [pillars, kpis]);
  const canArrange = isDeptAdmin(department.id) && kpis.some((k) => k.active);

  function startArrange() {
    setGranularity('daily');
    setArrange(Object.fromEntries(pillars.map((p) => [p.id, orderedBaseNames((kpisByPillar.get(p.id) ?? []).filter((k) => k.active))])));
    setArrangeDirty(false);
    setArrangeError(null);
  }

  async function saveArrange() {
    if (!arrange) return;
    setArrangeSaving(true);
    setArrangeError(null);
    try {
      const updates = pillars.flatMap((p) => {
        const pillarKpis = kpisByPillar.get(p.id) ?? [];
        const units = (arrange[p.id] ?? []).map((base) => pillarKpis.filter((k) => k.active && baseNameOf(k.name) === base));
        return renumberKpis(units, pillarKpis);
      });
      await saveKpiOrder(updates);
      const byId = new Map(updates.map((u) => [u.id, u.sort_order]));
      setKpis((prev) => prev.map((k) => (byId.has(k.id) ? { ...k, sort_order: byId.get(k.id)! } : k)));
      setArrange(null);
    } catch (e) {
      setArrangeError(errorMessage(e, 'Could not save the new order'));
    } finally {
      setArrangeSaving(false);
    }
  }

  if (loading) return <PageLoader label="Loading board…" />;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="board-page">
      <div className="board-page-header">
        <div>
          <h1>SQDC Board</h1>
          <span className="muted">{format(today, 'EEEE, d MMMM yyyy')}</span>
          <span className="board-reviewing-badge">Reviewing {format(referenceDate, 'EEEE, d MMMM yyyy')}</span>
          {selectedDay !== null && (
            <Button size="small" fillMode="flat" svgIcon={xIcon} className="board-reviewing-reset" onClick={() => setSelectedDay(null)}>
              Back to {isCurrentMonth ? 'yesterday' : 'month end'}
            </Button>
          )}
        </div>
        <div className="board-page-controls">
          <Select
            className="board-month-select"
            value={String(monthOffset)}
            onChange={(v) => handleMonthChange(Number(v))}
            options={monthOptions.map((m) => ({ value: String(m.offset), label: m.label }))}
            ariaLabel="Select month to review"
          />
          <SegmentedControl
            size="medium"
            value={granularity}
            onChange={(v) => setGranularity(v as Granularity)}
            title={isCurrentMonth ? undefined : 'Weekly is only available for the current month'}
            items={[
              { value: 'daily', text: 'Daily' },
              { value: 'weekly', text: 'Weekly', disabled: !isCurrentMonth },
            ]}
          />
          {granularity === 'weekly' && (
            <>
              <SegmentedControl
                size="medium"
                aria-label="Pareto period length"
                value={String(paretoSpan)}
                onChange={(v) => {
                  setParetoSpan(Number(v) as ParetoSpan);
                  setParetoOffset(null);
                }}
                items={[
                  { value: '1', text: '1 week' },
                  { value: '2', text: '2 weeks' },
                ]}
              />
              <div className="board-period">
                <Button
                  fillMode="flat"
                  svgIcon={chevronLeftIcon}
                  aria-label="Previous period"
                  title="Previous period"
                  onClick={() => setParetoOffset(effectiveParetoOffset + 1)}
                />
                <span className="board-period-label">
                  {paretoPeriod.label}
                  {paretoInProgress && <span className="muted"> (in progress)</span>}
                </span>
                <Button
                  fillMode="flat"
                  svgIcon={chevronRightIcon}
                  aria-label="Next period"
                  title="Next period"
                  disabled={effectiveParetoOffset === 0}
                  onClick={() => setParetoOffset(Math.max(0, effectiveParetoOffset - 1))}
                />
              </div>
            </>
          )}
          {canArrange && !arrange && (
            <Button fillMode="outline" svgIcon={dragAndDropIcon} onClick={startArrange} title="Change the order of each pillar's KPIs">
              Arrange KPIs
            </Button>
          )}
          {granularity === 'daily' && (
            <Button
              fillMode="outline"
              svgIcon={showParetoActions ? chevronUpIcon : chevronDownIcon}
              onClick={() => setShowParetoActions((s) => !s)}
              aria-expanded={showParetoActions}
            >
              {showParetoActions ? 'Hide Pareto & Actions' : 'Show Pareto & Actions'}
            </Button>
          )}
        </div>
      </div>
      {kpis.length === 0 && (
        <div className="alert alert-info board-setup-hint">
          {department.name} has no KPIs yet.{' '}
          {isDeptAdmin(department.id) ? (
            <>
              <Link to={deptPath('admin')}>Set up its KPIs in Admin → KPIs</Link> — the board fills in as data comes in.
            </>
          ) : (
            'A department admin sets them up under Admin → KPIs.'
          )}
        </div>
      )}
      {arrange && (
        <ArrangeBar
          hint="Drag the KPIs within each pillar (or focus one and use the arrow keys). The new order shows everywhere — Board, Enter Remarks, Admin and the upload template."
          dirty={arrangeDirty}
          saving={arrangeSaving}
          error={arrangeError}
          onCancel={() => setArrange(null)}
          onSave={saveArrange}
        />
      )}
      <div className={`board-grid ${granularity === 'weekly' ? 'board-grid-weekly' : ''}${arrange ? ' is-arranging' : ''}`}>
        {pillars.map((p) => (
          <PillarQuadrant
            key={p.id}
            pillar={p}
            kpis={kpisByPillar.get(p.id) ?? []}
            arrangeKeys={arrange?.[p.id]}
            onArrange={(keys) => {
              setArrange((a) => (a ? { ...a, [p.id]: keys } : a));
              setArrangeDirty(true);
            }}
            granularity={granularity}
            showParetoActions={showParetoActions}
            referenceDate={referenceDate}
            latestAvailableDate={defaultReferenceDate}
            onDayClick={handleDayClick}
            paretoPeriod={paretoPeriod}
          />
        ))}
      </div>
    </div>
  );
}
