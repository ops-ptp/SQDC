import { useEffect, useMemo, useState } from 'react';
import {
  addEntryCategory,
  addKpiCategory,
  fetchEntryCategories,
  fetchKpiAngles,
  fetchKpiCategories,
  orderedDimensions,
  removeEntryCategory,
  type EntryCategory,
  type KpiAngle,
  type KpiCategory,
} from '../lib/categories';
import { useDepartment } from '../context/DepartmentContext';
import { errorMessage } from '../types';
import { Chip } from '@progress/kendo-react-buttons';
import { AutoComplete } from '@progress/kendo-react-dropdowns';
import { checkIcon } from '@progress/kendo-svg-icons';
import { Button, InlineLoader } from './ui';

interface Props {
  pillarId: string;
  /** Logical KPI base name — Day and Night share one category list. */
  kpiBaseName: string;
  /** The daily entry (one shift) being tagged. */
  entryId: string;
  /** Who's tagging (stored on new tags); null when not logged in. */
  employeeId: string | null;
  /** Read-only when false — chips shown, no toggling or adding. */
  editable: boolean;
  /** Called after any tag change, so a parent Pareto can refresh. */
  onChange?: () => void;
  /** Accent for selected chips — the pillar's brand color. */
  color?: string;
}

/** Category chips for one shift. Each dimension (usually just "Cause";
 * Accident has Location / Equipment / Symptom) is a row of toggle chips
 * drawn from the KPI's pick-list. Changes save immediately — there's no
 * separate Save step — so it works the same on Enter Remarks and in the
 * board's Pareto drill-down. Typing a new category reuses an existing one
 * when it only differs by case, so the list can't grow new casing variants. */
export default function CategoryPicker({ pillarId, kpiBaseName, entryId, employeeId, editable, onChange, color = '#2A544F' }: Props) {
  const department = useDepartment();
  const [list, setList] = useState<KpiCategory[]>([]);
  const [angles, setAngles] = useState<KpiAngle[]>([]);
  const [tags, setTags] = useState<EntryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState<Record<string, string>>({});

  useEffect(() => {
    // Starts in the loading state; callers key this component by entry, so
    // a different shift always mounts a fresh instance.
    let cancelled = false;
    Promise.all([fetchKpiCategories(department.id, pillarId, kpiBaseName), fetchKpiAngles(department.id, pillarId, kpiBaseName).catch(() => []), fetchEntryCategories([entryId])])
      .then(([l, a, t]) => {
        if (cancelled) return;
        setList(l);
        setAngles(a);
        setTags(t);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load categories')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [department.id, pillarId, kpiBaseName, entryId]);

  // Dimensions come from the KPI's list AND from any tags already on this
  // entry, so a tag whose list item was removed still shows (and can be
  // un-ticked) rather than silently disappearing from view.
  // Angles created in Insights show up even before they have any category.
  const dimensions = useMemo(() => orderedDimensions([...list, ...angles.map((a) => ({ dimension: a.dimension })), ...tags]), [list, angles, tags]);

  function isOn(dimension: string, label: string) {
    return tags.some((t) => t.dimension === dimension && t.category === label);
  }

  async function toggle(dimension: string, label: string) {
    if (!editable || busy) return;
    const key = `${dimension}|${label}`;
    setBusy(key);
    setError(null);
    try {
      if (isOn(dimension, label)) {
        await removeEntryCategory(entryId, dimension, label);
        setTags((prev) => prev.filter((t) => !(t.dimension === dimension && t.category === label)));
      } else {
        await addEntryCategory(entryId, dimension, label, employeeId);
        setTags((prev) => [...prev, { id: key, entry_id: entryId, dimension, category: label }]);
      }
      onChange?.();
    } catch (e) {
      setError(errorMessage(e, 'Failed to save category'));
    } finally {
      setBusy(null);
    }
  }

  async function addNew(dimension: string) {
    const raw = (newText[dimension] ?? '').trim();
    if (!raw || busy) return;
    setBusy(`new|${dimension}`);
    setError(null);
    try {
      const label = await addKpiCategory(department.id, pillarId, kpiBaseName, dimension, raw, list);
      if (!list.some((c) => c.dimension === dimension && c.label === label)) {
        setList((prev) => [...prev, { id: `${dimension}|${label}`, pillar_id: pillarId, kpi_base_name: kpiBaseName, dimension, label, sort_order: 999 }]);
      }
      if (!isOn(dimension, label)) {
        await addEntryCategory(entryId, dimension, label, employeeId);
        setTags((prev) => [...prev, { id: `${dimension}|${label}`, entry_id: entryId, dimension, category: label }]);
        onChange?.();
      }
      setNewText((prev) => ({ ...prev, [dimension]: '' }));
    } catch (e) {
      setError(errorMessage(e, 'Failed to add category'));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <InlineLoader label="Loading categories…" />;

  return (
    <div className="category-picker">
      {dimensions.map((dimension) => {
        const labels = Array.from(
          new Set([
            ...list.filter((c) => c.dimension === dimension).map((c) => c.label),
            ...tags.filter((t) => t.dimension === dimension).map((t) => t.category),
          ])
        );
        const visible = editable ? labels : labels.filter((l) => isOn(dimension, l));
        return (
          <div key={dimension} className="category-dimension">
            {dimensions.length > 1 && <div className="category-dimension-label">{dimension}</div>}
            <div className="category-chips">
              {visible.length === 0 && <span className="muted category-empty">{editable ? 'No categories yet — add one below.' : 'Not categorised'}</span>}
              {visible.map((label) => {
                const on = isOn(dimension, label);
                return (
                  <Chip
                    key={label}
                    text={label}
                    rounded="full"
                    className={`category-chip ${on ? 'category-chip-on' : ''}`}
                    style={on ? { background: color, borderColor: color, color: 'white' } : undefined}
                    svgIcon={on ? checkIcon : undefined}
                    selected={on}
                    disabled={!editable || busy !== null}
                    ariaSelected={on}
                    onClick={() => toggle(dimension, label)}
                  />
                );
              })}
            </div>
            {editable && (
              <form
                className="category-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addNew(dimension);
                }}
              >
                <AutoComplete
                  className="category-add-input"
                  data={labels}
                  size="small"
                  placeholder={`New ${dimension.toLowerCase()}…`}
                  value={newText[dimension] ?? ''}
                  onChange={(e) => setNewText((prev) => ({ ...prev, [dimension]: String(e.value ?? '') }))}
                />
                <Button type="submit" size="small" disabled={!(newText[dimension] ?? '').trim() || busy !== null}>
                  Add
                </Button>
              </form>
            )}
          </div>
        );
      })}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}
