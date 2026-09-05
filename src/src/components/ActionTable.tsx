import { format, parseISO } from 'date-fns';
import { ACTION_STATUS_META, getDisplayStatus, type ActionItem, type ActionStatus } from '../types';

interface Props {
  actions: ActionItem[];
  onStatusChange?: (action: ActionItem, status: ActionStatus) => void;
  compact?: boolean;
}

const STATUS_ORDER: ActionStatus[] = ['not_started', 'in_progress', 'dropped', 'completed'];
const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

const ROW_CLASS: Record<string, string> = {
  overdue: 'row-overdue',
  dropped: 'row-dropped',
  completed: 'row-completed',
  in_progress: 'row-in-progress',
  not_started: '',
};

export default function ActionTable({ actions, onStatusChange, compact }: Props) {
  if (actions.length === 0) {
    return <div className="empty-state">No actions logged yet.</div>;
  }

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
            const displayStatus = getDisplayStatus(a, TODAY_STR);
            const meta = ACTION_STATUS_META[displayStatus];
            return (
              <tr key={a.id} className={ROW_CLASS[displayStatus]}>
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
                      title={displayStatus === 'overdue' ? 'Past its deadline — pick a status to update it' : undefined}
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
          {actions.filter((a) => getDisplayStatus(a, TODAY_STR) === 'overdue').length} overdue ·{' '}
          {actions.filter((a) => a.status === 'not_started' || a.status === 'in_progress').length} open ·{' '}
          {actions.filter((a) => a.status === 'completed').length} completed ·{' '}
          {actions.filter((a) => a.status === 'dropped').length} dropped
        </p>
      )}
    </div>
  );
}
