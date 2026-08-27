import { useEffect, useRef, useState } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import {
  bulkUpsertDailyEntriesFromUpload,
  bulkUpsertKpiDailyTargets,
  bulkUpsertLeadingEntriesFromUpload,
  bulkUpsertWeeklyEntriesFromUpload,
  createKpi,
  fetchAllKpisAdmin,
  fetchKpisForUpload,
  fetchLeadingKpis,
  fetchManualOverrideKeys,
  fetchPillars,
  saveKpiAdminUpdates,
  type KpiAdminUpdate,
} from '../lib/data';
import {
  detectNewDailyColumns,
  detectNewLeadingColumns,
  parseDailyTargetSheet,
  parseDailyWorkbook,
  parseNext24hrsWorkbook,
  parseWeeklyWorkbook,
} from '../lib/excelUpload';
import { errorMessage, type KpiWithPillar, type Pillar } from '../types';

interface UploadResult {
  ok: boolean;
  message: string;
  warnings: string[];
}

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
// KPI Management — one combined list of every Board (lagging) + Next 24
// Hours (leading) KPI. Admin can show/hide (kpis.active — one global state,
// not per-admin views) and edit the basic best-guess fields an auto-created
// KPI needs filling in (pillar, unit, direction, target). Edits are staged
// locally and committed together via "Save changes".
// ---------------------------------------------------------------------------

interface EditableKpi {
  id: string;
  name: string;
  is_leading: boolean;
  is_secondary: boolean;
  pillar_id: string;
  unit: string;
  is_higher_better: boolean;
  target: number;
  active: boolean;
}

function toEditable(k: KpiWithPillar): EditableKpi {
  return {
    id: k.id,
    name: k.name,
    is_leading: k.is_leading,
    is_secondary: k.is_secondary,
    pillar_id: k.pillar_id,
    unit: k.unit,
    is_higher_better: k.is_higher_better,
    target: k.target,
    active: k.active,
  };
}

function KpiManagementTable({
  title,
  rows,
  pillars,
  onChange,
}: {
  title: string;
  rows: EditableKpi[];
  pillars: Pillar[];
  onChange: (id: string, patch: Partial<EditableKpi>) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="quadrant-section" style={{ marginBottom: 20 }}>
      <div className="quadrant-block-title" style={{ padding: '0 0 8px' }}>
        {title}
      </div>
      <div className="table-scroll">
        <table className="action-table admin-kpi-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pillar</th>
              <th>Unit</th>
              <th>Direction</th>
              <th>Target</th>
              <th>Visible</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.is_secondary && <span className="pill pill-bad admin-kpi-secondary-tag">secondary</span>}
                </td>
                <td>
                  <select className="input admin-kpi-input" value={r.pillar_id} onChange={(e) => onChange(r.id, { pillar_id: e.target.value })}>
                    {pillars.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input admin-kpi-input admin-kpi-input-sm"
                    value={r.unit}
                    onChange={(e) => onChange(r.id, { unit: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="input admin-kpi-input"
                    value={r.is_higher_better ? 'higher' : 'lower'}
                    onChange={(e) => onChange(r.id, { is_higher_better: e.target.value === 'higher' })}
                  >
                    <option value="higher">Higher is good</option>
                    <option value="lower">Lower is good</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="any"
                    className="input admin-kpi-input admin-kpi-input-sm"
                    value={r.target}
                    onChange={(e) => onChange(r.id, { target: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={r.active} onChange={(e) => onChange(r.id, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiManagementSection() {
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [rows, setRows] = useState<EditableKpi[]>([]);
  const [original, setOriginal] = useState<Map<string, EditableKpi>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPillars(), fetchAllKpisAdmin()])
      .then(([p, kpis]) => {
        setPillars(p);
        const editable = kpis.map(toEditable);
        setRows(editable);
        setOriginal(new Map(editable.map((r) => [r.id, r])));
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load KPI catalog')))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(id: string, patch: Partial<EditableKpi>) {
    setMessage(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function isDirty(r: EditableKpi): boolean {
    const o = original.get(r.id);
    if (!o) return true;
    return o.pillar_id !== r.pillar_id || o.unit !== r.unit || o.is_higher_better !== r.is_higher_better || o.target !== r.target || o.active !== r.active;
  }

  const dirtyCount = rows.filter(isDirty).length;

  async function handleSave() {
    const changed: KpiAdminUpdate[] = rows
      .filter(isDirty)
      .map((r) => ({ id: r.id, pillar_id: r.pillar_id, unit: r.unit, is_higher_better: r.is_higher_better, target: r.target, active: r.active }));
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveKpiAdminUpdates(changed);
      setOriginal(new Map(rows.map((r) => [r.id, r])));
      setMessage(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'}.`);
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
            Every KPI across the Board (lagging) and Next 24 Hours (leading), in one list. Untick "Visible" to hide a
            KPI everywhere — this is one shared setting for the whole board, not a per-person view. A newly detected
            spreadsheet column shows up here automatically after an upload; fill in its pillar/unit/target/direction
            before relying on it.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving || dirtyCount === 0} onClick={handleSave}>
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save changes (${dirtyCount})` : 'Save changes'}
        </button>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading KPI catalog…</div>
      ) : (
        <>
          <KpiManagementTable title="Board (Lagging KPIs)" rows={lagging} pillars={pillars} onChange={handleChange} />
          <KpiManagementTable title="Next 24 Hours (Leading KPIs)" rows={leading} pillars={pillars} onChange={handleChange} />
        </>
      )}
    </div>
  );
}

export default function Admin() {
  const { employee } = useEmployee();

  async function handleDailyUpload(file: File): Promise<UploadResult> {
    const [pillars, kpisInitial, leadingKpisInitial, buffer] = await Promise.all([
      fetchPillars(),
      fetchKpisForUpload(),
      fetchLeadingKpis(),
      file.arrayBuffer(),
    ]);

    // Detect + auto-create any brand-new spreadsheet columns before parsing
    // the rest of the workbook, so this same upload picks them up rather
    // than needing a second pass once the admin notices them.
    const [newDailyCols, newLeadingCols] = await Promise.all([
      detectNewDailyColumns(buffer),
      detectNewLeadingColumns(buffer, leadingKpisInitial),
    ]);
    const fallbackPillar = pillars.find((p) => p.code === 'Q') ?? pillars[0];
    const createdNames: string[] = [];
    for (const col of newDailyCols) {
      const pillar = pillars.find((p) => p.code === col.categoryGuess) ?? fallbackPillar;
      if (!pillar) continue;
      const created = await createKpi({ pillar_id: pillar.id, name: col.header, unit: '', is_higher_better: true, target: 0, is_leading: false, sort_order: 999 });
      createdNames.push(created.name);
    }
    for (const col of newLeadingCols) {
      const pillar = pillars.find((p) => p.code === col.categoryGuess) ?? fallbackPillar;
      if (!pillar) continue;
      const created = await createKpi({ pillar_id: pillar.id, name: col.header, unit: '', is_higher_better: true, target: 0, is_leading: true, sort_order: 999 });
      createdNames.push(created.name);
    }

    const kpis = newDailyCols.length > 0 ? await fetchKpisForUpload() : kpisInitial;
    const leadingKpis = newLeadingCols.length > 0 ? await fetchLeadingKpis() : leadingKpisInitial;

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
        ? ` Auto-added ${createdNames.length} new KPI(s) to the catalog: ${createdNames.join(', ')} — review pillar/unit/target in KPI Management below.`
        : '';

    return {
      ok: true,
      message: `Uploaded ${written} daily row(s), ${writtenTargets} target row(s), and ${writtenLeading} Next 24hrs figure(s) from ${parsed.rowsRead}/${parsedTarget.rowsRead}/${parsedLeading.rowsRead} spreadsheet rows.${skippedNote}${createdNote}`,
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
        <UploadCard
          title="Daily upload"
          description="OPS SQDC Daily.xlsx — “Daily Database” (Date + Day/Night shift rows), “Target” (per-day/shift targets — a KPI's target can now change over time), and “Next 24hrs” (leading KPI projections). Re-uploading updates matching date rows only; other dates are untouched."
          accept=".xlsx"
          onUpload={handleDailyUpload}
        />
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
