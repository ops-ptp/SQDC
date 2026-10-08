import { format, subDays } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';
import { useDepartment } from '../context/DepartmentContext';
import {
  fetchEntriesForKpisOnDate,
  fetchEntryForKpiAndDate,
  fetchKpiDailyTarget,
  fetchKpis,
  fetchPillars,
  upsertDailyEntry,
} from '../lib/data';
import { bulkAddEntryCategories } from '../lib/categories';
import CategoryPicker from '../components/CategoryPicker';
import { PILLAR_COLORS, errorMessage, isManualKpi, metTarget, round2, type DailyEntry, type Department, type Kpi, type Pillar } from '../types';
import { Chip, SegmentedControl } from '@progress/kendo-react-buttons';
import { useTodayString } from '../lib/useToday';
import { Button, DateField, NumberField, PageLoader, TextAreaField, InlineLoader, InfoTip } from '../components/ui';

// Staff typically log the previous day's completed shift results each
// morning — matches the Board, which reviews yesterday's performance.
const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd');

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
  actualInput: string;
  remarks: string;
  existing: DailyEntry | null;
  /** Categories ticked before a typed value's first save — written to the
   * new entry right after it's saved. */
  pendingTags: { dimension: string; category: string }[];
  /** Which KPI row the form was loaded for — saves are refused until it
   * matches the selected KPI/shift, so a slow earlier load can never put
   * one KPI's figures onto another. */
  kpiId: string | null;
  /** This date's target — from the Admin upload's Target-sheet data
   * (kpi_daily_targets) when available, falling back to the KPI catalog's
   * fixed target otherwise. Used for the manual-entry met/missed check and
   * the target shown in the header, since targets can now vary by day. */
  resolvedTarget: number;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const EMPTY_FORM: FormState = {
  shift: 'single',
  actualInput: '',
  remarks: '',
  existing: null,
  pendingTags: [],
  kpiId: null,
  resolvedTarget: 0,
  loading: true,
  saving: false,
  saved: false,
  error: null,
};

function baseNameOf(name: string): string {
  return name.replace(/\s*\((Day|Night)\)\s*$/i, '').trim();
}

function buildGroups(kpis: Kpi[], department: Department): KpiGroup[] {
  const map = new Map<string, KpiGroup>();
  // Secondary/comparison KPIs (e.g. "Mainliner Load GMPH (Old)") are shown
  // on the Board as a dimmed reference line/number, but never themselves a
  // remarks target — the primary ("new calculation") KPI already covers
  // pass/fail and remark-required logic for that metric.
  for (const k of kpis.filter((k) => !k.is_secondary)) {
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
        manualEntry: isManualKpi(department, k),
      };
      map.set(mapKey, g);
    }
    g.sortOrder = Math.min(g.sortOrder, k.sort_order);
    g.manualEntry = g.manualEntry || isManualKpi(department, k);
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
 * logged at all". Drives the red pill highlight + the page-level count.
 * Recomputed live via metTarget rather than trusting each entry's stored
 * met_target — that column is a snapshot taken at write time using
 * whatever is_higher_better the KPI had THEN. If a KPI's direction gets
 * corrected later (e.g. switched to "lower is better"), every entry
 * written before that change keeps the old, now-wrong verdict baked in
 * unless read live like this. */
function groupNeedsRemark(g: KpiGroup, entries: DailyEntry[]): boolean {
  const ids = groupKpiIds(g);
  return entries.some((e) => ids.includes(e.kpi_id) && !metTarget({ is_higher_better: g.isHigherBetter }, e.target, e.actual) && !e.remarks?.trim());
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
  const department = useDepartment();
  const remarksOnly = department.entry_mode === 'upload';
  const location = useLocation();
  const deepLinkApplied = useRef(false);
  // Only the latest form load may fill the form (KPI/shift/date can change
  // faster than the network answers).
  const loadSeq = useRef(0);
  const today = useTodayString();
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
    Promise.all([fetchPillars(), fetchKpis(department.id)])
      .then(([p, kpis]) => {
        setPillars(p);
        const built = buildGroups(kpis, department);
        setGroups(built);
        if (p.length > 0) setSelectedPillarId(p[0].id);
        const first = built.find((g) => g.pillarId === p[0]?.id) ?? built[0];
        if (first) setSelectedGroupKey(first.key);
      })
      .catch((e) => setLoadError(errorMessage(e, 'Failed to load the KPI catalog')))
      .finally(() => setLoading(false));
  }, [department]);

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
    let cancelled = false;
    fetchEntriesForKpisOnDate(ids, selectedDate)
      .then((e) => !cancelled && setDateEntries(e))
      .catch(() => !cancelled && setDateEntries([]));
    return () => {
      cancelled = true;
    };
  }, [groups, selectedDate]);

  // Load the form for whichever KPI + shift is currently selected. Fires on
  // group/date change, always resetting to that group's default shift.
  useEffect(() => {
    if (!selectedGroup) return;
    const shift = defaultShift(selectedGroup);
    const kpi = activeKpi(selectedGroup, shift);
    if (!kpi) return;
    const seq = ++loadSeq.current;
    setForm((f) => ({ ...f, shift, loading: true }));
    Promise.all([fetchEntryForKpiAndDate(kpi.id, selectedDate), fetchKpiDailyTarget(kpi.id, selectedDate).catch(() => null)])
      .then(([existing, dailyTarget]) => {
        if (seq !== loadSeq.current) return;
        setForm({
          shift,
          existing,
          pendingTags: [],
          kpiId: kpi.id,
          resolvedTarget: dailyTarget ?? selectedGroup.target,
          actualInput: existing ? String(existing.actual) : '',
          remarks: existing?.remarks ?? '',
          loading: false,
          saving: false,
          saved: false,
          error: null,
        });
      })
      .catch((e) => seq === loadSeq.current && setForm((f) => ({ ...f, loading: false, error: errorMessage(e, 'Failed to load entry') })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.key, selectedDate]);

  async function handleShiftChange(shift: Shift) {
    if (!selectedGroup) return;
    const kpi = activeKpi(selectedGroup, shift);
    if (!kpi) return;
    const seq = ++loadSeq.current;
    setForm((f) => ({ ...f, shift, loading: true }));
    try {
      const [existing, dailyTarget] = await Promise.all([fetchEntryForKpiAndDate(kpi.id, selectedDate), fetchKpiDailyTarget(kpi.id, selectedDate).catch(() => null)]);
      if (seq !== loadSeq.current) return;
      setForm({
        shift,
        existing,
        pendingTags: [],
        kpiId: kpi.id,
        resolvedTarget: dailyTarget ?? selectedGroup.target,
        actualInput: existing ? String(existing.actual) : '',
        remarks: existing?.remarks ?? '',
        loading: false,
        saving: false,
        saved: false,
        error: null,
      });
    } catch (e) {
      if (seq === loadSeq.current) setForm((f) => ({ ...f, loading: false, error: errorMessage(e, 'Failed to load entry') }));
    }
  }

  /** True (and says so) while the form still belongs to another KPI/shift. */
  function formIsStale(kpiId: string): boolean {
    if (form.loading || form.kpiId !== kpiId) {
      patch({ error: 'Still loading this KPI — try again in a moment.' });
      return true;
    }
    return false;
  }

  /** Any edit clears "Saved ✓"; a save passes saved: true explicitly. */
  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, saved: false, ...p }));
  }

  /** Manual-entry save: person types the Performance value directly (one of
   * the 3 manual_entry KPIs). Always marks is_manual_override so a later
   * Admin upload never clobbers it. */
  async function handleSaveManual() {
    if (!employee || !selectedGroup) return;
    const kpi = activeKpi(selectedGroup, form.shift);
    if (!kpi || formIsStale(kpi.id)) return;

    const actual = Number(form.actualInput);
    if (form.actualInput.trim() === '' || Number.isNaN(actual)) {
      patch({ error: 'Enter a numeric value.' });
      return;
    }
    const met = metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.resolvedTarget, actual);
    if (!met && !form.remarks.trim()) {
      patch({ error: 'Target missed — please add a remark explaining what happened.' });
      return;
    }

    patch({ saving: true, error: null });
    try {
      const saved = await upsertDailyEntry({
        kpi_id: kpi.id,
        entry_date: selectedDate,
        target: form.resolvedTarget,
        actual,
        met_target: met,
        remarks: form.remarks.trim() || null,
        entered_by: employee.id,
        is_manual_override: true,
      });
      if (!met && form.pendingTags.length > 0) {
        await bulkAddEntryCategories(form.pendingTags.map((t) => ({ entry_id: saved.id, dimension: t.dimension, category: t.category, created_by: employee.id })));
      }
      patch({ saving: false, saved: true, existing: saved, pendingTags: [] });
      setDateEntries((prev) => [...prev.filter((e) => e.kpi_id !== kpi.id), saved]);
    } catch (e) {
      patch({ saving: false, error: errorMessage(e, 'Failed to save') });
    }
  }

  /** Remarks-only save: the Performance value already exists (written by the
   * Admin Excel upload) — only the remark is editable. Leaves
   * is_manual_override untouched (omitted from the payload) since this was
   * never a manually-typed value. */
  async function handleSaveRemarks() {
    if (!employee || !selectedGroup || !form.existing) return;
    const kpi = activeKpi(selectedGroup, form.shift);
    if (!kpi || formIsStale(kpi.id)) return;

    // Recomputed live rather than trusting form.existing.met_target — see
    // groupNeedsRemark's comment for why that stored value can be stale
    // after a KPI's direction is corrected in KPI Management.
    const met = metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.existing.target, form.existing.actual);
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
        // Written as the freshly-recomputed value, not form.existing's
        // stale one — this is also what lets a remarks-only save quietly
        // self-heal a row's stored met_target the next time someone
        // touches it, rather than needing a separate backfill.
        met_target: met,
        remarks: form.remarks.trim() || null,
        entered_by: employee.id,
      });
      patch({ saving: false, saved: true, existing: saved });
      setDateEntries((prev) => [...prev.filter((e) => e.kpi_id !== kpi.id), saved]);
    } catch (e) {
      patch({ saving: false, error: errorMessage(e, 'Failed to save') });
    }
  }

  /** Category chips for the saved entry of the selected shift — feeds the
   * Weekly/Bi-weekly Pareto. Saves on click, independent of the Save
   * button, so it only appears once there's a saved entry to tag. */
  function renderCategories(entryId: string | null) {
    if (!selectedGroup) return null;
    const pillarColor = (PILLAR_COLORS[pillars.find((p) => p.id === selectedGroup.pillarId)?.code ?? 'S'] ?? PILLAR_COLORS.S).base;
    return (
      <div className="category-block">
        <label className="field-label">
          Categories{' '}
          <InfoTip>
            {entryId
              ? 'Tick every cause that applied. Saved instantly and counted in the Board’s Pareto.'
              : 'Tick every cause that applied. Saved together with the entry and counted in the Board’s Pareto.'}
          </InfoTip>
        </label>
        <CategoryPicker
          key={entryId ?? `pending|${form.kpiId}|${selectedDate}`}
          pillarId={selectedGroup.pillarId}
          kpiBaseName={selectedGroup.label}
          entryId={entryId}
          pendingTags={entryId ? undefined : form.pendingTags}
          onPendingChange={(pendingTags) => setForm((f) => ({ ...f, pendingTags, saved: false }))}
          employeeId={employee?.id ?? null}
          editable={Boolean(employee)}
          color={pillarColor}
        />
      </div>
    );
  }

  if (loading) return <PageLoader label="Loading KPI catalog…" />;
  if (loadError) return <div className="alert alert-error page-margin">{loadError}</div>;

  const actualNum = Number(form.actualInput);
  const hasValidActual = form.actualInput.trim() !== '' && !Number.isNaN(actualNum);
  const manualMet = selectedGroup && hasValidActual ? metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.resolvedTarget, actualNum) : null;
  const hasShiftToggle = Boolean(selectedGroup?.day && selectedGroup?.night);
  const needsRemarkCount = groups.filter((g) => groupNeedsRemark(g, dateEntries)).length;

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>
            {remarksOnly ? 'Enter Remarks' : 'Enter Data'}{' '}
            <InfoTip>
              Logged in as {employee?.name}.{' '}
              {remarksOnly
                ? 'Performance values come from the daily Admin upload — pick a KPI below to add the remark and its categories.'
                : department.entry_mode === 'both'
                  ? 'Type a KPI’s value here, or let the Admin upload fill it in — a value typed here is never overwritten by an upload. Add a remark whenever a target is missed.'
                  : 'Pick a KPI, type the day’s value, and add a remark whenever the target is missed.'}
            </InfoTip>
          </h1>
        </div>
        <label className="date-picker">
          <span className="field-label">Date</span>
          <DateField value={selectedDate} max={today} onChange={(v) => v && setSelectedDate(v)} ariaLabel="Date" />
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
            <Chip
              key={p.id}
              rounded="full"
              size="large"
              className="entry-pill entry-pill-pillar"
              style={style}
              selected={isSelected}
              onClick={() => {
                setSelectedPillarId(p.id);
                const first = groups.find((g) => g.pillarId === p.id);
                if (first) setSelectedGroupKey(first.key);
              }}
            >
              {p.name}
            </Chip>
          );
        })}
      </div>

      <div className="field-label" style={{ marginTop: 14 }}>
        KPI <InfoTip>Grey until updated. Red if the target was missed and a remark is still needed.</InfoTip>
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
            <Chip key={g.key} rounded="full" className="entry-pill entry-pill-kpi" style={style} selected={isSelected} onClick={() => setSelectedGroupKey(g.key)}>
              {needsRemark ? <span className="entry-pill-check">!</span> : done && <span className="entry-pill-check">✓</span>} {g.label}
              {!g.manualEntry && <span className="entry-pill-remarks-tag"> · remarks only</span>}
            </Chip>
          );
        })}
      </div>

      {selectedGroup && (
        <div className="card entry-card entry-card-single" style={{ borderTopColor: (PILLAR_COLORS[pillars.find((p) => p.id === selectedGroup.pillarId)?.code ?? 'S'] ?? PILLAR_COLORS.S).base }}>
          <div className="entry-card-header">
            <h3>{selectedGroup.label}</h3>
            <span className="muted">
              Target: {round2(form.loading ? selectedGroup.target : form.resolvedTarget)} {selectedGroup.unit} ({selectedGroup.isHigherBetter ? 'higher is good' : 'lower is good'})
            </span>
          </div>

          {hasShiftToggle && (
            <SegmentedControl
              size="small"
              className="entry-shift-toggle"
              value={form.shift}
              onChange={(v) => handleShiftChange(v as 'day' | 'night')}
              items={[
                { value: 'day', text: 'Day' },
                { value: 'night', text: 'Night' },
              ]}
            />
          )}

          {form.loading ? (
            <InlineLoader />
          ) : selectedGroup.manualEntry ? (
            <>
              <label className="field-label">
                Actual ({selectedGroup.unit}){hasShiftToggle ? ` — ${form.shift === 'day' ? 'Day' : 'Night'} shift` : ''}
              </label>
              <NumberField value={form.actualInput} onChange={(v) => patch({ actualInput: v })} placeholder="Enter value" />

              {manualMet === true && (
                <span className="pill pill-good" style={{ marginTop: 8 }}>
                  Target met
                </span>
              )}

              {manualMet === false && (
                <span className="pill pill-bad" style={{ marginTop: 8 }}>
                  Target missed
                </span>
              )}

              <label className="field-label">Remarks{manualMet === false ? ' (required — target missed)' : ' (optional)'}</label>
              <TextAreaField className="entry-remarks" value={form.remarks} onChange={(v) => patch({ remarks: v })} placeholder="What happened, what's being done about it…" />

              {/* Shown as soon as the typed value misses target — before the
                  first save too; ticks then save together with the entry. */}
              {manualMet === false && renderCategories(form.existing?.id ?? null)}

              {form.error && <div className="alert alert-error">{form.error}</div>}

              <div>
                <Button themeColor="primary" disabled={form.saving} onClick={handleSaveManual}>
                  {form.saving ? 'Saving…' : form.saved ? 'Saved ✓' : form.existing ? 'Update entry' : 'Save entry'}
                </Button>
              </div>
            </>
          ) : !form.existing ? (
            <div className="empty-state">
              No performance data uploaded yet for {selectedGroup.label} on this date. Once the Admin daily upload
              includes it, this KPI's actual value will show here and you can add a remark.
            </div>
          ) : (
            <>
              {(() => {
                // Recomputed live, not read from form.existing.met_target —
                // see groupNeedsRemark's comment above for why the stored
                // value can be stale after a direction correction.
                const existingMet = metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.existing.target, form.existing.actual);
                return (
                  <>
                    <div className="entry-readonly-value">
                      <span className={`headline-value ${existingMet ? 'value-good' : 'value-bad'}`}>
                        {round2(form.existing.actual)}
                        <span className="headline-unit">{selectedGroup.unit}</span>
                      </span>
                      <span className={`pill ${existingMet ? 'pill-good' : 'pill-bad'}`}>{existingMet ? 'Target met' : 'Target missed'}</span>
                    </div>

                  </>
                );
              })()}

              <label className="field-label">
                Remarks
                {!metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.existing.target, form.existing.actual) ? ' (required — target missed)' : ' (optional)'}
              </label>
              <TextAreaField className="entry-remarks" value={form.remarks} onChange={(v) => patch({ remarks: v })} placeholder="What happened, what's being done about it…" />

              {!metTarget({ is_higher_better: selectedGroup.isHigherBetter }, form.existing.target, form.existing.actual) &&
                renderCategories(form.existing.id)}

              {form.error && <div className="alert alert-error">{form.error}</div>}

              <div>
                <Button themeColor="primary" disabled={form.saving} onClick={handleSaveRemarks}>
                  {form.saving ? 'Saving…' : form.saved ? 'Saved ✓' : 'Save remark'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
