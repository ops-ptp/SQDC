import { format, subDays } from 'date-fns';
import { useEffect, useState } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import { fetchEntryForKpiAndDate, fetchKpisForEmployee, fetchReasonsForKpi, upsertDailyEntry } from '../lib/data';
import { PILLAR_COLORS, metTarget, type DailyEntry, type KpiWithPillar, type Reason } from '../types';

const TODAY = format(new Date(), 'yyyy-MM-dd');
// Staff typically log the previous day's completed shift results each
// morning — matches the Board, which reviews yesterday's performance.
const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd');
const OTHER_SENTINEL = 'OTHER';

type Shift = 'day' | 'night' | 'single';

interface KpiGroup {
  key: string;
  label: string;
  pillarName: string;
  pillarCode: string;
  target: number;
  unit: string;
  isHigherBetter: boolean;
  sortOrder: number;
  day?: KpiWithPillar;
  night?: KpiWithPillar;
  single?: KpiWithPillar;
}

interface GroupState {
  group: KpiGroup;
  shift: Shift;
  reasons: Reason[];
  actualInput: string;
  remarks: string;
  reasonId: string; // '' | OTHER_SENTINEL | a real reason uuid
  reasonOther: string;
  existing: DailyEntry | null;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

function baseNameOf(name: string): string {
  return name.replace(/\s*\((Day|Night)\)\s*$/i, '').trim();
}

function buildGroups(kpis: KpiWithPillar[]): KpiGroup[] {
  const map = new Map<string, KpiGroup>();
  for (const k of kpis) {
    const isDay = /\(Day\)\s*$/i.test(k.name);
    const isNight = /\(Night\)\s*$/i.test(k.name);
    const base = baseNameOf(k.name);
    let g = map.get(base);
    if (!g) {
      g = {
        key: base,
        label: base,
        pillarName: k.pillar.name,
        pillarCode: k.pillar.code,
        target: k.target,
        unit: k.unit,
        isHigherBetter: k.is_higher_better,
        sortOrder: k.sort_order,
      };
      map.set(base, g);
    }
    g.sortOrder = Math.min(g.sortOrder, k.sort_order);
    if (isDay) g.day = k;
    else if (isNight) g.night = k;
    else g.single = k;
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function activeKpi(g: KpiGroup, shift: Shift): KpiWithPillar | undefined {
  if (shift === 'day') return g.day;
  if (shift === 'night') return g.night;
  return g.single;
}

function defaultShift(g: KpiGroup): Shift {
  if (g.day) return 'day';
  if (g.night) return 'night';
  return 'single';
}

export default function DataEntry() {
  const { employee } = useEmployee();
  const [selectedDate, setSelectedDate] = useState(YESTERDAY);
  const [groups, setGroups] = useState<KpiGroup[]>([]);
  const [rows, setRows] = useState<Record<string, GroupState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the KPI catalog for this employee once.
  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchKpisForEmployee(employee.id)
      .then((kpis) => {
        if (cancelled) return;
        const built = buildGroups(kpis);
        setGroups(built);
        setRows(
          Object.fromEntries(
            built.map((g) => [
              g.key,
              {
                group: g,
                shift: defaultShift(g),
                reasons: [],
                actualInput: '',
                remarks: '',
                reasonId: '',
                reasonOther: '',
                existing: null,
                loading: true,
                saving: false,
                saved: false,
                error: null,
              } satisfies GroupState,
            ])
          )
        );
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Failed to load your KPIs'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [employee]);

  // (Re)load one group's entry + reasons for its currently active KPI + the selected date.
  async function reloadGroup(key: string, kpi: KpiWithPillar, date: string) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }));
    try {
      const [reasons, existing] = await Promise.all([fetchReasonsForKpi(kpi.id), fetchEntryForKpiAndDate(kpi.id, date)]);
      setRows((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          reasons,
          existing,
          actualInput: existing ? String(existing.actual) : '',
          remarks: existing?.remarks ?? '',
          reasonId: existing?.reason_id ?? (existing?.reason_other ? OTHER_SENTINEL : ''),
          reasonOther: existing?.reason_other ?? '',
          loading: false,
          saved: false,
          error: null,
        },
      }));
    } catch (e) {
      setRows((prev) => ({
        ...prev,
        [key]: { ...prev[key], loading: false, error: e instanceof Error ? e.message : 'Failed to load entry' },
      }));
    }
  }

  // Reload every group whenever the date changes (or groups first load).
  useEffect(() => {
    for (const g of groups) {
      const kpi = activeKpi(g, rows[g.key]?.shift ?? defaultShift(g));
      if (kpi) reloadGroup(g.key, kpi, selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedDate]);

  function handleShiftChange(key: string, shift: Shift) {
    const g = groups.find((x) => x.key === key);
    if (!g) return;
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], shift } }));
    const kpi = activeKpi(g, shift);
    if (kpi) reloadGroup(key, kpi, selectedDate);
  }

  function patchRow(key: string, patch: Partial<GroupState>) {
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch, saved: false } }));
  }

  async function handleSave(key: string) {
    if (!employee) return;
    const row = rows[key];
    const g = groups.find((x) => x.key === key);
    const kpi = g && activeKpi(g, row.shift);
    if (!g || !kpi) return;

    const actual = Number(row.actualInput);
    if (row.actualInput.trim() === '' || Number.isNaN(actual)) {
      patchRow(key, { error: 'Enter a numeric value.' });
      return;
    }
    const met = metTarget({ is_higher_better: g.isHigherBetter }, g.target, actual);
    const hasReason = (row.reasonId && row.reasonId !== OTHER_SENTINEL) || (row.reasonId === OTHER_SENTINEL && row.reasonOther.trim());
    if (!met && !hasReason) {
      patchRow(key, { error: 'Target missed — please select a reason category (or "Other" and specify it).' });
      return;
    }
    if (!met && !row.remarks.trim()) {
      patchRow(key, { error: 'Target missed — please add a remark explaining what happened.' });
      return;
    }

    patchRow(key, { saving: true, error: null });
    try {
      const saved = await upsertDailyEntry({
        kpi_id: kpi.id,
        entry_date: selectedDate,
        target: g.target,
        actual,
        met_target: met,
        reason_id: met ? null : row.reasonId && row.reasonId !== OTHER_SENTINEL ? row.reasonId : null,
        reason_other: met ? null : row.reasonId === OTHER_SENTINEL ? row.reasonOther.trim() || null : null,
        remarks: row.remarks.trim() || null,
        entered_by: employee.id,
      });
      patchRow(key, { saving: false, saved: true, existing: saved });
    } catch (e) {
      patchRow(key, { saving: false, error: e instanceof Error ? e.message : 'Failed to save' });
    }
  }

  if (loading) return <div className="page-loading">Loading your KPIs…</div>;
  if (loadError) return <div className="alert alert-error page-margin">{loadError}</div>;

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>Enter KPI results</h1>
          <p className="muted">Logged in as {employee?.name}</p>
        </div>
        <label className="date-picker">
          <span className="field-label">Date</span>
          <input
            type="date"
            className="input"
            value={selectedDate}
            max={TODAY}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
      </div>

      {groups.length === 0 && (
        <div className="empty-state page-margin">
          No KPIs are currently assigned to your Employee ID. Ask your supervisor to add you in the{' '}
          <code>kpi_assignments</code> table.
        </div>
      )}

      <div className="entry-grid">
        {groups.map((g) => {
          const row = rows[g.key];
          if (!row) return null;
          const colors = PILLAR_COLORS[g.pillarCode] ?? PILLAR_COLORS.S;
          const actualNum = Number(row.actualInput);
          const hasValidActual = row.actualInput.trim() !== '' && !Number.isNaN(actualNum);
          const met = hasValidActual ? metTarget({ is_higher_better: g.isHigherBetter }, g.target, actualNum) : null;
          const hasShiftToggle = Boolean(g.day && g.night);

          return (
            <div key={g.key} className="card entry-card" style={{ borderTopColor: colors.base }}>
              <div className="entry-card-header">
                <span className="pillar-tag" style={{ background: colors.soft, color: colors.text }}>
                  {g.pillarName}
                </span>
                <h3>{g.label}</h3>
                <span className="muted">
                  Target: {g.target} {g.unit} ({g.isHigherBetter ? 'higher is good' : 'lower is good'})
                </span>
              </div>

              {hasShiftToggle && (
                <div className="segmented segmented-sm">
                  <button
                    type="button"
                    className={`segmented-btn ${row.shift === 'day' ? 'segmented-btn-active' : ''}`}
                    onClick={() => handleShiftChange(g.key, 'day')}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    className={`segmented-btn ${row.shift === 'night' ? 'segmented-btn-active' : ''}`}
                    onClick={() => handleShiftChange(g.key, 'night')}
                  >
                    Night
                  </button>
                </div>
              )}

              {row.loading ? (
                <div className="empty-state">Loading…</div>
              ) : (
                <>
                  <label className="field-label">
                    Actual ({g.unit}){hasShiftToggle ? ` — ${row.shift === 'day' ? 'Day' : 'Night'} shift` : ''}
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="input"
                    value={row.actualInput}
                    onChange={(e) => patchRow(g.key, { actualInput: e.target.value })}
                    placeholder="Enter value"
                  />

                  {met === true && (
                    <span className="pill pill-good" style={{ marginTop: 8 }}>
                      Target met
                    </span>
                  )}

                  {met === false && (
                    <div className="reason-block">
                      <span className="pill pill-bad">Target missed</span>
                      <label className="field-label">Reason category</label>
                      <select
                        className="input"
                        value={row.reasonId}
                        onChange={(e) => patchRow(g.key, { reasonId: e.target.value, reasonOther: e.target.value === OTHER_SENTINEL ? row.reasonOther : '' })}
                      >
                        <option value="">— Select a reason —</option>
                        {row.reasons.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                        <option value={OTHER_SENTINEL}>Other (please specify)</option>
                      </select>
                      {row.reasonId === OTHER_SENTINEL && (
                        <input
                          className="input"
                          placeholder="Specify the reason category…"
                          value={row.reasonOther}
                          onChange={(e) => patchRow(g.key, { reasonOther: e.target.value })}
                        />
                      )}
                    </div>
                  )}

                  <label className="field-label">
                    Remarks{met === false ? ' (required — target missed)' : ' (optional)'}
                  </label>
                  <textarea
                    className="input entry-remarks"
                    rows={2}
                    value={row.remarks}
                    onChange={(e) => patchRow(g.key, { remarks: e.target.value })}
                    placeholder="What happened, what's being done about it…"
                  />

                  {row.error && <div className="alert alert-error">{row.error}</div>}

                  <button className="btn btn-primary" disabled={row.saving} onClick={() => handleSave(g.key)}>
                    {row.saving ? 'Saving…' : row.saved ? 'Saved ✓' : row.existing ? 'Update entry' : 'Save entry'}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
