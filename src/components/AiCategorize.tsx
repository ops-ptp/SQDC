import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { AutoComplete } from '@progress/kendo-react-dropdowns';
import { useDepartment } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import { bulkUpdateAiCategories, fetchMissedEntriesForKpiIds, type RawEntryRow } from '../lib/data';
import { bulkAddEntryCategories, bulkAddKpiCategories, cleanLabel, DEFAULT_DIMENSION, fetchEntryCategories, fetchKpiCategories, orderedDimensions, type EntryCategory, type KpiCategory } from '../lib/categories';
import { AiNotConfiguredError, remarkText, suggestCategories, type AiSuggestion } from '../lib/aiCategorize';
import { errorMessage, round2 } from '../types';
import ParetoChart from './ParetoChart';
import { Button, CheckField, DateField, InfoTip, InlineLoader, Select, TextAreaField } from './ui';

// ===========================================================================
// AI categorisation (Gemini) for one KPI's missed-target remarks.
//
//   1. The admin picks a date range, the category list (pre-filled from the
//      KPI's own pick-list) and an instruction in plain words.
//   2. Gemini SUGGESTS one category per remark, with a confidence and the
//      words that led to it.
//   3. The admin reviews every row — change the category, untick what's
//      wrong — and sees the resulting Pareto before saving.
//   4. Save writes BOTH the Weekly Pareto tag (entry_categories, the same
//      tags Enter Remarks shows) and the Insights category (ai_category),
//      and adds any new category to the KPI's pick-list.
// Nothing is written before step 4.
// ===========================================================================

const MAX_PER_RUN = 300;
const DEFAULT_INSTRUCTION = 'Categorise each remark by the main root cause of the missed target.';

interface ReviewRow {
  entry: RawEntryRow;
  suggestion: AiSuggestion;
  category: string;
  accepted: boolean;
}

const CONFIDENCE_LABEL: Record<AiSuggestion['confidence'], string> = { high: 'High', medium: 'Medium', low: 'Low' };

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
  const [dimension, setDimension] = useState(DEFAULT_DIMENSION);
  const [onlyUntagged, setOnlyUntagged] = useState(true);
  const [categoriesText, setCategoriesText] = useState('');
  const [allowNew, setAllowNew] = useState(false);
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewRow[] | null>(null);
  const [model, setModel] = useState('');
  const idsKey = kpiIds.join(',');

  // Load the KPI's remarks, existing tags and category pick-list.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReview(null);
    setError(null);
    Promise.all([fetchMissedEntriesForKpiIds(kpiIds, from), fetchKpiCategories(department.id, pillarId, kpiLabel)])
      .then(async ([rows, list]) => {
        const inRange = rows.filter((r) => r.entry_date <= to);
        const t = await fetchEntryCategories(inRange.map((r) => r.id));
        if (cancelled) return;
        setEntries(inRange);
        setTags(t);
        setPickList(list);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load remarks')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, from, to, department.id, pillarId, kpiLabel]);

  const dimensions = useMemo(() => orderedDimensions(pickList), [pickList]);
  useEffect(() => {
    if (!dimensions.includes(dimension)) setDimension(dimensions[0]);
  }, [dimensions, dimension]);

  // Pre-fill the category list from the KPI's pick-list for this dimension.
  useEffect(() => {
    setCategoriesText(
      pickList
        .filter((c) => c.dimension === dimension)
        .map((c) => c.label)
        .join('\n')
    );
  }, [pickList, dimension]);

  const tagsByEntry = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of tags) if (t.dimension === dimension) m.set(t.entry_id, [...(m.get(t.entry_id) ?? []), t.category]);
    return m;
  }, [tags, dimension]);

  const candidates = entries.filter((e) => remarkText(e.reason, e.remarks) && (!onlyUntagged || !tagsByEntry.has(e.id)));
  const noText = entries.filter((e) => !remarkText(e.reason, e.remarks)).length;
  const categories = Array.from(new Set(categoriesText.split('\n').map(cleanLabel).filter(Boolean)));

  async function run() {
    if (!employee) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    setNotConfigured(null);
    try {
      const batch = candidates.slice(0, MAX_PER_RUN);
      const res = await suggestCategories({
        employeeCode: employee.employee_code,
        departmentId: department.id,
        instruction,
        categories,
        allowNew,
        items: batch.map((e) => ({ id: e.id, text: remarkText(e.reason, e.remarks) })),
      });
      const byId = new Map(res.results.map((r) => [r.id, r]));
      setModel(res.model);
      setReview(
        batch.map((entry) => {
          const suggestion = byId.get(entry.id) ?? { id: entry.id, category: null, confidence: 'low' as const, reason: 'No suggestion returned' };
          const category = suggestion.category ? cleanLabel(suggestion.category) : '';
          // "Other" and empty suggestions start unticked — they need a human call.
          return { entry, suggestion, category, accepted: Boolean(category) && category.toLowerCase() !== 'other' };
        })
      );
    } catch (e) {
      if (e instanceof AiNotConfiguredError) setNotConfigured(e.message);
      else setError(errorMessage(e, 'AI categorisation failed'));
    } finally {
      setRunning(false);
    }
  }

  function patchRow(id: string, patch: Partial<ReviewRow>) {
    setReview((prev) => prev?.map((r) => (r.entry.id === id ? { ...r, ...patch } : r)) ?? null);
  }

  const accepted = useMemo(() => review?.filter((r) => r.accepted && cleanLabel(r.category)) ?? [], [review]);
  const previewData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of accepted) {
      const c = cleanLabel(r.category);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [accepted]);
  const options = useMemo(
    () => Array.from(new Set([...categories, ...(review ?? []).map((r) => cleanLabel(r.category)).filter(Boolean)])).sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoriesText, review]
  );

  async function save() {
    if (accepted.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const existing = new Set(pickList.filter((c) => c.dimension === dimension).map((c) => c.label.toLowerCase()));
      // Reuse an existing pick-list spelling when only the case differs.
      const canonical = new Map(pickList.filter((c) => c.dimension === dimension).map((c) => [c.label.toLowerCase(), c.label]));
      const rows = accepted.map((r) => {
        const c = cleanLabel(r.category);
        return { id: r.entry.id, category: canonical.get(c.toLowerCase()) ?? c };
      });
      const newLabels = Array.from(new Set(rows.map((r) => r.category).filter((c) => !existing.has(c.toLowerCase()))));
      await bulkAddKpiCategories(
        newLabels.map((label) => ({ department_id: department.id, pillar_id: pillarId, kpi_base_name: kpiLabel, dimension, label, sort_order: 999 }))
      );
      await bulkAddEntryCategories(rows.map((r) => ({ entry_id: r.id, dimension, category: r.category, created_by: employee?.id ?? null })));
      await bulkUpdateAiCategories(rows);
      const savedIds = new Set(rows.map((r) => r.id));
      setMessage(
        `Saved ${rows.length} categor${rows.length === 1 ? 'y' : 'ies'} — they now count in the Weekly Pareto and the Insights pivot below.` +
          (newLabels.length ? ` Added ${newLabels.length} new categor${newLabels.length === 1 ? 'y' : 'ies'} to ${kpiLabel}'s list: ${newLabels.join(', ')}.` : '')
      );
      setReview((prev) => prev?.filter((r) => !savedIds.has(r.entry.id)) ?? null);
      setTags((prev) => [...prev, ...rows.map((r) => ({ id: `new-${r.id}`, entry_id: r.id, dimension, category: r.category }))]);
      setPickList((prev) => [...prev, ...newLabels.map((label) => ({ id: `new-${label}`, pillar_id: pillarId, kpi_base_name: kpiLabel, dimension, label, sort_order: 999 }))]);
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card ai-cat">
      <h3>
        AI categorisation — {kpiLabel}{' '}
        <InfoTip>
          Google Gemini suggests a Pareto category for each missed-target remark. You review every suggestion before anything is saved. Saved
          categories become the remark's Weekly Pareto tag and its Insights category.
        </InfoTip>
      </h3>
      <div className="alert alert-warning" style={{ marginBottom: 16 }}>
        Remarks are sent to Google Gemini. Use a <b>paid</b> Google AI Studio key for live data — on the free tier Google may use what's sent to
        improve its products.
      </div>

      {notConfigured && <div className="alert alert-info">{notConfigured} A site admin adds the key in Supabase → Edge Functions → Secrets.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="ai-cat-setup">
        <div className="ai-cat-col">
          <div className="ai-cat-row">
            <label className="field-label">
              From
              <DateField value={from} max={to} onChange={(v) => v && setFrom(v)} ariaLabel="From date" />
            </label>
            <label className="field-label">
              To
              <DateField value={to} max={today} onChange={(v) => v && setTo(v)} ariaLabel="To date" />
            </label>
            {dimensions.length > 1 && (
              <label className="field-label">
                Pareto
                <Select value={dimension} onChange={setDimension} options={dimensions.map((d) => ({ value: d, label: d }))} ariaLabel="Category dimension" />
              </label>
            )}
          </div>
          <label className="field-label ai-cat-check">
            <CheckField checked={onlyUntagged} onChange={setOnlyUntagged} />
            Only remarks without a {dimension.toLowerCase()} category yet
          </label>
          <label className="field-label">
            Instruction to the AI
            <TextAreaField value={instruction} onChange={setInstruction} rows={3} placeholder={DEFAULT_INSTRUCTION} />
          </label>
        </div>
        <div className="ai-cat-col">
          <label className="field-label">
            <span className="field-title">
              Categories — one per line{' '}
              <InfoTip>Pre-filled from this KPI's own category list. Edit freely. Leave it empty to let the AI propose categories.</InfoTip>
            </span>
            <TextAreaField value={categoriesText} onChange={setCategoriesText} rows={7} placeholder={'QC breakdown\nHeavy rehandle\nBad weather'} />
          </label>
          <label className="field-label ai-cat-check">
            <CheckField checked={allowNew} onChange={setAllowNew} disabled={categories.length === 0} />
            Let the AI propose a new category when none fits
          </label>
        </div>
      </div>

      <div className="ai-cat-run">
        {loading ? (
          <InlineLoader label="Loading remarks…" />
        ) : (
          <>
            <Button themeColor="primary" onClick={run} disabled={running || candidates.length === 0 || !employee}>
              {running ? 'Asking Gemini…' : `Suggest categories for ${Math.min(candidates.length, MAX_PER_RUN)} remark${candidates.length === 1 ? '' : 's'}`}
            </Button>
            <span className="muted">
              {entries.length} missed-target entr{entries.length === 1 ? 'y' : 'ies'} in range
              {noText > 0 ? ` · ${noText} with no remark (skipped)` : ''}
              {candidates.length > MAX_PER_RUN ? ` · first ${MAX_PER_RUN} only — narrow the dates for the rest` : ''}
            </span>
          </>
        )}
      </div>

      {review && review.length === 0 && <div className="empty-state">Nothing left to review.</div>}
      {review && review.length > 0 && (
        <div className="ai-cat-review">
          <div className="ai-cat-review-head">
            <h3>
              Review {review.length} suggestion{review.length === 1 ? '' : 's'} <span className="muted ai-cat-model">· {model}</span>
            </h3>
            <div className="ai-cat-bulk">
              <Button size="small" fillMode="flat" onClick={() => setReview((p) => p?.map((r) => ({ ...r, accepted: Boolean(cleanLabel(r.category)) })) ?? null)}>
                Tick all
              </Button>
              <Button size="small" fillMode="flat" onClick={() => setReview((p) => p?.map((r) => (r.suggestion.confidence === 'low' ? { ...r, accepted: false } : r)) ?? null)}>
                Untick low confidence
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
                  <th>Category</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {review.map((r) => {
                  const existing = tagsByEntry.get(r.entry.id);
                  return (
                    <tr key={r.entry.id} className={r.accepted ? '' : 'row-dropped'}>
                      <td>
                        <CheckField checked={r.accepted} onChange={(v) => patchRow(r.entry.id, { accepted: v })} />
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
                        {existing && <div className="muted">Already tagged: {existing.join(', ')}</div>}
                      </td>
                      <td className="ai-cat-category">
                        <AutoComplete
                          data={options}
                          value={r.category}
                          size="small"
                          placeholder="Type a category"
                          onChange={(e) => patchRow(r.entry.id, { category: String(e.value ?? ''), accepted: Boolean(cleanLabel(String(e.value ?? ''))) })}
                        />
                        <div className="muted ai-cat-why">Why: {r.suggestion.reason}</div>
                      </td>
                      <td>
                        <span className={`pill ai-cat-conf ai-cat-conf-${r.suggestion.confidence}`}>{CONFIDENCE_LABEL[r.suggestion.confidence]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ai-cat-preview">
            <div>
              <div className="quadrant-block-title" style={{ padding: '0 0 6px' }}>
                Pareto of what will be saved
              </div>
              {previewData.length > 0 ? <ParetoChart data={previewData} barColor={color} maxBars={8} cumulativeOfAll /> : <div className="empty-state">Nothing ticked.</div>}
            </div>
            <div className="ai-cat-save">
              <Button themeColor="primary" size="large" onClick={save} disabled={saving || accepted.length === 0}>
                {saving ? 'Saving…' : `Save ${accepted.length} categor${accepted.length === 1 ? 'y' : 'ies'}`}
              </Button>
              <span className="muted">Unticked rows are left as they are.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
