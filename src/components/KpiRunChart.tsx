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

export interface RunPoint {
  label: string;
  date: string;
  dayActual: number | null;
  nightActual: number | null;
  avgActual: number | null;
  target: number;
}

interface Props {
  points: RunPoint[];
  unit: string;
  /** false for KPIs with no Day/Night split — only the average line is shown. */
  showDayNight: boolean;
}

const DAY_COLOR = '#0ea5e9';
const NIGHT_COLOR = '#7c3aed';
const AVG_COLOR = '#0f172a';

export default function KpiRunChart({ points, unit, showDayNight }: Props) {
  const target = points[0]?.target ?? 0;
  const hasData = points.some((p) => p.dayActual !== null || p.nightActual !== null || p.avgActual !== null);

  if (!hasData) {
    return <div className="empty-state" style={{ height: 180 }}>No data logged for this period yet.</div>;
  }

  return (
    <div style={{ width: '100%', height: 190 }}>
      <ResponsiveContainer width="100%" height="100%" debounce={1}>
        <ComposedChart data={points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={40} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value, name) => [`${value} ${unit}`, String(name)]}
          />
          <Legend verticalAlign="top" align="right" height={24} wrapperStyle={{ fontSize: 11 }} iconSize={10} />
          <ReferenceLine y={target} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10, fill: '#64748b', position: 'insideTopLeft' }} />
          {showDayNight && (
            <Line type="monotone" dataKey="dayActual" name="Day" stroke={DAY_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          )}
          {showDayNight && (
            <Line type="monotone" dataKey="nightActual" name="Night" stroke={NIGHT_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          )}
          <Line type="monotone" dataKey="avgActual" name={showDayNight ? 'Average' : 'Actual'} stroke={AVG_COLOR} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
