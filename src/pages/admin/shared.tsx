import { useRef, useState } from 'react';
import { fetchAllKpisAdmin } from '../../lib/data';
import { bulkAddEntryCategories, bulkAddKpiCategories, fetchEntriesLite, fetchKpiCategories, fillEmptyRemarks } from '../../lib/categories';
import { labelCanonicalizer } from '../../lib/categoryCore';
import { familyOf, matchRows, parseParetoWorkbook } from '../../lib/categoryImport';
import { baseNameOf, errorMessage } from '../../types';
import { Button, InfoTip } from '../../components/ui';

export interface UploadResult {
  ok: boolean;
  message: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Single-step upload card (choose a file -> it's processed straight away) —
// used where there's no catalog diff worth previewing first: the OPS Weekly
// workbook and the Pareto-categories workbook.
// ---------------------------------------------------------------------------

export function UploadCard({
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
      <h3>{title} <InfoTip>{description}</InfoTip></h3>
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
      <Button type="button" themeColor="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : fileName ? `Upload another file` : 'Choose file & upload'}
      </Button>
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

/** Pareto-categories workbook (weekly_paretto.xlsx): reads each KPI's
 * remarks-log sheet and attaches its category tags to the matching daily
 * entries (KPI + date + shift). Additive only — see lib/categories.ts. */
export async function handleParetoUpload(file: File, departmentId: string, employeeId: string | null): Promise<UploadResult> {
  const [allKpis, buffer] = await Promise.all([fetchAllKpisAdmin(departmentId), file.arrayBuffer()]);
  const lagging = allKpis.filter((k) => !k.is_leading);
  const baseNames = Array.from(new Set(lagging.filter((k) => !k.is_secondary).map((k) => baseNameOf(k.name))));
  const sheets = await parseParetoWorkbook(buffer, baseNames);
  if (sheets.length === 0) {
    return { ok: false, message: 'No remarks sheets found — expected sheets with date, shift and "category 1…" columns.', warnings: [] };
  }

  const warnings: string[] = [];
  const listRows: { department_id: string; pillar_id: string; kpi_base_name: string; dimension: string; label: string; sort_order: number }[] = [];
  const tagRows: { entry_id: string; dimension: string; category: string; created_by: string | null }[] = [];
  const remarkFills: { id: string; remarks: string }[] = [];
  const summary: string[] = [];

  for (const sheet of sheets) {
    if (!sheet.kpiBase) {
      warnings.push(`Sheet "${sheet.sheet}": couldn't match it to a KPI by name — skipped.`);
      continue;
    }
    const family = familyOf(lagging, sheet.kpiBase);
    const primary = family.find((k) => !k.is_secondary);
    const tagged = sheet.rows.filter((r) => r.tags.length > 0);
    if (!primary || tagged.length === 0) continue;

    // Use the KPI's existing spelling of each category (ignoring case), so a
    // sheet that writes "QC breakdown" doesn't start a second "QC Breakdown" bar.
    const canonical = labelCanonicalizer(await fetchKpiCategories(departmentId, primary.pillar_id, sheet.kpiBase));
    for (const r of tagged) {
      const mapped = r.tags.map((t) => ({ ...t, category: canonical(t.dimension, t.category) }));
      r.tags = mapped.filter((t, i) => mapped.findIndex((o) => o.dimension === t.dimension && o.category === t.category) === i);
    }

    // Pick-list: every category seen on this sheet, in first-seen order.
    const seen = new Set<string>();
    for (const r of tagged) {
      for (const t of r.tags) {
        const key = `${t.dimension}\u0000${t.category}`;
        if (seen.has(key)) continue;
        seen.add(key);
        listRows.push({ department_id: departmentId, pillar_id: primary.pillar_id, kpi_base_name: sheet.kpiBase, dimension: t.dimension, label: t.category, sort_order: seen.size });
      }
    }

    const dates = tagged.map((r) => r.date).sort();
    const entries = await fetchEntriesLite(family.map((k) => k.id), dates[0], dates[dates.length - 1]);
    const { matches, unmatched } = matchRows(sheet.rows, family, entries);
    const entryById = new Map(entries.map((e) => [e.id, e]));
    let tagCount = 0;
    for (const m of matches) {
      // Old-calculation shifts are never counted in any Pareto — don't store tags on them.
      if (m.secondary) continue;
      for (const t of m.row.tags) {
        tagRows.push({ entry_id: m.entryId, dimension: t.dimension, category: t.category, created_by: employeeId });
        tagCount++;
      }
      const entry = entryById.get(m.entryId);
      const text = m.row.remarks || m.row.reason;
      if (!m.secondary && entry && entry.remarks === null && text) remarkFills.push({ id: m.entryId, remarks: text });
    }
    for (const r of unmatched) {
      warnings.push(`${sheet.kpiBase}: ${r.date} ${r.shift ?? ''} (sheet row ${r.rowNumber}) has no matching entry in the app yet — upload that day's Daily file first, then re-import.`);
    }
    const secondary = matches.filter((m) => m.secondary).length;
    summary.push(
      `${sheet.kpiBase}: ${matches.length} shift(s), ${tagCount} tag(s)` +
        (secondary ? ` (${secondary} on the old calculation, skipped)` : '') +
        (unmatched.length ? `, ${unmatched.length} unmatched` : '')
    );
  }

  await bulkAddKpiCategories(listRows);
  await bulkAddEntryCategories(tagRows);
  const filled = await fillEmptyRemarks(remarkFills);

  return {
    ok: tagRows.length > 0,
    message:
      `Imported ${tagRows.length} category tag(s) across ${summary.length} KPI(s). ${summary.join(' · ')}.` +
      (filled ? ` Also filled ${filled} empty remark(s) from the sheet.` : '') +
      ' Re-importing is safe — existing tags are kept, nothing is deleted.',
    warnings,
  };
}
