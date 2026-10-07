import { useEffect, useState } from 'react';
import { Button } from './ui';

// ===========================================================================
// Progress while Gemini works through a run. The run is sent in batches, so
// the bar is real (remarks done / total); a shimmer on the bar, a rotating
// status line and an elapsed clock keep it visibly alive between batches.
// Skeleton rows stand in for the review table until the results arrive.
// ===========================================================================

export interface AiRunProgress {
  total: number;
  done: number;
  batches: number;
  batchesDone: number;
  angles: string[];
  startedAt: number;
  /** When the last batch came back — used to notice a slow spell. */
  lastProgressAt: number;
}

const STATUS_LINES = [
  'Reading the remarks…',
  'Matching them to your categories…',
  'Looking at each angle…',
  'Checking how sure it is…',
  'Noting the words behind each tag…',
];
const SLOW_AFTER_MS = 25_000;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function AiProgress({ progress, onCancel, cancelling }: { progress: AiRunProgress; onCancel: () => void; cancelling: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const elapsed = now - progress.startedAt;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const slow = now - progress.lastProgressAt > SLOW_AFTER_MS;
  const status = cancelling
    ? 'Stopping after the batches already sent…'
    : slow
      ? 'Taking longer than usual — Google may be busy; it retries automatically.'
      : STATUS_LINES[Math.floor(elapsed / 3000) % STATUS_LINES.length];
  const batchNow = Math.min(progress.batchesDone + 1, progress.batches);

  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <div className="ai-progress-head">
        <span className="ai-progress-spark" aria-hidden="true">
          ✦
        </span>
        <b className="ai-progress-title">Asking Gemini…</b>
        <span className="ai-progress-time" aria-label={`Elapsed ${clock(elapsed)}`}>
          {clock(elapsed)}
        </span>
      </div>
      <div
        className="ai-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-label={`${progress.done} of ${progress.total} remarks tagged`}
      >
        <div className="ai-progress-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <div className="ai-progress-meta">
        <span>
          <b>{progress.done}</b> of {progress.total} remarks
          {progress.batches > 1 ? ` · batch ${batchNow} of ${progress.batches}` : ''} · {progress.angles.join(', ')}
        </span>
        <span className="ai-progress-pct">{pct}%</span>
      </div>
      <div className={`ai-progress-status${slow ? ' is-slow' : ''}`} key={status}>
        {status}
      </div>
      <div className="ai-progress-actions">
        <Button size="small" fillMode="outline" onClick={onCancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
        <span className="muted">Cancelling keeps whatever is already done.</span>
      </div>
    </div>
  );
}

/** Grey shimmering stand-ins for review rows still to come. */
export function SkeletonRows({ rows, angles }: { rows: number; angles: string[] }) {
  return (
    <div className="table-scroll ai-skeleton" aria-hidden="true">
      <table className="action-table ai-cat-table">
        <thead>
          <tr>
            <th>Save</th>
            <th>Date</th>
            <th>Actual / target</th>
            <th>Remark</th>
            {angles.map((a) => (
              <th key={a}>{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>
                <span className="skel skel-box" />
              </td>
              <td>
                <span className="skel" style={{ width: 52 }} />
              </td>
              <td>
                <span className="skel" style={{ width: 64 }} />
              </td>
              <td className="ai-cat-remark">
                <span className="skel" style={{ width: `${70 + ((i * 17) % 25)}%` }} />
                <span className="skel" style={{ width: `${40 + ((i * 29) % 35)}%` }} />
              </td>
              {angles.map((a, j) => (
                <td key={a} className="ai-cat-category">
                  <span className="skel skel-chip" style={{ width: 70 + ((i + j) * 23) % 50 }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
