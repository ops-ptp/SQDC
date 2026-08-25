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

// Fixed, hand-authored cell layouts, transcribed from the user's
// "SQDC Letter Grid & Sequence" reference diagram — a 7-column x 8-row grid
// per letter (row 1 = topmost, col 1 = leftmost). Transcription was done
// programmatically (green/white pixel sampling per cell, cross-checked
// against zoomed crops of every row of every letter) rather than eyeballed,
// since two of the four letters intentionally number out of simple
// row-major order (see notes below) and are easy to misread by eye.
// Index 0 = day 1's cell ... index 30 = day 31's cell. Always exactly 31
// cells; the layout itself never changes, shorter months just blacken the
// trailing cells (see render below).
//
// Two non-obvious bits, confirmed (not transcription slips):
//   - D: row 2 reads 09 / 08 / 07 left-to-right (descending) — the diagram
//     traces down the right side 2 cells before jumping to the left stroke.
//   - C: the bottom hook is numbered 19-20-**31** (row 6), then
//     21-22-**29**-**30** (row 7), then 23-28 (row 8) — the diagram traces
//     the hook's tip before backfilling the bottom bar.

const LETTER_LAYOUTS: Record<string, Cell[]> = {
  S: [
    { row: 1, col: 1 }, // 01
    { row: 1, col: 2 }, // 02
    { row: 1, col: 3 }, // 03
    { row: 1, col: 4 }, // 04
    { row: 1, col: 5 }, // 05
    { row: 1, col: 6 }, // 06
    { row: 1, col: 7 }, // 07
    { row: 2, col: 1 }, // 08
    { row: 2, col: 6 }, // 09
    { row: 2, col: 7 }, // 10
    { row: 3, col: 1 }, // 11
    { row: 4, col: 1 }, // 12
    { row: 4, col: 2 }, // 13
    { row: 4, col: 3 }, // 14
    { row: 4, col: 4 }, // 15
    { row: 4, col: 5 }, // 16
    { row: 5, col: 4 }, // 17
    { row: 5, col: 5 }, // 18
    { row: 5, col: 6 }, // 19
    { row: 5, col: 7 }, // 20
    { row: 6, col: 7 }, // 21
    { row: 7, col: 7 }, // 22
    { row: 8, col: 7 }, // 23
    { row: 8, col: 6 }, // 24
    { row: 8, col: 5 }, // 25
    { row: 8, col: 4 }, // 26
    { row: 8, col: 3 }, // 27
    { row: 8, col: 2 }, // 28
    { row: 8, col: 1 }, // 29
    { row: 7, col: 1 }, // 30
    { row: 7, col: 2 }, // 31
  ],
  Q: [
    { row: 1, col: 1 }, // 01
    { row: 1, col: 2 }, // 02
    { row: 1, col: 3 }, // 03
    { row: 1, col: 4 }, // 04
    { row: 1, col: 5 }, // 05
    { row: 1, col: 6 }, // 06
    { row: 1, col: 7 }, // 07
    { row: 2, col: 1 }, // 08
    { row: 2, col: 2 }, // 09
    { row: 2, col: 6 }, // 10
    { row: 2, col: 7 }, // 11
    { row: 3, col: 1 }, // 12
    { row: 3, col: 2 }, // 13
    { row: 3, col: 7 }, // 14
    { row: 4, col: 1 }, // 15
    { row: 4, col: 7 }, // 16
    { row: 5, col: 1 }, // 17
    { row: 5, col: 7 }, // 18
    { row: 6, col: 1 }, // 19
    { row: 6, col: 6 }, // 20
    { row: 6, col: 7 }, // 21
    { row: 7, col: 1 }, // 22
    { row: 7, col: 2 }, // 23
    { row: 7, col: 5 }, // 24
    { row: 7, col: 6 }, // 25
    { row: 8, col: 1 }, // 26
    { row: 8, col: 2 }, // 27
    { row: 8, col: 3 }, // 28
    { row: 8, col: 4 }, // 29
    { row: 8, col: 5 }, // 30
    { row: 8, col: 7 }, // 31
  ],
  D: [
    { row: 1, col: 1 }, // 01
    { row: 1, col: 2 }, // 02
    { row: 1, col: 3 }, // 03
    { row: 1, col: 4 }, // 04
    { row: 1, col: 5 }, // 05
    { row: 1, col: 6 }, // 06
    { row: 2, col: 6 }, // 07
    { row: 2, col: 5 }, // 08
    { row: 2, col: 1 }, // 09
    { row: 3, col: 1 }, // 10
    { row: 3, col: 6 }, // 11
    { row: 3, col: 7 }, // 12
    { row: 4, col: 1 }, // 13
    { row: 4, col: 6 }, // 14
    { row: 4, col: 7 }, // 15
    { row: 5, col: 1 }, // 16
    { row: 5, col: 6 }, // 17
    { row: 5, col: 7 }, // 18
    { row: 6, col: 1 }, // 19
    { row: 6, col: 6 }, // 20
    { row: 6, col: 7 }, // 21
    { row: 7, col: 1 }, // 22
    { row: 7, col: 5 }, // 23
    { row: 7, col: 6 }, // 24
    { row: 7, col: 7 }, // 25
    { row: 8, col: 1 }, // 26
    { row: 8, col: 2 }, // 27
    { row: 8, col: 3 }, // 28
    { row: 8, col: 4 }, // 29
    { row: 8, col: 5 }, // 30
    { row: 8, col: 6 }, // 31
  ],
  C: [
    { row: 1, col: 1 }, // 01
    { row: 1, col: 2 }, // 02
    { row: 1, col: 3 }, // 03
    { row: 1, col: 4 }, // 04
    { row: 1, col: 5 }, // 05
    { row: 1, col: 6 }, // 06
    { row: 1, col: 7 }, // 07
    { row: 2, col: 1 }, // 08
    { row: 2, col: 2 }, // 09
    { row: 2, col: 6 }, // 10
    { row: 2, col: 7 }, // 11
    { row: 3, col: 1 }, // 12
    { row: 3, col: 2 }, // 13
    { row: 3, col: 7 }, // 14
    { row: 4, col: 1 }, // 15
    { row: 4, col: 2 }, // 16
    { row: 5, col: 1 }, // 17
    { row: 5, col: 2 }, // 18
    { row: 6, col: 1 }, // 19
    { row: 6, col: 2 }, // 20
    { row: 7, col: 1 }, // 21
    { row: 7, col: 2 }, // 22
    { row: 8, col: 2 }, // 23
    { row: 8, col: 3 }, // 24
    { row: 8, col: 4 }, // 25
    { row: 8, col: 5 }, // 26
    { row: 8, col: 6 }, // 27
    { row: 8, col: 7 }, // 28
    { row: 7, col: 5 }, // 29
    { row: 7, col: 6 }, // 30
    { row: 6, col: 7 }, // 31
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
                    ? `Day ${dayInfo.day}${isToday ? ' (most recent)' : ''} — ${STATUS_LABEL[dayInfo.status]}`
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
