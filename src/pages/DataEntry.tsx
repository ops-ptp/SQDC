import { format, subDays } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';
import {
  fetchEntriesForKpisOnDate,
  fetchEntryForKpiAndDate,
  fetchKpis,
  fetchPillars,
  fetchReasonsForKpi,
  upsertDailyEntry,
} from '../lib/data';
import { PILLAR_COLORS, metTarget, round2, type DailyEntry, type Kpi, type Pillar, type Reason } from '../types';

const TODAY = format(new Date(), 'yyyy-MM-dd');
// Staff typically log the previous day's completed shift results each
// morning — matches the Board, which reviews yesterday's performance.
const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd');
const OTHER_SENTINEL = 'OTHER';

type Shift = 'day' | 'night' | 'single';

interface KpiGroup {
  key: string;
  label: string;
  pillarId: string;
  target: number;
  unit: string;
  isHigherBetter: boolean;
  sortOrder: number;
  /** True when this KPI keeps manual Performance-value entry (Accident
   * During Operation, QC Preventive Maintenance & Service, Average Litres
   * per Vessel Call) — every other KPI is remarks-only, its Performance
   * value coming from the Admin Excel upload instead. */
  manualEntry: boolean;
  day?: Kpi;
  night?: Kpi;
  single?: Kpi;
}

interface FormState {
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

const EMPTY_FORM: FormState = {
  shift: 'single',
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
};

function baseNameOf(name: string): string {
  return name.replace(/\s*\((Day|Night)\)\s*$/i, '').trim();
}

function buildGroups(kpis: Kpi[]): KpiGroup[] {
  const map = new Map<string, KpiGroup>();
  for (const k of kpis) {
    const isDay = /\(Day\)\s*$/i.test(k.name);
    const isNight = /\(Night\)\s*$/i.test(k.name);
    const base = baseNameOf(k.name);
    const mapKey = `${k.pillar_id}::${base}`;
    let g = map.get(mapKey);
    if (!g) {
      g = {
        key: mapKey,
        label: base,
        pillarId: k.pillar_id,
        target: k.target,
        unit: k.unit,
        isHigherBetter: k.is_higher_better,
        sortOrder: k.sort_order,
        manualEntry: k.manual_entry,
      };
      map.set(mapKey, g);
    }
    g.sortOrder = Math.min(g.sortOrder, k.sort_order);
    g.manualEntry = g.manualEntry || k.manual_entry;
    if (isDay) g.day = k;
    else if (isNight) g.night = k;
    else g.single = k;
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function activeKpi(g: KpiGroup, shift: Shift): Kpi | undefined {
  if (shift === 'day') return g.day;
  if (shift === 'night') return g.night;
  return g.single;
}

function defaultShift(g: KpiGroup): Shift {
  if (g.day) return 'day';
  if (g.night) return 'night';
  return 'single';
}

function groupKpiIds(g: KpiGroup): string[] {
  return [g.day?.id, g.night?.id, g.single?.id].filter((x): x is string => Boolean(x));
}

/** "Done" for a date = every applicable shift (day/night, or the single
 * variant) has a logged entry — drives the grey-vs-colored pill state. */
function isGroupDone(g: KpiGroup, entries: DailyEntry[]): boolean {
  const ids = entries.map((e) => e.kpi_id);
  if (g.single) return ids.includes(g.single.id);
  const dayDone = g.day ? ids.includes(g.day.id) : true;
  const nightDone = g.night ? ids.includes(g.night.id) : true;
  return dayDone && nightDone;
}

/** True when this group has a logged entry that missed target and has no
 * remark yet — the "still needs attention" state, distinct from "not
 * logged at all". Drives the red pill highlight + the page-level count. */
function groupNeedsRemark(g: KpiGroup, entries: DailyEntry[]): boolean {
  const ids = groupKpiIds(g);
  return entries.some((e) => ids.includes(e.kpi_id) && !e.met_target && !e.remarks?.trim());
}

/** Deep-link payload from the Board's "no remarks logged" highlight — see
 * PillarQuadrant.tsx's renderRemarksBlock. */
interface DeepLinkState {
  pillarId: string;
  label: string;
  date: string;
}

export default function DataEntry() {
  const { employee } = useEmployee();
  const location = useLocation();
  const deepLinkApplied = useRef(false);
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [groups, setGroups] = useState<KpiGroup[]>([]);
  const [selectedDate, setSelectedDate] = useState(YESTERDAY);
  const [selectedPillarId, setSelectedPillarId] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [dateEntries, setDateEntries] = useState<DailyEntry[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the full KPI catalog once — any logged-in employee can update any KPI.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchPillars(), fetchKpis()])
      .then(([p, kpis]) => {
        setPillars(p);
        const built = buildGroups(kpis);
        setGroups(built);
        if (p.length > 0) setSelectedPillarId(p[0].id);
        const first = built.find((g) => g.pillarId === p[0]?.id) ?? built[0];
        if (first) setSelectedGroupKey(first.key);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load the KPI catalog'))
      .finally(() => setLoading(false));
  }, []);

  // Deep link from the Board's "no remarks logged" highlight — pre-select
  // the pillar/KPI/date it was clicked from. Applied once, the first time
  // the KPI catalog is ready.
  useEffect(() => {
    if (deepLinkApplied.current || groups.length === 0) return;
    const state = location.state as DeepLinkState | null;
    if (!state) return;
    const match = groups.find((g) => g.pillarId === state.pillarId && g.label === state.label);
    if (match) {
      deepLinkApplied.current = true;
      setSelectedPillarId(match.pillarId);
      setSelectedGroupKey(match.key);
      if (state.date) setSelectedDate(state.date);
    }
  }, [groups, location.state]);

  const pillarGroups = groups.filter((g) => g.pillarId === selectedPillarId);
  const selectedGroup = groups.find((g) => g.key === selectedGroupKey);

  // Which KPIs already have an entry for the selected date — drives the
  // grey-until-updated pill styling and the "needs remark" highlight.
  useEffect(() => {
    const ids = groups.flatMap((g) => [g.day?.id, g.night?.id, g.single?.id].filter((x): x is string => Boolean(x)));
    if (ids.length === 0) return;
    fetchEntriesForKpisOnDate(ids, selectedDate)
      .then(setDateEntries)
      .catch(() => setDateEntries([]));
  }, [groups, selectedDate]);

  // Load the form for whichever KPI + shift is currently selected. Fires on
  // group/date change, always resetting to that group's default shift.
  useEffect(() => {
    if (!selectedGroup) return;
    const shift = defaultShift(selectedGroup);
    const kpi = activeKpi(selectedGroup, shift);
    if (!kpi) return;
    setForm((f) => ({ ...f, shift, loading: true }));
    Promise.all([fetchReasonsForKpi(kpi.id), fetchEntryForKpiAndDate(kpi.id, selectedDate)])
      .then(([reasons, existing]) => {
        setForm({
          shift,
          reasons,
          existing,
          actualInput: existing ? String(existing.actual) : '',
          remarks: existing?.remarks ?? '',
          reasonId: existing?.reason_id ?? (existing?.reason_other ? OTHER_SENTINEL : ''),
          reasonOther: existing?.reason_other ?? '',
          loading: false,
          saving: false,
          saved: false,
          error: null,
        });
      })
      .catch((e) => setForm((f) => ({ ...f, loading: false, error: e instanceof Error ? e.message : 'Failed to load entry' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.key, selectedDate]);

  async function handleShiftChange(shift: Shift) {
    if (!selectedGroup) return;
    const kpi = activeKpi(selectedGroup, shift);
    if (!kpi) return;
    setForm((f) => ({ ...f, shift, loading: true }));
    try {
      const [reasons, existing] = await Promise.all([fetchReasonsForKpi(kpi.id), fetchEntryForKpiAndDate(kpi.id, selectedDate)]);
      setForm({
        shift,
        reasons,
        existing,
        actualInput: existing ? String(existing.actual) : '',
        remarks: existing?.remarks ?? '',
        reasonId: existing?.reason_id ?? (existing?.reason_other ? OTHER_SENTINEL : ''),
        reasonOther: existing?.reason_other ?? '',
        loading: false,
        saving: false,
        saved: false,
        error: null,
      });
    } catch (e) {
      setForm((f) => ({ ...f, loading: false, error: e instanceof Error ? e.message : 'Failed to load entry' }));
    }
  }

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p, saved: false }));
  }

  /** Manual-entry save: person types the Performance value directly (one of
   * the 3 manual_entry KPIs). Always marks is_manual_override so a later
   * Admin upload never clobbers it. */
  async function handleSaveManual() {
    if (!employee || !selectedGroup) return;
    const kpi = activeKpi(selectedGroup, form.shift);
    if (!kpi) return;

    const actual = Number(form.actualInput);
    if (form.actualInput.trim() === '' || Number.isNaN(actual)) {
      patch({ error: 'Enter a numeric value.' });
      return;
    }
    const met = metTarget({ is_higher_better: selectedGroup.isHigherBetter }, selectedGroup.target, actual);
    const hasReason = (form.reasonId && form.reasonId !== OTHER_SENTINEL) || (form.reasonId === OTHER_SENTINEL && form.reasonOther.trim());
    if (!met && !hasReason) {
      patch({ error: 'Target missed — please select a reason category (or "Other" and specify it).' });
      return;
    }
    if (!met && !form.remarks.trim()) {
      patch({ error: 'Target missed — please add a remark explaining what happened.' });
      return;
    }

    patch({ saving: true, error: null });
    try {
      const saved = await upsertDailyEntry({
        kpi_id: kpi.id,
        entry_date: selectedDate,
        target: selectedGroup.target,
        actual,
        met_target: met,
        reason_id: met ? null : form.reasonId && form.reasonId !== OTHER_SENTINEL ? form.reasonId : null,
        reason_other: met ? null : form.reasonId === OTHER_SENTINEL ? form.reasonOther.trim() || null : null,
        remarks: form.remarks.trim() || null,
        entered_by: employee.id,
        is_manual_override: true,
      });
      patch({ saving: false, saved: true, existing: saved });
      setDateEntries((prev) => [...prev.filter((e) => e.kpi_id !== kpi.id), saved]);
    } catch (e) {
      patch({ saving: false, error: e instanceof Error ? e.message : 'Failed to save' });
    }
  }

  /** Remarks-only save: the Performance value already exists (written by the
   * Admin Excel upload) — only remarks/reason are editable. Leaves
   * is_manual_override untouched (omitted from the payload) since this was
   * never a manually-typed value. */
  async function handleSaveRemarks() {
    if (!employee || !selectedGroup || !form.existing) return;
    const kpi = activeKpi(selectedGroup, form.shift);
    if (!kpi) return;

    const met = form.existing.met_target;
    const hasReason = (form.reasonId && form.reasonId !== OTHER_SENTINEL) || (form.reasonId === OTHER_SENTINEL && form.reasonOther.trim());
    if (!met && !hasReason) {
      patch({ error: 'Target was missed — please select a reason category (or "Other" and specify it).' });
      return;
    }
    if (!met && !form.remarks.trim()) {
      patch({ error: 'Target was missed — please add a remark explaining what happened.' });
      return;
    }

    patch({ saving: true, error: null });
    try {
      const saved = await upsertDailyEntry({
        kpi_id: kpi.id,
        entry_date: selectedDate,
        target: form.existing.target,
        actual: form.existing.actual,
        met_target: form.existing.met_target,
        reason_id: met ? null : form.reasonId && form.reasonId !== OTHER_SENTINEL ? form.reasonId : null,
        reason_other: met ? null : form.reasonId === OTHER_SENTINEL ? form.reasonOther.trim() || null : null,
        remarks: form.remarks.trim() || null,
        entered_by: employee.id,
      });
      patch({ saving: false, saved: true, existing: saved });
      setDateEntries((prev) => [...prev.filter((e) => e.kpi_id !== kpi.id), saved]);
    } catch (e) {
      patch({ saving: false, error: e instanceof Error ? e.message : 'Failed to save' });
    }
  }

  if (loading) return <div className="page-loading">Loading KPI catalog…</div>;
  if (loadError) return <div className="alert alert-error page-margin">{loadError}</div>;

  const actualNum = Number(form.actualInput);
  const hasValidActual = form.actualInput.trim() !== '' && !Number.isNaN(actualNum);
  const manualMet = selectedGroup && hasValidActual ? metTarget({ is_higher_better: selectedGroup.isHigherBetter }, selectedGroup.target, actualNum) : null;
  const hasShiftToggle = Boolean(selectedGroup?.day && selectedGroup?.night);
  const needsRemarkCount = groups.filter((g) => groupNeedsRemark(g, dateEntries)).length;

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>Enter Remarks</h1>
          <p className="muted">
            Logged in as {employee?.name}. Performance values come from the daily Admin upload — pick a KPI below to add
            the remark or reason for it.
          </p>
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

      {needsRemarkCount > 0 && (
        <div className="alert alert-error">
          {needsRemarkCount} KPI{needsRemarkCount === 1 ? '' : 's'} missed target on this date and still need{needsRemarkCount === 1 ? 's' : ''} a
          remark — look for the red pills below.
        </div>
      )}

      <div className="field-label">Pillar</div>
      <div className="entry-pillar-pills">
        {pillars.map((p) => {
          const colors = PILLAR_COLORS[p.code] ?? PILLAR_COLORS.S;
          const isSelected = p.id === selectedPillarId;
          // Grey out until every failed KPI in this pillar has a remark
          // filled in — mirrors the KPI-pill grey/colored logic below.
          const pillarGroupsForPill = groups.filter((g) => g.pillarId === p.id);
          const pillarDone = pillarGroupsForPill.every((g) => !groupNeedsRemark(g, dateEntries));
          const style = pillarDone
            ? isSelected
              ? { background: colors.base, borderColor: colors.base, color: 'white' }
              : { borderColor: colors.base, color: colors.text }
            : isSelected
              ? { background: '#94a3b8', borderColor: '#94a3b8', color: 'white' }
              : { background: '#f1f5f9', borderColor: '#e2e8f0', color: '#94a3b8' };
          return (
            <button
              key={p.id}
              type="button"
              className="entry-pill entry-pill-pillar"
              style={style}
              onClick={() => {
                setSelectedPillarId(p.id);
                const first = groups.find((g) => g.pillarId === p.id);
                if (first) setSelectedGroupKey(first.key);
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="field-label" style={{ marginTop: 14 }}>
        KPI <span className="entry-pill-hint">— grey until updated, red if target was missed and still needs a remark</span>
      </div>
      <div className="entry-kpi-pills">
        {pillarGroups.length === 0 && <span className="muted">No KPIs in this pillar.</span>}
        {pillarGroups.map((g) => {
          const done = isGroupDone(g, dateEntries);
          const needsRemark = groupNeedsRemark(g, dateEntries);
          const isSelected = g.key === selectedGroupKey;
          const colors = PILLAR_COLORS[pillars.find((p) => p.id === g.pillarId)?.code ?? 'S'] ?? PILLAR_COLORS.S;
          const style = needsRemark
            ? isSelected
              ? { background: 'var(--bad)', borderColor: 'var(--bad)', color: 'white' }
              : { background: '#fee2e2', borderColor: 'var(--bad)', color: '#991b1b' }
            : isSelected
              ? { background: colors.base, borderColor: colors.base, color: 'white' }
              : done
                ? { background: colors.soft, borderColor: colors.base, color: colors.text }
                : { background: '#f1f5f9', borderColor: '#e2e8f0', color: '#94a3b8' };
          return (
            <button key={g.key} type="button" className="entry-pill entry-pill-kpi" style={style} onClick={() => setSelectedGroupKey(g.key)}>
              {needsRemark ? <span className="entry-pill-check">!</span> : done && <span className="entry-pill-check">✓</span>} {g.label}
              {!g.manualEntry && <span className="entry-pill-remarks-tag"> · remarks only</span>}
            </button>
          );
        })}
      </div>

      {selectedGroup && (
        <div className="card entry-card entry-card-single" style={{ borderTopColor: (PILLAR_COLORS[pillars.find((p) => p.id === selectedGroup.pillarId)?.code ?? 'S'] ?? PILLAR_COLORS.S).base }}>
          <div className="entry-card-header">
            <h3>{selectedGroup.label}</h3>
            <span className="muted">
              Target: {round2(selectedGroup.target)} {selectedGroup.unit} ({selectedGroup.isHigherBetter ? 'higher is good' : 'lower is good'})
            </span>
          </div>

          {hasShiftToggle && (
            <div className="segmented segmented-sm">
              <button type="button" className={`segmented-btn ${form.shift === 'day' ? 'segmented-btn-active' : ''}`} onClick={() => handleShiftChange('day')}>
                Day
              </button>
              <button type="button" className={`segmented-btn ${form.shift === 'night' ? 'segmented-btn-active' : ''}`} onClick={() => handleShiftChange('night')}>
                Night
              </button>
            </div>
          )}

          {form.loading ? (
            <div className="empty-state">Loading…</div>
          ) : selectedGroup.manualEntry ? (
            <>
              <label className="field-label">
                Actual ({selectedGroup.unit}){hasShiftToggle ? ` — ${form.shift === 'day' ? 'Day' : 'Night'} shift` : ''}
              </label>
              <input
                type="number"
                step="any"
                className="input"
                value={form.actualInput}
                onChange={(e) => patch({ actualInput: e.target.value })}
                placeholder="Enter value"
              />

              {manualMet === true && (
                <span className="pill pill-good" style={{ marginTop: 8 }}>
                  Target met
                </span>
              )}

              {manualMet === false && (
                <div className="reason-block">
                  <span className="pill pill-bad">Target missed</span>
                  <label className="field-label">Reason category</label>
                  <select
                    className="input"
                    value={form.reasonId}
                    onChange={(e) => patch({ reasonId: e.target.value, reasonOther: e.target.value === OTHER_SENTINEL ? form.reasonOther : '' })}
                  >
                    <option value="">— Select a reason —</option>
                    {form.reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                    <option value={OTHER_SENTINEL}>Other (please specify)</option>
                  </select>
                  {form.reasonId === OTHER_SENTINEL && (
                    <input
                      className="input"
                      placeholder="Specify the reason category…"
                      value={form.reasonOther}
                      onChange={(e) => patch({ reasonOther: e.target.value })}
                    />
                  )}
                </div>
              )}

              <label className="field-label">Remarks{manualMet === false ? ' (required — target missed)' : ' (optional)'}</label>
              <textarea
                className="input entry-remarks"
                rows={2}
                value={form.remarks}
                onChange={(e) => patch({ remarks: e.target.value })}
                placeholder="What happened, what's being done about it…"
              />

              {form.error && <div className="alert alert-error">{form.error}</div>}

              <button className="btn btn-primary" disabled={form.saving} onClick={handleSaveManual}>
                {form.saving ? 'Saving…' : form.saved ? 'Saved ✓' : form.existing ? 'Update entry' : 'Save entry'}
              </button>
            </>
          ) : !form.existing ? (
            <div className="empty-state">
              No performance data uploaded yet for {selectedGroup.label} on this date. Once the Admin daily upload
              includes it, this KPI's actual value will show here and you can add a remark.
            </div>
          ) : (
            <>
              <div className="entry-readonly-value">
                <span className={`headline-value ${form.existing.met_target ? 'value-good' : 'value-bad'}`}>
                  {round2(form.existing.actual)}
                  <span className="headline-unit">{selectedGroup.unit}</span>
                </span>
                <span className={`pill ${form.existing.met_target ? 'pill-good' : 'pill-bad'}`}>
                  {form.existing.met_target ? 'Target met' : 'Target missed'}
                </span>
              </div>

              {!form.existing.met_target && (
                <div className="reason-block">
                  <label className="field-label">Reason category</label>
                  <select
                    className="input"
                    value={form.reasonId}
                    onChange={(e) => patch({ reasonId: e.target.value, reasonOther: e.target.value === OTHER_SENTINEL ? form.reasonOther : '' })}
                  >
                    <option value="">— Select a reason —</option>
                    {form.reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                    <option value={OTHER_SENTINEL}>Other (please specify)</option>
                  </select>
                  {form.reasonId === OTHER_SENTINEL && (
                    <input
                      className="input"
                      placeholder="Specify the reason category…"
                      value={form.reasonOther}
                      onChange={(e) => patch({ reasonOther: e.target.value })}
                    />
                  )}
                </div>
              )}

              <label className="field-label">Remarks{!form.existing.met_target ? ' (required — target missed)' : ' (optional)'}</label>
              <textarea
                className="input entry-remarks"
                rows={2}
                value={form.remarks}
                onChange={(e) => patch({ remarks: e.target.value })}
                placeholder="What happened, what's being done about it…"
              />

              {form.error && <div className="alert alert-error">{form.error}</div>}

              <button className="btn btn-primary" disabled={form.saving} onClick={handleSaveRemarks}>
                {form.saving ? 'Saving…' : form.saved ? 'Saved ✓' : 'Save remark'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
