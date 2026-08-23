import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Label,
  LabelList,
  Line,
  ReferenceLine,
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
}

const BAR_COLOR = '#64748b';
const LINE_COLOR = '#1e293b';

export default function ParetoChart({ data }: Props) {
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
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={chartData} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={58}
        />
        {/* Count scale drives the bar heights but stays hidden — the count is
            labeled directly on each bar instead, which reads better in a
            narrow card than a cramped left axis. */}
        <YAxis yAxisId="left" hide allowDecimals={false} domain={[0, (max: number) => Math.ceil(max * 1.25)]} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
          width={30}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          formatter={(value, name) => [name === 'Cumulative %' ? `${value}%` : value, String(name)]}
        />
        <ReferenceLine yAxisId="right" y={80} stroke="#94a3b8" strokeDasharray="4 4">
          <Label value="80%" position="insideTopLeft" fontSize={10} fill="#64748b" />
        </ReferenceLine>
        <Bar yAxisId="left" dataKey="count" fill={BAR_COLOR} radius={[3, 3, 0, 0]} name="Occurrences" maxBarSize={48}>
          <LabelList dataKey="count" position="top" fontSize={11} fontWeight={700} fill="#334155" />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulativePct"
          stroke={LINE_COLOR}
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Cumulative %"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
