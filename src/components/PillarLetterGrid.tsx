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

// Fixed, hand-authored cell layouts, transcribed exactly from the user's
// spreadsheet reference grid (8 columns x 9 rows, 1-indexed there; row 1 and
// column 1 are intentionally always empty — the letters start at row/col 2
// in that reference, which is row/col index 1 here). Index 0 = day 1's cell
// ... index 30 = day 31's cell, in a continuous path around the letter's
// outline. Always exactly 31 cells; the layout itself never changes, shorter
// months just blacken the trailing cells (see render below). Verified by
// rendering this exact data to PNG and visually confirming all 4 letters
// match the reference exactly, including the 28-day blackening.
// Layouts are defined on an 8-column x 9-row grid (matching the reference
// spreadsheet's 1-indexed cols 1-8 / rows 1-9), though the actual bounding
// box used per letter is cropped dynamically at render time (see below).

const LETTER_LAYOUTS: Record<string, Cell[]> = {
  S: [
    { row: 1, col: 7 },
    { row: 2, col: 7 },
    { row: 2, col: 6 },
    { row: 1, col: 6 },
    { row: 1, col: 5 },
    { row: 1, col: 4 },
    { row: 1, col: 3 },
    { row: 1, col: 2 },
    { row: 1, col: 1 },
    { row: 2, col: 1 },
    { row: 3, col: 1 },
    { row: 4, col: 1 },
    { row: 4, col: 2 },
    { row: 4, col: 3 },
    { row: 4, col: 4 },
    { row: 4, col: 5 },
    { row: 5, col: 5 },
    { row: 5, col: 4 },
    { row: 5, col: 6 },
    { row: 5, col: 7 },
    { row: 6, col: 7 },
    { row: 7, col: 7 },
    { row: 8, col: 7 },
    { row: 8, col: 6 },
    { row: 8, col: 5 },
    { row: 8, col: 4 },
    { row: 8, col: 3 },
    { row: 8, col: 2 },
    { row: 8, col: 1 },
    { row: 7, col: 1 },
    { row: 7, col: 2 },
  ],
  Q: [
    { row: 1, col: 1 },
    { row: 2, col: 1 },
    { row: 3, col: 1 },
    { row: 4, col: 1 },
    { row: 5, col: 1 },
    { row: 6, col: 1 },
    { row: 7, col: 1 },
    { row: 8, col: 1 },
    { row: 8, col: 2 },
    { row: 8, col: 3 },
    { row: 8, col: 4 },
    { row: 8, col: 5 },
    { row: 7, col: 5 },
    { row: 7, col: 6 },
    { row: 6, col: 6 },
    { row: 6, col: 7 },
    { row: 5, col: 7 },
    { row: 4, col: 7 },
    { row: 3, col: 7 },
    { row: 2, col: 7 },
    { row: 1, col: 7 },
    { row: 1, col: 6 },
    { row: 1, col: 5 },
    { row: 1, col: 4 },
    { row: 1, col: 3 },
    { row: 1, col: 2 },
    { row: 2, col: 2 },
    { row: 3, col: 2 },
    { row: 7, col: 2 },
    { row: 8, col: 7 },
    { row: 2, col: 6 },
  ],
  D: [
    { row: 7, col: 7 },
    { row: 6, col: 7 },
    { row: 5, col: 7 },
    { row: 4, col: 7 },
    { row: 3, col: 7 },
    { row: 3, col: 6 },
    { row: 4, col: 6 },
    { row: 5, col: 6 },
    { row: 6, col: 6 },
    { row: 7, col: 6 },
    { row: 8, col: 6 },
    { row: 8, col: 5 },
    { row: 8, col: 4 },
    { row: 8, col: 3 },
    { row: 8, col: 2 },
    { row: 8, col: 1 },
    { row: 7, col: 1 },
    { row: 6, col: 1 },
    { row: 5, col: 1 },
    { row: 4, col: 1 },
    { row: 3, col: 1 },
    { row: 2, col: 1 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
    { row: 1, col: 6 },
    { row: 2, col: 6 },
    { row: 2, col: 5 },
    { row: 7, col: 5 },
  ],
  C: [
    { row: 1, col: 1 },
    { row: 2, col: 1 },
    { row: 3, col: 1 },
    { row: 4, col: 1 },
    { row: 5, col: 1 },
    { row: 6, col: 1 },
    { row: 7, col: 1 },
    { row: 7, col: 2 },
    { row: 6, col: 2 },
    { row: 5, col: 2 },
    { row: 4, col: 2 },
    { row: 3, col: 2 },
    { row: 2, col: 2 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
    { row: 1, col: 6 },
    { row: 1, col: 7 },
    { row: 2, col: 7 },
    { row: 3, col: 7 },
    { row: 2, col: 6 },
    { row: 6, col: 7 },
    { row: 7, col: 7 },
    { row: 8, col: 7 },
    { row: 8, col: 6 },
    { row: 8, col: 5 },
    { row: 8, col: 4 },
    { row: 8, col: 3 },
    { row: 8, col: 2 },
    { row: 7, col: 6 },
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

  // Crop the SVG's viewBox to the actual bounding box of used cells, rather
  // than the full fixed grid — the layouts intentionally leave row 0 / col 0
  // empty (matching the reference template), which otherwise leaves a blank
  // margin baked into the rendered box and throws off centering.
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const minCol = Math.min(...cells.map((c) => c.col));
  const maxCol = Math.max(...cells.map((c) => c.col));
  const boxRows = maxRow - minRow + 1;
  const boxCols = maxCol - minCol + 1;

  const widthPx = (height / boxRows) * boxCols;
  const cellPx = height / boxRows;
  const fontSize = Math.min(0.34, Math.max(0.2, 11 / cellPx));

  return (
    <svg
      width={widthPx}
      height={height}
      viewBox={`${minCol} ${minRow} ${boxCols} ${boxRows}`}
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
