import { format, parseISO } from 'date-fns';
import type { ActionItem } from '../types';

interface Props {
  actions: ActionItem[];
  onToggleDone?: (action: ActionItem) => void;
  compact?: boolean;
}

export default function ActionTable({ actions, onToggleDone, compact }: Props) {
  if (actions.length === 0) {
    return <div className="empty-state">No actions logged yet.</div>;
  }

  const isOverdue = (a: ActionItem) => !a.done && a.deadline && parseISO(a.deadline) < new Date(new Date().toDateString());

  return (
    <div className="table-scroll">
      <table className="action-table">
        <thead>
          <tr>
            <th>Related reason / issue</th>
            <th>Action</th>
            <th>Owner</th>
            <th>Deadline</th>
            <th>Done?</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id} className={a.done ? 'row-done' : isOverdue(a) ? 'row-overdue' : ''}>
              <td>{a.related_issue}</td>
              <td>{a.action}</td>
              <td>{a.owner_name}</td>
              <td>{a.deadline ? format(parseISO(a.deadline), 'd MMM yyyy') : '—'}</td>
              <td>
                {onToggleDone ? (
                  <input
                    type="checkbox"
                    checked={a.done}
                    onChange={() => onToggleDone(a)}
                    aria-label={a.done ? 'Mark not done' : 'Mark done'}
                  />
                ) : (
                  <span className={`pill ${a.done ? 'pill-good' : 'pill-bad'}`}>{a.done ? 'Yes' : 'No'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <p className="table-footnote">
          {actions.filter((a) => !a.done).length} open · {actions.filter((a) => a.done).length} completed
        </p>
      )}
    </div>
  );
}
