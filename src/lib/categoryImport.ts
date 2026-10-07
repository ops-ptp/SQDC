import ExcelJS from 'exceljs';
import type { Kpi } from '../types';
import { baseNameOf } from '../types';
import { cleanLabel, DEFAULT_DIMENSION } from './categoryCore';

// ---------------------------------------------------------------------------
// Import of the team's weekly Pareto workbook (weekly_paretto.xlsx).
//
// The workbook has, per KPI, a "<KPI> Remarks" log sheet — one row per
// missed shift: date | shift | actual | target | unit | reason | remarks |
// category 1..N — plus a hand-built "Week NN & NN" summary sheet. Only the
// log sheets are read; the summaries are what the app now computes itself.
//
// Accident's log sheet groups its category columns under three dimension
// headings in the row(s) above the header (Location / Equipment / Symptom);
// every other sheet's categories are a single "Cause" dimension.
// ---------------------------------------------------------------------------

/** Sheet-name stem → KPI base name, for the stems that don't already match
 * a KPI's base name exactly (case-insensitive). */
const SHEET_ALIASES: Record<string, string> = {
  accident: 'Accident During Operation',
  'overall mix yard': 'Overall Mixing Yard',
};

/** Known header typos corrected for display only (dimension names become
 * tab labels on the board). Category labels themselves are never changed. */
const DIMENSION_FIXES: Record<string, string> = { sympthom: 'Symptom' };

interface ParsedTag {
  dimension: string;
  category: string;
}

interface ParsedRemarkRow {
  sheet: string;
  rowNumber: number;
  date: string; // yyyy-mm-dd
  shift: 'Day' | 'Night' | null;
  actual: number | null;
  reason: string;
  remarks: string;
  tags: ParsedTag[];
}

interface ParsedSheet {
  sheet: string;
  /** Resolved KPI base name, or null when the sheet name matched nothing. */
  kpiBase: string | null;
  rows: ParsedRemarkRow[];
}

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('');
    if ('result' in o) return o.result === undefined || o.result === null ? '' : text(o.result as ExcelJS.CellValue);
    if ('text' in o) return text(o.text as ExcelJS.CellValue);
    return '';
  }
  return String(v);
}

function cellDate(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (v && typeof v === 'object' && 'result' in v) return cellDate((v as { result: ExcelJS.CellValue }).result);
  const s = text(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function cellNum(v: ExcelJS.CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return cellNum((v as { result: ExcelJS.CellValue }).result);
  const s = text(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveKpiBase(sheetName: string, baseNames: string[]): string | null {
  const stem = cleanLabel(sheetName.replace(/\s*remarks?\s*$/i, '')).toLowerCase();
  const exact = baseNames.find((b) => b.toLowerCase() === stem);
  if (exact) return exact;
  const alias = SHEET_ALIASES[stem];
  if (alias && baseNames.includes(alias)) return alias;
  return null;
}

/** Reads every remarks-log sheet in the workbook. `baseNames` is the list of
 * known KPI base names, used to resolve each sheet to a KPI. */
export async function parseParetoWorkbook(buffer: ArrayBuffer, baseNames: string[]): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out: ParsedSheet[] = [];

  for (const ws of wb.worksheets) {
    // Header row: the first of rows 1-6 with both "date" and "shift".
    let headerRow = 0;
    const colOf: Record<string, number> = {};
    for (let r = 1; r <= Math.min(6, ws.rowCount) && !headerRow; r++) {
      const row = ws.getRow(r);
      const found: Record<string, number> = {};
      for (let c = 1; c <= ws.columnCount; c++) {
        const h = cleanLabel(text(row.getCell(c).value)).toLowerCase();
        if (h && !(h in found)) found[h] = c;
      }
      if ('date' in found && 'shift' in found) {
        headerRow = r;
        Object.assign(colOf, found);
      }
    }
    if (!headerRow) continue; // a summary sheet, not a remarks log

    // Category columns, each with its dimension from the nearest non-empty
    // cell above it (Accident only); otherwise the default dimension.
    const catCols: { col: number; dimension: string }[] = [];
    const hdr = ws.getRow(headerRow);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (!/^category\s*\d+$/i.test(cleanLabel(text(hdr.getCell(c).value)))) continue;
      let dimension = DEFAULT_DIMENSION;
      for (let r = headerRow - 1; r >= 1; r--) {
        const above = cleanLabel(text(ws.getRow(r).getCell(c).value));
        if (above) {
          const name = cleanLabel(above.replace(/\(.*$/, ''));
          dimension = DIMENSION_FIXES[name.toLowerCase()] ?? name;
          break;
        }
      }
      catCols.push({ col: c, dimension });
    }
    if (catCols.length === 0) continue;

    const rows: ParsedRemarkRow[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const date = cellDate(row.getCell(colOf.date).value);
      if (!date) continue;
      const shiftText = cleanLabel(text(row.getCell(colOf.shift).value)).toLowerCase();
      const shift = shiftText.startsWith('day') ? 'Day' : shiftText.startsWith('night') ? 'Night' : null;
      const tags: ParsedTag[] = [];
      for (const { col, dimension } of catCols) {
        const category = cleanLabel(text(row.getCell(col).value));
        if (category && !tags.some((t) => t.dimension === dimension && t.category === category)) {
          tags.push({ dimension, category });
        }
      }
      rows.push({
        sheet: ws.name,
        rowNumber: r,
        date,
        shift,
        actual: colOf.actual ? cellNum(row.getCell(colOf.actual).value) : null,
        reason: colOf.reason ? cleanLabel(text(row.getCell(colOf.reason).value)) : '',
        remarks: colOf.remarks ? text(row.getCell(colOf.remarks).value).trim() : '',
        tags,
      });
    }
    out.push({ sheet: ws.name, kpiBase: resolveKpiBase(ws.name, baseNames), rows });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matching parsed rows to existing daily entries.
// ---------------------------------------------------------------------------

interface EntryLite {
  id: string;
  kpi_id: string;
  entry_date: string;
  actual: number;
  remarks: string | null;
}

interface RowMatch {
  row: ParsedRemarkRow;
  entryId: string;
  /** True when the matched entry is a secondary ("Old" calculation) KPI —
   * its tags are stored but don't count toward the board's Pareto. */
  secondary: boolean;
}

function shiftOf(kpiName: string): 'Day' | 'Night' | null {
  if (/\(Day\)\s*$/i.test(kpiName)) return 'Day';
  if (/\(Night\)\s*$/i.test(kpiName)) return 'Night';
  return null;
}

/** Matches each tagged row to the daily entry for the same KPI family
 * (incl. secondary/Old variants), date and shift. When several entries
 * qualify (Mainliner Load GMPH lists its new- and old-calculation figures as
 * two rows per shift), the one whose actual is closest to the row's wins. */
export function matchRows(
  rows: ParsedRemarkRow[],
  familyKpis: Kpi[],
  entries: EntryLite[]
): { matches: RowMatch[]; unmatched: ParsedRemarkRow[] } {
  const kpiById = new Map(familyKpis.map((k) => [k.id, k]));
  const matches: RowMatch[] = [];
  const unmatched: ParsedRemarkRow[] = [];
  for (const row of rows) {
    if (row.tags.length === 0) continue; // nothing to import for this row
    const candidates = entries.filter((e) => {
      const k = kpiById.get(e.kpi_id);
      if (!k || e.entry_date !== row.date) return false;
      const s = shiftOf(k.name);
      return row.shift === null || s === null || s === row.shift;
    });
    if (candidates.length === 0) {
      unmatched.push(row);
      continue;
    }
    let best = candidates.find((e) => !kpiById.get(e.kpi_id)!.is_secondary) ?? candidates[0];
    if (row.actual !== null && candidates.length > 1) {
      best = candidates.reduce((a, b) => (Math.abs(b.actual - row.actual!) < Math.abs(a.actual - row.actual!) ? b : a));
    }
    matches.push({ row, entryId: best.id, secondary: kpiById.get(best.kpi_id)!.is_secondary });
  }
  return { matches, unmatched };
}

/** KPIs belonging to a base name (Day/Night/Old variants), lagging only. */
export function familyOf(kpis: Kpi[], base: string): Kpi[] {
  return kpis.filter((k) => !k.is_leading && baseNameOf(k.name) === base);
}
