import { useEffect, useMemo, useRef, useState } from 'react';
import { format, getISOWeek, subDays } from 'date-fns';
import {
  bulkUpdateAiCategories,
  fetchCategorizedEntriesForKpiIds,
  fetchKpis,
  fetchMissedEntriesForKpiIds,
  fetchPillars,
  type CategorizedEntryRow,
  type RawEntryRow,
} from '../lib/data';
import { buildExportCsv, parseCategoryCsv } from '../lib/csv';
import { baseNameOf, errorMessage, PILLAR_COLORS, round2, type Kpi, type Pillar } from '../types';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import ParetoChart, { type ParetoDatum } from '../components/ParetoChart';
import PivotFieldPanel, { type PivotZone } from '../components/PivotFieldPanel';

const LOOKBACK_DAYS = 180;

const DEFAULT_PROMPT = `I've attached a CSV of missed-target operational remarks from an SQDC performance board, all for one KPI.

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

interface KpiGroupOption {
  key: string;
  label: string;
  ids: string[];
}

function groupKpisByBase(kpis: Kpi[]): KpiGroupOption[] {
  const map = new Map<string, string[]>();
  for (const k of kpis) {
    const base = baseNameOf(k.name);
    const arr = map.get(base) ?? [];
    arr.push(k.id);
    map.set(base, arr);
  }
  return Array.from(map.entries())
    .map(([base, ids]) => ({ key: base, label: base, ids }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Pillar + KPI pickers — cascading pill rows, matching the board's own
// pillar/KPI pill styling so this page feels like part of the same app.
// ---------------------------------------------------------------------------

function PillarPicker({ pillars, selectedId, onSelect }: { pillars: Pillar[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="kpi-pills" style={{ padding: '0 0 4px' }}>
      {pillars.map((p) => {
        const colors = PILLAR_COLORS[p.code] ?? PILLAR_COLORS.Q;
        const isSelected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            className="kpi-pill"
            style={isSelected ? { background: colors.base, borderColor: colors.base, color: 'white' } : { background: 'white', borderColor: colors.base, color: colors.base }}
            onClick={() => onSelect(p.id)}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

function KpiPicker({ groups, selectedKey, onSelect }: { groups: KpiGroupOption[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  if (groups.length === 0) {
    return <div className="empty-state">No KPIs in this pillar.</div>;
  }
  return (
    <div className="kpi-pills" style={{ padding: '0 0 4px' }}>
      {groups.map((g) => {
        const isSelected = g.key === selectedKey;
        return (
          <button
            key={g.key}
            type="button"
            className="kpi-pill"
            style={isSelected ? { background: 'var(--text)', borderColor: 'var(--text)', color: 'white' } : { background: 'white', borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => onSelect(g.key)}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Excel-style data table + CSV export/import
// ---------------------------------------------------------------------------

const TABLE_COLUMNS: DataTableColumn<RawEntryRow>[] = [
  { key: 'date', label: 'Date', accessor: (r) => r.entry_date },
  { key: 'shift', label: 'Shift', accessor: (r) => r.shift ?? '—' },
  { key: 'actual', label: 'Actual', accessor: (r) => round2(r.actual), align: 'right' },
  { key: 'target', label: 'Target', accessor: (r) => round2(r.target), align: 'right' },
  { key: 'reason', label: 'Reason', accessor: (r) => r.reason },
  { key: 'remarks', label: 'Remarks', accessor: (r) => r.remarks },
  { key: 'category', label: 'Category', accessor: (r) => r.ai_category ?? '' },
];

function ExportTableSection({ kpiGroup, refreshKey }: { kpiGroup: KpiGroupOption | null; refreshKey: number }) {
  const [rows, setRows] = useState<RawEntryRow[]>([]);
  const [visibleRows, setVisibleRows] = useState<RawEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  useEffect(() => {
    if (!kpiGroup) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchMissedEntriesForKpiIds(kpiGroup.ids, format(subDays(new Date(), LOOKBACK_DAYS), 'yyyy-MM-dd'))
      .then(setRows)
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiGroup?.key, refreshKey]);

  function handleDownload() {
    if (visibleRows.length === 0) return;
    const csv = buildExportCsv(visibleRows);
    downloadTextFile(`${(kpiGroup?.label ?? 'kpi').replace(/[^a-z0-9]+/gi, '-')}-remarks.csv`, csv);
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card">
      <h3>Missed-target remarks {kpiGroup ? `— ${kpiGroup.label}` : ''}</h3>
      <p className="muted">
        Last {LOOKBACK_DAYS} days. Click a column header to sort, type in the box under a header to filter — same idea
        as an Excel table. "Download CSV" exports exactly what's showing here (filtered/sorted), ready to run through
        an AI tool and re-import once it's added a "category" column.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : !kpiGroup ? (
        <div className="empty-state">Pick a pillar and KPI above.</div>
      ) : (
        <DataTable
          columns={TABLE_COLUMNS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage="No missed-target entries in the last 180 days."
          onVisibleRowsChange={setVisibleRows}
        />
      )}
      <div className="insights-download-row">
        <button type="button" className="btn btn-primary" disabled={visibleRows.length === 0} onClick={handleDownload}>
          Download CSV ({visibleRows.length} row{visibleRows.length === 1 ? '' : 's'})
        </button>
      </div>

      <details className="insights-prompt-details">
        <summary>Prompt to paste alongside the file</summary>
        <div className="insights-prompt-block">
          <div className="insights-prompt-header">
            <span className="muted">Edit the bracketed part to change the angle each cycle.</span>
            <button type="button" className="btn btn-ghost-light" onClick={handleCopyPrompt}>
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </div>
          <textarea className="insights-prompt-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={9} />
        </div>
      </details>
    </div>
  );
}

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
      <h3>Re-import the categorized file</h3>
      <p className="muted">
        Upload the CSV back once your AI tool has added the "category" column — matched by the hidden id column, only
        that field is written back.
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
// PivotChart-style builder — Pareto chart left, drag-and-drop field panel
// right. Scoped to the currently selected KPI, same as the table above.
// ---------------------------------------------------------------------------

const PIVOT_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'shift', label: 'Shift' },
  { key: 'week', label: 'Week' },
];

function pivotDimValue(e: CategorizedEntryRow, key: string): string {
  switch (key) {
    case 'category':
      return e.category;
    case 'shift':
      return e.shift ?? 'Unspecified';
    case 'week':
      return `Wk ${getISOWeek(new Date(e.entry_date))}`;
    default:
      return '';
  }
}

function PivotSection({ kpiGroup, refreshKey }: { kpiGroup: KpiGroupOption | null; refreshKey: number }) {
  const [entries, setEntries] = useState<CategorizedEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<Partial<Record<PivotZone, string>>>({ rows: 'category' });
  const [filterIncluded, setFilterIncluded] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!kpiGroup) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchCategorizedEntriesForKpiIds(kpiGroup.ids)
      .then(setEntries)
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiGroup?.key, refreshKey]);

  // Reset to a sensible default whenever the KPI changes, and clear any
  // filter-value selection whenever the filter FIELD itself changes (a
  // saved selection from a different field wouldn't make sense here).
  useEffect(() => {
    setAssignment({ rows: 'category' });
    setFilterIncluded(null);
  }, [kpiGroup?.key]);
  useEffect(() => {
    setFilterIncluded(null);
  }, [assignment.filters]);

  const filterValues = useMemo(() => {
    if (!assignment.filters) return [];
    return Array.from(new Set(entries.map((e) => pivotDimValue(e, assignment.filters!)))).sort();
  }, [entries, assignment.filters]);

  const filteredEntries = useMemo(() => {
    if (!assignment.filters || !filterIncluded) return entries;
    return entries.filter((e) => filterIncluded.has(pivotDimValue(e, assignment.filters!)));
  }, [entries, assignment.filters, filterIncluded]);

  const rowField = assignment.rows;
  const colField = assignment.columns;

  const chartData: ParetoDatum[] = useMemo(() => {
    if (!rowField) return [];
    const counts = new Map<string, number>();
    for (const e of filteredEntries) {
      const label = pivotDimValue(e, rowField);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [filteredEntries, rowField]);

  const crossTab = useMemo(() => {
    if (!rowField || !colField) return null;
    const rowLabels = new Set<string>();
    const colLabels = new Set<string>();
    const grid = new Map<string, number>();
    for (const e of filteredEntries) {
      const r = pivotDimValue(e, rowField);
      const c = pivotDimValue(e, colField);
      rowLabels.add(r);
      colLabels.add(c);
      grid.set(`${r}\u0000${c}`, (grid.get(`${r}\u0000${c}`) ?? 0) + 1);
    }
    return { rows: Array.from(rowLabels).sort(), cols: Array.from(colLabels).sort(), grid };
  }, [filteredEntries, rowField, colField]);

  return (
    <div className="card">
      <h3>Pivot builder {kpiGroup ? `— ${kpiGroup.label}` : ''}</h3>
      <p className="muted">
        Drag fields into Filters / Rows / Columns to slice the categorized entries for this KPI — same idea as an
        Excel PivotChart. Only entries that have been categorized (via the export/re-import cycle above) show up here.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!kpiGroup ? (
        <div className="empty-state">Pick a pillar and KPI above.</div>
      ) : loading ? (
        <div className="empty-state">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No categorized entries for this KPI yet — export, categorize, and re-import above first.</div>
      ) : (
        <div className="pivot-layout">
          <div className="pivot-chart-side">
            {assignment.filters && (
              <div className="pivot-filter-checklist">
                <span className="pivot-filter-checklist-label">{PIVOT_FIELDS.find((f) => f.key === assignment.filters)?.label}:</span>
                {filterValues.map((v) => {
                  const checked = filterIncluded ? filterIncluded.has(v) : true;
                  return (
                    <label key={v} className="pivot-filter-checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(filterIncluded ?? filterValues);
                          if (e.target.checked) next.add(v);
                          else next.delete(v);
                          setFilterIncluded(next);
                        }}
                      />
                      {v}
                    </label>
                  );
                })}
              </div>
            )}
            {!rowField ? (
              <div className="empty-state">Drag a field into Rows to see a breakdown.</div>
            ) : crossTab ? (
              <div className="table-scroll">
                <table className="action-table">
                  <thead>
                    <tr>
                      <th>{PIVOT_FIELDS.find((f) => f.key === rowField)?.label}</th>
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
          <div className="pivot-panel-side">
            <PivotFieldPanel fields={PIVOT_FIELDS} assignment={assignment} onAssignmentChange={setAssignment} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Insights() {
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPillarId, setSelectedPillarId] = useState<string | null>(null);
  const [selectedKpiKey, setSelectedKpiKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    Promise.all([fetchPillars(), fetchKpis()])
      .then(([p, k]) => {
        setPillars(p);
        setKpis(k);
        setSelectedPillarId((prev) => prev ?? p[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
  }, []);

  const kpiGroups = useMemo(() => groupKpisByBase(kpis.filter((k) => k.pillar_id === selectedPillarId)), [kpis, selectedPillarId]);

  // Selecting a different pillar should reset which KPI is picked, rather
  // than silently keeping a same-named group from the previous pillar (base
  // names aren't guaranteed unique across pillars).
  useEffect(() => {
    setSelectedKpiKey(kpiGroups[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPillarId]);

  const selectedKpiGroup = kpiGroups.find((g) => g.key === selectedKpiKey) ?? null;

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Insights</h1>
        <p className="muted">
          Pick a pillar and KPI, export its missed-target remarks, run them through whatever AI tool you already have,
          re-import, and build a pivot breakdown — no AI plugged into this app itself.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="quadrant-block-title" style={{ padding: '0 0 4px' }}>
          Pillar
        </div>
        <PillarPicker pillars={pillars} selectedId={selectedPillarId} onSelect={setSelectedPillarId} />
        <div className="quadrant-block-title" style={{ padding: '10px 0 4px' }}>
          KPI
        </div>
        <KpiPicker groups={kpiGroups} selectedKey={selectedKpiKey} onSelect={setSelectedKpiKey} />
      </div>

      <div className="insights-stack">
        <ExportTableSection kpiGroup={selectedKpiGroup} refreshKey={refreshKey} />
        <ImportSection onImported={() => setRefreshKey((k) => k + 1)} />
        <PivotSection kpiGroup={selectedKpiGroup} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
