import { useRef, useState } from 'react';
import { useEmployee } from '../../context/EmployeeContext';
import { useDepartment } from '../../context/DepartmentContext';
import {
  bulkUpsertDailyEntriesFromUpload,
  bulkUpsertKpiDailyTargets,
  bulkUpsertLeadingEntriesFromUpload,
  bulkUpsertWeeklyEntriesFromUpload,
  createKpi,
  fetchAllKpisAdmin,
  fetchKpisForUpload,
  fetchManualOverrideKeys,
  fetchPillars,
  saveKpiAdminUpdates,
  type KpiAdminUpdate,
} from '../../lib/data';
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
} from '../../lib/excelUpload';
import { errorMessage, type Kpi, type Pillar } from '../../types';
import { Button, InlineLoader, InfoTip } from '../../components/ui';
import { handleParetoUpload, UploadCard, type UploadResult } from './shared';

// ===========================================================================
// Uploads for the ORIGINAL Operations workbooks (OPS SQDC Daily.xlsx /
// OPS SQDC Weekly.xlsx / weekly_paretto.xlsx) — departments whose upload
// format is "ops". Every other department uses the generated template
// (TemplateUploads.tsx).
// ===========================================================================

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
              <li key={`ad-${c.header}`}>
                {c.header}
                {c.bothShifts ? ' — Day & Night (2 KPIs)' : ' — single value'}
              </li>
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
      <h3>Daily upload <InfoTip>OPS SQDC Daily.xlsx — "Daily Database" (Date + Day/Night shift rows), "Target" (per-day/shift targets — a
        KPI's target can now change over time), and "Next 24hrs" (leading KPI projections). Re-uploading updates
        matching date rows only; other dates are untouched. The file is read first — you'll see exactly what KPI
        catalog changes it would make before anything is written.</InfoTip></h3>
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
        <Button type="button" themeColor="primary" onClick={() => inputRef.current?.click()}>
          {result ? 'Choose another file' : 'Choose file'}
        </Button>
      )}
      {fileName && phase !== 'idle' && <div className="admin-filename muted">{fileName}</div>}
      {phase === 'analyzing' && <InlineLoader label="Reading file…" />}
      {phase === 'preview' && preview && (
        <>
          <ColumnChangeSummary preview={preview} />
          <div className="modal-actions">
            <Button type="button" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="button" themeColor="primary" onClick={handleConfirm}>
              Confirm &amp; upload
            </Button>
          </div>
        </>
      )}
      {phase === 'uploading' && <InlineLoader label="Uploading…" />}
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


export default function OpsUploads({ onCatalogChanged }: { onCatalogChanged: () => void }) {
  const { employee } = useEmployee();
  const department = useDepartment();

  async function analyzeDailyUpload(file: File): Promise<DailyUploadPreview> {
    const [pillars, allKpisInitial, buffer] = await Promise.all([fetchPillars(), fetchAllKpisAdmin(department.id), file.arrayBuffer()]);

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
      if (col.bothShifts) {
        // The sheet has real, distinct values under both shift rows for
        // this column — needs two catalog rows (same shape every existing
        // split KPI already uses), or the write path's own "one value per
        // date" dedup for unsplit KPIs would silently keep only whichever
        // shift is written first each day and drop the other.
        const day = await createKpi({
          department_id: department.id,
          pillar_id: pillar.id,
          name: `${col.header} (Day)`,
          unit: col.unitGuess,
          is_higher_better: true,
          target: 0,
          is_leading: false,
          sort_order: 999,
        });
        const night = await createKpi({
          department_id: department.id,
          pillar_id: pillar.id,
          name: `${col.header} (Night)`,
          unit: col.unitGuess,
          is_higher_better: true,
          target: 0,
          is_leading: false,
          sort_order: 999,
        });
        createdNames.push(day.name, night.name);
      } else {
        const created = await createKpi({
          department_id: department.id,
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
    }
    for (const col of addedLeading) {
      const pillar = pillars.find((p) => p.code === col.categoryGuess) ?? fallbackPillar;
      if (!pillar) continue;
      const created = await createKpi({
        department_id: department.id,
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
    if (catalogChanged) onCatalogChanged();
    const refetchedKpis = catalogChanged ? await fetchAllKpisAdmin(department.id) : null;
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
        ? ` Added ${createdNames.length} new KPI(s): ${createdNames.join(', ')} — review pillar/unit/target in the KPIs tab.`
        : '';
    const hiddenNote = hideUpdates.length > 0 ? ` Hid ${hideUpdates.length} KPI(s) no longer in this file.` : '';

    return {
      ok: true,
      message: `Uploaded ${written} daily row(s), ${writtenTargets} target row(s), and ${writtenLeading} Next 24hrs figure(s) from ${parsed.rowsRead}/${parsedTarget.rowsRead}/${parsedLeading.rowsRead} spreadsheet rows.${skippedNote}${createdNote}${hiddenNote}`,
      warnings: [...parsed.warnings, ...parsedTarget.warnings, ...parsedLeading.warnings],
    };
  }

  async function handleWeeklyUpload(file: File): Promise<UploadResult> {
    const [kpis, buffer] = await Promise.all([fetchKpisForUpload(department.id), file.arrayBuffer()]);
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
    <div className="admin-upload-grid">
      <DailyUploadCard onAnalyze={analyzeDailyUpload} onCommit={commitDailyUpload} />
      <UploadCard
        title="Weekly upload"
        description="OPS SQDC Weekly.xlsx — the “Weekly Database” sheet (ISO week rows, can span multiple years). This is the authoritative source for the Board's Weekly view — the KPIs ticked “Weekly view” in the KPIs tab show their headline and trend from this upload, not from daily figures."
        accept=".xlsx"
        onUpload={handleWeeklyUpload}
      />
      <UploadCard
        title="Pareto categories upload"
        description="weekly_paretto.xlsx — each KPI's remarks sheet (date, shift, actual, …, category 1–N). Tags every listed shift with its categories so the Weekly view's Pareto can count them, and seeds each KPI's category pick-list. Accident's Location / Equipment / Symptom columns become three separate Paretos. Only adds — re-uploading never removes tags added in the app."
        accept=".xlsx"
        onUpload={(file) => handleParetoUpload(file, department.id, employee?.id ?? null)}
      />
    </div>
  );
}
