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
  /** Bar color — pass the pillar's brand color (e.g. colors.base) so the
   * chart reads as belonging to that pillar. Falls back to neutral grey. */
  barColor?: string;
}

const DEFAULT_BAR_COLOR = '#64748b';
const LINE_COLOR = '#1e293b';
const MAX_LABEL_CHARS = 15;

function truncateLabel(text: string, max = MAX_LABEL_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base}…`;
}

// Custom tick: rotated labels can be long ("CHE allocation / scheduling gap")
// and, rotated -25°, spill past the card's left edge and get clipped by the
// card's overflow:hidden. Truncating here (word-aware) keeps every label
// inside the plot area; hovering shows the full text via a native <title>.
//
// IMPORTANT: passed to XAxis as a bare function reference (`tick={AngledTick}`),
// NOT as a pre-built element (`tick={<AngledTick .../>}`). Recharts extracts
// SVG-attribute-looking props (x, y, ...) straight off an already-built
// element and uses them to override its own computed per-tick coordinates —
// so a pre-built element with placeholder x/y pins every tick to that same
// spot. A function reference has no such props to extract from.
function AngledTick({ x, y, payload }: { x: number | string; y: number | string; payload: { value: string } }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="end" transform="rotate(-30)" fontSize={10} fill="var(--muted)">
        {truncateLabel(payload.value)}
        <title>{payload.value}</title>
      </text>
    </g>
  );
}

export default function ParetoChart({ data, barColor = DEFAULT_BAR_COLOR }: Props) {
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
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={chartData} margin={{ top: 18, right: 4, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
          <XAxis dataKey="label" interval={0} height={62} tick={AngledTick} />
          {/* Count scale drives the bar heights but stays hidden — the count is
              labeled directly on each bar instead, which reads better in a
              narrow card than a cramped left axis. */}
          <YAxis yAxisId="left" hide width={0} allowDecimals={false} domain={[0, (max: number) => Math.ceil(max * 1.25)]} />
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
            <Label value="80%" position="insideTopLeft" offset={6} fontSize={10} fill="#64748b" />
          </ReferenceLine>
          <Bar yAxisId="left" dataKey="count" fill={barColor} radius={[3, 3, 0, 0]} name="Occurrences" maxBarSize={48}>
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
    </div>
  );
}
