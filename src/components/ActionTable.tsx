import { format, parseISO } from 'date-fns';
import { ACTION_STATUS_META, type ActionItem, type ActionStatus } from '../types';

interface Props {
  actions: ActionItem[];
  onStatusChange?: (action: ActionItem, status: ActionStatus) => void;
  compact?: boolean;
}

const STATUS_ORDER: ActionStatus[] = ['not_started', 'in_progress', 'dropped', 'completed'];

export default function ActionTable({ actions, onStatusChange, compact }: Props) {
  if (actions.length === 0) {
    return <div className="empty-state">No actions logged yet.</div>;
  }

  const isClosed = (a: ActionItem) => a.status === 'completed' || a.status === 'dropped';
  const isOverdue = (a: ActionItem) => !isClosed(a) && a.deadline && parseISO(a.deadline) < new Date(new Date().toDateString());

  return (
    <div className="table-scroll">
      <table className="action-table">
        <thead>
          <tr>
            <th>Related reason / issue</th>
            <th>Action</th>
            <th>Owner</th>
            <th>Deadline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => {
            const meta = ACTION_STATUS_META[a.status];
            return (
              <tr key={a.id} className={isClosed(a) ? 'row-done' : isOverdue(a) ? 'row-overdue' : ''}>
                <td>{a.related_issue}</td>
                <td>{a.action}</td>
                <td>{a.owner_name}</td>
                <td>{a.deadline ? format(parseISO(a.deadline), 'd MMM yyyy') : '—'}</td>
                <td>
                  {onStatusChange ? (
                    <select
                      className="status-select"
                      style={{ color: meta.color, background: meta.bg }}
                      value={a.status}
                      onChange={(e) => onStatusChange(a, e.target.value as ActionStatus)}
                      aria-label="Change status"
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {ACTION_STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="status-badge" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!compact && (
        <p className="table-footnote">
          {actions.filter((a) => !isClosed(a)).length} open · {actions.filter((a) => a.status === 'completed').length} completed ·{' '}
          {actions.filter((a) => a.status === 'dropped').length} dropped
        </p>
      )}
    </div>
  );
}
