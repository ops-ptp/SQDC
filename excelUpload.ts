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

/** True if this header already corresponds to a known KPI in the catalog —
 * either an exact-name match (an unsplit KPI) or a "${header} (Day)" /
 * "${header} (Night)" split pair with no bare-name row of its own. Shared
 * by detectNewDailyColumns ("is this header new?") and parseDailyWorkbook
 * ("which base does this column's values belong to?") so the two can never
 * disagree — checking exact-name-only in either place means a KPI that's
 * been split into Day/Night variants stops being recognised there: its
 * column silently stops being read (parseDailyWorkbook) while
 * simultaneously getting flagged as a brand-new column again
 * (detectNewDailyColumns), offering to create a duplicate. */
function isKnownBase(kpis: Kpi[], header: string): boolean {
  return kpis.some((k) => k.name === header || k.name === `${header} (Day)` || k.name === `${header} (Night)`);
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

  // A header maps to a base name either via the known static translation
  // table above, or — for a column an admin added to the spreadsheet after
  // launch — by matching the header text directly against a KPI already in
  // the catalog (auto-created by detectNewDailyColumns on a prior upload,
  // same as parseNext24hrsWorkbook already does for leading KPIs). Without
  // this second path, a newly auto-created KPI's name would appear in the
  // catalog but its column's numbers would never be read on any upload,
  // including this one and every one after it.
  const simpleCols: { col: number; base: string }[] = [];
  for (let c = 1; c <= colCount; c++) {
    const base = DAILY_HEADER_TO_BASE[headers[c]] ?? (isKnownBase(kpis, headers[c]) ? headers[c] : undefined);
    if (base) simpleCols.push({ col: c, base });
  }

  const warnings: string[] = [];
  const rows: UploadDailyRow[] = [];
  // Dedupe: a single (no Day/Night) KPI should only get one value per date.
  // Stores the actual value already written (not just whether one was), so
  // if a second shift's number for the same KPI/date turns up and it's
  // GENUINELY DIFFERENT — not just a redundant re-write of the same figure
  // — that's a real sign this KPI should have been split into Day/Night
  // and wasn't (e.g. it was auto-created before the other shift's data
  // existed in the sheet yet, so there was nothing to detect at the time).
  // Surfaced as a warning rather than silently dropped, so it gets noticed
  // the moment it actually happens instead of relying on catching it later.
  const singleWritten = new Map<string, number>();
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
        const already = singleWritten.get(key);
        if (already !== undefined) {
          if (Math.abs(already - raw) > 1e-9) {
            warnings.push(
              `"${base}" has different Day and Night values on ${dateStr} (${already} vs ${raw}) but is set up as a single KPI — only ${already} was kept. If Day and Night should be tracked separately for this KPI, it needs to be split in the catalog.`
            );
          }
          return;
        }
        singleWritten.set(key, raw);
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
    // Same catalog fallback as parseDailyWorkbook: a header not in the
    // static TARGET_HEADER_TO_BASES table may still be a KPI an admin added
    // after launch — match it directly against the live catalog so its
    // per-day target actually gets written instead of the new KPI sitting
    // at its creation-time default (target: 0) forever.
    const bases = TARGET_HEADER_TO_BASES[headers[c]] ?? (kpis.some((k) => k.name === headers[c]) ? [headers[c]] : undefined);
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
  /** True when this column actually carries distinct values under BOTH the
   * Day and Night shift rows in the sheet — meaning it needs two catalog
   * rows ("X (Day)" / "X (Night)"), not one. Determined by reading real
   * data, not guessed from the header: the sheet has no separate Day/Night
   * *columns* (one column serves both shifts, split by which row a given
   * date's Day/Night entry sits on), so there's no way to tell from the
   * header text alone whether a column is meant to be split. Getting this
   * wrong silently drops one shift's numbers forever — a single-row KPI
   * can only ever hold one value per date, so if both shifts really do
   * carry different figures, the second one written each day gets thrown
   * away by the write path's own single-value-per-date dedup. */
  bothShifts: boolean;
}

/** Reads the actual Excel cell format for a column, rather than guessing
 * from the values themselves — the previous magnitude-only heuristic
 * ("percent if every sampled value is between -1 and 1") broke for any
 * genuinely-percent column that happened to hit exactly 100% (stored as the
 * value 1, which is not "strictly between -1 and 1"), e.g. an SLA/delivery
 * column that's occasionally at target. Excel's own per-cell number format
 * (e.g. "0%", "0.00%") is the ground truth for "is this a percentage" — no
 * guessing needed when it's explicitly set.
 *
 * Returns '%' or '' when the format makes the answer unambiguous ('0%' /
 * '0.00%' -> '%'; 'General', '0.00', '#,##0', etc. -> a definite non-%),
 * or null when every sampled cell is unformatted/blank and the caller
 * should fall back to the old value-based guess. */
function guessUnitFromNumberFormat(sheet: ExcelJS.Worksheet, col: number, headerRowNum: number): string | null {
  for (let r = headerRowNum + 1; r <= sheet.rowCount && r < headerRowNum + 31; r++) {
    const cell = sheet.getRow(r).getCell(col);
    if (cell.value === null || cell.value === undefined) continue;
    const fmt = cell.numFmt;
    if (!fmt || fmt === 'General') continue; // ambiguous — no explicit format to trust
    return fmt.includes('%') ? '%' : '';
  }
  return null;
}

/** Samples up to 30 numeric values already present in a column (below the
 * header row) and guesses '%' when every one of them sits strictly between
 * -1 and 1 — the same raw-ratio convention every other percentage-style KPI
 * in this app already uses (sheet's 0.11 -> stored/shown as 11%). An empty
 * or all-zero column can't be distinguished this way and falls back to '',
 * same as before this heuristic existed.
 *
 * Only used as a fallback when the column's own Excel cell format (see
 * guessUnitFromNumberFormat) doesn't give a definite answer — reading the
 * sheet's actual number format is more reliable than guessing from
 * magnitude and is tried first. */
function guessUnitFromColumn(sheet: ExcelJS.Worksheet, col: number, headerRowNum: number): string {
  const fromFormat = guessUnitFromNumberFormat(sheet, col, headerRowNum);
  if (fromFormat !== null) return fromFormat;

  let sampled = 0;
  for (let r = headerRowNum + 1; r <= sheet.rowCount && sampled < 30; r++) {
    const v = cellNumber(sheet.getRow(r).getCell(col).value);
    if (v === null) continue;
    sampled++;
    if (Math.abs(v) >= 1) return '';
  }
  return sampled > 0 ? '%' : '';
}

/** Scans a column for real values under both shift rows — see the
 * `bothShifts` doc comment on DetectedNewColumn for why this has to read
 * actual data rather than being guessable from the header. Stops as soon
 * as both have been seen at least once; doesn't require every date to have
 * both (a KPI can still be "split" even if a few dates are missing one
 * shift's entry). */
function detectBothShifts(sheet: ExcelJS.Worksheet, col: number, headerRowNum: number, shiftCol: number): boolean {
  let hasDay = false;
  let hasNight = false;
  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const v = cellNumber(sheet.getRow(r).getCell(col).value);
    if (v === null) continue;
    const shiftRaw = norm(sheet.getRow(r).getCell(shiftCol).value);
    if (/night/i.test(shiftRaw)) hasNight = true;
    else if (/day/i.test(shiftRaw)) hasDay = true;
    if (hasDay && hasNight) return true;
  }
  return false;
}

/** Scans the Daily Database sheet for column headers that don't map to any
 * known KPI — i.e. a new column the admin added to the spreadsheet. Used by
 * Admin.tsx to auto-create catalog entries before the main parse, so a new
 * column is picked up in the same upload rather than needing a second pass.
 *
 * `existingKpis` must be the live catalog (including anything auto-created
 * by a previous upload) — a header is only "new" if it matches neither the
 * static translation table nor an existing KPI's name. Without checking the
 * live catalog here, a column auto-created on upload #1 would still look
 * "new" on upload #2 and get created again, producing duplicate KPI rows. */
export async function detectNewDailyColumns(buffer: ArrayBuffer, existingKpis: Kpi[] = []): Promise<DetectedNewColumn[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /daily database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) return [];

  const headerRowNum = findHeaderRowByAccident(sheet);
  if (headerRowNum === -1) return [];

  const headerRow = sheet.getRow(headerRowNum);
  const categoryRow = headerRowNum > 1 ? sheet.getRow(headerRowNum - 1) : null;
  const colCount = sheet.columnCount;
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) headers[c] = norm(headerRow.getCell(c).value);
  const shiftCol = findColumnByHeader(headers, colCount, 'Shift', 2);
  const known = new Set(Object.keys(DAILY_HEADER_TO_BASE));
  known.add('Date');
  known.add('Shift');

  const found: DetectedNewColumn[] = [];
  for (let c = 1; c <= colCount; c++) {
    const header = headers[c];
    if (!header || known.has(header) || isKnownBase(existingKpis, header)) continue;
    if (/mainliner load gmph/i.test(header)) continue; // handled specially, not "new"
    const cat = categoryRow ? norm(categoryRow.getCell(c).value).toUpperCase() : '';
    found.push({
      header,
      categoryGuess: CATEGORY_TO_PILLAR_CODE[cat] ?? null,
      unitGuess: guessUnitFromColumn(sheet, c, headerRowNum),
      bothShifts: detectBothShifts(sheet, c, headerRowNum, shiftCol),
    });
  }
  return found;
}

export interface ColumnRemoval {
  kpi: Kpi;
  /** The spreadsheet column header this KPI's data used to come from —
   * shown to the admin so they can see why it's flagged. */
  expectedHeader: string;
}

/** Every currently-ACTIVE lagging KPI whose spreadsheet column is no longer
 * present in this Daily Database sheet — e.g. a column the team deleted
 * from the workbook. This only READS the file; it doesn't touch the
 * database. Admin.tsx shows the result to the admin as a preview and only
 * hides (kpis.active = false) anything here after they confirm — nothing
 * is ever deleted from the catalog by this, matching the same "hide, don't
 * delete" rule new-column auto-creation already follows in reverse. */
export async function detectRemovedDailyColumns(buffer: ArrayBuffer, existingKpis: Kpi[]): Promise<ColumnRemoval[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /daily database/i.test(s.name)) ?? wb.worksheets[0];
  if (!sheet) return [];

  const headerRowNum = findHeaderRowByAccident(sheet);
  if (headerRowNum === -1) return [];
  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const headers = new Set<string>();
  for (let c = 1; c <= colCount; c++) {
    const h = norm(headerRow.getCell(c).value);
    if (h) headers.add(h);
  }

  // Which base KPI names this sheet's headers currently account for — the
  // exact same header -> base resolution parseDailyWorkbook itself uses, so
  // "removed" can never disagree with what a real upload would actually
  // read from this file.
  const presentBases = new Set<string>();
  for (const h of headers) presentBases.add(DAILY_HEADER_TO_BASE[h] ?? h);
  if ([...headers].some((h) => /mainliner load gmph.*new calculation/i.test(h))) presentBases.add('Mainliner Load GMPH');
  if ([...headers].some((h) => /mainliner load gmph.*old calculation/i.test(h))) presentBases.add('Mainliner Load GMPH (Old)');

  const removed: ColumnRemoval[] = [];
  for (const k of existingKpis) {
    if (!k.active) continue; // already hidden — nothing new to flag
    const base = k.name.replace(/\s*\((Day|Night)\)\s*$/i, '');
    if (!presentBases.has(base)) removed.push({ kpi: k, expectedHeader: base });
  }
  return removed;
}

/** Same idea for the Next 24hrs sheet — an active leading KPI whose exact-
 * name column is no longer present. */
export async function detectRemovedLeadingColumns(buffer: ArrayBuffer, existingLeadingKpis: Kpi[]): Promise<ColumnRemoval[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets.find((s) => /next\s*24/i.test(s.name));
  if (!sheet) return [];

  const kpiNames = new Set(existingLeadingKpis.map((k) => k.name));
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
  // Can't locate a header row without at least one recognisable existing
  // column to anchor on — nothing to safely compare against, so report no
  // removals rather than risk a false positive from a misread row.
  if (headerRowNum === -1) return [];

  const headerRow = sheet.getRow(headerRowNum);
  const colCount = sheet.columnCount;
  const headers = new Set<string>();
  for (let c = 1; c <= colCount; c++) {
    const h = norm(headerRow.getCell(c).value);
    if (h) headers.add(h);
  }

  return existingLeadingKpis.filter((k) => k.active && !headers.has(k.name)).map((k) => ({ kpi: k, expectedHeader: k.name }));
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
    found.push({
      header,
      categoryGuess: CATEGORY_TO_PILLAR_CODE[cat] ?? null,
      unitGuess: guessUnitFromColumn(sheet, c, headerRowNum),
      // Leading KPIs (Next 24hrs) have no shift concept at all — one figure
      // per KPI per date, never split by Day/Night.
      bothShifts: false,
    });
  }
  return found;
}
