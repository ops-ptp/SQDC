import ExcelJS from 'exceljs';
import { getISOWeekYear } from 'date-fns';
import { metTarget } from '../types';
import type { Kpi } from '../types';
import type { UploadDailyRow, UploadLeadingRow, UploadTargetRow, UploadWeeklyRow } from './data';

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
  Moves: 'Moves',
  'GMPH Mainliner': 'GMPH Mainliner',
  'GMPH Feeder': 'GMPH Feeder',
  // Sheet says "Truck Turnaround Time >1 hour"; the seeded KPI is named
  // "Gate Truck Waiting Time >1 hour" (same metric).
  'Truck Turnaround Time >1 hour': 'Gate Truck Waiting Time >1 hour',
  'QC Preventive Maintenance & Service': 'QC Preventive Maintenance & Service',
  'Average Litres per Vessel Call': 'Average Litres per Vessel Call',
};

// The Target tab's headers mostly match Daily Database's, with a couple of
// its own quirks (confirmed from the real restructured file): "Labour
// Supply" carries "& Lashing" in its header here, and "Mainliner Load GMPH"
// is a single column (no old/new split) whose one target value applies to
// BOTH the new- and old-calculation KPIs — hence two base names for that key.
const TARGET_HEADER_TO_BASES: Record<string, string[]> = {
  'Accident During Operation': ['Accident During Operation'],
  'Delay – Waiting for CHE (L&D)': ['Delay – Waiting for CHE (L&D)'],
  'Overall Mixing Yard': ['Overall Mixing Yard'],
  'Labour Supply (QC Gang & Lashing)': ['Labour Supply as Required – QC Gang'],
  Moves: ['Moves'],
  'GMPH Mainliner': ['GMPH Mainliner'],
  'GMPH Feeder': ['GMPH Feeder'],
  'Mainliner Load GMPH': ['Mainliner Load GMPH', 'Mainliner Load GMPH (Old)'],
  'Truck Turnaround Time >1 hour': ['Gate Truck Waiting Time >1 hour'],
  'QC Preventive Maintenance & Service': ['QC Preventive Maintenance & Service'],
  'Average Litres per Vessel Call': ['Average Litres per Vessel Call'],
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

const CATEGORY_TO_PILLAR_CODE: Record<string, 'S' | 'Q' | 'D' | 'C'> = {
  SAFETY: 'S',
  QUALITY: 'Q',
  DELIVERY: 'D',
  COST: 'C',
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

/** Like cellNumber, but also handles a threshold written as text (e.g. the
 * Target sheet's "Average Litres per Vessel Call" column contains the
 * literal string "≤425" rather than a number) — pulls out the numeric part. */
function cellNumberOrThreshold(v: ExcelJS.CellValue): number | null {
  const n = cellNumber(v);
  if (n !== null) return n;
  if (typeof v === 'string') {
    const m = /[\d.]+/.exec(v);
    if (m) return Number(m[0]);
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

/** Finds the header row (the row containing "Accident During Operation" as
 * a column heading, scanning defensively within the first several rows) —
 * shared by the Daily Database and Target sheets, which use the same
 * layout. Returns -1 if not found. */
function findHeaderRowByAccident(sheet: ExcelJS.Worksheet): number {
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    if (Array.from({ length: row.cellCount }, (_, i) => norm(row.getCell(i + 1).value)).some((v) => v === 'Accident During Operation')) {
      return r;
    }
  }
  return -1;
}

/** Locates a column by its exact header text (case-insensitive), falling
 * back to a hardcoded position when the label isn't present as text — the
 * Target sheet's Date/Shift columns carry no header label of their own
 * (confirmed from the real file), unlike Daily Database's labeled ones. */
function findColumnByHeader(headers: string[], colCount: number, label: string, fallback: number): number {
  for (let c = 1; c <= colCount; c++) {
    if (headers[c]?.toLowerCase() === label.toLowerCase()) return c;
  }
  return fallback;
}

export interface ParsedDailyResult {
  rows: UploadDailyRow[];
  warnings: string[];
  rowsRead: number;
}

/** Parses the "Daily Database" sheet of OPS SQDC Daily.xlsx into upsert-ready
 * daily_entries rows. Does NOT check manual-override protection — that's a
 * separate pre-write step in Admin.tsx (needs a DB round trip).
 *
 * `targetMap` (keyed `${kpi_id}|${entry_date}`) comes from parsing the same
 * workbook's Target sheet first — every KPI's row target is looked up there,
 * falling back to the KPI catalog's fixed target only when no Target-sheet
 * row exists yet for that date. */
export async function parseDailyWorkbook(
  buffer: ArrayBuffer,
  kpis: Kpi[],
  uploadedBy: string | null,
  targetMap?: Map<string, number>
): Promise<ParsedDailyResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /daily database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) throw new Error('Could not find a "Daily Database" sheet in this file.');

  const headerRowNum = findHeaderRowByAccident(sheet);
  if (headerRowNum === -1) throw new Error('Could not find the header row (expected "Accident During Operation" as a column heading).');

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) headers[c] = norm(headerRow.getCell(c).value);

  // Date is column A, Shift is column B in the real file — detected by
  // label text rather than hardcoded, so a future column reshuffle doesn't
  // silently misread every row (this app already got bitten by one such
  // reshuffle: an earlier version of this parser assumed Date/Shift sat one
  // column over from where they actually are in this restructured file).
  const dateCol = findColumnByHeader(headers, colCount, 'Date', 1);
  const shiftCol = findColumnByHeader(headers, colCount, 'Shift', 2);

  // Mainliner Load GMPH: the sheet has separate old/new calculation columns.
  // Both are now captured — new calculation into the existing "Mainliner
  // Load GMPH (Day)/(Night)" KPIs (unchanged meaning), old calculation into
  // the "(Old)" secondary KPIs — rather than discarding one as before.
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
    const date = cellDate(row.getCell(dateCol).value);
    if (!date) continue; // blank/trailer row
    const shiftRaw = norm(row.getCell(shiftCol).value);
    const shift: 'Day' | 'Night' | null = /night/i.test(shiftRaw) ? 'Night' : /day/i.test(shiftRaw) ? 'Day' : null;
    if (!shift) {
      warnings.push(`Row ${r}: unrecognised shift "${shiftRaw}" — skipped.`);
      continue;
    }
    rowsRead++;
    const dateStr = date.toISOString().slice(0, 10);

    function writeValue(base: string, raw: number | null) {
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
      const rowTarget = targetMap?.get(`${target.id}|${dateStr}`) ?? target.target;
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
    if (mainlinerNewCol > 0) writeValue('Mainliner Load GMPH', cellNumber(row.getCell(mainlinerNewCol).value));
    if (mainlinerOldCol > 0) writeValue('Mainliner Load GMPH (Old)', cellNumber(row.getCell(mainlinerOldCol).value));
  }

  return { rows, warnings, rowsRead };
}

export interface ParsedTargetResult {
  targets: UploadTargetRow[];
  warnings: string[];
  rowsRead: number;
}

/** Parses the "Target" sheet of the Daily workbook — Date+Shift rows, one
 * column per KPI, just like Daily Database. Unlike a single flat target
 * row, this lets a KPI's target genuinely change over time (confirmed from
 * the real file: several KPIs' targets step to a new value partway through
 * the sheet). Feeds `kpi_daily_targets`, which the Admin upload consults
 * when snapshotting each daily_entries row's own target. */
export async function parseDailyTargetSheet(buffer: ArrayBuffer, kpis: Kpi[]): Promise<ParsedTargetResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /^target$/i.test(s.name.trim()));
  if (!sheet) {
    return { targets: [], warnings: ['No "Target" sheet found in this file — per-day targets were not updated.'], rowsRead: 0 };
  }

  const headerRowNum = findHeaderRowByAccident(sheet);
  if (headerRowNum === -1) {
    return { targets: [], warnings: ["Could not find the Target sheet's header row — per-day targets were not updated."], rowsRead: 0 };
  }

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) headers[c] = norm(headerRow.getCell(c).value);

  // The Target sheet's Date/Shift columns carry no header text of their own
  // (confirmed from the real file) — fall back to columns A/B, matching
  // Daily Database's actual layout.
  const dateCol = findColumnByHeader(headers, colCount, 'Date', 1);
  const shiftCol = findColumnByHeader(headers, colCount, 'Shift', 2);

  const cols: { col: number; bases: string[] }[] = [];
  for (let c = 1; c <= colCount; c++) {
    const bases = TARGET_HEADER_TO_BASES[headers[c]];
    if (bases) cols.push({ col: c, bases });
  }

  const warnings: string[] = [];
  // Every expected Target header that's genuinely present in the sheet but
  // resolves to no catalog KPI at all — surfaces a naming mismatch loudly
  // instead of silently falling back to the KPI's static catalog target
  // (which is exactly what happened here before this check existed: it
  // looked fine because most targets never change, until one — Labour
  // Supply — actually did).
  for (const [header, bases] of Object.entries(TARGET_HEADER_TO_BASES)) {
    if (!headers.includes(header)) continue;
    for (const base of bases) {
      const hasAny = findRepresentativeKpi(kpis, base) || kpis.some((k) => k.name.startsWith(`${base} (`));
      if (!hasAny) warnings.push(`Target column "${header}" found, but no catalog KPI matches "${base}" — its per-day target was not written.`);
    }
  }
  const targets: UploadTargetRow[] = [];
  let rowsRead = 0;
  // An unsplit KPI (no "(Day)"/"(Night)" catalog rows — e.g. QC Preventive
  // Maintenance & Service, Average Litres per Vessel Call) has both a Day
  // and a Night row in this sheet for the same date, and both resolve to
  // the SAME single kpi_id — without deduping, that pushes two rows with
  // an identical (kpi_id, entry_date) key into one upsert batch, which
  // Postgres rejects outright ("ON CONFLICT DO UPDATE command cannot affect
  // row a second time"), matching parseDailyWorkbook's `singleWritten` dedup.
  const written = new Set<string>();

  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const date = cellDate(row.getCell(dateCol).value);
    if (!date) continue; // blank/trailer row
    const shiftRaw = norm(row.getCell(shiftCol).value);
    const shift: 'Day' | 'Night' | null = /night/i.test(shiftRaw) ? 'Night' : /day/i.test(shiftRaw) ? 'Day' : null;
    if (!shift) continue;
    rowsRead++;
    const dateStr = date.toISOString().slice(0, 10);

    for (const { col, bases } of cols) {
      const raw = cellNumberOrThreshold(row.getCell(col).value);
      if (raw === null) continue;
      for (const base of bases) {
        const kpi = findShiftKpi(kpis, base, shift) ?? findRepresentativeKpi(kpis, base);
        if (!kpi) continue; // unmapped KPI — already warned about during the Daily Database parse
        const key = `${kpi.id}|${dateStr}`;
        if (written.has(key)) continue;
        written.add(key);
        targets.push({ kpi_id: kpi.id, entry_date: dateStr, target: convertValue(raw, kpi) });
      }
    }
  }

  return { targets, warnings, rowsRead };
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

  const headerRowNum = findHeaderRowByAccident(sheet);
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

export interface DetectedNewColumn {
  header: string;
  /** Best-guess pillar, read from the merged category header directly above
   * the column (e.g. "QUALITY") — null when it can't be determined. */
  categoryGuess: 'S' | 'Q' | 'D' | 'C' | null;
  /** Best-guess unit, inferred by sampling the column's own numeric values
   * (see guessUnitFromColumn) — '%' when they all look like a raw ratio
   * (e.g. 0.85), '' otherwise. Only a starting point — same as every other
   * auto-created field, wrong guesses are fixed via the Supabase Table
   * Editor, not an in-app edit screen (KPI Management is show/hide only). */
  unitGuess: string;
}

/** Samples up to 30 numeric values already present in a column (below the
 * header row) and guesses '%' when every one of them sits strictly between
 * -1 and 1 — the same raw-ratio convention every other percentage-style KPI
 * in this app already uses (sheet's 0.11 -> stored/shown as 11%). An empty
 * or all-zero column can't be distinguished this way and falls back to '',
 * same as before this heuristic existed. */
function guessUnitFromColumn(sheet: ExcelJS.Worksheet, col: number, headerRowNum: number): string {
  let sampled = 0;
  for (let r = headerRowNum + 1; r <= sheet.rowCount && sampled < 30; r++) {
    const v = cellNumber(sheet.getRow(r).getCell(col).value);
    if (v === null) continue;
    sampled++;
    if (Math.abs(v) >= 1) return '';
  }
  return sampled > 0 ? '%' : '';
}

/** Scans the Daily Database sheet for column headers that don't map to any
 * known KPI — i.e. a new column the admin added to the spreadsheet. Used by
 * Admin.tsx to auto-create catalog entries before the main parse, so a new
 * column is picked up in the same upload rather than needing a second pass. */
export async function detectNewDailyColumns(buffer: ArrayBuffer): Promise<DetectedNewColumn[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /daily database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) return [];

  const headerRowNum = findHeaderRowByAccident(sheet);
  if (headerRowNum === -1) return [];

  const headerRow = sheet.getRow(headerRowNum);
  const categoryRow = headerRowNum > 1 ? sheet.getRow(headerRowNum - 1) : null;
  const colCount = sheet.columnCount;
  const known = new Set(Object.keys(DAILY_HEADER_TO_BASE));
  known.add('Date');
  known.add('Shift');

  const found: DetectedNewColumn[] = [];
  for (let c = 1; c <= colCount; c++) {
    const header = norm(headerRow.getCell(c).value);
    if (!header || known.has(header)) continue;
    if (/mainliner load gmph/i.test(header)) continue; // handled specially, not "new"
    const cat = categoryRow ? norm(categoryRow.getCell(c).value).toUpperCase() : '';
    found.push({ header, categoryGuess: CATEGORY_TO_PILLAR_CODE[cat] ?? null, unitGuess: guessUnitFromColumn(sheet, c, headerRowNum) });
  }
  return found;
}

/** Same idea for the Next 24hrs sheet — a column whose header doesn't match
 * any existing leading KPI's name (e.g. "Yard Density Projection", added to
 * the sheet with no data yet at the time of writing). */
export async function detectNewLeadingColumns(buffer: ArrayBuffer, leadingKpis: Kpi[]): Promise<DetectedNewColumn[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /next\s*24/i.test(s.name));
  if (!sheet) return [];

  const kpiNames = new Set(leadingKpis.map((k) => k.name));
  let headerRowNum = -1;
  let bestMatchCount = 0;
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    let matches = 0;
    for (let c = 1; c <= sheet.columnCount; c++) {
      if (kpiNames.has(norm(row.getCell(c).value))) matches++;
    }
    if (matches > bestMatchCount) {
      bestMatchCount = matches;
      headerRowNum = r;
    }
  }
  if (headerRowNum === -1) return [];

  const headerRow = sheet.getRow(headerRowNum);
  const categoryRow = headerRowNum > 1 ? sheet.getRow(headerRowNum - 1) : null;
  const colCount = sheet.columnCount;

  const found: DetectedNewColumn[] = [];
  for (let c = 1; c <= colCount; c++) {
    const header = norm(headerRow.getCell(c).value);
    if (!header || header.toLowerCase() === 'date' || kpiNames.has(header)) continue;
    const cat = categoryRow ? norm(categoryRow.getCell(c).value).toUpperCase() : '';
    found.push({ header, categoryGuess: CATEGORY_TO_PILLAR_CODE[cat] ?? null, unitGuess: guessUnitFromColumn(sheet, c, headerRowNum) });
  }
  return found;
}
