import Papa from 'papaparse';
import type { CategoryImportRow, RawEntryRow } from './data';

/** Builds the CSV an admin downloads from Insights — exactly the rows
 * currently visible in the on-screen table (whatever sort/filter is
 * applied there), for the one KPI selected via the pillar/KPI pills.
 * Column order matters for readability (id first, category last, empty
 * and ready to be filled in) but not for re-import — parseCategoryCsv
 * matches by header name, not position, so the AI reordering or adding
 * columns doesn't break anything. */
export function buildExportCsv(rows: RawEntryRow[]): string {
  const data = rows.map((r) => ({
    id: r.id,
    date: r.entry_date,
    shift: r.shift ?? '',
    actual: r.actual,
    target: r.target,
    unit: r.unit,
    reason: r.reason,
    remarks: r.remarks,
    category: r.ai_category ?? '',
  }));
  return Papa.unparse(data);
}

export interface ParsedCategoryImport {
  rows: CategoryImportRow[];
  warnings: string[];
}

function findHeader(fields: string[] | undefined, candidates: string[]): string | undefined {
  if (!fields) return undefined;
  const lower = fields.map((f) => f.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return fields[idx];
  }
  return undefined;
}

/** Parses a re-uploaded CSV back into (id, category) pairs. Deliberately
 * tolerant of what an AI tool might do to the file — different column
 * order, different capitalization, extra columns it added along the way —
 * matching by header name rather than position, and only requiring "id"
 * and something that looks like a category column to exist at all. */
export function parseCategoryCsv(text: string): ParsedCategoryImport {
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const warnings: string[] = [];
  if (result.errors.length > 0) {
    warnings.push(...result.errors.slice(0, 5).map((e) => `Row ${e.row ?? '?'}: ${e.message}`));
  }

  const idKey = findHeader(result.meta.fields, ['id']);
  const categoryKey = findHeader(result.meta.fields, ['category', 'categories', 'bucket', 'group']);

  if (!idKey) {
    return { rows: [], warnings: ['Could not find an "id" column in this file — make sure you started from a file downloaded here, and that column was not removed or renamed.'] };
  }
  if (!categoryKey) {
    return { rows: [], warnings: ['Could not find a "category" column in this file — check that the AI added its answer in a column named "category".'] };
  }

  const rows: CategoryImportRow[] = [];
  for (const row of result.data) {
    const id = row[idKey]?.trim();
    const category = row[categoryKey]?.trim();
    if (!id) continue;
    if (!category) {
      warnings.push(`Row with id ${id} has no category — skipped.`);
      continue;
    }
    rows.push({ id, category });
  }
  return { rows, warnings };
}
