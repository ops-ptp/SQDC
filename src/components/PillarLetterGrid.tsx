import { useEffect, useState } from 'react';

export type DayStatus = {
  day: number; // day of month, 1-based
  status: 'met' | 'missed' | 'future' | 'nodata';
};

interface Props {
  letter: string;
  /** One entry per day of the current month, index 0 = day 1, in order. */
  days: DayStatus[];
  todayDay: number;
  height?: number;
}

const SAMPLE_W = 220;
const SAMPLE_H = 260;
const START_COLS = 11;
const START_ROWS = 13;
const MAX_ATTEMPTS = 5;

function sampleGlyph(letter: string, cols: number, rows: number): { row: number; col: number }[] {
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
  const filled: { row: number; col: number }[] = [];
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

const STATUS_COLOR: Record<DayStatus['status'], string> = {
  met: '#16a34a',
  missed: '#dc2626',
  future: '#eef2f7',
  nodata: '#cbd5e1',
};

const STATUS_LABEL: Record<DayStatus['status'], string> = {
  met: 'target met',
  missed: 'target missed',
  future: "hasn't happened yet",
  nodata: 'no data logged',
};

export default function PillarLetterGrid({ letter, days, todayDay, height = 120 }: Props) {
  const [cells, setCells] = useState<{ row: number; col: number }[]>([]);
  const [dims, setDims] = useState({ cols: START_COLS, rows: START_ROWS });

  useEffect(() => {
    const target = Math.max(days.length, 28);
    let cols = START_COLS;
    let rows = START_ROWS;
    let filled = sampleGlyph(letter, cols, rows);
    for (let attempt = 1; attempt < MAX_ATTEMPTS && filled.length < target; attempt++) {
      cols += 2;
      rows += 2;
      filled = sampleGlyph(letter, cols, rows);
    }
    setCells(filled);
    setDims({ cols, rows });
  }, [letter, days.length]);

  if (days.length === 0 || cells.length === 0) {
    return (
      <div className="letter-grid-empty" style={{ height }}>
        {letter}
      </div>
    );
  }

  const widthPx = (height / dims.rows) * dims.cols;

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
        const dayInfo = days[i];
        const isToday = dayInfo?.day === todayDay;
        const fill = dayInfo ? STATUS_COLOR[dayInfo.status] : STATUS_COLOR.future;
        return (
          <rect
            key={`${c.row}-${c.col}`}
            x={c.col + 0.06}
            y={c.row + 0.06}
            width={0.88}
            height={0.88}
            rx={0.12}
            fill={fill}
            stroke={isToday ? '#1d4ed8' : 'rgba(0,0,0,0.35)'}
            strokeWidth={isToday ? 0.16 : 0.05}
          >
            {dayInfo && <title>{`Day ${dayInfo.day}${isToday ? ' (today)' : ''} — ${STATUS_LABEL[dayInfo.status]}`}</title>}
          </rect>
        );
      })}
    </svg>
  );
}
