import { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PERFORMANCE_COLORS, round2 } from '../types';

export interface RunPoint {
  label: string;
  date: string;
  dayActual: number | null;
  nightActual: number | null;
  avgActual: number | null;
  target: number;
  /** Pass/fail vs. target for each series at this point — drives dot color.
   * null when there's no value logged for that series on this point. */
  dayMet: boolean | null;
  nightMet: boolean | null;
  avgMet: boolean | null;
  /** Old-calculation Day/Night figures (Mainliner Load GMPH only) — plotted
   * as dimmed, thinner reference lines alongside the primary (new
   * calculation) ones. No pass/fail semantics of their own. */
  oldDayActual?: number | null;
  oldNightActual?: number | null;
}

interface Props {
  points: RunPoint[];
  unit: string;
  /** false for KPIs with no Day/Night split — only the single "Actual" line is shown. */
  showDayNight: boolean;
  /** true only for Mainliner Load GMPH — adds two dimmed, thinner Day/Night
   * lines for the old calculation alongside the normal-weight new ones, so
   * the two methods' figures can be visually compared on one chart. */
  showOldCalc?: boolean;
}

// Day is dark orange, Night is dark blue — per spec, not the softer defaults
// recharts would otherwise pick. Old-calculation lines reuse the same hues
// at reduced opacity so they read as "the same series, superseded" rather
// than an unrelated third color.
const DAY_COLOR = '#c2410c';
const NIGHT_COLOR = '#1e3a8a';
const AVG_COLOR = '#1e293b';
const DAY_COLOR_DIM = 'rgba(194, 65, 12, 0.4)';
const NIGHT_COLOR_DIM = 'rgba(30, 58, 138, 0.4)';

const formatYTick = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Custom dot: filled red/green by that point's pass/fail status instead of
 * a flat series color, so a glance at the run shows which days missed. */
function makeStatusDot(metKey: 'dayMet' | 'nightMet' | 'avgMet', stroke: string) {
  return function StatusDot(props: { cx?: number; cy?: number; payload?: RunPoint }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const met = payload[metKey];
    if (met === null) return null;
    const fill = met ? PERFORMANCE_COLORS.met : PERFORMANCE_COLORS.missed;
    return <circle cx={cx} cy={cy} r={3.25} fill={fill} stroke={stroke} strokeWidth={1} />;
  };
}

/** "Nice" padded domain so a run that only moves within a narrow band still
 * shows visible shape, instead of defaulting to a 0-anchored axis that
 * flattens everything into a near-straight line. */
function useYDomain(points: RunPoint[]): [number, number] {
  return useMemo(() => {
    const values: number[] = [];
    for (const p of points) {
      if (p.dayActual !== null) values.push(p.dayActual);
      if (p.nightActual !== null) values.push(p.nightActual);
      if (p.avgActual !== null) values.push(p.avgActual);
      if (p.oldDayActual != null) values.push(p.oldDayActual);
      if (p.oldNightActual != null) values.push(p.oldNightActual);
      values.push(p.target);
    }
    if (values.length === 0) return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const pad = Math.abs(min) * 0.1 || 1;
      return [min - pad, max + pad];
    }
    const span = max - min;
    const pad = span * 0.15;
    return [min - pad, max + pad];
  }, [points]);
}

export default function KpiRunChart({ points, unit, showDayNight, showOldCalc = false }: Props) {
  const [yMin, yMax] = useYDomain(points);
  const hasData = points.some((p) => p.dayActual !== null || p.nightActual !== null || p.avgActual !== null);

  // Most KPIs have a fixed target, so a flat ReferenceLine is correct and
  // reads more cleanly than a dashed series. A few (e.g. Moves, whose target
  // is the day's uploaded Projection figure) have a target that varies by
  // date — for those, plot it as its own dashed line so it steps/slopes
  // along with the real daily number instead of averaging it away.
  const targetVaries = points.length > 1 && points.some((p) => p.target !== points[0].target);

  if (!hasData) {
    return <div className="empty-state" style={{ height: 180 }}>No data logged for this period yet.</div>;
  }

  return (
    <div className="chart-wrap" style={{ height: 190 }}>
      <ResponsiveContainer width="100%" height="100%" debounce={1}>
        <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            width={44}
            tickFormatter={formatYTick}
            allowDataOverflow
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value, name) => [`${typeof value === 'number' ? round2(value) : value} ${unit}`, String(name)]}
          />
          <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 11 }} iconSize={10} />
          {targetVaries ? (
            <Line
              type="monotone"
              dataKey="target"
              name="Target"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : (
            <ReferenceLine y={points[0]?.target ?? 0} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10, fill: '#64748b', position: 'insideTopLeft' }} />
          )}
          {showDayNight && (
            <Line
              type="monotone"
              dataKey="dayActual"
              name="Day"
              stroke={DAY_COLOR}
              strokeWidth={2}
              dot={makeStatusDot('dayMet', DAY_COLOR)}
              activeDot={{ r: 4.5 }}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {showDayNight && (
            <Line
              type="monotone"
              dataKey="nightActual"
              name="Night"
              stroke={NIGHT_COLOR}
              strokeWidth={2}
              dot={makeStatusDot('nightMet', NIGHT_COLOR)}
              activeDot={{ r: 4.5 }}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {!showDayNight && (
            <Line
              type="monotone"
              dataKey="avgActual"
              name="Actual"
              stroke={AVG_COLOR}
              strokeWidth={2.25}
              dot={makeStatusDot('avgMet', AVG_COLOR)}
              activeDot={{ r: 4.5 }}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {showOldCalc && (
            <Line
              type="monotone"
              dataKey="oldDayActual"
              name="Day (old calc)"
              stroke={DAY_COLOR_DIM}
              strokeWidth={1}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {showOldCalc && (
            <Line
              type="monotone"
              dataKey="oldNightActual"
              name="Night (old calc)"
              stroke={NIGHT_COLOR_DIM}
              strokeWidth={1}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
