import { useEffect, useMemo, useState } from 'react';

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
  /** Called whenever the filtered+sorted result changes — lets the parent
   * export/act on exactly what's currently visible in the table, matching
   * the spreadsheet mental model of "download what I'm looking at" rather
   * than a separately-tracked selection. */
  onVisibleRowsChange?: (rows: T[]) => void;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** A small Excel-like table: click a header to sort (cycles asc -> desc ->
 * unsorted), type in the box under a header to filter that column
 * (case-insensitive "contains", matched against the same value shown in
 * the cell). Deliberately simple — one filter mode for every column,
 * rather than per-type filter UIs — since these are short human-entered
 * strings and small numbers, not the kind of data that needs a real
 * spreadsheet's range/date-picker filters. */
export default function DataTable<T>({ columns, rows, rowKey, emptyMessage = 'No rows.', onVisibleRowsChange }: Props<T>) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);

  const filtered = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col) => {
        const f = filters[col.key]?.trim().toLowerCase();
        if (!f) return true;
        return String(col.accessor(row)).toLowerCase().includes(f);
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

  useEffect(() => {
    onVisibleRowsChange?.(sorted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

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
              <th key={col.key} className="data-table-sortable-th" onClick={() => toggleSort(col.key)}>
                {col.label}
                {sort?.key === col.key ? (sort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : ''}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="data-table-filter-th">
                <input
                  className="data-table-filter-input"
                  placeholder="Filter…"
                  value={filters[col.key] ?? ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                />
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
