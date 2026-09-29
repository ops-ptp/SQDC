import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { orderBy, type SortDescriptor } from '@progress/kendo-data-query';
import { Grid, GridColumn, type GridCustomCellProps, type GridCustomRowProps } from '@progress/kendo-react-grid';
import { DropDownList } from '@progress/kendo-react-dropdowns';
import { ACTION_STATUS_META, PILLAR_COLORS, getDisplayStatus, type ActionItem, type ActionStatus, type Pillar } from '../types';

interface Props {
  actions: ActionItem[];
  onStatusChange?: (action: ActionItem, status: ActionStatus) => void;
  compact?: boolean;
  /** When provided, a "Pillar" column is shown, looked up per-action from pillar_id. */
  pillars?: Pillar[];
  /** When provided (admin only), an "Edit" column with a button opens the row for editing. */
  onEdit?: (action: ActionItem) => void;
}

const STATUS_ORDER: ActionStatus[] = ['not_started', 'in_progress', 'dropped', 'completed'];
const STATUS_OPTIONS = STATUS_ORDER.map((value) => ({ value, label: ACTION_STATUS_META[value].label }));
const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

const ROW_CLASS: Record<string, string> = {
  overdue: 'row-overdue',
  dropped: 'row-dropped',
  completed: 'row-completed',
  in_progress: 'row-in-progress',
  not_started: '',
};

export default function ActionTable({ actions, onStatusChange, compact, pillars, onEdit }: Props) {
  const [sort, setSort] = useState<SortDescriptor[]>([]);

  if (actions.length === 0) {
    return <div className="empty-state">No actions logged yet.</div>;
  }

  const pillarById = new Map((pillars ?? []).map((p) => [p.id, p]));
  const sorted = orderBy(actions, sort) as ActionItem[];

  // Row-level status coloring (overdue/dropped/completed/in-progress) — a
  // custom row component so the class lands on the <tr> itself, same as the
  // plain-table version, keeping the existing .row-* CSS working unchanged.
  function DataRow(props: GridCustomRowProps) {
    const item = props.dataItem as ActionItem;
    const statusClass = ROW_CLASS[getDisplayStatus(item, TODAY_STR)];
    const className = [props.trProps?.className, statusClass].filter(Boolean).join(' ');
    return (
      <tr {...props.trProps} className={className || undefined}>
        {props.children}
      </tr>
    );
  }

  function PillarCell(props: GridCustomCellProps) {
    const item = props.dataItem as ActionItem;
    const pillar = pillarById.get(item.pillar_id);
    return (
      <td {...props.tdProps}>
        {pillar ? (
          <span className="status-badge" style={{ color: PILLAR_COLORS[pillar.code].text, background: PILLAR_COLORS[pillar.code].soft }}>
            {pillar.name}
          </span>
        ) : (
          '—'
        )}
      </td>
    );
  }

  function DeadlineCell(props: GridCustomCellProps) {
    const item = props.dataItem as ActionItem;
    return <td {...props.tdProps}>{item.deadline ? format(parseISO(item.deadline), 'd MMM yyyy') : '—'}</td>;
  }

  function StatusCell(props: GridCustomCellProps) {
    const item = props.dataItem as ActionItem;
    const displayStatus = getDisplayStatus(item, TODAY_STR);
    const meta = ACTION_STATUS_META[displayStatus];
    return (
      <td {...props.tdProps}>
        {onStatusChange ? (
          <DropDownList
            style={{ minWidth: 140, color: meta.color }}
            data={STATUS_OPTIONS}
            textField="label"
            dataItemKey="value"
            value={STATUS_OPTIONS.find((o) => o.value === item.status)}
            onChange={(e) => onStatusChange(item, e.value.value as ActionStatus)}
            title={displayStatus === 'overdue' ? 'Past its deadline — pick a status to update it' : undefined}
          />
        ) : (
          <span className="status-badge" style={{ color: meta.color, background: meta.bg }}>
            {meta.label}
          </span>
        )}
      </td>
    );
  }

  function EditCell(props: GridCustomCellProps) {
    const item = props.dataItem as ActionItem;
    return (
      <td {...props.tdProps}>
        <button type="button" className="btn btn-ghost-light" onClick={() => onEdit!(item)}>
          Edit
        </button>
      </td>
    );
  }

  return (
    <div className="table-scroll">
      <Grid
        className="action-grid"
        data={sorted}
        dataItemKey="id"
        sortable={!compact}
        sort={sort}
        onSortChange={(e) => setSort(e.sort)}
        rows={{ data: DataRow }}
      >
        <GridColumn field="action" title="Action" />
        <GridColumn field="related_issue" title="Related reason / issue" />
        {pillars && <GridColumn title="Pillar" sortable={false} cells={{ data: PillarCell }} />}
        <GridColumn field="owner_name" title="Owner" />
        <GridColumn field="deadline" title="Deadline" cells={{ data: DeadlineCell }} />
        <GridColumn title="Status" sortable={false} cells={{ data: StatusCell }} />
        {onEdit && <GridColumn title="Edit" sortable={false} width={90} cells={{ data: EditCell }} />}
      </Grid>
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
