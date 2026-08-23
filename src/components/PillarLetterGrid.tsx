import { useEffect, useState } from 'react';
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

const SAMPLE_W = 220;
const SAMPLE_H = 260;
const MAX_GROW_ATTEMPTS = 10;
// The letter's cell layout is always sampled at this fixed size (the longest
// possible month) so the shape never changes month to month. Shorter months
// (28-30 days) just blacken the trailing cells that have no real date, rather
// than re-sampling a differently-shaped/differently-sized letter.
const GRID_CELL_COUNT = 31;

interface Cell {
  row: number;
  col: number;
}

function sampleGlyph(letter: string, cols: number, rows: number): Cell[] {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
  ctx.fillStyle = '#000';
  ctx.font = `900 ${SAMPLE_H * 0.92}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, SAMPLE_W / 2, SAMPLE_H / 2 + SAMPLE_H * 0.03);

  const imgData = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  const cellW = SAMPLE_W / cols;
  const cellH = SAMPLE_H / rows;
  const filled: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.min(SAMPLE_W - 1, Math.floor((col + 0.5) * cellW));
      const y = Math.min(SAMPLE_H - 1, Math.floor((row + 0.5) * cellH));
      const alpha = imgData[(y * SAMPLE_W + x) * 4 + 3];
      if (alpha > 100) filled.push({ row, col });
    }
  }
  return filled;
}

/** Trim a filled-cell set down to exactly `target` cells, removing the most
 * "interior" cells first (most filled neighbours) so what's left reads as an
 * outline/silhouette of the letter rather than losing recognisable shape. */
function trimToCount(cells: Cell[], target: number): Cell[] {
  if (cells.length <= target) return cells;
  const key = (c: Cell) => `${c.row}-${c.col}`;
  const set = new Set(cells.map(key));
  const centroid = cells.reduce(
    (acc, c) => ({ row: acc.row + c.row / cells.length, col: acc.col + c.col / cells.length }),
    { row: 0, col: 0 }
  );
  const scored = cells.map((c) => {
    const neighbors = [
      [c.row - 1, c.col],
      [c.row + 1, c.col],
      [c.row, c.col - 1],
      [c.row, c.col + 1],
    ].filter(([r, cc]) => set.has(`${r}-${cc}`)).length;
    const dist = Math.hypot(c.row - centroid.row, c.col - centroid.col);
    return { c, neighbors, dist };
  });
  // Remove the most "buried" cells first: most filled neighbours, then closest to centroid.
  scored.sort((a, b) => b.neighbors - a.neighbors || a.dist - b.dist);
  const toRemove = new Set(scored.slice(0, cells.length - target).map((s) => key(s.c)));
  return cells.filter((c) => !toRemove.has(key(c)));
}

/** Grow a filled-cell set up to exactly `target` cells by adding cells
 * adjacent to the existing shape (rare fallback if sampling came up short). */
function growToCount(cells: Cell[], target: number, cols: number, rows: number): Cell[] {
  const key = (c: Cell) => `${c.row}-${c.col}`;
  const set = new Set(cells.map(key));
  const result = [...cells];
  let frontier = [...cells];
  while (result.length < target && frontier.length > 0) {
    const next: Cell[] = [];
    for (const c of frontier) {
      const candidates: Cell[] = [
        { row: c.row - 1, col: c.col },
        { row: c.row + 1, col: c.col },
        { row: c.row, col: c.col - 1 },
        { row: c.row, col: c.col + 1 },
      ];
      for (const cand of candidates) {
        if (cand.row < 0 || cand.row >= rows || cand.col < 0 || cand.col >= cols) continue;
        const k = key(cand);
        if (set.has(k)) continue;
        set.add(k);
        result.push(cand);
        next.push(cand);
        if (result.length >= target) break;
      }
      if (result.length >= target) break;
    }
    frontier = next;
  }
  return result;
}

const STATUS_LABEL: Record<PerformanceStatus, string> = {
  met: 'target met',
  missed: 'target missed',
  future: "hasn't happened yet",
  nodata: 'no data logged',
};

export default function PillarLetterGrid({ letter, days, todayDay, height = 208 }: Props) {
  const [cells, setCells] = useState<Cell[]>([]);
  const [dims, setDims] = useState({ cols: 7, rows: 8 });

  // Sampled once per letter, always at the fixed 31-cell target — NOT
  // re-sampled per month, so the shape/layout is identical every month.
  useEffect(() => {
    let cols = 6;
    let rows = 7;
    let filled = sampleGlyph(letter, cols, rows);
    for (let attempt = 1; attempt < MAX_GROW_ATTEMPTS && filled.length < GRID_CELL_COUNT; attempt++) {
      cols += 1;
      rows += 1;
      filled = sampleGlyph(letter, cols, rows);
    }
    const exact =
      filled.length >= GRID_CELL_COUNT
        ? trimToCount(filled, GRID_CELL_COUNT)
        : growToCount(filled, GRID_CELL_COUNT, cols, rows);
    // Reading order: top-to-bottom, left-to-right, so day 1 lands near the
    // top of the letter and the month progresses downward.
    exact.sort((a, b) => a.row - b.row || a.col - b.col);
    setCells(exact);
    setDims({ cols, rows });
  }, [letter]);

  if (cells.length === 0) {
    return (
      <div className="letter-grid-empty" style={{ height }}>
        {letter}
      </div>
    );
  }

  const widthPx = (height / dims.rows) * dims.cols;
  const cellPx = height / dims.rows;
  const fontSize = Math.min(0.34, Math.max(0.2, 11 / cellPx));

  return (
    <svg
      width={widthPx}
      height={height}
      viewBox={`0 0 ${dims.cols} ${dims.rows}`}
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
