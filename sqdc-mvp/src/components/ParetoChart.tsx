import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ParetoDatum {
  label: string;
  count: number;
}

interface Props {
  data: ParetoDatum[];
  color: string;
}

export default function ParetoChart({ data, color }: Props) {
  const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, 6);
  const total = sorted.reduce((sum, d) => sum + d.count, 0);
  const { rows: chartData } = sorted.reduce<{ running: number; rows: Array<ParetoDatum & { cumulativePct: number }> }>(
    (acc, d) => {
      const running = acc.running + d.count;
      acc.rows.push({ ...d, cumulativePct: total > 0 ? Math.round((running / total) * 100) : 0 });
      return { running, rows: acc.rows };
    },
    { running: 0, rows: [] }
  );

  if (chartData.length === 0) {
    return (
      <div className="empty-state" style={{ height: 160 }}>
        No missed-target reasons logged yet this period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={190}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 20, left: -20, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={50}
        />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={30} allowDecimals={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: 'var(--muted)' }}
          width={34}
          domain={[0, 100]}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar yAxisId="left" dataKey="count" fill={color} radius={[3, 3, 0, 0]} name="Occurrences" />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulativePct"
          stroke="#334155"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Cumulative %"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
