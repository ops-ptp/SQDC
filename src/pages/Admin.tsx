import { useRef, useState } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import { bulkUpsertDailyEntriesFromUpload, bulkUpsertWeeklyEntriesFromUpload, fetchKpisForUpload, fetchManualOverrideKeys } from '../lib/data';
import { parseDailyWorkbook, parseWeeklyWorkbook } from '../lib/excelUpload';

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
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Upload failed', warnings: [] });
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

export default function Admin() {
  const { employee } = useEmployee();

  async function handleDailyUpload(file: File): Promise<UploadResult> {
    const [kpis, buffer] = await Promise.all([fetchKpisForUpload(), file.arrayBuffer()]);
    const parsed = await parseDailyWorkbook(buffer, kpis, employee?.id ?? null);
    if (parsed.rows.length === 0) {
      return { ok: false, message: `Read ${parsed.rowsRead} row(s) but found nothing to upload.`, warnings: parsed.warnings };
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

    const written = await bulkUpsertDailyEntriesFromUpload(rowsToWrite);
    const skippedNote = skipped > 0 ? ` ${skipped} row(s) were skipped because a manual entry already exists for that KPI/date.` : '';
    return {
      ok: true,
      message: `Uploaded ${written} daily row(s) from ${parsed.rowsRead} spreadsheet row(s).${skippedNote}`,
      warnings: parsed.warnings,
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
          Service, Average Litres per Vessel Call).
        </p>
      </div>

      <div className="admin-upload-grid">
        <UploadCard
          title="Daily upload"
          description="OPS SQDC Daily.xlsx — the “Daily Database” sheet (Date + Day/Night shift rows). Re-uploading updates matching date/shift rows only; other dates are untouched."
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
    </div>
  );
}
