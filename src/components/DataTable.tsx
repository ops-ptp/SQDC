import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckField, TextField } from './ui';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  accessor: (row: T) => string | number;
  align?: 'left' | 'right';
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
  anchorRect,
}: {
  values: string[];
  /** null = no filter active (everything shown, every box reads as checked) */
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  onClose: () => void;
  /** Bounding rect of the ▾ button that opened this — positions the
   * portal-rendered dropdown under it. Rendered via a portal (not inline in
   * the header cell) because the table body scrolls with a fixed max-
   * height; an inline-positioned dropdown would get clipped by that
   * scroll container the moment it's more than a few rows down. */
  anchorRect: DOMRect;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element;
      // The ▾ buttons toggle the dropdown themselves on click — closing here
      // first would make a click on the open column's ▾ re-open it.
      if (target.closest?.('.data-table-th-filter-btn')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    // The dropdown is fixed-positioned from where its ▾ was when it opened,
    // so it would float away from the column once anything scrolls.
    function handleScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

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
      style={{ position: 'fixed', zIndex: 200, top: anchorRect.bottom + 4, left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 236)) }}
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
            <span className="data-table-filter-option-text">{v || '(blank)'}</span>
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
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [sort, setSort] = useState<SortState>(null);

  // Distinct values per column, from the full row set — same "every value
  // that ever appears here" scope Excel's own AutoFilter dropdown uses.
  const distinctValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      map[col.key] = Array.from(new Set(rows.map((r) => String(col.accessor(r))))).sort();
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col) => {
        const sel = filters[col.key];
        if (!sel) return true;
        return sel.has(String(col.accessor(row)));
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
                      const rect = e.currentTarget.getBoundingClientRect();
                      setOpenFilterKey((k) => (k === col.key ? null : col.key));
                      setAnchorRect(rect);
                    }}
                    aria-label={`Filter ${col.label}`}
                  >
                    ▾
                  </button>
                  {openFilterKey === col.key && anchorRect && (
                    <FilterDropdown
                      values={distinctValues[col.key] ?? []}
                      selected={filters[col.key] ?? null}
                      onChange={(next) => setFilters((f) => ({ ...f, [col.key]: next }))}
                      onClose={closeFilter}
                      anchorRect={anchorRect}
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
