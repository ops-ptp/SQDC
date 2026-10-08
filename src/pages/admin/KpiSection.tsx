import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { pencilIcon, plusIcon, trashIcon } from '@progress/kendo-svg-icons';
import { useDepartment } from '../../context/DepartmentContext';
import { createKpi, deleteKpis, fetchAllKpisAdmin, fetchPillars, renameKpiGroup, updateKpis, type KpiSettingsPatch } from '../../lib/data';
import { baseNameOf, errorMessage, weeklyFromUpload, type KpiWithPillar, type Pillar } from '../../types';
import Modal from '../../components/Modal';
import { Button, CheckField, InfoTip, InlineLoader, NumberField, Select, TextAreaField, TextField } from '../../components/ui';

// ===========================================================================
// KPIs — the department admin's catalog editor. Day/Night (and Old, where
// present) variants of one logical KPI are a single row here, same grouping
// as the board; every setting applies to all of a row's variants at once.
// ===========================================================================

const DIRECTION_OPTIONS = [
  { value: 'higher', label: 'Higher is better' },
  { value: 'lower', label: 'Lower is better' },
];

const WEEKLY_AGG_OPTIONS = [
  { value: 'avg', label: 'Average of the days' },
  { value: 'sum', label: 'Total of the days' },
];

interface KpiRow {
  key: string;
  name: string;
  pillarId: string;
  pillarName: string;
  pillarSort: number;
  isLeading: boolean;
  split: boolean;
  hasSecondary: boolean;
  ids: string[];
  unit: string;
  target: number;
  info: string;
  weeklyAgg: 'avg' | 'sum';
  sortOrder: number;
  /** Next 24 Hours KPIs: compare with the target on the card. */
  hasTarget: boolean;
  /** Next 24 Hours KPIs: the board KPI whose daily target the card follows. */
  targetKpiId: string | null;
  // Inline-editable settings:
  active: boolean;
  isHigherBetter: boolean;
  trackWeekly: boolean;
  manualEntry: boolean;
}

type InlineSettings = Pick<KpiRow, 'active' | 'isHigherBetter' | 'trackWeekly' | 'manualEntry'>;

function buildKpiRows(kpis: KpiWithPillar[], pillars: Pillar[]): KpiRow[] {
  const pillarById = new Map(pillars.map((p) => [p.id, p]));
  const map = new Map<string, { members: KpiWithPillar[] }>();
  for (const k of kpis) {
    const key = `${k.is_leading}|${k.pillar_id}|${baseNameOf(k.name)}`;
    const g = map.get(key) ?? { members: [] };
    g.members.push(k);
    map.set(key, g);
  }
  const rows: KpiRow[] = [];
  for (const [key, g] of map) {
    const rep = g.members.find((k) => !k.is_secondary) ?? g.members[0];
    const pillar = pillarById.get(rep.pillar_id);
    rows.push({
      key,
      name: baseNameOf(rep.name),
      pillarId: rep.pillar_id,
      pillarName: pillar?.name ?? rep.pillar?.name ?? '—',
      pillarSort: pillar?.sort_order ?? 99,
      isLeading: rep.is_leading,
      split: g.members.some((k) => !k.is_secondary && /\((Day|Night)\)\s*$/i.test(k.name)),
      hasSecondary: g.members.some((k) => k.is_secondary),
      ids: g.members.map((k) => k.id),
      unit: rep.unit,
      target: Number(rep.target),
      info: rep.info ?? '',
      weeklyAgg: rep.weekly_agg ?? 'avg',
      sortOrder: Math.min(...g.members.map((k) => k.sort_order)),
      hasTarget: rep.has_target ?? false,
      targetKpiId: rep.target_kpi_id ?? null,
      active: rep.active,
      isHigherBetter: rep.is_higher_better,
      trackWeekly: g.members.some((k) => k.track_weekly),
      manualEntry: rep.manual_entry,
    });
  }
  return rows.sort((a, b) => a.pillarSort - b.pillarSort || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function settingsOf(r: KpiRow): InlineSettings {
  return { active: r.active, isHigherBetter: r.isHigherBetter, trackWeekly: r.trackWeekly, manualEntry: r.manualEntry };
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

interface KpiFormProps {
  mode: 'add' | 'edit';
  row?: KpiRow;
  pillars: Pillar[];
  existingNames: string[];
  /** Board KPIs a Next 24 Hours KPI can follow the daily target of. */
  boardKpis: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}

type TargetMode = 'none' | 'fixed' | 'daily';
const TARGET_MODE_OPTIONS = [
  { value: 'none', label: 'None — plain card' },
  { value: 'fixed', label: 'Fixed number' },
  { value: 'daily', label: "Follow a board KPI's target (day before)" },
];

function KpiFormModal({ mode, row, pillars, existingNames, boardKpis, onCancel, onSaved }: KpiFormProps) {
  const department = useDepartment();
  const opsFormat = department.upload_format === 'ops' && department.entry_mode !== 'manual';
  const showManualToggle = department.entry_mode === 'upload';
  const weeklyRolledUp = !weeklyFromUpload(department);
  const [name, setName] = useState(row?.name ?? '');
  const [pillarId, setPillarId] = useState(row?.pillarId ?? pillars[0]?.id ?? '');
  const [kind, setKind] = useState<'board' | 'leading'>(row?.isLeading ? 'leading' : 'board');
  const [unit, setUnit] = useState(row?.unit ?? '');
  const [target, setTarget] = useState(row ? String(row.target) : '');
  const [direction, setDirection] = useState(row ? (row.isHigherBetter ? 'higher' : 'lower') : 'higher');
  const [split, setSplit] = useState(row?.split ?? false);
  const [trackWeekly, setTrackWeekly] = useState(row?.trackWeekly ?? true);
  const [weeklyAgg, setWeeklyAgg] = useState<'avg' | 'sum'>(row?.weeklyAgg ?? 'avg');
  const [manualEntry, setManualEntry] = useState(row?.manualEntry ?? false);
  const [info, setInfo] = useState(row?.info ?? '');
  const [targetMode, setTargetMode] = useState<TargetMode>(row?.hasTarget ? (row.targetKpiId ? 'daily' : 'fixed') : 'none');
  const [targetKpiId, setTargetKpiId] = useState(row?.targetKpiId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBoard = kind === 'board';
  // A board KPI is always judged against its target; a Next 24 Hours KPI
  // against a fixed number or a board KPI's daily target, or not at all.
  const hasTarget = !isBoard && targetMode !== 'none';
  const showTarget = isBoard || targetMode === 'fixed';
  const renamed = mode === 'edit' && row && (name.trim() !== row.name || pillarId !== row.pillarId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) return setError('Give the KPI a name.');
    if (/\((Day|Night|Old)\)\s*$/i.test(cleanName)) return setError('Leave "(Day)", "(Night)" and "(Old)" off the name — tick "Separate Day & Night values" instead.');
    const others = existingNames.filter((n) => n.toLowerCase() !== row?.name.toLowerCase());
    if (others.some((n) => n.toLowerCase() === cleanName.toLowerCase())) return setError(`There's already a KPI called "${cleanName}" in ${department.name}.`);
    if (!pillarId) return setError('Pick a pillar.');
    const targetNum = target.trim() === '' ? 0 : Number(target);
    if (Number.isNaN(targetNum)) return setError('Standard target must be a number.');
    if (!isBoard && targetMode === 'fixed' && target.trim() === '') return setError('Enter the target to compare the projection with.');
    if (!isBoard && targetMode === 'daily' && !targetKpiId) return setError('Pick the board KPI whose daily target to follow.');
    const followKpiId = !isBoard && targetMode === 'daily' ? targetKpiId : null;

    setSaving(true);
    setError(null);
    try {
      if (mode === 'add') {
        const base = {
          department_id: department.id,
          pillar_id: pillarId,
          unit: unit.trim(),
          is_higher_better: direction === 'higher',
          target: targetNum,
          is_leading: !isBoard,
          sort_order: 999,
          manual_entry: showManualToggle && isBoard ? manualEntry : false,
          track_weekly: isBoard ? trackWeekly : false,
          weekly_agg: weeklyAgg,
          has_target: hasTarget,
          target_kpi_id: followKpiId,
        };
        if (isBoard && split) {
          await createKpi({ ...base, name: `${cleanName} (Day)` });
          await createKpi({ ...base, name: `${cleanName} (Night)` });
        } else {
          await createKpi({ ...base, name: cleanName });
        }
        onSaved(`Added "${cleanName}".`);
      } else if (row) {
        if (renamed) await renameKpiGroup(department.id, row.pillarId, row.name, pillarId, cleanName);
        const patch: KpiSettingsPatch = { unit: unit.trim(), target: targetNum, weekly_agg: weeklyAgg, info: info.trim() || null };
        if (!isBoard) {
          patch.has_target = hasTarget;
          patch.target_kpi_id = followKpiId;
          if (targetMode === 'fixed') patch.is_higher_better = direction === 'higher';
        }
        await updateKpis(row.ids, patch);
        onSaved(`Saved "${cleanName}".`);
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to save'));
      setSaving(false);
    }
  }

  return (
    <Modal title={mode === 'add' ? 'Add KPI' : `Edit ${row?.name}`} onClose={onCancel} maxWidth={620}>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="span-2">
            KPI name
            <TextField autoFocus={mode === 'add'} value={name} onChange={setName} placeholder="e.g. Invoices paid on time" />
          </label>
          <label>
            Pillar
            <Select value={pillarId} onChange={setPillarId} options={pillars.map((p) => ({ value: p.id, label: p.name }))} />
          </label>
          <label>
            Shows on
            <Select
              value={kind}
              onChange={(v) => setKind(v as 'board' | 'leading')}
              disabled={mode === 'edit'}
              options={[
                { value: 'board', label: 'SQDC Board (daily result vs target)' },
                { value: 'leading', label: 'Next 24 Hours (projection)' },
              ]}
            />
          </label>
          <label>
            Unit
            <TextField value={unit} onChange={setUnit} placeholder="%, Count, Hours, RM…" />
          </label>
          {!isBoard && (
            <label>
              <span className="field-title">
                Target{' '}
                <InfoTip>With a target, the Next 24 Hours card turns green or red and shows how far the projection is from it.</InfoTip>
              </span>
              <Select value={targetMode} onChange={(v) => setTargetMode(v as TargetMode)} options={TARGET_MODE_OPTIONS} ariaLabel="Target" />
            </label>
          )}
          {!isBoard && targetMode === 'daily' && (
            <label>
              <span className="field-title">
                Follow{' '}
                <InfoTip>
                  Compares today's projection with that KPI's target for the day before (from the upload's Target sheet), using its direction.
                  If the day before has no daily target, its standard target.
                </InfoTip>
              </span>
              <Select value={targetKpiId} onChange={setTargetKpiId} placeholder="— Pick a board KPI —" options={boardKpis.map((k) => ({ value: k.id, label: k.name }))} ariaLabel="Follow board KPI" />
            </label>
          )}
          {showTarget && (
            <label>
              <span className="field-title">
                {isBoard ? 'Standard target' : 'Target value'}{' '}
                <InfoTip>
                  {isBoard
                    ? "The target each day is judged against unless an upload's Targets sheet gives that day its own. Changing it affects new entries only — past days keep the target they were judged against."
                    : 'The figure each day’s projection is compared with, e.g. the budgeted moves per shift.'}
                </InfoTip>
              </span>
              <NumberField value={target} onChange={setTarget} placeholder="0" />
            </label>
          )}
          {showTarget && (mode === 'add' || !isBoard) && (
            <label>
              Direction
              <Select value={direction} onChange={setDirection} options={DIRECTION_OPTIONS} />
            </label>
          )}
          {isBoard && mode === 'add' && (
            <label className="kpi-form-check">
              <CheckField checked={split} onChange={setSplit} />
              Separate Day &amp; Night values
            </label>
          )}
          {isBoard && mode === 'add' && (
            <label className="kpi-form-check">
              <CheckField checked={trackWeekly} onChange={setTrackWeekly} />
              Show on the Weekly view
            </label>
          )}
          {isBoard && weeklyRolledUp && (
            <label>
              <span className="field-title">
                Weekly figure{' '}
              <InfoTip>How a week's daily values become one weekly figure on the Weekly view — average for rates and percentages, total for counts.</InfoTip>
              </span>
              <Select value={weeklyAgg} onChange={(v) => setWeeklyAgg(v as 'avg' | 'sum')} options={WEEKLY_AGG_OPTIONS} />
            </label>
          )}
          {isBoard && mode === 'add' && showManualToggle && (
            <label className="kpi-form-check">
              <CheckField checked={manualEntry} onChange={setManualEntry} />
              Typed in the app (not in the upload)
            </label>
          )}
          {mode === 'edit' && (
            <label className="span-2">
              What this KPI tells us (optional)
              <TextAreaField value={info} onChange={setInfo} placeholder="Shown to admins only for now — a note for whoever maintains this KPI." />
            </label>
          )}
        </div>
        {renamed && opsFormat && (
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            The OPS workbook upload matches columns to KPIs by name — rename the column in the Excel file to “{name.trim()}” too,
            or the next upload will treat it as a brand-new KPI.
          </div>
        )}
        {mode === 'add' && department.upload_format === 'template' && department.entry_mode !== 'manual' && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            Download a fresh template from the Uploads tab after adding KPIs — it gets a column for each one.
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" themeColor="primary" disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Add KPI' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteKpiModal({ row, onCancel, onConfirmed }: { row: KpiRow; onCancel: () => void; onConfirmed: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteKpis(row.ids);
      onConfirmed();
    } catch (e) {
      setError(errorMessage(e, 'Failed to delete'));
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete KPI" onClose={onCancel}>
      <p>
        This will permanently erase <strong>"{row.name}"</strong> and all of its historical data — every daily entry,
        target, remark, reason, Pareto tag and weekly figure logged against it
        {row.hasSecondary ? ' (including its old-calculation figures)' : ''}.
      </p>
      <p>
        <strong>This cannot be undone.</strong> If you just want to remove it from the board without losing its
        history, untick "Visible" instead.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <Button type="button" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
        <Button type="button" themeColor="error" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function KpiTable({
  title,
  rows,
  showWeekly,
  showManual,
  onPatch,
  onEdit,
  onDelete,
  locked,
  boardKpiNames,
}: {
  title: string;
  locked: boolean;
  boardKpiNames: Map<string, string>;
  rows: KpiRow[];
  showWeekly: boolean;
  showManual: boolean;
  onPatch: (key: string, patch: Partial<InlineSettings>) => void;
  onEdit: (row: KpiRow) => void;
  onDelete: (row: KpiRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="quadrant-section" style={{ marginBottom: 20 }}>
      <div className="quadrant-block-title" style={{ padding: '0 0 8px' }}>
        {title}
      </div>
      <div className="table-scroll admin-kpi-table-scroll">
        <table className="action-table admin-kpi-table">
          <thead>
            <tr>
              <th>Pillar</th>
              <th>KPI</th>
              <th>Unit</th>
              <th>Target</th>
              <th>Direction</th>
              {showWeekly && <th>Weekly view</th>}
              {showManual && (
                <th>
                  Typed in app <InfoTip>Ticked = people type this KPI's value on the Enter page instead of it coming from the upload.</InfoTip>
                </th>
              )}
              <th>Visible</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.pillarName}</td>
                <td>
                  {r.name}
                  {r.split && <span className="pill admin-kpi-tag">Day/Night</span>}
                  {r.hasSecondary && <span className="pill pill-bad admin-kpi-secondary-tag">+old calc</span>}
                </td>
                <td>{r.unit || '—'}</td>
                <td>{!r.isLeading ? r.target : !r.hasTarget ? '—' : r.targetKpiId ? `Day before · ${boardKpiNames.get(r.targetKpiId) ?? 'board KPI'}` : r.target}</td>
                <td>
                  {r.isLeading && r.hasTarget && r.targetKpiId ? (
                    <span className="muted">Same as the followed KPI</span>
                  ) : (
                    <Select
                      className="admin-kpi-direction-select"
                      value={r.isHigherBetter ? 'higher' : 'lower'}
                      onChange={(v) => onPatch(r.key, { isHigherBetter: v === 'higher' })}
                      options={DIRECTION_OPTIONS}
                      size="small"
                      ariaLabel={`Direction for ${r.name}`}
                    />
                  )}
                </td>
                {showWeekly && <td>{!r.isLeading && <CheckField checked={r.trackWeekly} onChange={(v) => onPatch(r.key, { trackWeekly: v })} />}</td>}
                {showManual && <td>{!r.isLeading && <CheckField checked={r.manualEntry} onChange={(v) => onPatch(r.key, { manualEntry: v })} />}</td>}
                <td>
                  <CheckField checked={r.active} onChange={(v) => onPatch(r.key, { active: v })} />
                </td>
                <td className="admin-row-actions">
                  <Button type="button" size="small" fillMode="flat" svgIcon={pencilIcon} onClick={() => onEdit(r)} disabled={locked} title={locked ? 'Save or undo your changes first' : undefined}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    fillMode="flat"
                    themeColor="error"
                    svgIcon={trashIcon}
                    onClick={() => onDelete(r)}
                    disabled={locked}
                    title={locked ? 'Save or undo your changes first' : `Delete ${r.name}`}
                    aria-label={`Delete ${r.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function KpiSection({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const department = useDepartment();
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [original, setOriginal] = useState<Map<string, InlineSettings>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'add' | 'edit'; row?: KpiRow } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KpiRow | null>(null);
  const [boardKpis, setBoardKpis] = useState<{ id: string; name: string }[]>([]);
  const boardKpiNames = useMemo(() => new Map(boardKpis.map((k) => [k.id, k.name])), [boardKpis]);

  function load() {
    setLoading(true);
    Promise.all([fetchPillars(), fetchAllKpisAdmin(department.id)])
      .then(([p, kpis]) => {
        setPillars(p);
        setBoardKpis(kpis.filter((k) => !k.is_leading && !k.is_secondary).map((k) => ({ id: k.id, name: k.active ? k.name : `${k.name} (hidden)` })));
        const built = buildKpiRows(kpis, p);
        setRows(built);
        setOriginal(new Map(built.map((r) => [r.key, settingsOf(r)])));
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load KPIs')))
      .finally(() => setLoading(false));
  }

  // Reload whenever an upload changes the catalog.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, department.id]);

  function handlePatch(key: string, patch: Partial<InlineSettings>) {
    setMessage(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const dirtyRows = rows.filter((r) => {
    const o = original.get(r.key);
    return !o || o.active !== r.active || o.isHigherBetter !== r.isHigherBetter || o.trackWeekly !== r.trackWeekly || o.manualEntry !== r.manualEntry;
  });

  async function handleSave() {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const r of dirtyRows) {
        await updateKpis(r.ids, {
          active: r.active,
          is_higher_better: r.isHigherBetter,
          track_weekly: r.isLeading ? false : r.trackWeekly,
          manual_entry: r.isLeading ? false : r.manualEntry,
        });
      }
      setOriginal(new Map(rows.map((r) => [r.key, settingsOf(r)])));
      setMessage(`Saved ${dirtyRows.length} change${dirtyRows.length === 1 ? '' : 's'}.`);
      onChanged();
    } catch (e) {
      setError(errorMessage(e, 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  }

  const board = useMemo(() => rows.filter((r) => !r.isLeading), [rows]);
  const leading = useMemo(() => rows.filter((r) => r.isLeading), [rows]);
  const existingNames = rows.map((r) => r.name);

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="page-header-row" style={{ marginBottom: 14 }}>
        <div>
          <h3>
            KPIs{' '}
            <InfoTip>
              Every KPI on {department.name}'s Board and Next 24 Hours, Day/Night combined into one row. "Visible" hides a KPI
              everywhere without losing its data. "Delete" is permanent and erases all of its history.
            </InfoTip>
          </h3>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {dirtyRows.length > 0 && (
            <Button type="button" fillMode="flat" onClick={load} disabled={saving}>
              Undo changes
            </Button>
          )}
          <Button type="button" svgIcon={plusIcon} onClick={() => setForm({ mode: 'add' })} disabled={loading || dirtyRows.length > 0} title={dirtyRows.length > 0 ? 'Save or undo your changes first' : undefined}>
            Add KPI
          </Button>
          <Button type="button" themeColor="primary" disabled={saving || dirtyRows.length === 0} onClick={handleSave}>
            {saving ? 'Saving…' : dirtyRows.length > 0 ? `Save changes (${dirtyRows.length})` : 'Save changes'}
          </Button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <InlineLoader label="Loading KPIs…" />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          No KPIs yet. Click <strong>Add KPI</strong> for each measure the team reviews at its SQDC huddle — a pillar, a target, and
          whether higher or lower is better is all it needs.
        </div>
      ) : (
        <>
          <KpiTable
            title="SQDC Board"
            rows={board}
            showWeekly
            locked={dirtyRows.length > 0}
            showManual={department.entry_mode === 'upload'}
            onPatch={handlePatch}
            onEdit={(row) => setForm({ mode: 'edit', row })}
            onDelete={setPendingDelete}
            boardKpiNames={boardKpiNames}
          />
          <KpiTable
            title="Next 24 Hours"
            rows={leading}
            showWeekly={false}
            locked={dirtyRows.length > 0}
            showManual={false}
            onPatch={handlePatch}
            onEdit={(row) => setForm({ mode: 'edit', row })}
            onDelete={setPendingDelete}
            boardKpiNames={boardKpiNames}
          />
        </>
      )}

      {form && (
        <KpiFormModal
          mode={form.mode}
          row={form.row}
          pillars={pillars}
          existingNames={existingNames}
          boardKpis={boardKpis}
          onCancel={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            setMessage(msg);
            load();
            onChanged();
          }}
        />
      )}

      {pendingDelete && (
        <DeleteKpiModal
          row={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirmed={() => {
            setPendingDelete(null);
            setMessage(`Deleted "${pendingDelete.name}" and all of its data.`);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
