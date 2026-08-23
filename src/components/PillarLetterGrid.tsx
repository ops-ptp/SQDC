import { PERFORMANCE_COLORS, type PerformanceStatus } from '../types';

export type DayStatus = {
  day: number; // day of month, 1-based
  status: PerformanceStatus;
};

interface Props {
  letter: string;
  /** One entry per day that actually exists this month (28-31 entries, index 0 = day 1). */
  days: DayStatus[];
  todayDay: number;
  height?: number;
}

interface Cell {
  row: number;
  col: number;
}

// Fixed, hand-authored cell layouts matching the reference board template
// exactly (traced and verified cell-by-cell, including cross-checking that
// each consecutive day number sits in a spatially connected cell). Index 0 =
// day 1's cell ... index 30 = day 31's cell. Always exactly 31 cells, on a
// 6-column x 12-row grid — the layout itself never changes; shorter months
// just blacken the trailing cells (see render below).
const GRID_COLS = 6;
const GRID_ROWS = 12;

const LETTER_LAYOUTS: Record<string, Cell[]> = {
  S: [
    { row: 2, col: 5 },
    { row: 1, col: 5 },
    { row: 1, col: 4 },
    { row: 0, col: 4 },
    { row: 0, col: 3 },
    { row: 0, col: 2 },
    { row: 0, col: 1 },
    { row: 1, col: 1 },
    { row: 1, col: 0 },
    { row: 2, col: 0 },
    { row: 3, col: 0 },
    { row: 4, col: 0 },
    { row: 5, col: 0 },
    { row: 5, col: 1 },
    { row: 5, col: 2 },
    { row: 5, col: 3 },
    { row: 6, col: 2 },
    { row: 6, col: 3 },
    { row: 6, col: 4 },
    { row: 6, col: 5 },
    { row: 7, col: 5 },
    { row: 8, col: 5 },
    { row: 9, col: 5 },
    { row: 10, col: 5 },
    { row: 10, col: 4 },
    { row: 11, col: 4 },
    { row: 11, col: 3 },
    { row: 11, col: 2 },
    { row: 11, col: 1 },
    { row: 10, col: 1 },
    { row: 10, col: 0 },
  ],
  Q: [
    { row: 0, col: 1 },
    { row: 0, col: 2 },
    { row: 0, col: 3 },
    { row: 0, col: 4 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
    { row: 2, col: 5 },
    { row: 3, col: 5 },
    { row: 4, col: 5 },
    { row: 5, col: 5 },
    { row: 6, col: 5 },
    { row: 7, col: 5 },
    { row: 8, col: 5 },
    { row: 9, col: 5 },
    { row: 11, col: 5 },
    { row: 10, col: 4 },
    { row: 11, col: 3 },
    { row: 11, col: 2 },
    { row: 11, col: 1 },
    { row: 10, col: 1 },
    { row: 10, col: 0 },
    { row: 9, col: 0 },
    { row: 8, col: 0 },
    { row: 7, col: 0 },
    { row: 6, col: 0 },
    { row: 5, col: 0 },
    { row: 4, col: 0 },
    { row: 3, col: 0 },
    { row: 2, col: 0 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ],
  D: [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 2 },
    { row: 0, col: 3 },
    { row: 0, col: 4 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
    { row: 2, col: 5 },
    { row: 3, col: 5 },
    { row: 4, col: 5 },
    { row: 5, col: 5 },
    { row: 6, col: 5 },
    { row: 7, col: 5 },
    { row: 8, col: 5 },
    { row: 9, col: 5 },
    { row: 10, col: 5 },
    { row: 11, col: 4 },
    { row: 11, col: 3 },
    { row: 11, col: 2 },
    { row: 11, col: 1 },
    { row: 11, col: 0 },
    { row: 10, col: 0 },
    { row: 9, col: 0 },
    { row: 8, col: 0 },
    { row: 7, col: 0 },
    { row: 6, col: 0 },
    { row: 5, col: 0 },
    { row: 4, col: 0 },
    { row: 3, col: 0 },
    { row: 2, col: 0 },
    { row: 1, col: 0 },
  ],
  C: [
    { row: 3, col: 5 },
    { row: 2, col: 5 },
    { row: 1, col: 5 },
    { row: 1, col: 4 },
    { row: 0, col: 4 },
    { row: 0, col: 3 },
    { row: 1, col: 3 },
    { row: 1, col: 2 },
    { row: 0, col: 2 },
    { row: 0, col: 1 },
    { row: 1, col: 1 },
    { row: 1, col: 0 },
    { row: 2, col: 0 },
    { row: 3, col: 0 },
    { row: 4, col: 0 },
    { row: 5, col: 0 },
    { row: 6, col: 0 },
    { row: 7, col: 0 },
    { row: 8, col: 0 },
    { row: 9, col: 0 },
    { row: 10, col: 0 },
    { row: 10, col: 1 },
    { row: 11, col: 1 },
    { row: 11, col: 2 },
    { row: 10, col: 2 },
    { row: 10, col: 3 },
    { row: 11, col: 3 },
    { row: 11, col: 4 },
    { row: 10, col: 4 },
    { row: 10, col: 5 },
    { row: 9, col: 5 },
  ],
};

const STATUS_LABEL: Record<PerformanceStatus, string> = {
  met: 'target met',
  missed: 'target missed',
  future: "hasn't happened yet",
  nodata: 'no data logged',
};

export default function PillarLetterGrid({ letter, days, todayDay, height = 208 }: Props) {
  const cells = LETTER_LAYOUTS[letter] ?? [];

  if (cells.length === 0) {
    return (
      <div className="letter-grid-empty" style={{ height }}>
        {letter}
      </div>
    );
  }

  const widthPx = (height / GRID_ROWS) * GRID_COLS;
  const cellPx = height / GRID_ROWS;
  const fontSize = Math.min(0.34, Math.max(0.2, 11 / cellPx));

  return (
    <svg
      width={widthPx}
      height={height}
      viewBox={`0 0 ${GRID_COLS} ${GRID_ROWS}`}
      className="letter-grid-svg"
      role="img"
      aria-label={`${letter} — daily performance for this month`}
    >
      {cells.map((c, i) => {
        // Cells beyond the real number of days this month (e.g. cell #29 in
        // February) have no matching day — shown blackened, no number.
        const dayInfo: DayStatus | undefined = i < days.length ? days[i] : undefined;
        const isPastMonthEnd = i >= days.length;
        const isToday = dayInfo?.day === todayDay;
        const fill = isPastMonthEnd ? '#1e293b' : dayInfo ? PERFORMANCE_COLORS[dayInfo.status] : PERFORMANCE_COLORS.future;
        const textColor = dayInfo && (dayInfo.status === 'met' || dayInfo.status === 'missed') ? '#ffffff' : '#475569';
        return (
          <g key={`${c.row}-${c.col}`}>
            <rect
              x={c.col + 0.05}
              y={c.row + 0.05}
              width={0.9}
              height={0.9}
              rx={0.14}
              fill={fill}
              stroke={isToday ? '#1d4ed8' : 'rgba(0,0,0,0.35)'}
              strokeWidth={isToday ? 0.14 : 0.045}
            >
              <title>
                {isPastMonthEnd
                  ? 'No such date this month'
                  : dayInfo
                    ? `Day ${dayInfo.day}${isToday ? ' (today)' : ''} — ${STATUS_LABEL[dayInfo.status]}`
                    : undefined}
              </title>
            </rect>
            {dayInfo && (
              <text
                x={c.col + 0.5}
                y={c.row + 0.53}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fontSize}
                fontWeight={700}
                fill={textColor}
                pointerEvents="none"
              >
                {String(dayInfo.day).padStart(2, '0')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
