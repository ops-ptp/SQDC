import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { fetchKpiCategories, fetchTaggedEntries, type KpiCategory, type TaggedEntryRow } from '../lib/categories';
import { computeParetoRows, orderedDimensions, type ParetoPeriod } from '../lib/categoryCore';
import { errorMessage, round2 } from '../types';
import CategoryPicker from './CategoryPicker';
import ParetoChart from './ParetoChart';

interface Props {
  pillarId: string;
  kpiBaseName: string;
  /** Primary (pass/fail) KPI ids only — old-calculation variants excluded,
   * same invariant as the rest of the board. */
  kpiIds: string[];
  dayKpiId?: string;
  nightKpiId?: string;
  unit: string;
  period: ParetoPeriod;
  color: string;
  /** Logged-in employee id; tags are editable from the drill-down when set. */
  employeeId: string | null;
  /** Shown instead when this KPI has no category list and nothing tagged in
   * the period — i.e. it simply isn't categorised (yet). */
  fallback: ReactNode;
}

const VITAL_FEW_PCT = 80;

/** Weekly / Bi-weekly category Pareto for one KPI — the in-app version of
 * the team's "Week NN & NN" Pareto sheets. Counts category TAGS (a shift can
 * have several) within the period, per dimension (Accident has Location /
 * Equipment / Symptom tabs). Bars or table rows drill down to the shifts
 * behind a category, where tags can be corrected by any logged-in user. */
export default function CategoryPareto({ pillarId, kpiBaseName, kpiIds, dayKpiId, nightKpiId, unit, period, color, employeeId, fallback }: Props) {
  const [list, setList] = useState<KpiCategory[]>([]);
  const [tags, setTags] = useState<TaggedEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  // True after the first successful load — later refreshes (after a tag
  // edit) update in place instead of flashing "Loading…" and closing the
  // editor the person is working in.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dimension, setDimension] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const idsKey = kpiIds.join(',');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchKpiCategories(pillarId, kpiBaseName), fetchTaggedEntries(kpiIds, period.from, period.to)])
      .then(([l, t]) => {
        if (cancelled) return;
        setList(l);
        setTags(t);
        setHasLoaded(true);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load categories')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pillarId, kpiBaseName, idsKey, period.from, period.to, refreshKey]);

  // Close any open drill-down when the KPI or period changes underneath it.
  useEffect(() => {
    setSelected(null);
    setEditingEntryId(null);
  }, [kpiBaseName, period.from, period.to]);

  const dimensions = useMemo(() => orderedDimensions([...list, ...tags]), [list, tags]);
  const activeDimension = dimensions.includes(dimension) ? dimension : dimensions[0];
  const dimTags = useMemo(() => tags.filter((t) => t.dimension === activeDimension), [tags, activeDimension]);
  const rows = useMemo(() => computeParetoRows(dimTags), [dimTags]);
  const totalTags = dimTags.length;
  const shiftCount = new Set(dimTags.map((t) => t.entry.id)).size;

  // Shifts behind the selected category, with all of each shift's tags in
  // this dimension so the reviewer sees the full picture before editing.
  const drill = useMemo(() => {
    if (!selected) return [];
    const entryIds = new Set(dimTags.filter((t) => t.category === selected).map((t) => t.entry.id));
    const byEntry = new Map<string, { entry: TaggedEntryRow['entry']; categories: string[] }>();
    for (const t of dimTags) {
      if (!entryIds.has(t.entry.id)) continue;
      const cur = byEntry.get(t.entry.id) ?? { entry: t.entry, categories: [] };
      cur.categories.push(t.category);
      byEntry.set(t.entry.id, cur);
    }
    return Array.from(byEntry.values()).sort((a, b) => a.entry.entry_date.localeCompare(b.entry.entry_date) || a.entry.kpi_id.localeCompare(b.entry.kpi_id));
  }, [selected, dimTags]);

  function shiftLabel(kpiId: string) {
    if (kpiId === dayKpiId) return 'Day';
    if (kpiId === nightKpiId) return 'Night';
    return '';
  }

  if (loading && !hasLoaded) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (list.length === 0 && tags.length === 0) return <>{fallback}</>;

  return (
    <div>
      {dimensions.length > 1 && (
        <div className="cat-pareto-tabs segmented segmented-sm" role="tablist">
          {dimensions.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === activeDimension}
              className={`segmented-btn ${d === activeDimension ? 'segmented-btn-active' : ''}`}
              onClick={() => {
                setDimension(d);
                setSelected(null);
                setEditingEntryId(null);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state" style={{ height: 120 }}>
          No categories tagged in {period.label.split(' · ')[0]}.
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12 }}>
            {totalTags} tag{totalTags === 1 ? '' : 's'} across {shiftCount} shift{shiftCount === 1 ? '' : 's'} · click a bar or row for the shifts behind it
          </div>
          <ParetoChart
            data={rows.map((r) => ({ label: r.category, count: r.count }))}
            barColor={color}
            maxBars={8}
            cumulativeOfAll
            selectedLabel={selected}
            onBarClick={(label) => {
              setSelected((s) => (s === label ? null : label));
              setEditingEntryId(null);
            }}
          />
          <div className="cat-pareto-table-wrap">
            <table className="cat-pareto-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Category</th>
                  <th className="num">Freq</th>
                  <th className="num">Cum %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  // "Vital few": every row up to and including the one that
                  // first reaches 80% of all tags.
                  const vital = i === 0 || rows[i - 1].cumulativePct < VITAL_FEW_PCT;
                  return (
                    <tr
                      key={r.category}
                      className={`cat-row ${selected === r.category ? 'cat-row-selected' : ''} ${vital ? 'cat-row-vital' : ''}`}
                      onClick={() => {
                        setSelected((s) => (s === r.category ? null : r.category));
                        setEditingEntryId(null);
                      }}
                    >
                      <td className="num">{r.rank}</td>
                      <td>{r.category}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{r.cumulativePct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (
        <div className="cat-drill">
          <div className="cat-drill-head">
            <strong>
              {selected} — {drill.length} shift{drill.length === 1 ? '' : 's'}
            </strong>
            <button type="button" className="link-btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          {drill.map(({ entry, categories }) => (
            <div key={entry.id} className="cat-drill-item">
              <div className="cat-drill-meta">
                <strong>
                  {format(parseISO(entry.entry_date), 'EEE d MMM')} {shiftLabel(entry.kpi_id)}
                </strong>
                <span className="muted">
                  {round2(entry.actual)} {unit} vs target {round2(entry.target)}
                </span>
              </div>
              {entry.remarks && <p className="cat-drill-remarks">{entry.remarks}</p>}
              {editingEntryId === entry.id ? (
                <>
                  <CategoryPicker
                    pillarId={pillarId}
                    kpiBaseName={kpiBaseName}
                    entryId={entry.id}
                    employeeId={employeeId}
                    editable
                    color={color}
                    onChange={() => setRefreshKey((k) => k + 1)}
                  />
                  <button type="button" className="link-btn" onClick={() => setEditingEntryId(null)}>
                    Done
                  </button>
                </>
              ) : (
                <div className="cat-drill-tags">
                  {categories.join(' · ')}
                  {employeeId && (
                    <>
                      {' '}
                      <button type="button" className="link-btn" onClick={() => setEditingEntryId(entry.id)}>
                        Edit categories
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
