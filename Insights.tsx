import { useEffect, useMemo, useRef, useState } from 'react';
import { format, subDays, getISOWeek } from 'date-fns';
import {
  bulkUpdateAiCategories,
  fetchCategorizedEntries,
  fetchMissedEntriesForExport,
  type CategorizedEntryRow,
} from '../lib/data';
import { buildExportCsv, parseCategoryCsv } from '../lib/csv';
import { errorMessage } from '../types';
import ParetoChart, { type ParetoDatum } from '../components/ParetoChart';

const DEFAULT_PROMPT = `I've attached a CSV of missed-target operational remarks from an SQDC performance board.

For EACH row, read the "remarks" and "reason" columns and assign it to ONE category based on: [pick your angle here — e.g. "which piece of equipment was involved", "root cause type", "which shift-related factor" — edit this line before you paste the prompt].

Suggested starting categories: Equipment, Staffing, Process/Planning, External (weather, customs, etc.), Other — but use your judgement; merge, split, or rename categories if the data clearly suggests better ones.

Add your answer as a new column called "category" containing ONLY the category name — no explanation, no extra text.

Keep every existing column and row exactly as they are, in the same order. Do NOT modify the "id" column. Return the completed file as a CSV I can download.`;

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Export section
// ---------------------------------------------------------------------------

function ExportSection() {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [busy, setBusy] = useState(false);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const rows = await fetchMissedEntriesForExport(fromDate, toDate);
      setRowCount(rows.length);
      if (rows.length === 0) return;
      const csv = buildExportCsv(rows);
      downloadTextFile(`sqdc-remarks-${fromDate}-to-${toDate}.csv`, csv);
    } catch (e) {
      setError(errorMessage(e, 'Failed to export'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card">
      <h3>1. Export for categorization</h3>
      <p className="muted">
        Downloads every missed-target entry in the date range below — date, pillar, KPI, the existing reason, and the
        remark someone typed in — as a CSV with an empty "category" column. Nothing here uses AI or leaves this app;
        you take the file to whatever AI tool you already have and paste in the prompt below alongside it.
      </p>
      <div className="insights-date-row">
        <label>
          From
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleDownload}>
          {busy ? 'Preparing…' : 'Download CSV'}
        </button>
      </div>
      {rowCount === 0 && <div className="alert alert-info">No missed-target entries in that range — nothing to export.</div>}
      {rowCount !== null && rowCount > 0 && <div className="alert alert-success">Downloaded {rowCount} row(s).</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="insights-prompt-block">
        <div className="insights-prompt-header">
          <span className="quadrant-block-title" style={{ padding: 0 }}>
            Prompt to paste alongside the file
          </span>
          <button type="button" className="btn btn-ghost-light" onClick={handleCopyPrompt}>
            {copied ? 'Copied ✓' : 'Copy prompt'}
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 6 }}>
          Edit the bracketed part to change the angle each cycle — equipment this time, root cause next time, whatever
          you want to slice by.
        </p>
        <textarea className="insights-prompt-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={9} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-import section
// ---------------------------------------------------------------------------

function ImportSection({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setWarnings([]);
    try {
      const text = await file.text();
      const { rows, warnings: parseWarnings } = parseCategoryCsv(text);
      setWarnings(parseWarnings);
      if (rows.length === 0) {
        setResult({ ok: false, message: 'No categorized rows found in this file.' });
        return;
      }
      const written = await bulkUpdateAiCategories(rows);
      setResult({ ok: true, message: `Saved categories for ${written} entr${written === 1 ? 'y' : 'ies'}.` });
      onImported();
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e, 'Failed to import') });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="card">
      <h3>2. Re-import the categorized file</h3>
      <p className="muted">
        Upload the CSV back once your AI tool has added the "category" column — this only ever writes that one column
        back onto the entries it came from, matched by the hidden id column. Nothing else about those entries changes.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="admin-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : 'Choose categorized CSV'}
      </button>
      {result && <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`} style={{ marginTop: 10 }}>{result.message}</div>}
      {warnings.length > 0 && (
        <details className="admin-warnings">
          <summary>{warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pivot / chart section
// ---------------------------------------------------------------------------

type Dimension = 'category' | 'pillar' | 'week' | 'kpi';

const DIMENSION_LABEL: Record<Dimension, string> = {
  category: 'Category',
  pillar: 'Pillar',
  week: 'Week',
  kpi: 'KPI',
};

function dimensionValue(e: CategorizedEntryRow, dim: Dimension): string {
  switch (dim) {
    case 'category':
      return e.category;
    case 'pillar':
      return e.pillar_name;
    case 'week':
      return `Wk ${getISOWeek(new Date(e.entry_date))}`;
    case 'kpi':
      return e.kpi_name;
  }
}

function PivotSection({ refreshKey }: { refreshKey: number }) {
  const [fromDate, setFromDate] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rowDim, setRowDim] = useState<Dimension>('category');
  const [colDim, setColDim] = useState<Dimension | 'none'>('none');
  const [entries, setEntries] = useState<CategorizedEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCategorizedEntries(fromDate, toDate)
      .then(setEntries)
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, refreshKey]);

  const chartData: ParetoDatum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const label = dimensionValue(e, rowDim);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [entries, rowDim]);

  const crossTab = useMemo(() => {
    if (colDim === 'none') return null;
    const rowLabels = new Set<string>();
    const colLabels = new Set<string>();
    const grid = new Map<string, number>();
    for (const e of entries) {
      const r = dimensionValue(e, rowDim);
      const c = dimensionValue(e, colDim);
      rowLabels.add(r);
      colLabels.add(c);
      const key = `${r}\u0000${c}`;
      grid.set(key, (grid.get(key) ?? 0) + 1);
    }
    return { rows: Array.from(rowLabels).sort(), cols: Array.from(colLabels).sort(), grid };
  }, [entries, rowDim, colDim]);

  return (
    <div className="card">
      <h3>3. Pivot view</h3>
      <p className="muted">
        Every entry that's been categorized so far (from any past export/re-import cycle), sliced however you pick
        below — same idea as a pivot table.
      </p>
      <div className="insights-date-row">
        <label>
          From
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          Rows
          <select className="input" value={rowDim} onChange={(e) => setRowDim(e.target.value as Dimension)}>
            {(Object.keys(DIMENSION_LABEL) as Dimension[]).map((d) => (
              <option key={d} value={d}>
                {DIMENSION_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Columns
          <select className="input" value={colDim} onChange={(e) => setColDim(e.target.value as Dimension | 'none')}>
            <option value="none">None (chart only)</option>
            {(Object.keys(DIMENSION_LABEL) as Dimension[])
              .filter((d) => d !== rowDim)
              .map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABEL[d]}
                </option>
              ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No categorized entries in this range yet — export, categorize, and re-import above first.</div>
      ) : crossTab ? (
        <div className="table-scroll">
          <table className="action-table">
            <thead>
              <tr>
                <th>{DIMENSION_LABEL[rowDim]}</th>
                {crossTab.cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {crossTab.rows.map((r) => {
                const rowTotal = crossTab.cols.reduce((sum, c) => sum + (crossTab.grid.get(`${r}\u0000${c}`) ?? 0), 0);
                return (
                  <tr key={r}>
                    <td>{r}</td>
                    {crossTab.cols.map((c) => (
                      <td key={c}>{crossTab.grid.get(`${r}\u0000${c}`) ?? 0}</td>
                    ))}
                    <td>
                      <strong>{rowTotal}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ParetoChart data={chartData} />
      )}
    </div>
  );
}

export default function Insights() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Insights</h1>
        <p className="muted">
          A way to slice missed-target remarks by any angle you want — equipment, root cause, whatever — without any
          AI plugged into this app itself. Export, run it through whichever AI tool you already have, re-import, and
          view the breakdown.
        </p>
      </div>
      <div className="insights-stack">
        <ExportSection />
        <ImportSection onImported={() => setRefreshKey((k) => k + 1)} />
        <PivotSection refreshKey={refreshKey} />
      </div>
    </div>
  );
}
