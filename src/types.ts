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
  role: string | null;
  active: boolean;
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
  entered_by: string | null;
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

export const ACTION_STATUS_META: Record<ActionStatus, { label: string; color: string; bg: string }> = {
  not_started: { label: 'Not started', color: '#475569', bg: '#e2e8f0' },
  in_progress: { label: 'In progress', color: '#1d4ed8', bg: '#dbeafe' },
  dropped: { label: 'Dropped', color: '#991b1b', bg: '#fee2e2' },
  completed: { label: 'Completed', color: '#166534', bg: '#dcfce7' },
};

export interface ForecastCard {
  id: string;
  kpi_id: string;
  pillar_id: string;
  target_date: string; // yyyy-mm-dd
  note: string;
  owner_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ForecastCardWithRefs extends ForecastCard {
  kpi: Pick<Kpi, 'name' | 'unit'>;
  pillar: Pick<Pillar, 'code' | 'name'>;
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

export function metTarget(kpi: Pick<Kpi, 'is_higher_better'>, target: number, actual: number): boolean {
  return kpi.is_higher_better ? actual >= target : actual <= target;
}
