import { useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { downloadIcon, uploadIcon } from '@progress/kendo-svg-icons';
import { useDepartment } from '../../context/DepartmentContext';
import { useEmployee } from '../../context/EmployeeContext';
import {
  bulkUpsertDailyEntriesFromUpload,
  bulkUpsertKpiDailyTargets,
  bulkUpsertLeadingEntriesFromUpload,
  fetchAllKpisAdmin,
  fetchManualOverrideKeys,
  fetchPillars,
} from '../../lib/data';
import { buildDepartmentTemplate, parseDepartmentTemplate, type TemplateParseResult } from '../../lib/templateUpload';
import { errorMessage } from '../../types';
import { Button, InfoTip, InlineLoader } from '../../components/ui';
import { handleParetoUpload, UploadCard, type UploadResult } from './shared';

// ===========================================================================
// Uploads for departments using the app-generated template: download a
// workbook built from the department's own KPI list, fill it in, upload it
// back. Read -> preview -> confirm, same as the OPS Daily upload.
// ===========================================================================

function slugFileName(name: string) {
  return name.replace(/[^\w-]+/g, '_').replace(/_+/g, '_');
}

function TemplateDownloadCard() {
  const department = useDepartment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const [pillars, kpis] = await Promise.all([fetchPillars(), fetchAllKpisAdmin(department.id)]);
      if (!kpis.some((k) => k.active && !k.is_secondary)) {
        setError('Add KPIs in the KPIs tab first — the template gets one column per KPI.');
        return;
      }
      const blob = await buildDepartmentTemplate(department, pillars, kpis);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugFileName(department.name)}_SQDC_${format(new Date(), 'yyyy-MM')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e, 'Failed to build the template'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card admin-upload-card">
      <h3>
        1. Download template{' '}
        <InfoTip>
          An Excel file with a column for each of {department.name}'s visible KPIs and a row for every day this month
          {' '}— Daily (actual values), Targets (only where a day's target differs from the standard one) and Next 24hrs (projections).
          Download a fresh copy whenever KPIs are added or renamed.
        </InfoTip>
      </h3>
      <Button type="button" svgIcon={downloadIcon} onClick={download} disabled={busy}>
        {busy ? 'Building…' : 'Download template'}
      </Button>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}

interface Preview {
  parsed: TemplateParseResult;
  skipKeys: Set<string>;
}

function TemplateUploadCard() {
  const department = useDepartment();
  const { employee } = useEmployee();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'preview' | 'uploading'>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setPhase('reading');
    setResult(null);
    setError(null);
    try {
      const [kpis, buffer] = await Promise.all([fetchAllKpisAdmin(department.id), file.arrayBuffer()]);
      const parsed = await parseDepartmentTemplate(buffer, kpis, employee?.id ?? null);
      // A value someone typed in the app is never overwritten by an upload.
      const skipKeys =
        parsed.daily.length > 0
          ? await fetchManualOverrideKeys(Array.from(new Set(parsed.daily.map((r) => r.kpi_id))), parsed.dates)
          : new Set<string>();
      setPreview({ parsed, skipKeys });
      setPhase('preview');
    } catch (e) {
      setError(errorMessage(e, 'Failed to read file'));
      setPhase('idle');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function confirm() {
    if (!preview) return;
    setPhase('uploading');
    const { parsed, skipKeys } = preview;
    try {
      const daily = parsed.daily.filter((r) => !skipKeys.has(`${r.kpi_id}|${r.entry_date}`));
      const [written, writtenTargets, writtenLeading] = await Promise.all([
        bulkUpsertDailyEntriesFromUpload(daily),
        bulkUpsertKpiDailyTargets(parsed.targets),
        bulkUpsertLeadingEntriesFromUpload(parsed.leading),
      ]);
      const skipped = parsed.daily.length - daily.length;
      setResult({
        ok: true,
        message:
          `Uploaded ${written} value(s), ${writtenTargets} target(s) and ${writtenLeading} Next 24hrs figure(s).` +
          (skipped > 0 ? ` ${skipped} value(s) were kept as typed in the app.` : ''),
        warnings: parsed.warnings,
      });
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e, 'Upload failed'), warnings: [] });
    } finally {
      setPhase('idle');
      setPreview(null);
    }
  }

  const p = preview?.parsed;
  const nothing = p && p.daily.length === 0 && p.targets.length === 0 && p.leading.length === 0;
  const fmt = (d: string) => format(parseISO(d), 'd MMM yyyy');

  return (
    <div className="card admin-upload-card">
      <h3>
        2. Upload filled-in template{' '}
        <InfoTip>
          Re-uploading only updates the dates in the file; other days are untouched. Empty cells are skipped. You'll see what's in the file
          before anything is saved.
        </InfoTip>
      </h3>
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
        <Button type="button" themeColor="primary" svgIcon={uploadIcon} onClick={() => inputRef.current?.click()}>
          {result ? 'Choose another file' : 'Choose file'}
        </Button>
      )}
      {fileName && phase !== 'idle' && <div className="admin-filename muted">{fileName}</div>}
      {phase === 'reading' && <InlineLoader label="Reading file…" />}
      {phase === 'preview' && p && (
        <>
          <div className={`alert ${nothing ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: 0 }}>
            {nothing ? (
              'Nothing to upload — no values were found under any of this department’s KPI columns.'
            ) : (
              <>
                <strong>Ready to upload:</strong>
                <ul className="upload-preview-list">
                  <li>
                    {p.daily.length} daily value(s)
                    {p.dates.length > 0 && ` across ${p.dates.length} day(s), ${fmt(p.dates[0])} – ${fmt(p.dates[p.dates.length - 1])}`}
                  </li>
                  {preview!.skipKeys.size > 0 && <li>{preview!.skipKeys.size} of them will be skipped — already typed in the app</li>}
                  <li>{p.targets.length} day-specific target(s)</li>
                  <li>{p.leading.length} Next 24hrs figure(s)</li>
                </ul>
              </>
            )}
          </div>
          {p.unknownColumns.length > 0 && (
            <div className="alert alert-warning" style={{ marginTop: 10, marginBottom: 0 }}>
              These columns don't match any KPI in {department.name} and will be ignored: {p.unknownColumns.join(', ')}. Add them in the KPIs tab
              first, or download a fresh template.
            </div>
          )}
          {p.warnings.map((w, i) => (
            <div key={i} className="alert alert-warning" style={{ marginTop: 10, marginBottom: 0 }}>
              {w}
            </div>
          ))}
          <div className="modal-actions">
            <Button type="button" onClick={() => setPhase('idle')}>
              Cancel
            </Button>
            <Button type="button" themeColor="primary" onClick={confirm} disabled={Boolean(nothing)}>
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
          <summary>
            {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
          </summary>
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

export default function TemplateUploads() {
  const department = useDepartment();
  const { employee } = useEmployee();
  return (
    <div className="admin-upload-grid">
      <TemplateDownloadCard />
      <TemplateUploadCard />
      <UploadCard
        title="Pareto categories upload (optional)"
        description="A workbook with one sheet per KPI (named after it) listing date, shift and category 1…N columns. Tags each listed day/shift with its categories for the Weekly view's Pareto. Only adds — re-uploading never removes tags added in the app."
        accept=".xlsx"
        onUpload={(file) => handleParetoUpload(file, department.id, employee?.id ?? null)}
      />
    </div>
  );
}
