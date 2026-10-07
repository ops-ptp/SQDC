import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckField, TextField } from './ui';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  accessor: (row: T) => string | number;
  /** For a cell that holds several values (e.g. one row's Pareto tags): the
   * values its filter offers and matches on. A row passes when any of its
   * values is ticked. Defaults to the cell text as a single value. */
  filterValues?: (row: T) => string[];
  align?: 'left' | 'right';
}

/** Width of the filter popup, kept in step with .data-table-filter-dropdown. */
const FILTER_WIDTH = 300;

function valuesOf<T>(col: DataTableColumn<T>, row: T): string[] {
  return col.filterValues ? col.filterValues(row) : [String(col.accessor(row))];
}

interface Props<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Excel AutoFilter-style dropdown: a checkbox per distinct value in this
 * column (computed from the full, unfiltered row set — like Excel, every
 * column's own filter dropdown offers every value that ever appears there,
 * not just the ones surviving other columns' current filters), plus a
 * search box to narrow that list for high-cardinality columns like free-
 * text remarks. Unchecking a box takes effect immediately — no separate
 * "Apply" step. */
function FilterDropdown({
  values,
  selected,
  onChange,
  onClose,
  anchor,
}: {
  values: string[];
  /** null = no filter active (everything shown, every box reads as checked) */
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  onClose: () => void;
  /** The ▾ button that opened this — the portal-rendered dropdown sits
   * under it. Rendered via a portal (not inline in the header cell) because
   * the table body scrolls with a fixed max-height; an inline-positioned
   * dropdown would get clipped by that scroll container. */
  anchor: HTMLElement;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState(() => anchor.getBoundingClientRect());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element;
      // The ▾ buttons toggle the dropdown themselves on click — closing here
      // first would make a click on the open column's ▾ re-open it.
      if (target.closest?.('.data-table-th-filter-btn')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    // Follow the column when the page or the table scrolls (on a phone the
    // table scrolls sideways, and tapping a half-hidden ▾ scrolls it too);
    // close only once the ▾ has left the screen.
    let frame = 0;
    function handleScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = anchor.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) onClose();
        else setAnchorRect(r);
      });
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, anchor]);

  const visibleValues = values.filter((v) => v.toLowerCase().includes(search.trim().toLowerCase()));
  const isChecked = (v: string) => !selected || selected.has(v);
  const allVisibleChecked = visibleValues.length > 0 && visibleValues.every(isChecked);

  function toggleValue(v: string) {
    const base = selected ?? new Set(values);
    const next = new Set(base);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // A full set (nothing excluded) is equivalent to "no filter" — collapse
    // back to null so the header doesn't show an active-filter indicator
    // for a filter that isn't actually excluding anything.
    onChange(next.size === values.length ? null : next);
  }

  function toggleSelectAllVisible() {
    const base = new Set(selected ?? values);
    if (allVisibleChecked) {
      for (const v of visibleValues) base.delete(v);
    } else {
      for (const v of visibleValues) base.add(v);
    }
    onChange(base.size === values.length ? null : base);
  }

  return createPortal(
    <div
      className="data-table-filter-dropdown"
      ref={ref}
      style={{
        position: 'fixed',
        zIndex: 200,
        top: anchorRect.bottom + 4,
        width: Math.min(FILTER_WIDTH, window.innerWidth - 16),
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - Math.min(FILTER_WIDTH, window.innerWidth - 16) - 8)),
      }}
    >
      <TextField className="data-table-filter-search" placeholder="Search…" value={search} onChange={setSearch} autoFocus ariaLabel="Search values" />
      <label className="data-table-filter-option data-table-filter-select-all">
        <CheckField checked={allVisibleChecked} onChange={() => toggleSelectAllVisible()} />
        Select all
      </label>
      <div className="data-table-filter-option-list">
        {visibleValues.length === 0 && <div className="data-table-filter-empty">No matches</div>}
        {visibleValues.map((v) => (
          <label key={v} className="data-table-filter-option">
            <CheckField checked={isChecked(v)} onChange={() => toggleValue(v)} />
            <span className="data-table-filter-option-text" title={v}>
              {v || '(blank)'}
            </span>
          </label>
        ))}
      </div>
      {selected && (
        <button type="button" className="data-table-filter-clear" onClick={() => onChange(null)}>
          Clear filter
        </button>
      )}
    </div>,
    document.body
  );
}

/** A small Excel-like table: click a header's text to sort (cycles asc ->
 * desc -> unsorted); click the ▾ next to it to open an AutoFilter-style
 * checkbox dropdown for that column. */
export default function DataTable<T>({ columns, rows, rowKey, emptyMessage = 'No rows.' }: Props<T>) {
  const [filters, setFilters] = useState<Record<string, Set<string> | null>>({});
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sort, setSort] = useState<SortState>(null);

  // Distinct values per column, from the full row set — same "every value
  // that ever appears here" scope Excel's own AutoFilter dropdown uses.
  const distinctValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      map[col.key] = Array.from(new Set(rows.flatMap((r) => valuesOf(col, r)))).sort((a, b) => a.localeCompare(b));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col) => {
        const sel = filters[col.key];
        if (!sel) return true;
        return valuesOf(col, row).some((v) => sel.has(v));
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dirMul = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul;
      return String(av).localeCompare(String(bv)) * dirMul;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const closeFilter = useCallback(() => setOpenFilterKey(null), []);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  return (
    <div className="table-scroll data-table-scroll">
      <table className="action-table data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="data-table-th">
                <span className="data-table-th-sort" onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sort?.key === col.key ? (sort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : ''}
                </span>
                <span className="data-table-th-filter-wrap">
                  <button
                    type="button"
                    className={`data-table-th-filter-btn ${filters[col.key] ? 'data-table-th-filter-btn-active' : ''}`}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      setOpenFilterKey((k) => (k === col.key ? null : col.key));
                      setAnchorEl(el);
                    }}
                    aria-label={`Filter ${col.label}`}
                  >
                    ▾
                  </button>
                  {openFilterKey === col.key && anchorEl && (
                    <FilterDropdown
                      values={distinctValues[col.key] ?? []}
                      selected={filters[col.key] ?? null}
                      onChange={(next) => setFilters((f) => ({ ...f, [col.key]: next }))}
                      onClose={closeFilter}
                      anchor={anchorEl}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-state">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td key={col.key} style={col.align === 'right' ? { textAlign: 'right' } : undefined}>
                    {col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
