export interface Pillar {
  id: string;
  code: 'S' | 'Q' | 'D' | 'C';
  name: string;
  sort_order: number;
}

export interface Employee {
  id: string;
  employee_code: string;
  name: string;
  active: boolean;
  is_admin: boolean;
}

export interface Kpi {
  id: string;
  pillar_id: string;
  name: string;
  unit: string;
  is_higher_better: boolean;
  target: number;
  info: string | null;
  active: boolean;
  sort_order: number;
  is_leading: boolean;
  /** True for the 3 KPIs that keep manual Performance-value entry in Enter
   * Remarks (Accident During Operation, QC Preventive Maintenance & Service,
   * Average Litres per Vessel Call) — everything else is remarks-only, its
   * Performance values coming from the Admin Excel upload instead. */
  manual_entry: boolean;
  /** True for a secondary/comparison metric (e.g. "Mainliner Load GMPH
   * (Old)", the superseded calculation kept for reference next to the
   * current figure) — never itself selectable in Enter Remarks or the
   * Action Log's KPI picker, and never counted in "needs a remark". */
  is_secondary: boolean;
}

export interface KpiWithPillar extends Kpi {
  pillar: Pick<Pillar, 'code' | 'name'>;
}

export interface Reason {
  id: string;
  kpi_id: string;
  label: string;
  active: boolean;
  sort_order: number;
}

export interface DailyEntry {
  id: string;
  kpi_id: string;
  entry_date: string; // yyyy-mm-dd
  target: number;
  actual: number;
  met_target: boolean;
  reason_id: string | null;
  reason_other: string | null;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
  /** True when this row's `actual` was typed in by a person (Enter Remarks,
   * for one of the 3 manual_entry KPIs) rather than written by the Admin
   * Excel upload. The upload treats its own value as a fallback only — it
   * must never overwrite a row with this set to true. */
  is_manual_override: boolean;
  /** Free-text category an admin assigned via the Insights CSV export →
   * AI categorize → re-import workflow (e.g. "Equipment", "Staffing" — or
   * whatever angle they chose that cycle). null until categorized. Not
   * used anywhere else in the app — purely for the Insights pivot view. */
  ai_category: string | null;
}

/** A blended (no Day/Night split) weekly figure from the Admin Weekly Excel
 * upload — keyed by pillar + KPI base name rather than a strict kpi_id,
 * since most KPIs only exist as Day/Night-split rows in `kpis`. Used as a
 * fallback for the Weekly board when a given ISO week has no live
 * daily_entries to aggregate from. */
export interface WeeklyEntry {
  id: string;
  pillar_id: string;
  kpi_base_name: string;
  iso_year: number;
  iso_week: number;
  target: number;
  actual: number;
  met_target: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  pillar_id: string;
  kpi_id: string | null;
  related_issue: string;
  action: string;
  owner_name: string;
  deadline: string | null; // yyyy-mm-dd
  status: ActionStatus;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type ActionStatus = 'not_started' | 'in_progress' | 'dropped' | 'completed';

/** Overdue isn't a stored status — it's derived from (status, deadline).
 * An action can be "in_progress" AND overdue at the same time; this is
 * purely how it's badged/highlighted, not a value you can select. */
export type DisplayActionStatus = ActionStatus | 'overdue';

export const ACTION_STATUS_META: Record<DisplayActionStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not started', color: '#475569', bg: '#e2e8f0' },
  in_progress: { label: 'In progress', color: '#1d4ed8', bg: '#dbeafe' },
  overdue: { label: 'Overdue', color: '#b91c1c', bg: '#fecaca' },
  dropped: { label: 'Dropped', color: '#78716c', bg: '#e7e5e4' },
  completed: { label: 'Completed', color: '#166534', bg: '#dcfce7' },
};

/** The status to actually display: real status, unless it's still open
 * (not_started/in_progress) and past its deadline, in which case "overdue"
 * takes over the badge/highlight — completed and dropped items are never
 * shown as overdue since they're already closed out. */
export function getDisplayStatus(action: Pick<ActionItem, 'status' | 'deadline'>, todayStr: string): DisplayActionStatus {
  if (action.status === 'completed' || action.status === 'dropped') return action.status;
  if (action.deadline && action.deadline < todayStr) return 'overdue';
  return action.status;
}

/** A leading KPI's numeric value for one day, written by the Admin Daily
 * Excel upload's "Next 24hrs" tab. No target/pass-fail — these are
 * projections, displayed as a plain headline number. */
export interface LeadingEntry {
  id: string;
  kpi_id: string;
  entry_date: string; // yyyy-mm-dd
  value: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PILLAR_COLORS: Record<string, { base: string; soft: string; text: string }> = {
  S: { base: '#dc2626', soft: '#fee2e2', text: '#7f1d1d' },
  Q: { base: '#2563eb', soft: '#dbeafe', text: '#1e3a8a' },
  D: { base: '#16a34a', soft: '#dcfce7', text: '#14532d' },
  C: { base: '#d97706', soft: '#fef3c7', text: '#78350f' },
};

export type PerformanceStatus = 'met' | 'missed' | 'nodata' | 'future';

export const PERFORMANCE_COLORS: Record<PerformanceStatus, string> = {
  met: '#16a34a',
  missed: '#dc2626',
  future: '#e2e8f0',
  nodata: '#94a3b8',
};

/** Strips a KPI's "(Day)"/"(Night)" shift suffix and, after that, an
 * "(Old)" secondary-calculation suffix (e.g. "Mainliner Load GMPH (Old)
 * (Day)" -> "Mainliner Load GMPH") — the shared base name several places
 * group Day/Night/Old variants of the same logical KPI under: the board's
 * KpiGroup (PillarQuadrant.tsx) and Admin's KPI Management table both call
 * this so a Day/Night/Old split is always folded together the same way. */
export function baseNameOf(name: string): string {
  return name
    .replace(/\s*\((Day|Night)\)\s*$/i, '')
    .replace(/\s*\(Old\)\s*$/i, '')
    .trim();
}

export function metTarget(kpi: Pick<Kpi, 'is_higher_better'>, target: number, actual: number): boolean {
  return kpi.is_higher_better ? actual >= target : actual <= target;
}

/** Extracts a human-readable message from anything a try/catch might throw.
 * `instanceof Error` alone isn't enough here — Supabase's PostgrestError
 * (thrown throughout this app's data layer as `if (error) throw error`) is a
 * plain object with its own `.message`, not a real Error instance, so an
 * `e instanceof Error` check alone was silently discarding it and falling
 * back to a generic "failed" string with no clue what actually went wrong. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  if (typeof e === 'string') return e;
  return fallback;
}

/** Rounds to at most 2 decimal places for display. KPI actual/target values
 * can carry long floating-point tails (e.g. from Excel-derived averages or
 * percentage conversions) — this keeps the board readable without changing
 * the underlying stored value. A whole number stays whole (round2(51) === 51,
 * not "51.00") since this rounds the number rather than formatting a string. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
