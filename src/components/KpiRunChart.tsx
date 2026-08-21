import { format, parseISO } from 'date-fns';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyEntry, Kpi } from '../types';

interface Props {
  kpi: Kpi;
  entries: DailyEntry[];
  color: string;
}

export default function KpiRunChart({ kpi, entries, color }: Props) {
  const data = entries.map((e) => ({
    date: e.entry_date,
    day: format(parseISO(e.entry_date), 'd'),
    actual: e.actual,
    target: e.target,
    met: e.met_target,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={40} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelFormatter={(_, payload) => (payload?.[0]?.payload?.date ? payload[0].payload.date : '')}
            formatter={(value, name) => [`${value} ${kpi.unit}`, name === 'actual' ? 'Actual' : 'Target']}
          />
          <ReferenceLine y={kpi.target} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10, fill: '#64748b', position: 'insideTopLeft' }} />
          <Line type="monotone" dataKey="actual" stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          <Scatter
            dataKey="actual"
            isAnimationActive={false}
            shape={(props: unknown) => {
              const p = props as { cx: number; cy: number; payload: { met: boolean } };
              return (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={4}
                  fill={p.payload.met ? '#16a34a' : '#dc2626'}
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
