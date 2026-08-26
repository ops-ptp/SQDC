import ExcelJS from 'exceljs';
import { getISOWeekYear } from 'date-fns';
import { metTarget } from '../types';
import type { Kpi } from '../types';
import type { UploadDailyRow, UploadLeadingRow, UploadWeeklyRow } from './data';

// ============================================================================
// Column mapping — OPS SQDC Daily.xlsx / OPS SQDC Weekly.xlsx are a fixed,
// known template (not a generic importer), so the mapping below is deliberately
// specific rather than fuzzy-matched. Header text -> the KPI *base name* as
// stored in `kpis.name` (with any " (Day)"/" (Night)" suffix stripped).
//
// A few headers don't match the seeded KPI names 1:1 — documented per entry.
// ============================================================================

const DAILY_HEADER_TO_BASE: Record<string, string> = {
  'Accident During Operation': 'Accident During Operation',
  'Delay – Waiting for CHE (L&D)': 'Delay – Waiting for CHE (L&D)',
  'Overall Mixing Yard': 'Overall Mixing Yard',
  // Sheet says "Labour Supply (QC Gang)"; the seeded KPI is named
  // "Labour Supply as Required – QC Gang".
  'Labour Supply (QC Gang)': 'Labour Supply as Required – QC Gang',
  'GMPH Mainliner': 'GMPH Mainliner',
  'GMPH Feeder': 'GMPH Feeder',
  // Sheet says "Truck Turnaround Time >1 hour"; the seeded KPI is named
  // "Gate Truck Waiting Time >1 hour" (same metric).
  'Truck Turnaround Time >1 hour': 'Gate Truck Waiting Time >1 hour',
  'QC Preventive Maintenance & Service': 'QC Preventive Maintenance & Service',
  'Average Litres per Vessel Call': 'Average Litres per Vessel Call',
};

const WEEKLY_HEADER_TO_BASE: Record<string, string> = {
  'Accident During Operation': 'Accident During Operation',
  'Delay – Waiting for CHE (L&D)': 'Delay – Waiting for CHE (L&D)',
  'Overall Mixing Yard': 'Overall Mixing Yard',
  'GMPH Mainliner': 'GMPH Mainliner',
  'GMPH Feeder': 'GMPH Feeder',
  'Mainliner Load GMPH': 'Mainliner Load GMPH',
  'QC Preventive Maintenance & Service': 'QC Preventive Maintenance & Service',
};

function norm(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
}

function cellDate(v: ExcelJS.CellValue): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date fallback (exceljs usually gives a Date directly for
    // real date cells, but be defensive).
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  return null;
}

/** Finds a representative kpis row for a base name — tries the exact name
 * first, then the " (Day)"/" (Night)" variants. Used to pull unit/target/
 * direction/pillar for a base name that itself has no un-suffixed row. */
function findRepresentativeKpi(kpis: Kpi[], baseName: string): Kpi | undefined {
  return (
    kpis.find((k) => k.name === baseName) ??
    kpis.find((k) => k.name === `${baseName} (Day)`) ??
    kpis.find((k) => k.name === `${baseName} (Night)`)
  );
}

function findShiftKpi(kpis: Kpi[], baseName: string, shift: 'Day' | 'Night'): Kpi | undefined {
  return kpis.find((k) => k.name === `${baseName} (${shift})`) ?? (shift === 'Day' ? kpis.find((k) => k.name === baseName) : undefined);
}

/** Percentage-style KPIs are stored in this app as raw-value×100 (e.g. sheet
 * 0.14 -> 14), matching the existing seed data convention — everything else
 * is written as-is. */
function convertValue(raw: number, kpi: Kpi): number {
  return kpi.unit === '%' ? raw * 100 : raw;
}

export interface ParsedDailyResult {
  rows: UploadDailyRow[];
  warnings: string[];
  rowsRead: number;
}

/** Parses the "Daily Database" sheet of OPS SQDC Daily.xlsx into upsert-ready
 * daily_entries rows. Does NOT check manual-override protection — that's a
 * separate pre-write step in Admin.tsx (needs a DB round trip). */
export async function parseDailyWorkbook(buffer: ArrayBuffer, kpis: Kpi[], uploadedBy: string | null): Promise<ParsedDailyResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /daily database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) throw new Error('Could not find a "Daily Database" sheet in this file.');

  // Header row: the row containing "Accident During Operation" in column D
  // onward (row 4 in the known template, but scan defensively).
  let headerRowNum = -1;
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    if (Array.from({ length: row.cellCount }, (_, i) => norm(row.getCell(i + 1).value)).some((v) => v === 'Accident During Operation')) {
      headerRowNum = r;
      break;
    }
  }
  if (headerRowNum === -1) throw new Error('Could not find the header row (expected "Accident During Operation" as a column heading).');

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) headers[c] = norm(headerRow.getCell(c).value);

  // Moves: the merged "Moves" header has both a "Projection" sub-column and
  // an "Actual" one. Projection is the day's real target (Moves has no fixed
  // catalog target — it's re-projected daily), so it's written into the
  // row's own `target` instead of falling back to the KPI catalog value.
  let movesActualCol = -1;
  let movesProjectionCol = -1;
  for (let c = 1; c <= colCount; c++) {
    if (headers[c] === 'Projection' && headers[c + 1] === 'Actual') {
      movesProjectionCol = c;
      movesActualCol = c + 1;
      break;
    }
  }

  // Mainliner Load GMPH: prefer "(new calculation)", fall back to "(old calculation)".
  let mainlinerNewCol = -1;
  let mainlinerOldCol = -1;
  for (let c = 1; c <= colCount; c++) {
    if (/mainliner load gmph.*new calculation/i.test(headers[c])) mainlinerNewCol = c;
    if (/mainliner load gmph.*old calculation/i.test(headers[c])) mainlinerOldCol = c;
  }

  const simpleCols: { col: number; base: string }[] = [];
  for (let c = 1; c <= colCount; c++) {
    const base = DAILY_HEADER_TO_BASE[headers[c]];
    if (base) simpleCols.push({ col: c, base });
  }

  const warnings: string[] = [];
  const rows: UploadDailyRow[] = [];
  // Dedupe: a single (no Day/Night) KPI should only get one value per date —
  // if both shift rows carry a number for it (shouldn't happen per the known
  // template, but be defensive), the first one wins.
  const singleWritten = new Set<string>();
  let rowsRead = 0;

  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateCell = row.getCell(2).value; // column B
    const date = cellDate(dateCell);
    if (!date) continue; // blank/trailer row
    const shiftRaw = norm(row.getCell(3).value); // column C
    const shift: 'Day' | 'Night' | null = /night/i.test(shiftRaw) ? 'Night' : /day/i.test(shiftRaw) ? 'Day' : null;
    if (!shift) {
      warnings.push(`Row ${r}: unrecognised shift "${shiftRaw}" — skipped.`);
      continue;
    }
    rowsRead++;
    const dateStr = date.toISOString().slice(0, 10);

    // `rawTarget`: when given, overrides the KPI catalog's fixed target with
    // a value read from the sheet itself (e.g. Moves' daily "Projection"
    // column) — the row keeps its own snapshotted target either way.
    function writeValue(base: string, raw: number | null, rawTarget?: number | null) {
      if (raw === null) return;
      const shiftKpi = findShiftKpi(kpis, base, shift!);
      const target = shiftKpi ?? findRepresentativeKpi(kpis, base);
      if (!target) {
        warnings.push(`"${base}" has no matching KPI in the catalog — skipped.`);
        return;
      }
      const isSplit = kpis.some((k) => k.name === `${base} (Day)` || k.name === `${base} (Night)`);
      if (!isSplit) {
        const key = `${target.id}|${dateStr}`;
        if (singleWritten.has(key)) return;
        singleWritten.add(key);
      } else if (!shiftKpi) {
        warnings.push(`"${base} (${shift})" has no matching KPI — skipped for ${dateStr}.`);
        return;
      }
      const actual = convertValue(raw, target);
      const rowTarget = rawTarget != null ? convertValue(rawTarget, target) : target.target;
      rows.push({
        kpi_id: target.id,
        entry_date: dateStr,
        target: rowTarget,
        actual,
        met_target: metTarget(target, rowTarget, actual),
        entered_by: uploadedBy,
      });
    }

    for (const { col, base } of simpleCols) writeValue(base, cellNumber(row.getCell(col).value));
    if (movesActualCol > 0) {
      const movesActual = cellNumber(row.getCell(movesActualCol).value);
      const movesProjection = movesProjectionCol > 0 ? cellNumber(row.getCell(movesProjectionCol).value) : null;
      if (movesActual !== null && movesProjection === null) {
        warnings.push(`Moves (${shift}) on ${dateStr}: no Projection value found — used the catalog's fixed target instead.`);
      }
      writeValue('Moves', movesActual, movesProjection);
    }
    if (mainlinerNewCol > 0 || mainlinerOldCol > 0) {
      const newVal = mainlinerNewCol > 0 ? cellNumber(row.getCell(mainlinerNewCol).value) : null;
      const oldVal = mainlinerOldCol > 0 ? cellNumber(row.getCell(mainlinerOldCol).value) : null;
      writeValue('Mainliner Load GMPH', newVal ?? oldVal);
    }
  }

  return { rows, warnings, rowsRead };
}

export interface ParsedWeeklyResult {
  rows: UploadWeeklyRow[];
  warnings: string[];
  rowsRead: number;
}

/** Parses the "Weekly Database" sheet of OPS SQDC Weekly.xlsx. Week labels
 * ("Week 27") carry no year, so the upload assumes the current ISO year —
 * flagged in the README as an explicit assumption. */
export async function parseWeeklyWorkbook(buffer: ArrayBuffer, kpis: Kpi[], uploadedBy: string | null): Promise<ParsedWeeklyResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /weekly database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) throw new Error('Could not find a "Weekly Database" sheet in this file.');

  let headerRowNum = -1;
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    if (Array.from({ length: row.cellCount }, (_, i) => norm(row.getCell(i + 1).value)).some((v) => v === 'Accident During Operation')) {
      headerRowNum = r;
      break;
    }
  }
  if (headerRowNum === -1) throw new Error('Could not find the header row (expected "Accident During Operation" as a column heading).');

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const cols: { col: number; base: string }[] = [];
  for (let c = 1; c <= colCount; c++) {
    const base = WEEKLY_HEADER_TO_BASE[norm(headerRow.getCell(c).value)];
    if (base) cols.push({ col: c, base });
  }

  const assumedIsoYear = getISOWeekYear(new Date());
  const warnings: string[] = [`Week labels have no year in this sheet — assumed ISO year ${assumedIsoYear}.`];
  const rows: UploadWeeklyRow[] = [];
  let rowsRead = 0;

  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const weekLabel = norm(row.getCell(2).value); // column B, e.g. "Week 27"
    const m = /week\s*(\d+)/i.exec(weekLabel);
    if (!m) continue; // blank/trailer row
    const isoWeek = Number(m[1]);
    rowsRead++;

    for (const { col, base } of cols) {
      const raw = cellNumber(row.getCell(col).value);
      if (raw === null) continue;
      const kpi = findRepresentativeKpi(kpis, base);
      if (!kpi) {
        warnings.push(`"${base}" has no matching KPI in the catalog — skipped.`);
        continue;
      }
      const actual = convertValue(raw, kpi);
      rows.push({
        pillar_id: kpi.pillar_id,
        kpi_base_name: base,
        iso_year: assumedIsoYear,
        iso_week: isoWeek,
        target: kpi.target,
        actual,
        met_target: metTarget(kpi, kpi.target, actual),
        uploaded_by: uploadedBy,
      });
    }
  }

  return { rows, warnings, rowsRead };
}

export interface ParsedLeadingResult {
  rows: UploadLeadingRow[];
  warnings: string[];
  rowsRead: number;
}

/** Parses the "Next 24hrs" sheet of the Daily workbook — one row per date,
 * one column per leading KPI, each cell a plain projected number (no
 * target). Unlike the Daily Database mapping above, headers here are
 * matched directly against `kpis.name` rather than through a translation
 * table, since the sheet's column headers already are the exact KPI names. */
export async function parseNext24hrsWorkbook(
  buffer: ArrayBuffer,
  leadingKpis: Kpi[],
  uploadedBy: string | null
): Promise<ParsedLeadingResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /next\s*24/i.test(s.name));
  if (!sheet) {
    return {
      rows: [],
      warnings: ['No "Next 24hrs" sheet found in this file — leading KPI figures were not updated.'],
      rowsRead: 0,
    };
  }

  const kpiByName = new Map(leadingKpis.map((k) => [k.name, k]));

  // Header row: whichever row has the most cells matching a known leading
  // KPI name (defensive — the known template has it in row 3).
  let headerRowNum = -1;
  let bestMatchCount = 0;
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    let matches = 0;
    for (let c = 1; c <= sheet.columnCount; c++) {
      if (kpiByName.has(norm(row.getCell(c).value))) matches++;
    }
    if (matches > bestMatchCount) {
      bestMatchCount = matches;
      headerRowNum = r;
    }
  }
  if (headerRowNum === -1) {
    return {
      rows: [],
      warnings: [
        'Could not find the "Next 24hrs" header row (expected leading KPI names as column headings) — leading KPI figures were not updated.',
      ],
      rowsRead: 0,
    };
  }

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const cols: { col: number; kpi: Kpi }[] = [];
  for (let c = 1; c <= colCount; c++) {
    const kpi = kpiByName.get(norm(headerRow.getCell(c).value));
    if (kpi) cols.push({ col: c, kpi });
  }

  const warnings: string[] = leadingKpis
    .filter((k) => !cols.some((c) => c.kpi.id === k.id))
    .map((k) => `"${k.name}" has no matching column in the Next 24hrs sheet — skipped.`);

  const rows: UploadLeadingRow[] = [];
  let rowsRead = 0;

  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const date = cellDate(row.getCell(2).value); // column B, known template
    if (!date) continue; // blank/trailer row
    rowsRead++;
    const dateStr = date.toISOString().slice(0, 10);

    for (const { col, kpi } of cols) {
      const raw = cellNumber(row.getCell(col).value);
      if (raw === null) continue; // not yet entered for this date
      rows.push({ kpi_id: kpi.id, entry_date: dateStr, value: convertValue(raw, kpi), uploaded_by: uploadedBy });
    }
  }

  return { rows, warnings, rowsRead };
}
