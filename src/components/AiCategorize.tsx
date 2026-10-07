import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { AutoComplete } from '@progress/kendo-react-dropdowns';
import { Chip } from '@progress/kendo-react-buttons';
import { useDepartment } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import { fetchMissedEntriesForKpiIds, type RawEntryRow } from '../lib/data';
import {
  bulkAddEntryCategories,
  bulkAddKpiCategories,
  cleanLabel,
  fetchEntryCategories,
  fetchKpiAngles,
  fetchKpiCategories,
  orderedDimensions,
  upsertKpiAngles,
  type EntryCategory,
  type KpiAngle,
  type KpiCategory,
} from '../lib/categories';
import { AiNotConfiguredError, MAX_AI_ANGLES, MAX_AI_TAGS, remarkText, suggestCategories, type AiConfidence, type AiSuggestion } from '../lib/aiCategorize';
import { errorMessage, round2 } from '../types';
import ParetoChart from './ParetoChart';
import AiProgress, { SkeletonRows, type AiRunProgress } from './AiProgress';
import { Button, CheckField, DateField, InfoTip, InlineLoader, Select, TextAreaField, TextField } from './ui';

// ===========================================================================
// AI categorisation (Gemini) for one KPI's missed-target remarks.
//
//   1. The admin picks a date range and one or more ANGLES — ways of looking
//      at the remarks (Cause, Equipment, Location…). Each angle has its own
//      category list (pre-filled from the KPI's pick-list for that angle)
//      and allows either one tag per remark or up to three. New angles can
//      be added right here.
//   2. Gemini SUGGESTS tags for every remark from every picked angle, each
//      with a confidence and the words that led to it.
//   3. The admin reviews every row — remove or add tags, untick what's
//      wrong — and sees each angle's resulting Pareto before saving.
//   4. Save writes the tags (entry_categories — the same tags Enter Remarks,
//      the Weekly Pareto and the Insights pivot use), adds new categories to
//      each angle's pick-list and remembers the angle settings.
// Nothing is written before step 4.
// ===========================================================================

const MAX_PER_RUN = 300;
const MAX_ANGLE_NAME = 40;
const DEFAULT_INSTRUCTION = '';

interface AngleSetup {
  name: string;
  categoriesText: string;
  allowNew: boolean;
  multi: boolean;
  selected: boolean;
  /** Created in this session and not saved yet. */
  isNew: boolean;
}

interface ReviewTag {
  category: string;
  confidence: AiConfidence | 'manual';
}

interface ReviewRow {
  entry: RawEntryRow;
  accepted: boolean;
  tags: Record<string, ReviewTag[]>;
  reasons: Record<string, string>;
}

const CONFIDENCE_LABEL: Record<ReviewTag['confidence'], string> = { high: 'High', medium: 'Medium', low: 'Low', manual: 'Added by you' };

/** Remarks per request: smaller with more angles (more output per remark),
 * so each batch is one quick Gemini call and the progress bar moves often. */
const batchSizeFor = (angleCount: number) => Math.max(10, Math.floor(40 / angleCount));
const PARALLEL_BATCHES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toReviewRow(entry: RawEntryRow, s: AiSuggestion | undefined, runAngles: AngleSetup[]): ReviewRow {
  const rowTags: Record<string, ReviewTag[]> = {};
  const reasons: Record<string, string> = {};
  for (const a of runAngles) {
    const r = s?.angles[a.name];
    // "Other" means the AI found nothing that fits — that's a human call, so it starts off.
    rowTags[a.name] = (r?.tags ?? []).filter((t) => cleanLabel(t.category).toLowerCase() !== 'other').map((t) => ({ ...t, category: cleanLabel(t.category) }));
    reasons[a.name] = r?.reason ?? 'No suggestion returned';
    if (r && r.tags.length > 0 && rowTags[a.name].length === 0) reasons[a.name] = `No category fits (AI said "Other") — ${r.reason}`;
  }
  const row: ReviewRow = { entry, accepted: false, tags: rowTags, reasons };
  row.accepted = Object.values(rowTags).some((t) => t.length > 0);
  return row;
}

const categoriesOf = (text: string) => Array.from(new Set(text.split('\n').map(cleanLabel).filter(Boolean)));
const rowHasTags = (r: ReviewRow) => Object.values(r.tags).some((t) => t.length > 0);

function buildAngleSetups(pickList: KpiCategory[], saved: KpiAngle[], prev: AngleSetup[]): AngleSetup[] {
  const names = orderedDimensions([...pickList, ...saved.map((a) => ({ dimension: a.dimension }))]);
  const prevByName = new Map(prev.map((a) => [a.name, a]));
  const setups = names.map((name, i) => {
    const p = prevByName.get(name);
    return {
      name,
      categoriesText: pickList
        .filter((c) => c.dimension === name)
        .map((c) => c.label)
        .join('\n'),
      allowNew: p?.allowNew ?? false,
      multi: saved.find((a) => a.dimension === name)?.multi_tag ?? p?.multi ?? false,
      selected: p ? p.selected : i === 0,
      isNew: false,
    };
  });
  // Keep unsaved new angles across a reload (e.g. a date change).
  for (const p of prev) if (p.isNew && !names.includes(p.name)) setups.push(p);
  return setups;
}

export default function AiCategorize({
  pillarId,
  kpiLabel,
  kpiIds,
  color,
  onSaved,
}: {
  pillarId: string;
  kpiLabel: string;
  kpiIds: string[];
  color: string;
  onSaved: () => void;
}) {
  const department = useDepartment();
  const { employee } = useEmployee();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(today);
  const [entries, setEntries] = useState<RawEntryRow[]>([]);
  const [tags, setTags] = useState<EntryCategory[]>([]);
  const [pickList, setPickList] = useState<KpiCategory[]>([]);
  const [angles, setAngles] = useState<AngleSetup[]>([]);
  const [newAngleName, setNewAngleName] = useState('');
  const [newAngleOpen, setNewAngleOpen] = useState(false);
  const [angleError, setAngleError] = useState<string | null>(null);
  const [onlyUntagged, setOnlyUntagged] = useState(true);
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewRow[] | null>(null);
  const [reviewAngles, setReviewAngles] = useState<AngleSetup[]>([]);
  const [previewAngle, setPreviewAngle] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [model, setModel] = useState('');
  const [progress, setProgress] = useState<AiRunProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Remarks a cancelled or failed run didn't get to, for "Continue".
  const [pending, setPending] = useState<{ entries: RawEntryRow[]; angles: AngleSetup[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idsKey = kpiIds.join(',');

  // Load the KPI's remarks, existing tags, category pick-lists and angles.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReview(null);
    setError(null);
    Promise.all([
      fetchMissedEntriesForKpiIds(kpiIds, from, to),
      fetchKpiCategories(department.id, pillarId, kpiLabel),
      fetchKpiAngles(department.id, pillarId, kpiLabel).catch(() => [] as KpiAngle[]),
    ])
      .then(async ([rows, list, saved]) => {
        const inRange = rows.filter((r) => r.entry_date <= to);
        const t = await fetchEntryCategories(inRange.map((r) => r.id));
        if (cancelled) return;
        setEntries(inRange);
        setTags(t);
        setPickList(list);
        setAngles((prev) => buildAngleSetups(list, saved, prev));
      })
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load remarks')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, from, to, department.id, pillarId, kpiLabel]);

  const selectedAngles = angles.filter((a) => a.selected);

  // entry id → angle → existing tags
  const existingTags = useMemo(() => {
    const m = new Map<string, Map<string, string[]>>();
    for (const t of tags) {
      const byAngle = m.get(t.entry_id) ?? new Map<string, string[]>();
      byAngle.set(t.dimension, [...(byAngle.get(t.dimension) ?? []), t.category]);
      m.set(t.entry_id, byAngle);
    }
    return m;
  }, [tags]);

  // "Only untagged": a remark is still worth sending while ANY picked angle
  // has no tag on it yet.
  const candidates = entries.filter(
    (e) => remarkText(e.reason, e.remarks) && (!onlyUntagged || selectedAngles.some((a) => !existingTags.get(e.id)?.has(a.name)))
  );
  const noText = entries.filter((e) => !remarkText(e.reason, e.remarks)).length;

  function patchAngle(name: string, patch: Partial<AngleSetup>) {
    setAngles((prev) => prev.map((a) => (a.name === name ? { ...a, ...patch } : a)));
  }

  function toggleAngle(name: string) {
    const a = angles.find((x) => x.name === name);
    if (!a) return;
    if (!a.selected && selectedAngles.length >= MAX_AI_ANGLES) {
      setAngleError(`Up to ${MAX_AI_ANGLES} angles per run.`);
      return;
    }
    setAngleError(null);
    patchAngle(name, { selected: !a.selected });
  }

  function addAngle() {
    const name = cleanLabel(newAngleName);
    if (!name) return;
    if (name.length > MAX_ANGLE_NAME) {
      setAngleError(`Keep the angle name under ${MAX_ANGLE_NAME} characters.`);
      return;
    }
    if (angles.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      setAngleError(`"${name}" already exists — tick it above.`);
      return;
    }
    if (selectedAngles.length >= MAX_AI_ANGLES) {
      setAngleError(`Up to ${MAX_AI_ANGLES} angles per run — untick one first.`);
      return;
    }
    setAngles((prev) => [...prev, { name, categoriesText: '', allowNew: false, multi: false, selected: true, isNew: true }]);
    setNewAngleName('');
    setNewAngleOpen(false);
    setAngleError(null);
  }

  /** Fresh run over the candidates for the ticked angles. */
  function run() {
    if (!employee || selectedAngles.length === 0) return;
    setReview(null);
    void runBatches(candidates.slice(0, MAX_PER_RUN), selectedAngles.map((a) => ({ ...a })), false);
  }

  /** Picks up where a cancelled or failed run stopped. */
  function continueRun() {
    if (!pending) return;
    void runBatches(pending.entries, pending.angles, true);
  }

  function cancelRun() {
    setCancelling(true);
    abortRef.current?.abort();
  }

  /**
   * Sends the remarks in small batches, two at a time, so the progress bar
   * shows real progress. A batch that fails is retried once; if it fails
   * again — or the admin cancels — the run stops, keeps every finished
   * batch for review, and offers to continue with the rest.
   */
  async function runBatches(toTag: RawEntryRow[], runAngles: AngleSetup[], append: boolean) {
    if (!employee || toTag.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setCancelling(false);
    setError(null);
    setMessage(null);
    setNotConfigured(null);
    setPending(null);

    const angleSpecs = runAngles.map((a) => {
      const categories = categoriesOf(a.categoriesText);
      return { name: a.name, categories, allowNew: a.allowNew && categories.length > 0, multi: a.multi };
    });
    const size = batchSizeFor(runAngles.length);
    const batches: RawEntryRow[][] = [];
    for (let i = 0; i < toTag.length; i += size) batches.push(toTag.slice(i, i + size));
    const started = Date.now();
    setProgress({ total: toTag.length, done: 0, batches: batches.length, batchesDone: 0, angles: runAngles.map((a) => a.name), startedAt: started, lastProgressAt: started });

    const results = new Map<string, AiSuggestion>();
    const finished = new Set<number>();
    const models = new Set<string>();
    let failure: unknown = null;
    let next = 0;

    async function worker() {
      while (next < batches.length && !failure && !controller.signal.aborted) {
        const index = next++;
        const batch = batches[index];
        const items = batch.map((e) => ({ id: e.id, text: remarkText(e.reason, e.remarks) }));
        for (let attempt = 0; ; attempt++) {
          try {
            const res = await suggestCategories(
              { employeeCode: employee!.employee_code, departmentId: department.id, instruction, angles: angleSpecs, items },
              controller.signal
            );
            for (const r of res.results) results.set(r.id, r);
            if (res.model) res.model.split(', ').forEach((m) => models.add(m));
            finished.add(index);
            setProgress((p) => p && { ...p, done: p.done + batch.length, batchesDone: p.batchesDone + 1, lastProgressAt: Date.now() });
            break;
          } catch (e) {
            if (controller.signal.aborted) return;
            if (e instanceof AiNotConfiguredError || attempt >= 1) {
              failure = failure ?? e;
              controller.abort();
              return;
            }
            await sleep(1500);
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker));

    // Keep every finished batch, in the original order.
    const doneEntries = batches.filter((_, i) => finished.has(i)).flat();
    const leftEntries = batches.filter((_, i) => !finished.has(i)).flat();
    const rows = doneEntries.map((e) => toReviewRow(e, results.get(e.id), runAngles));
    if (rows.length === 0 && !append) {
      setReview(null);
    } else if (rows.length > 0) {
      setReviewAngles(runAngles);
      setPreviewAngle((p) => (append && runAngles.some((a) => a.name === p) ? p : runAngles[0].name));
      setModel((m) => Array.from(new Set([...(append && m ? m.split(', ') : []), ...models])).join(', '));
      if (!append) setDrafts({});
      setReview((prev) => (append && prev ? [...prev, ...rows] : rows));
    }
    if (leftEntries.length > 0) setPending({ entries: leftEntries, angles: runAngles });

    if (failure instanceof AiNotConfiguredError) {
      setNotConfigured(failure.message);
    } else if (failure) {
      setError(
        `${errorMessage(failure, 'AI categorisation failed')} — stopped after ${doneEntries.length} of ${toTag.length} remarks.` +
          (doneEntries.length ? ' The finished ones are below.' : '')
      );
    } else if (controller.signal.aborted) {
      setMessage(`Cancelled — ${doneEntries.length} of ${toTag.length} remarks tagged${doneEntries.length ? ' and ready to review below' : ''}.`);
    }
    abortRef.current = null;
    setProgress(null);
    setCancelling(false);
    setRunning(false);
  }

  // Stop any run in flight if the panel goes away (KPI switched, page left).
  useEffect(() => () => abortRef.current?.abort(), []);

  function patchRow(id: string, fn: (r: ReviewRow) => ReviewRow) {
    setReview((prev) => prev?.map((r) => (r.entry.id === id ? fn(r) : r)) ?? null);
  }

  function removeTag(id: string, angle: string, category: string) {
    patchRow(id, (r) => {
      const next = { ...r, tags: { ...r.tags, [angle]: r.tags[angle].filter((t) => t.category !== category) } };
      return { ...next, accepted: next.accepted && rowHasTags(next) };
    });
  }

  function addTag(id: string, angle: AngleSetup) {
    const key = `${id}|${angle.name}`;
    const category = cleanLabel(drafts[key] ?? '');
    if (!category) return;
    patchRow(id, (r) => {
      const current = r.tags[angle.name] ?? [];
      if (current.some((t) => t.category.toLowerCase() === category.toLowerCase())) return r;
      const added: ReviewTag = { category, confidence: 'manual' };
      // Single-tag angles: a typed tag replaces the AI's.
      const nextTags = angle.multi ? [...current, added].slice(-MAX_AI_TAGS) : [added];
      return { ...r, accepted: true, tags: { ...r.tags, [angle.name]: nextTags } };
    });
    setDrafts((d) => ({ ...d, [key]: '' }));
  }

  const accepted = useMemo(() => review?.filter((r) => r.accepted && rowHasTags(r)) ?? [], [review]);
  const acceptedTagCount = accepted.reduce((n, r) => n + Object.values(r.tags).reduce((m, t) => m + t.length, 0), 0);

  // Options for each angle's "add tag" box: its list + anything in the review.
  const optionsByAngle = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of reviewAngles) {
      const set = new Set(categoriesOf(a.categoriesText));
      for (const c of pickList) if (c.dimension === a.name) set.add(c.label);
      for (const r of review ?? []) for (const t of r.tags[a.name] ?? []) set.add(t.category);
      m.set(a.name, Array.from(set).sort((x, y) => x.localeCompare(y)));
    }
    return m;
  }, [reviewAngles, pickList, review]);

  const preview = useMemo(() => {
    const counts = new Map<string, number>();
    let shifts = 0;
    let tagCount = 0;
    for (const r of accepted) {
      const t = r.tags[previewAngle] ?? [];
      if (t.length) shifts++;
      for (const x of t) {
        tagCount++;
        counts.set(x.category, (counts.get(x.category) ?? 0) + 1);
      }
    }
    return { data: Array.from(counts.entries()).map(([label, count]) => ({ label, count })), shifts, tagCount };
  }, [accepted, previewAngle]);

  async function save() {
    if (accepted.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const listRows: Parameters<typeof bulkAddKpiCategories>[0] = [];
      const tagRows: Parameters<typeof bulkAddEntryCategories>[0] = [];
      const newByAngle: string[] = [];
      for (const a of reviewAngles) {
        // Reuse an existing pick-list spelling when only the case differs.
        const canonical = new Map(pickList.filter((c) => c.dimension === a.name).map((c) => [c.label.toLowerCase(), c.label]));
        const added: string[] = [];
        for (const r of accepted) {
          for (const t of r.tags[a.name] ?? []) {
            const label = canonical.get(t.category.toLowerCase()) ?? t.category;
            if (!canonical.has(label.toLowerCase())) {
              canonical.set(label.toLowerCase(), label);
              added.push(label);
              listRows.push({ department_id: department.id, pillar_id: pillarId, kpi_base_name: kpiLabel, dimension: a.name, label, sort_order: 999 });
            }
            tagRows.push({ entry_id: r.entry.id, dimension: a.name, category: label, created_by: employee?.id ?? null });
          }
        }
        if (added.length) newByAngle.push(`${a.name}: ${added.join(', ')}`);
      }
      await upsertKpiAngles(
        reviewAngles.map((a) => ({ department_id: department.id, pillar_id: pillarId, kpi_base_name: kpiLabel, dimension: a.name, multi_tag: a.multi }))
      );
      await bulkAddKpiCategories(listRows);
      await bulkAddEntryCategories(tagRows);

      setMessage(
        `Saved ${tagRows.length} tag${tagRows.length === 1 ? '' : 's'} on ${accepted.length} remark${accepted.length === 1 ? '' : 's'} (${reviewAngles
          .map((a) => a.name)
          .join(', ')}) — they now count in the Weekly Pareto, Enter Remarks and Analyse.` +
          (newByAngle.length ? ` New categories added — ${newByAngle.join('; ')}.` : '')
      );
      const savedIds = new Set(accepted.map((r) => r.entry.id));
      setReview((prev) => prev?.filter((r) => !savedIds.has(r.entry.id)) ?? null);
      setTags((prev) => [...prev, ...tagRows.map((t, i) => ({ id: `new-${i}-${t.entry_id}`, entry_id: t.entry_id, dimension: t.dimension, category: t.category }))]);
      const nextPickList = [...pickList, ...listRows.map((l) => ({ ...l, id: `new-${l.dimension}-${l.label}` }))];
      setPickList(nextPickList);
      setAngles((prev) => prev.map((a) => (reviewAngles.some((r) => r.name === a.name) ? { ...a, isNew: false } : a)));
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card ai-cat">
      <p className="muted insights-tab-intro">
        Google Gemini suggests Pareto tags for each missed-target remark, from one or more angles at once. You review every suggestion before
        anything is saved; saved tags are the same ones Enter Remarks, the Weekly Pareto and <b>Analyse</b> use.
      </p>

      {notConfigured && <div className="alert alert-info">{notConfigured} A site admin adds the key in Supabase → Edge Functions → Secrets.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="ai-cat-setup">
        <div className="ai-cat-col">
          <div className="ai-cat-step">Which remarks</div>
          <div className="ai-cat-row">
            <label className="field-label">
              From
              <DateField value={from} max={to} onChange={(v) => v && setFrom(v)} ariaLabel="From date" />
            </label>
            <label className="field-label">
              To
              <DateField value={to} max={today} onChange={(v) => v && setTo(v)} ariaLabel="To date" />
            </label>
          </div>
          <label className="field-label ai-cat-check">
            <CheckField checked={onlyUntagged} onChange={setOnlyUntagged} />
            Skip remarks already tagged in every picked angle
          </label>
          <details className="ai-cat-more" open={Boolean(instruction)}>
            <summary>Extra instruction to the AI (optional)</summary>
            <p className="muted">Anything that helps it read your remarks — abbreviations, what counts as what. The angles and their categories are sent automatically.</p>
            <TextAreaField
              value={instruction}
              onChange={setInstruction}
              rows={3}
              placeholder={'e.g. "RTG" and "RTGC" are the same crane. Weather includes haze and lightning stoppages.'}
            />
          </details>
        </div>

        <div className="ai-cat-col">
          <div>
            <div className="ai-cat-step">
              Angles to tag{' '}
              <InfoTip>
                An angle is one way of looking at the remarks, with its own categories and its own Pareto — e.g. Cause, Equipment, Location, Crew. Pick
                up to {MAX_AI_ANGLES}; the AI tags every remark from each one in a single run.
              </InfoTip>
            </div>
            <div className="ai-cat-angles">
              {angles.map((a) => (
                <Chip
                  key={a.name}
                  text={a.isNew ? `${a.name} (new)` : a.name}
                  rounded="full"
                  selected={a.selected}
                  className={`ai-cat-angle-chip${a.selected ? ' is-selected' : ''}`}
                  onClick={() => toggleAngle(a.name)}
                  ariaLabel={`${a.selected ? 'Untick' : 'Tick'} angle ${a.name}`}
                />
              ))}
              {!newAngleOpen && (
                <Button size="small" fillMode="flat" onClick={() => setNewAngleOpen(true)}>
                  + New angle
                </Button>
              )}
            </div>
            {newAngleOpen && (
              <div className="ai-cat-new-angle">
                <TextField value={newAngleName} onChange={setNewAngleName} placeholder="e.g. Equipment involved" ariaLabel="New angle name" autoFocus />
                <Button size="small" themeColor="primary" onClick={addAngle} disabled={!cleanLabel(newAngleName)}>
                  Add
                </Button>
                <Button
                  size="small"
                  fillMode="flat"
                  onClick={() => {
                    setNewAngleOpen(false);
                    setNewAngleName('');
                    setAngleError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
            {angleError && <div className="field-error">{angleError}</div>}
          </div>

          {selectedAngles.length === 0 && <div className="muted">Tick at least one angle.</div>}
          {selectedAngles.map((a) => {
            const categories = categoriesOf(a.categoriesText);
            return (
              <div key={a.name} className="ai-cat-angle-card">
                <div className="ai-cat-angle-card-title">{a.name}</div>
                <label className="field-label">
                  <span className="field-title">
                    Categories — one per line{' '}
                    <InfoTip>Pre-filled from this angle's category list. Edit freely. Leave it empty to let the AI propose categories.</InfoTip>
                  </span>
                  <TextAreaField
                    value={a.categoriesText}
                    onChange={(v) => patchAngle(a.name, { categoriesText: v })}
                    rows={4}
                    placeholder={'Leave empty to let the AI propose,\nor list them: QC breakdown\nHeavy rehandle'}
                  />
                </label>
                <label className="field-label ai-cat-check">
                  <CheckField checked={a.multi} onChange={(v) => patchAngle(a.name, { multi: v })} />
                  <span className="field-title">
                    Up to {MAX_AI_TAGS} tags per remark{' '}
                    <InfoTip>
                      For angles where one shift can have several answers — e.g. a delay caused by both a breakdown and a manpower shortage. Leave off
                      for angles with one answer per shift (e.g. Location). The setting is remembered when you save.
                    </InfoTip>
                  </span>
                </label>
                <label className="field-label ai-cat-check">
                  <CheckField checked={a.allowNew && categories.length > 0} onChange={(v) => patchAngle(a.name, { allowNew: v })} disabled={categories.length === 0} />
                  Let the AI propose a new category when none fits
                </label>
              </div>
            );
          })}
        </div>
      </div>

      {pending && !running && (
        <div className="alert alert-info ai-cat-continue">
          <span>
            {pending.entries.length} remark{pending.entries.length === 1 ? '' : 's'} from that run {pending.entries.length === 1 ? "wasn't" : "weren't"} tagged yet.
          </span>
          <Button size="small" themeColor="primary" onClick={continueRun}>
            Continue with {pending.entries.length}
          </Button>
          <Button size="small" fillMode="flat" onClick={() => setPending(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="ai-cat-run">
        {loading ? (
          <InlineLoader label="Loading remarks…" />
        ) : progress ? (
          <AiProgress progress={progress} onCancel={cancelRun} cancelling={cancelling} />
        ) : (
          <>
            <Button themeColor="primary" onClick={run} disabled={running || candidates.length === 0 || !employee || selectedAngles.length === 0}>
              {`Suggest tags for ${Math.min(candidates.length, MAX_PER_RUN)} remark${candidates.length === 1 ? '' : 's'}${
                selectedAngles.length > 1 ? ` × ${selectedAngles.length} angles` : ''
              }`}
            </Button>
            <span className="muted">
              {entries.length} missed-target entr{entries.length === 1 ? 'y' : 'ies'} in range
              {noText > 0 ? ` · ${noText} with no remark (skipped)` : ''}
              {candidates.length > MAX_PER_RUN ? ` · first ${MAX_PER_RUN} only — narrow the dates for the rest` : ''}
            </span>
          </>
        )}
      </div>
      <p className="ai-cat-privacy">
        Remarks are sent to Google Gemini. Use a <b>paid</b> Google AI Studio key for live data — on the free tier Google may use what's sent to
        improve its products.
      </p>

      {progress && <SkeletonRows rows={Math.min(6, Math.max(1, progress.total - progress.done))} angles={progress.angles} />}
      {!progress && review && review.length === 0 && <div className="empty-state">Nothing left to review.</div>}
      {!progress && review && review.length > 0 && (
        <div className="ai-cat-review">
          <div className="ai-cat-review-head">
            <h3>
              Review {review.length} remark{review.length === 1 ? '' : 's'} <span className="muted ai-cat-model">· {model}</span>
            </h3>
            <div className="ai-cat-bulk">
              <Button size="small" fillMode="flat" onClick={() => setReview((p) => p?.map((r) => ({ ...r, accepted: rowHasTags(r) })) ?? null)}>
                Tick all
              </Button>
              <Button
                size="small"
                fillMode="flat"
                onClick={() =>
                  setReview(
                    (p) =>
                      p?.map((r) => {
                        const next = { ...r, tags: Object.fromEntries(Object.entries(r.tags).map(([k, t]) => [k, t.filter((x) => x.confidence !== 'low')])) };
                        return { ...next, accepted: next.accepted && rowHasTags(next) };
                      }) ?? null
                  )
                }
              >
                Remove low-confidence tags
              </Button>
              <Button size="small" fillMode="flat" onClick={() => setReview((p) => p?.map((r) => ({ ...r, accepted: false })) ?? null)}>
                Untick all
              </Button>
            </div>
          </div>
          <div className="table-scroll ai-cat-table-scroll">
            <table className="action-table ai-cat-table">
              <thead>
                <tr>
                  <th>Save</th>
                  <th>Date</th>
                  <th>Actual / target</th>
                  <th>Remark</th>
                  {reviewAngles.map((a) => (
                    <th key={a.name}>
                      {a.name}
                      <span className="muted ai-cat-th-note">{a.multi ? ` · up to ${MAX_AI_TAGS}` : ' · 1 tag'}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.map((r) => {
                  const existing = existingTags.get(r.entry.id);
                  return (
                    <tr key={r.entry.id} className={r.accepted ? '' : 'row-dropped'}>
                      <td>
                        <CheckField checked={r.accepted} disabled={!rowHasTags(r)} onChange={(v) => patchRow(r.entry.id, (x) => ({ ...x, accepted: v }))} />
                      </td>
                      <td className="ai-cat-nowrap">
                        {format(parseISO(r.entry.entry_date), 'd MMM')}
                        {r.entry.shift ? ` · ${r.entry.shift}` : ''}
                      </td>
                      <td className="ai-cat-nowrap">
                        {round2(r.entry.actual)} / {round2(r.entry.target)} {r.entry.unit}
                      </td>
                      <td className="ai-cat-remark">
                        {r.entry.reason && <div className="muted">{r.entry.reason}</div>}
                        <div>{r.entry.remarks}</div>
                        {existing &&
                          reviewAngles
                            .filter((a) => existing.has(a.name))
                            .map((a) => (
                              <div key={a.name} className="muted">
                                Already tagged {a.name}: {existing.get(a.name)!.join(', ')}
                              </div>
                            ))}
                      </td>
                      {reviewAngles.map((a) => {
                        const key = `${r.entry.id}|${a.name}`;
                        const rowTags = r.tags[a.name] ?? [];
                        return (
                          <td key={a.name} className="ai-cat-category">
                            <div className="ai-cat-tags">
                              {rowTags.map((t) => (
                                <span key={t.category} className={`ai-tag ai-cat-conf-${t.confidence}`} title={`Confidence: ${CONFIDENCE_LABEL[t.confidence]}`}>
                                  {t.category}
                                  <button type="button" className="ai-tag-remove" aria-label={`Remove ${t.category}`} onClick={() => removeTag(r.entry.id, a.name, t.category)}>
                                    ×
                                  </button>
                                </span>
                              ))}
                              {rowTags.length === 0 && <span className="muted">No tag</span>}
                            </div>
                            <div className="ai-tag-add">
                              <AutoComplete
                                data={optionsByAngle.get(a.name) ?? []}
                                value={drafts[key] ?? ''}
                                size="small"
                                placeholder={a.multi || rowTags.length === 0 ? 'Add a tag' : 'Replace tag'}
                                onChange={(e) => setDrafts((d) => ({ ...d, [key]: String(e.value ?? '') }))}
                              />
                              <Button size="small" onClick={() => addTag(r.entry.id, a)} disabled={!cleanLabel(drafts[key] ?? '')} aria-label={`Add tag to ${a.name}`}>
                                +
                              </Button>
                            </div>
                            <div className="muted ai-cat-why">Why: {r.reasons[a.name]}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ai-cat-preview">
            <div>
              <div className="ai-cat-preview-head">
                <div className="quadrant-block-title" style={{ padding: 0 }}>
                  Pareto of what will be saved
                </div>
                {reviewAngles.length > 1 && (
                  <Select
                    value={previewAngle}
                    onChange={setPreviewAngle}
                    options={reviewAngles.map((a) => ({ value: a.name, label: a.name }))}
                    ariaLabel="Angle to preview"
                    size="small"
                  />
                )}
              </div>
              {preview.data.length > 0 ? (
                <>
                  <ParetoChart data={preview.data} barColor={color} maxBars={8} cumulativeOfAll shareOf={preview.shifts} />
                  <div className="muted ai-cat-preview-note">
                    {preview.shifts} remark{preview.shifts === 1 ? '' : 's'}
                    {preview.tagCount > preview.shifts
                      ? ` · ${preview.tagCount} tags — some remarks carry more than one, so the bars add up to more than ${preview.shifts}. Bar % = share of remarks mentioning it.`
                      : ''}
                  </div>
                </>
              ) : (
                <div className="empty-state">Nothing ticked for this angle.</div>
              )}
            </div>
          </div>
          <div className="ai-cat-savebar">
            <span className="muted">Unticked rows are left as they are. Saving adds tags — it never removes ones already on a remark.</span>
            <Button themeColor="primary" size="large" onClick={save} disabled={saving || accepted.length === 0}>
              {saving ? 'Saving…' : `Save ${accepted.length} remark${accepted.length === 1 ? '' : 's'} · ${acceptedTagCount} tag${acceptedTagCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
