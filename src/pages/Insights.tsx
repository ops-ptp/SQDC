import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { Chip } from '@progress/kendo-react-buttons';
import { TabStrip, TabStripTab } from '@progress/kendo-react-layout';
import { useDepartment } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import {
  deleteCustomPareto,
  fetchCategorizedEntriesForKpiIds,
  fetchCustomParetosForPillar,
  fetchKpis,
  fetchMissedEntriesForKpiIds,
  fetchPillars,
  fetchTagsByEntry,
  saveCustomPareto,
  type CategorizedEntryRow,
  type CustomPareto,
  type RawEntryRow,
} from '../lib/data';
import { applyPivotFilter, computeChartData, computeCrossTab, pivotCoverage, pivotFieldLabel, pivotFieldsFor, pivotFilterOptions } from '../lib/pivot';
import { baseNameOf, errorMessage, PILLAR_COLORS, round2, type Kpi, type Pillar } from '../types';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import ParetoChart from '../components/ParetoChart';
import AiCategorize from '../components/AiCategorize';
import { Button, InfoTip, InlineLoader, PageLoader, Select, TextField } from '../components/ui';

// ===========================================================================
// Insights — for one KPI at a time:
//   1. Tag remarks   — AI-suggested Pareto tags from one or more angles,
//                      reviewed by the admin before saving
//   2. Analyse       — Pareto / cross-tab of the tags, optionally pinned to
//                      the SQDC Board
//   3. Remarks       — every missed-target remark with its tags
// A summary strip above the tabs shows how much of the KPI is tagged.
// ===========================================================================

const LOOKBACK_DAYS = 180;

interface KpiGroupOption {
  key: string;
  label: string;
  ids: string[];
}

function groupKpisByBase(kpis: Kpi[]): KpiGroupOption[] {
  const map = new Map<string, string[]>();
  for (const k of kpis) {
    const base = baseNameOf(k.name);
    map.set(base, [...(map.get(base) ?? []), k.id]);
  }
  return Array.from(map.entries())
    .map(([base, ids]) => ({ key: base, label: base, ids }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// KPI picker — pillar pills, then that pillar's KPI pills (the board's own
// pill styling, so this page reads as part of the same app).
// ---------------------------------------------------------------------------

function KpiPicker({
  pillars,
  pillarId,
  onPillar,
  groups,
  kpiKey,
  onKpi,
}: {
  pillars: Pillar[];
  pillarId: string | null;
  onPillar: (id: string) => void;
  groups: KpiGroupOption[];
  kpiKey: string | null;
  onKpi: (key: string) => void;
}) {
  return (
    <div className="insights-picker">
      <div className="insights-picker-row">
        <span className="insights-picker-label">Pillar</span>
        <div className="kpi-pills">
          {pillars.map((p) => {
            const colors = PILLAR_COLORS[p.code] ?? PILLAR_COLORS.Q;
            const on = p.id === pillarId;
            return (
              <Chip
                key={p.id}
                text={p.name}
                rounded="full"
                className="kpi-pill"
                selected={on}
                style={on ? { background: colors.base, borderColor: colors.base, color: 'white' } : { background: 'white', borderColor: colors.base, color: colors.base }}
                onClick={() => onPillar(p.id)}
              />
            );
          })}
        </div>
      </div>
      <div className="insights-picker-row">
        <span className="insights-picker-label">KPI</span>
        {groups.length === 0 ? (
          <span className="muted">No KPIs in this pillar.</span>
        ) : (
          <div className="kpi-pills">
            {groups.map((g) => {
              const on = g.key === kpiKey;
              return (
                <Chip
                  key={g.key}
                  text={g.label}
                  rounded="full"
                  className="kpi-pill"
                  selected={on}
                  style={on ? { background: 'var(--text)', borderColor: 'var(--text)', color: 'white' } : { background: 'white', borderColor: 'var(--border)', color: 'var(--text)' }}
                  onClick={() => onKpi(g.key)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip — how much of this KPI's missed-target history is tagged.
// ---------------------------------------------------------------------------

function TagSummary({ remarks, tagsByEntry, loading }: { remarks: RawEntryRow[]; tagsByEntry: Map<string, Record<string, string[]>>; loading: boolean }) {
  const stats = useMemo(() => {
    const perAngle = new Map<string, number>();
    let tagged = 0;
    for (const r of remarks) {
      const t = tagsByEntry.get(r.id);
      if (!t || Object.values(t).every((v) => v.length === 0)) continue;
      tagged++;
      for (const [angle, v] of Object.entries(t)) if (v.length) perAngle.set(angle, (perAngle.get(angle) ?? 0) + 1);
    }
    const angles = Array.from(perAngle.entries()).sort((a, b) => (a[0] === 'Cause' ? -1 : b[0] === 'Cause' ? 1 : a[0].localeCompare(b[0])));
    return { total: remarks.length, tagged, untagged: remarks.length - tagged, angles };
  }, [remarks, tagsByEntry]);

  if (loading) {
    return (
      <div className="insights-summary">
        <InlineLoader />
      </div>
    );
  }
  return (
    <div className="insights-summary">
      <div className="insights-stat">
        <span className="insights-stat-value">{stats.total}</span>
        <span className="insights-stat-label">missed-target remarks · last {LOOKBACK_DAYS} days</span>
      </div>
      <div className="insights-stat">
        <span className="insights-stat-value">{stats.tagged}</span>
        <span className="insights-stat-label">tagged</span>
      </div>
      <div className={`insights-stat${stats.untagged > 0 ? ' is-attention' : ''}`}>
        <span className="insights-stat-value">{stats.untagged}</span>
        <span className="insights-stat-label">not tagged yet</span>
      </div>
      {stats.angles.length > 0 && (
        <div className="insights-angle-coverage" aria-label="Remarks tagged per angle">
          {stats.angles.map(([angle, n]) => (
            <span key={angle} className="insights-angle-pill">
              {angle} <b>{n}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remarks tab — every missed-target remark with its Pareto tags.
// ---------------------------------------------------------------------------

function remarkColumns(tagsByEntry: Map<string, Record<string, string[]>>): DataTableColumn<RawEntryRow>[] {
  return [
    { key: 'date', label: 'Date', accessor: (r) => r.entry_date },
    { key: 'shift', label: 'Shift', accessor: (r) => r.shift ?? '—' },
    { key: 'actual', label: 'Actual', accessor: (r) => round2(r.actual), align: 'right' },
    { key: 'target', label: 'Target', accessor: (r) => round2(r.target), align: 'right' },
    { key: 'reason', label: 'Reason', accessor: (r) => r.reason },
    { key: 'remarks', label: 'Remarks', accessor: (r) => r.remarks },
    {
      key: 'tags',
      label: 'Pareto tags',
      accessor: (r) =>
        Object.entries(tagsByEntry.get(r.id) ?? {})
          .map(([angle, tags]) => `${angle}: ${tags.join(', ')}`)
          .join(' · ') || '—',
    },
  ];
}

function RemarksTab({ remarks, tagsByEntry }: { remarks: RawEntryRow[]; tagsByEntry: Map<string, Record<string, string[]>> }) {
  const columns = useMemo(() => remarkColumns(tagsByEntry), [tagsByEntry]);
  return (
    <div className="card">
      <p className="muted insights-tab-intro">
        Every missed-target remark for this KPI in the last {LOOKBACK_DAYS} days. Click a column header to sort or filter, like an Excel table.
      </p>
      <DataTable columns={columns} rows={remarks} rowKey={(r) => r.id} emptyMessage={`No missed-target entries in the last ${LOOKBACK_DAYS} days.`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyse tab — Pareto of the tags by any angle, split by a second field
// into a shaded cross-tab, filtered by a third; optionally pinned to the
// SQDC Board (live — recomputed from the tags whenever the board loads).
// ---------------------------------------------------------------------------

function AnalyseTab({ pillarId, kpiGroup, refreshKey, color }: { pillarId: string; kpiGroup: KpiGroupOption; refreshKey: number; color: string }) {
  const { employee } = useEmployee();
  const department = useDepartment();
  const [entries, setEntries] = useState<CategorizedEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState('');
  const [splitBy, setSplitBy] = useState('');
  const [filterBy, setFilterBy] = useState('');
  const [filterIncluded, setFilterIncluded] = useState<Set<string> | null>(null);
  const [existing, setExisting] = useState<CustomPareto | null>(null);
  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<{ busy: boolean; message: string | null; error: string | null }>({ busy: false, message: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchCategorizedEntriesForKpiIds(kpiGroup.ids)
      .then((e) => {
        if (cancelled) return;
        setEntries(e);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiGroup.key, refreshKey]);

  // Continue from the chart already pinned to the Board for this KPI, if any.
  useEffect(() => {
    let cancelled = false;
    fetchCustomParetosForPillar(department.id, pillarId)
      .then((all) => {
        if (cancelled) return;
        const match = all.find((p) => p.kpi_base_name === kpiGroup.key) ?? null;
        setExisting(match);
        setGroupBy(match?.row_field ?? '');
        setSplitBy(match?.column_field ?? '');
        setFilterBy(match?.filter_field ?? '');
        setFilterIncluded(match?.filter_values ? new Set(match.filter_values) : null);
        setTitle(match?.title ?? '');
      })
      .catch(() => !cancelled && setExisting(null));
    return () => {
      cancelled = true;
    };
  }, [department.id, pillarId, kpiGroup.key]);

  // Only offer fields that have data; fall back to the first angle when the
  // chosen one has none (e.g. a pinned chart's angle was emptied).
  const fields = useMemo(() => pivotFieldsFor(entries), [entries]);
  const has = (k: string) => fields.some((f) => f.key === k);
  const rowField = groupBy && has(groupBy) ? groupBy : fields[0]?.key;
  const colField = splitBy && has(splitBy) && splitBy !== rowField ? splitBy : undefined;
  const filterField = filterBy && has(filterBy) && filterBy !== rowField && filterBy !== colField ? filterBy : undefined;

  const filterValues = useMemo(() => (filterField ? pivotFilterOptions(entries, filterField) : []), [entries, filterField]);
  const filtered = useMemo(() => applyPivotFilter(entries, filterField, filterIncluded ? Array.from(filterIncluded) : null), [entries, filterField, filterIncluded]);
  const chartData = useMemo(() => (rowField ? computeChartData(filtered, rowField) : []), [filtered, rowField]);
  const crossTab = useMemo(() => (rowField && colField ? computeCrossTab(filtered, rowField, colField) : null), [filtered, rowField, colField]);
  const coverage = useMemo(() => (rowField ? pivotCoverage(filtered, rowField) : { entries: 0, multi: false }), [filtered, rowField]);

  const fieldOptions = fields.map((f) => ({ value: f.key, label: f.label }));
  const defaultTitle = rowField ? `By ${pivotFieldLabel(rowField)}${colField ? ` × ${pivotFieldLabel(colField)}` : ''}` : 'Pareto';

  async function pin() {
    if (!rowField) return;
    setSaveState({ busy: true, message: null, error: null });
    try {
      const saved = await saveCustomPareto({
        department_id: department.id,
        pillar_id: pillarId,
        kpi_base_name: kpiGroup.key,
        title: title.trim() || defaultTitle,
        row_field: rowField,
        column_field: colField ?? null,
        filter_field: filterField ?? null,
        filter_values: filterField && filterIncluded ? Array.from(filterIncluded) : null,
        created_by: employee?.id ?? null,
      });
      setExisting(saved);
      setSaveState({ busy: false, message: `Pinned to the Board as "${saved.title}".`, error: null });
    } catch (e) {
      setSaveState({ busy: false, message: null, error: errorMessage(e, 'Failed to save') });
    }
  }

  async function unpin() {
    if (!existing) return;
    setSaveState({ busy: true, message: null, error: null });
    try {
      await deleteCustomPareto(existing.id);
      setExisting(null);
      setSaveState({ busy: false, message: 'Removed from the Board.', error: null });
    } catch (e) {
      setSaveState({ busy: false, message: null, error: errorMessage(e, 'Failed to remove') });
    }
  }

  if (loading) {
    return (
      <div className="card">
        <InlineLoader />
      </div>
    );
  }
  if (error) return <div className="alert alert-error">{error}</div>;
  if (entries.length === 0 || !rowField) {
    return (
      <div className="card">
        <div className="empty-state">
          Nothing tagged for this KPI yet. Tag remarks in <b>1 · Tag remarks</b> (or in Enter Remarks), then come back here.
        </div>
      </div>
    );
  }

  const maxCell = crossTab ? Math.max(1, ...Array.from(crossTab.grid.values())) : 1;

  return (
    <div className="card">
      <div className="analyse-controls">
        <div className="field-label">
          Group by
          <Select value={rowField} onChange={setGroupBy} options={fieldOptions} ariaLabel="Group by" />
        </div>
        <div className="field-label">
          <span className="field-title">
            Split by <InfoTip>Pick a second field to see how the two combine — e.g. Cause split by Equipment.</InfoTip>
          </span>
          <Select
            value={colField ?? ''}
            onChange={setSplitBy}
            options={[{ value: '', label: 'Nothing' }, ...fieldOptions.filter((o) => o.value !== rowField)]}
            ariaLabel="Split by"
          />
        </div>
        <div className="field-label">
          Filter by
          <Select
            value={filterField ?? ''}
            onChange={(v) => {
              setFilterBy(v);
              setFilterIncluded(null);
            }}
            options={[{ value: '', label: 'Nothing' }, ...fieldOptions.filter((o) => o.value !== rowField && o.value !== colField)]}
            ariaLabel="Filter by"
          />
        </div>
      </div>

      {filterField && (
        <div className="analyse-filter" role="group" aria-label={`Show only these ${pivotFieldLabel(filterField)} values`}>
          <span className="muted analyse-filter-hint">Click a {pivotFieldLabel(filterField)} value to hide or show it:</span>
          {filterValues.map((v) => {
            const on = filterIncluded ? filterIncluded.has(v) : true;
            return (
              <Chip
                key={v}
                text={v}
                rounded="full"
                size="small"
                selected={on}
                className={`analyse-filter-chip${on ? ' is-on' : ''}`}
                onClick={() => {
                  const next = new Set(filterIncluded ?? filterValues);
                  if (on) next.delete(v);
                  else next.add(v);
                  setFilterIncluded(next.size === filterValues.length ? null : next);
                }}
              />
            );
          })}
        </div>
      )}

      <div className="analyse-chart">
        {crossTab ? (
          <div className="table-scroll">
            <table className="action-table analyse-heat">
              <thead>
                <tr>
                  <th>
                    {pivotFieldLabel(rowField)} ↓ · {pivotFieldLabel(colField!)} →
                  </th>
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
                      <th scope="row">{r}</th>
                      {crossTab.cols.map((c) => {
                        const n = crossTab.grid.get(`${r}\u0000${c}`) ?? 0;
                        const strength = n / maxCell;
                        return (
                          <td
                            key={c}
                            className="analyse-heat-cell"
                            style={n ? { background: `color-mix(in srgb, ${color} ${Math.round(12 + strength * 70)}%, white)`, color: strength > 0.55 ? 'white' : undefined } : undefined}
                          >
                            {n || ''}
                          </td>
                        );
                      })}
                      <td className="analyse-heat-total">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <ParetoChart data={chartData} barColor={color} maxBars={12} cumulativeOfAll shareOf={coverage.multi ? coverage.entries : undefined} />
            <div className="muted analyse-note">
              {coverage.entries} remark{coverage.entries === 1 ? '' : 's'} tagged in {pivotFieldLabel(rowField)}
              {coverage.multi ? ' · some carry more than one tag, so the bars add up to more. Bar % = share of remarks mentioning it.' : '.'}
            </div>
          </>
        )}
      </div>

      <div className="analyse-pin">
        <div className="analyse-pin-text">
          <b>Show on the SQDC Board</b>
          <span className="muted">Adds this chart to {kpiGroup.label}'s card on the Board. It stays live — new tags appear automatically.</span>
        </div>
        <div className="analyse-pin-actions">
          <TextField className="pivot-title-input" placeholder={defaultTitle} value={title} onChange={setTitle} ariaLabel="Chart title" />
          <Button themeColor="primary" disabled={saveState.busy} onClick={pin}>
            {saveState.busy ? 'Saving…' : existing ? 'Update on Board' : 'Pin to Board'}
          </Button>
          {existing && (
            <Button fillMode="flat" themeColor="error" disabled={saveState.busy} onClick={unpin}>
              Remove from Board
            </Button>
          )}
        </div>
        {saveState.message && <div className="alert alert-success">{saveState.message}</div>}
        {saveState.error && <div className="alert alert-error">{saveState.error}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Insights() {
  const department = useDepartment();
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pillarId, setPillarId] = useState<string | null>(null);
  const [kpiKey, setKpiKey] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [remarks, setRemarks] = useState<RawEntryRow[]>([]);
  const [tagsByEntry, setTagsByEntry] = useState<Map<string, Record<string, string[]>>>(new Map());
  // Which KPI + refresh the remarks above belong to — while it differs from
  // the current one, a load is in flight.
  const [remarksKey, setRemarksKey] = useState('');
  const [remarksError, setRemarksError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPillars(), fetchKpis(department.id)])
      .then(([p, k]) => {
        setPillars(p);
        setKpis(k);
        setPillarId((prev) => prev ?? p[0]?.id ?? null);
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
  }, [department.id]);

  // Secondary "(Old)"-calculation KPIs are left out, as in Enter Remarks —
  // otherwise they'd merge into their primary KPI's group here.
  const kpiGroups = useMemo(() => groupKpisByBase(kpis.filter((k) => k.pillar_id === pillarId && !k.is_secondary)), [kpis, pillarId]);
  const kpiGroup = kpiGroups.find((g) => g.key === kpiKey) ?? kpiGroups[0] ?? null;
  const pillar = pillars.find((p) => p.id === pillarId);
  const color = (PILLAR_COLORS[pillar?.code ?? 'Q'] ?? PILLAR_COLORS.Q).base;

  // The KPI's missed-target remarks + their tags: the summary strip and the
  // Remarks tab both read these.
  const idsKey = kpiGroup?.ids.join(',') ?? '';
  const wantedKey = `${idsKey}#${refreshKey}`;
  const remarksLoading = Boolean(idsKey) && remarksKey !== wantedKey;
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    fetchMissedEntriesForKpiIds(idsKey.split(','), format(subDays(new Date(), LOOKBACK_DAYS), 'yyyy-MM-dd'))
      .then(async (rows) => {
        const tags = await fetchTagsByEntry(rows.map((r) => r.id));
        if (cancelled) return;
        setRemarks(rows);
        setTagsByEntry(tags);
        setRemarksError(null);
        setRemarksKey(`${idsKey}#${refreshKey}`);
      })
      .catch((e) => {
        if (cancelled) return;
        setRemarksError(errorMessage(e, 'Failed to load remarks'));
        setRemarksKey(`${idsKey}#${refreshKey}`);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey, refreshKey]);

  if (loading) return <PageLoader label="Loading insights…" />;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          Insights <span className="muted admin-dept-name">· {department.name}</span>{' '}
          <InfoTip>
            Pick a KPI, tag its missed-target remarks from one or more angles (Cause, Equipment…) with AI suggestions you review, then see what
            drives the misses and pin the chart to the Board.
          </InfoTip>
        </h1>
      </div>

      <div className="card insights-head">
        <KpiPicker
          pillars={pillars}
          pillarId={pillarId}
          onPillar={(id) => {
            setPillarId(id);
            setKpiKey(null);
          }}
          groups={kpiGroups}
          kpiKey={kpiGroup?.key ?? null}
          onKpi={setKpiKey}
        />
        {kpiGroup && <TagSummary remarks={remarks} tagsByEntry={tagsByEntry} loading={remarksLoading} />}
        {remarksError && <div className="alert alert-error">{remarksError}</div>}
      </div>

      {pillarId && kpiGroup && (
        <TabStrip selected={tab} onSelect={(e) => setTab(e.selected)} className="admin-tabs insights-tabs" keepTabsMounted>
          <TabStripTab title="1 · Tag remarks">
            <AiCategorize
              key={`${pillarId}|${kpiGroup.key}`}
              pillarId={pillarId}
              kpiLabel={kpiGroup.label}
              kpiIds={kpiGroup.ids}
              color={color}
              onSaved={() => setRefreshKey((k) => k + 1)}
            />
          </TabStripTab>
          <TabStripTab title="2 · Analyse">
            <AnalyseTab key={`${pillarId}|${kpiGroup.key}`} pillarId={pillarId} kpiGroup={kpiGroup} refreshKey={refreshKey} color={color} />
          </TabStripTab>
          <TabStripTab title={`3 · Remarks${remarksLoading ? '' : ` (${remarks.length})`}`}>
            <RemarksTab remarks={remarks} tagsByEntry={tagsByEntry} />
          </TabStripTab>
        </TabStrip>
      )}
    </div>
  );
}
