import { useEffect, useRef, useState } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import {
  bulkUpsertDailyEntriesFromUpload,
  bulkUpsertKpiDailyTargets,
  bulkUpsertLeadingEntriesFromUpload,
  bulkUpsertWeeklyEntriesFromUpload,
  createKpi,
  deleteKpis,
  fetchAllKpisAdmin,
  fetchKpisForUpload,
  fetchManualOverrideKeys,
  fetchPillars,
  saveKpiAdminUpdates,
  type KpiAdminUpdate,
} from '../lib/data';
import {
  detectNewDailyColumns,
  detectNewLeadingColumns,
  detectRemovedDailyColumns,
  detectRemovedLeadingColumns,
  parseDailyTargetSheet,
  parseDailyWorkbook,
  parseNext24hrsWorkbook,
  parseWeeklyWorkbook,
  type ColumnRemoval,
  type DetectedNewColumn,
} from '../lib/excelUpload';
import { baseNameOf, errorMessage, type Kpi, type KpiWithPillar, type Pillar } from '../types';
import Modal from '../components/Modal';

interface UploadResult {
  ok: boolean;
  message: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Weekly upload — unchanged, single-step. The Weekly sheet never auto-
// creates or hides catalog KPIs (its figures are matched to existing lagging
// KPIs by base name), so there's no catalog diff to preview here.
// ---------------------------------------------------------------------------

function UploadCard({
  title,
  description,
  accept,
  onUpload,
}: {
  title: string;
  description: string;
  accept: string;
  onUpload: (file: File) => Promise<UploadResult>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setBusy(true);
    setResult(null);
    try {
      const res = await onUpload(file);
      setResult(res);
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e, 'Upload failed'), warnings: [] });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="card admin-upload-card">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="admin-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : fileName ? `Upload another file` : 'Choose file & upload'}
      </button>
      {fileName && <div className="admin-filename muted">{fileName}</div>}
      {result && (
        <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 10 }}>
          {result.message}
        </div>
      )}
      {result && result.warnings.length > 0 && (
        <details className="admin-warnings">
          <summary>{result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}</summary>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily upload — read, preview, confirm. The Daily workbook is the one that
// drives the KPI catalog itself (new columns get auto-created, columns the
// team deleted get auto-hidden), so unlike Weekly this reads the file first,
// works out exactly what would change, and only writes anything — catalog
// changes AND the day's data — once the admin confirms. Hiding a KPI here
// only ever sets kpis.active = false; nothing is ever deleted by an upload.
// ---------------------------------------------------------------------------

interface DailyUploadPreview {
  buffer: ArrayBuffer;
  pillars: Pillar[];
  kpisInitial: Kpi[];
  leadingKpisInitial: Kpi[];
  addedDaily: DetectedNewColumn[];
  removedDaily: ColumnRemoval[];
  addedLeading: DetectedNewColumn[];
  removedLeading: ColumnRemoval[];
}

function totalChangeCount(p: DailyUploadPreview): number {
  return p.addedDaily.length + p.removedDaily.length + p.addedLeading.length + p.removedLeading.length;
}

function ColumnChangeSummary({ preview }: { preview: DailyUploadPreview }) {
  if (totalChangeCount(preview) === 0) {
    return (
      <div className="alert alert-info" style={{ marginBottom: 0 }}>
        No KPI catalog changes detected — every column in this file already matches an existing KPI. Uploading will
        only update the data itself.
      </div>
    );
  }
  return (
    <div className="alert alert-warning" style={{ marginBottom: 0 }}>
      <strong>Review before uploading:</strong>
      {preview.addedDaily.length > 0 && (
        <div className="upload-diff-group">
          <div className="upload-diff-group-title">+ {preview.addedDaily.length} new Board KPI(s) will be added &amp; shown</div>
          <ul>
            {preview.addedDaily.map((c) => (
              <li key={`ad-${c.header}`}>{c.header}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.addedLeading.length > 0 && (
        <div className="upload-diff-group">
          <div className="upload-diff-group-title">+ {preview.addedLeading.length} new Next 24 Hours KPI(s) will be added &amp; shown</div>
          <ul>
            {preview.addedLeading.map((c) => (
              <li key={`al-${c.header}`}>{c.header}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.removedDaily.length > 0 && (
        <div className="upload-diff-group">
          <div className="upload-diff-group-title">
            − {preview.removedDaily.length} Board KPI(s) no longer in this file will be hidden (not deleted)
          </div>
          <ul>
            {preview.removedDaily.map((c) => (
              <li key={`rd-${c.kpi.id}`}>{c.kpi.name}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.removedLeading.length > 0 && (
        <div className="upload-diff-group">
          <div className="upload-diff-group-title">
            − {preview.removedLeading.length} Next 24 Hours KPI(s) no longer in this file will be hidden (not deleted)
          </div>
          <ul>
            {preview.removedLeading.map((c) => (
              <li key={`rl-${c.kpi.id}`}>{c.kpi.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DailyUploadCard({
  onAnalyze,
  onCommit,
}: {
  onAnalyze: (file: File) => Promise<DailyUploadPreview>;
  onCommit: (preview: DailyUploadPreview) => Promise<UploadResult>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'preview' | 'uploading'>('idle');
  const [preview, setPreview] = useState<DailyUploadPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setPhase('analyzing');
    setResult(null);
    setError(null);
    try {
      const p = await onAnalyze(file);
      setPreview(p);
      setPhase('preview');
    } catch (e) {
      setError(errorMessage(e, 'Failed to read file'));
      setPhase('idle');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setPhase('uploading');
    try {
      const res = await onCommit(preview);
      setResult(res);
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e, 'Upload failed'), warnings: [] });
    } finally {
      setPhase('idle');
      setPreview(null);
    }
  }

  function handleCancel() {
    setPreview(null);
    setPhase('idle');
  }

  return (
    <div className="card admin-upload-card">
      <h3>Daily upload</h3>
      <p className="muted">
        OPS SQDC Daily.xlsx — "Daily Database" (Date + Day/Night shift rows), "Target" (per-day/shift targets — a
        KPI's target can now change over time), and "Next 24hrs" (leading KPI projections). Re-uploading updates
        matching date rows only; other dates are untouched. The file is read first — you'll see exactly what KPI
        catalog changes it would make before anything is written.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="admin-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {phase === 'idle' && (
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
          {result ? 'Choose another file' : 'Choose file'}
        </button>
      )}
      {fileName && phase !== 'idle' && <div className="admin-filename muted">{fileName}</div>}
      {phase === 'analyzing' && <div className="empty-state">Reading file…</div>}
      {phase === 'preview' && preview && (
        <>
          <ColumnChangeSummary preview={preview} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleConfirm}>
              Confirm &amp; upload
            </button>
          </div>
        </>
      )}
      {phase === 'uploading' && <div className="empty-state">Uploading…</div>}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {result && (
        <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 10 }}>
          {result.message}
        </div>
      )}
      {result && result.warnings.length > 0 && (
        <details className="admin-warnings">
          <summary>{result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}</summary>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Management — Day/Night (and Old, where present) variants of the same
// logical KPI are grouped into one row via baseNameOf, the same grouping the
// board itself uses. Editing "Higher is better" or "Visible" on a row
// applies to every underlying variant at once; Delete removes all of them.
// ---------------------------------------------------------------------------

interface EditableGroup {
  key: string; // `${is_leading}|${base name}` — unique across both buckets
  name: string;
  pillarName: string;
  is_leading: boolean;
  active: boolean;
  is_higher_better: boolean;
  ids: string[];
  hasSecondary: boolean;
}

function buildGroups(kpis: KpiWithPillar[]): EditableGroup[] {
  const map = new Map<string, { ids: string[]; hasSecondary: boolean; representative?: KpiWithPillar; is_leading: boolean }>();
  for (const k of kpis) {
    const base = baseNameOf(k.name);
    const key = `${k.is_leading}|${base}`;
    let g = map.get(key);
    if (!g) {
      g = { ids: [], hasSecondary: false, is_leading: k.is_leading };
      map.set(key, g);
    }
    g.ids.push(k.id);
    if (k.is_secondary) g.hasSecondary = true;
    else g.representative = g.representative ?? k;
  }
  const rows: EditableGroup[] = [];
  for (const [key, g] of map) {
    const base = key.slice(key.indexOf('|') + 1);
    // Every group has at least one member; representative is only unset if
    // every member in the group is secondary, which shouldn't happen (a
    // secondary variant always has a primary counterpart) — fall back to
    // the first member's own KPI object just in case.
    const rep = g.representative ?? kpis.find((k) => g.ids.includes(k.id))!;
    rows.push({
      key,
      name: base,
      pillarName: rep.pillar?.name ?? '—',
      is_leading: g.is_leading,
      active: rep.active,
      is_higher_better: rep.is_higher_better,
      ids: g.ids,
      hasSecondary: g.hasSecondary,
    });
  }
  return rows;
}

function KpiManagementTable({
  title,
  rows,
  onToggleVisible,
  onChangeDirection,
  onDelete,
}: {
  title: string;
  rows: EditableGroup[];
  onToggleVisible: (key: string, active: boolean) => void;
  onChangeDirection: (key: string, isHigherBetter: boolean) => void;
  onDelete: (row: EditableGroup) => void;
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
              <th>KPI Name</th>
              <th>Higher is better</th>
              <th>Visible</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.pillarName}</td>
                <td>
                  {r.name}
                  {r.hasSecondary && <span className="pill pill-bad admin-kpi-secondary-tag">+old calc</span>}
                </td>
                <td>
                  <select
                    className="admin-kpi-direction-select"
                    value={r.is_higher_better ? 'higher' : 'lower'}
                    onChange={(e) => onChangeDirection(r.key, e.target.value === 'higher')}
                  >
                    <option value="higher">Higher is better</option>
                    <option value="lower">Lower is better</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={r.active} onChange={(e) => onToggleVisible(r.key, e.target.checked)} />
                </td>
                <td>
                  <button type="button" className="admin-kpi-delete-btn" onClick={() => onDelete(r)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeleteKpiModal({ row, onCancel, onConfirmed }: { row: EditableGroup; onCancel: () => void; onConfirmed: () => void }) {
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
        target, remark, and reason logged against it{row.hasSecondary ? ' (including its old-calculation figures)' : ''}.
      </p>
      <p>
        <strong>This cannot be undone.</strong> If you just want to remove it from the board without losing its
        history, use "Visible" instead.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={deleting}>
          Cancel
        </button>
        <button type="button" className="admin-kpi-delete-btn" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Modal>
  );
}

function KpiManagementSection() {
  const [rows, setRows] = useState<EditableGroup[]>([]);
  const [original, setOriginal] = useState<Map<string, { active: boolean; is_higher_better: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EditableGroup | null>(null);

  function load() {
    setLoading(true);
    fetchAllKpisAdmin()
      .then((kpis) => {
        const groups = buildGroups(kpis);
        setRows(groups);
        setOriginal(new Map(groups.map((r) => [r.key, { active: r.active, is_higher_better: r.is_higher_better }])));
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load KPI catalog')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleToggleVisible(key: string, active: boolean) {
    setMessage(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, active } : r)));
  }

  function handleChangeDirection(key: string, is_higher_better: boolean) {
    setMessage(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, is_higher_better } : r)));
  }

  function isDirty(r: EditableGroup): boolean {
    const o = original.get(r.key);
    return !o || o.active !== r.active || o.is_higher_better !== r.is_higher_better;
  }

  const dirtyRows = rows.filter(isDirty);

  async function handleSave() {
    if (dirtyRows.length === 0) return;
    const changed: KpiAdminUpdate[] = dirtyRows.flatMap((r) =>
      r.ids.map((id) => ({ id, active: r.active, is_higher_better: r.is_higher_better }))
    );
    setSaving(true);
    setError(null);
    try {
      await saveKpiAdminUpdates(changed);
      setOriginal(new Map(rows.map((r) => [r.key, { active: r.active, is_higher_better: r.is_higher_better }])));
      setMessage(`Saved ${dirtyRows.length} change${dirtyRows.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(errorMessage(e, 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  }

  const lagging = rows.filter((r) => !r.is_leading).sort((a, b) => a.name.localeCompare(b.name));
  const leading = rows.filter((r) => r.is_leading).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="page-header-row" style={{ marginBottom: 14 }}>
        <div>
          <h3>KPI Management</h3>
          <p className="muted">
            Every KPI across the Board (lagging) and Next 24 Hours (leading), Day/Night combined into one row.
            "Visible" hides a KPI everywhere without losing its data — a shared setting for the whole board, not a
            per-person view. "Delete" is permanent and erases all of its history.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving || dirtyRows.length === 0} onClick={handleSave}>
          {saving ? 'Saving…' : dirtyRows.length > 0 ? `Save changes (${dirtyRows.length})` : 'Save changes'}
        </button>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading KPI catalog…</div>
      ) : (
        <>
          <KpiManagementTable
            title="Board (Lagging KPIs)"
            rows={lagging}
            onToggleVisible={handleToggleVisible}
            onChangeDirection={handleChangeDirection}
            onDelete={setPendingDelete}
          />
          <KpiManagementTable
            title="Next 24 Hours (Leading KPIs)"
            rows={leading}
            onToggleVisible={handleToggleVisible}
            onChangeDirection={handleChangeDirection}
            onDelete={setPendingDelete}
          />
        </>
      )}

      {pendingDelete && (
        <DeleteKpiModal
          row={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirmed={() => {
            setPendingDelete(null);
            setMessage(`Deleted "${pendingDelete.name}" and all of its data.`);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function Admin() {
  const { employee } = useEmployee();

  async function analyzeDailyUpload(file: File): Promise<DailyUploadPreview> {
    const [pillars, allKpisInitial, buffer] = await Promise.all([fetchPillars(), fetchAllKpisAdmin(), file.arrayBuffer()]);

    // Column-matching must see the FULL catalog — active AND hidden. A KPI
    // an admin has unticked "visible" for is still a known column, not a
    // brand-new one; using an active-only fetch here would make a hidden
    // KPI look "new" again the moment its column reappears in an upload.
    const kpisInitial = allKpisInitial.filter((k) => !k.is_leading);
    const leadingKpisInitial = allKpisInitial.filter((k) => k.is_leading);

    const [addedDaily, removedDaily, addedLeading, removedLeading] = await Promise.all([
      detectNewDailyColumns(buffer, kpisInitial),
      detectRemovedDailyColumns(buffer, kpisInitial),
      detectNewLeadingColumns(buffer, leadingKpisInitial),
      detectRemovedLeadingColumns(buffer, leadingKpisInitial),
    ]);

    return { buffer, pillars, kpisInitial, leadingKpisInitial, addedDaily, removedDaily, addedLeading, removedLeading };
  }

  async function commitDailyUpload(preview: DailyUploadPreview): Promise<UploadResult> {
    const { buffer, pillars, addedDaily, removedDaily, addedLeading, removedLeading } = preview;

    // Hide (never delete) anything the admin just confirmed is gone from
    // the file — same shared active flag KPI Management itself uses.
    const hideUpdates: KpiAdminUpdate[] = [...removedDaily, ...removedLeading].map((r) => ({
      id: r.kpi.id,
      active: false,
      is_higher_better: r.kpi.is_higher_better,
    }));
    if (hideUpdates.length > 0) await saveKpiAdminUpdates(hideUpdates);

    const fallbackPillar = pillars.find((p) => p.code === 'Q') ?? pillars[0];
    const createdNames: string[] = [];
    for (const col of addedDaily) {
      const pillar = pillars.find((p) => p.code === col.categoryGuess) ?? fallbackPillar;
      if (!pillar) continue;
      const created = await createKpi({
        pillar_id: pillar.id,
        name: col.header,
        unit: col.unitGuess,
        is_higher_better: true,
        target: 0,
        is_leading: false,
        sort_order: 999,
      });
      createdNames.push(created.name);
    }
    for (const col of addedLeading) {
      const pillar = pillars.find((p) => p.code === col.categoryGuess) ?? fallbackPillar;
      if (!pillar) continue;
      const created = await createKpi({
        pillar_id: pillar.id,
        name: col.header,
        unit: col.unitGuess,
        is_higher_better: true,
        target: 0,
        is_leading: true,
        sort_order: 999,
      });
      createdNames.push(created.name);
    }

    const catalogChanged = addedDaily.length > 0 || addedLeading.length > 0 || hideUpdates.length > 0;
    const refetchedKpis = catalogChanged ? await fetchAllKpisAdmin() : null;
    const kpis = refetchedKpis ? refetchedKpis.filter((k) => !k.is_leading) : preview.kpisInitial;
    const leadingKpis = refetchedKpis ? refetchedKpis.filter((k) => k.is_leading) : preview.leadingKpisInitial;

    // Target sheet must be parsed first — its per-(kpi, date) values feed
    // the Daily Database parse's own target snapshot.
    const parsedTarget = await parseDailyTargetSheet(buffer, kpis);
    const targetMap = new Map(parsedTarget.targets.map((t) => [`${t.kpi_id}|${t.entry_date}`, t.target]));
    const parsed = await parseDailyWorkbook(buffer, kpis, employee?.id ?? null, targetMap);
    // Leading KPIs (Next 24 Hours board) live in the same workbook, on the
    // "Next 24hrs" tab — parsed and written alongside the lagging KPIs from
    // one upload rather than a separate button.
    const parsedLeading = await parseNext24hrsWorkbook(buffer, leadingKpis, employee?.id ?? null);

    if (parsed.rows.length === 0 && parsedLeading.rows.length === 0 && parsedTarget.targets.length === 0) {
      return {
        ok: false,
        message: `Read ${parsed.rowsRead} daily row(s), ${parsedTarget.rowsRead} target row(s), and ${parsedLeading.rowsRead} Next 24hrs row(s) but found nothing to upload.`,
        warnings: [...parsed.warnings, ...parsedTarget.warnings, ...parsedLeading.warnings],
      };
    }

    // Manual-override protection: split out rows for manual_entry KPIs and
    // check which (kpi_id, date) pairs already carry a person-typed value —
    // those are dropped from this upload rather than overwritten.
    const manualEntryKpiIds = new Set(kpis.filter((k) => k.manual_entry).map((k) => k.id));
    const candidateManualRows = parsed.rows.filter((r) => manualEntryKpiIds.has(r.kpi_id));
    const overrideKeys =
      candidateManualRows.length > 0
        ? await fetchManualOverrideKeys(
            Array.from(new Set(candidateManualRows.map((r) => r.kpi_id))),
            Array.from(new Set(candidateManualRows.map((r) => r.entry_date)))
          )
        : new Set<string>();

    const rowsToWrite = parsed.rows.filter((r) => !overrideKeys.has(`${r.kpi_id}|${r.entry_date}`));
    const skipped = parsed.rows.length - rowsToWrite.length;

    const [written, writtenTargets, writtenLeading] = await Promise.all([
      bulkUpsertDailyEntriesFromUpload(rowsToWrite),
      bulkUpsertKpiDailyTargets(parsedTarget.targets),
      bulkUpsertLeadingEntriesFromUpload(parsedLeading.rows),
    ]);

    const skippedNote = skipped > 0 ? ` ${skipped} row(s) were skipped because a manual entry already exists for that KPI/date.` : '';
    const createdNote =
      createdNames.length > 0
        ? ` Added ${createdNames.length} new KPI(s): ${createdNames.join(', ')} — review pillar/unit/target in KPI Management below.`
        : '';
    const hiddenNote = hideUpdates.length > 0 ? ` Hid ${hideUpdates.length} KPI(s) no longer in this file.` : '';

    return {
      ok: true,
      message: `Uploaded ${written} daily row(s), ${writtenTargets} target row(s), and ${writtenLeading} Next 24hrs figure(s) from ${parsed.rowsRead}/${parsedTarget.rowsRead}/${parsedLeading.rowsRead} spreadsheet rows.${skippedNote}${createdNote}${hiddenNote}`,
      warnings: [...parsed.warnings, ...parsedTarget.warnings, ...parsedLeading.warnings],
    };
  }

  async function handleWeeklyUpload(file: File): Promise<UploadResult> {
    const [kpis, buffer] = await Promise.all([fetchKpisForUpload(), file.arrayBuffer()]);
    const parsed = await parseWeeklyWorkbook(buffer, kpis, employee?.id ?? null);
    if (parsed.rows.length === 0) {
      return { ok: false, message: `Read ${parsed.rowsRead} week row(s) but found nothing to upload.`, warnings: parsed.warnings };
    }
    const written = await bulkUpsertWeeklyEntriesFromUpload(parsed.rows);
    return {
      ok: true,
      message: `Uploaded ${written} weekly figure(s) from ${parsed.rowsRead} spreadsheet row(s).`,
      warnings: parsed.warnings,
    };
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Admin</h1>
        <p className="muted">
          Upload the daily and weekly Excel exports here — they write straight into the board's data, replacing manual
          entry for every KPI except the 3 that stay manual (Accident During Operation, QC Preventive Maintenance &amp;
          Service, Average Litres per Vessel Call). The Daily upload also reads the Target sheet's per-day targets and
          the Next 24hrs sheet's leading-KPI figures in the same pass.
        </p>
      </div>

      <div className="admin-upload-grid">
        <DailyUploadCard onAnalyze={analyzeDailyUpload} onCommit={commitDailyUpload} />
        <UploadCard
          title="Weekly upload"
          description="OPS SQDC Weekly.xlsx — the “Weekly Database” sheet (ISO week rows). Used as a fallback on the Weekly board for weeks with no daily data logged."
          accept=".xlsx"
          onUpload={handleWeeklyUpload}
        />
      </div>

      <KpiManagementSection />
    </div>
  );
}
