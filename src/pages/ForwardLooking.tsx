import { addDays, format } from 'date-fns';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import {
  createForecastCard,
  deleteForecastCard,
  fetchForecastCards,
  fetchLeadingKpis,
  updateForecastCard,
  type NewForecastCardInput,
} from '../lib/data';
import { PILLAR_COLORS, type ForecastCardWithRefs, type KpiWithPillar } from '../types';

const TODAY = new Date();
const COLUMN_OFFSETS = [1, 2, 3] as const;

interface FormState {
  kpiId: string;
  note: string;
  ownerName: string;
}

const EMPTY_FORM: FormState = { kpiId: '', note: '', ownerName: '' };

export default function ForwardLooking() {
  const { employee } = useEmployee();
  const [kpis, setKpis] = useState<KpiWithPillar[]>([]);
  const [cards, setCards] = useState<ForecastCardWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which column's "add card" form is open, if any.
  const [addingOffset, setAddingOffset] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Which card is currently being edited, if any.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fromDate = format(addDays(TODAY, 1), 'yyyy-MM-dd');
  const toDate = format(addDays(TODAY, 3), 'yyyy-MM-dd');

  function reload() {
    setLoading(true);
    setError(null);
    Promise.all([fetchLeadingKpis(), fetchForecastCards(fromDate, toDate)])
      .then(([k, c]) => {
        setKpis(k);
        setCards(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Forward Looking board'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => {
    return COLUMN_OFFSETS.map((offset) => {
      const date = addDays(TODAY, offset);
      const dateStr = format(date, 'yyyy-MM-dd');
      return {
        offset,
        dateStr,
        label: `+${offset} Day${offset > 1 ? 's' : ''}`,
        dateLabel: format(date, 'EEE, d MMM'),
        cards: cards.filter((c) => c.target_date === dateStr),
      };
    });
  }, [cards]);

  function kpiById(id: string) {
    return kpis.find((k) => k.id === id);
  }

  function openAdd(offset: number) {
    setAddingOffset(offset);
    setAddForm({ ...EMPTY_FORM, kpiId: kpis[0]?.id ?? '' });
    setAddError(null);
  }

  function closeAdd() {
    setAddingOffset(null);
    setAddForm(EMPTY_FORM);
    setAddError(null);
  }

  async function handleAddSubmit(e: FormEvent, offset: number) {
    e.preventDefault();
    const kpi = kpiById(addForm.kpiId);
    if (!kpi) {
      setAddError('Pick a KPI.');
      return;
    }
    if (!addForm.note.trim()) {
      setAddError('Add a short forecast note.');
      return;
    }
    setAddSaving(true);
    setAddError(null);
    const input: NewForecastCardInput = {
      kpi_id: kpi.id,
      pillar_id: kpi.pillar_id,
      target_date: format(addDays(TODAY, offset), 'yyyy-MM-dd'),
      note: addForm.note.trim(),
      owner_name: addForm.ownerName.trim() || null,
      created_by: employee?.id ?? null,
    };
    try {
      const created = await createForecastCard(input);
      setCards((prev) => [...prev, created]);
      closeAdd();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setAddSaving(false);
    }
  }

  function openEdit(card: ForecastCardWithRefs) {
    setEditingId(card.id);
    setEditForm({ kpiId: card.kpi_id, note: card.note, ownerName: card.owner_name ?? '' });
    setEditError(null);
  }

  function closeEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent, card: ForecastCardWithRefs) {
    e.preventDefault();
    const kpi = kpiById(editForm.kpiId);
    if (!kpi) {
      setEditError('Pick a KPI.');
      return;
    }
    if (!editForm.note.trim()) {
      setEditError('Add a short forecast note.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await updateForecastCard(card.id, {
        kpi_id: kpi.id,
        pillar_id: kpi.pillar_id,
        note: editForm.note.trim(),
        owner_name: editForm.ownerName.trim() || null,
      });
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
      closeEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(card: ForecastCardWithRefs) {
    if (!window.confirm('Delete this forecast card?')) return;
    try {
      await deleteForecastCard(card.id);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete card');
    }
  }

  /** Move a card one day earlier or later by re-writing its target_date. */
  async function shiftCard(card: ForecastCardWithRefs, deltaDays: number) {
    const newDate = format(addDays(new Date(card.target_date), deltaDays), 'yyyy-MM-dd');
    if (newDate < fromDate || newDate > toDate) return;
    try {
      const updated = await updateForecastCard(card.id, { target_date: newDate });
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move card');
    }
  }

  if (loading) return <div className="page-loading">Loading Forward Looking board…</div>;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="page fl-page">
      <div className="page-header">
        <h1>Forward Looking</h1>
        <p className="muted">
          Forecast the next 3 days on your leading KPIs — what's expected, and what to watch for.
        </p>
      </div>

      {kpis.length === 0 ? (
        <div className="empty-state">
          No leading KPIs are configured yet. Mark a KPI as leading (<code>kpis.is_leading = true</code>) to forecast
          it here.
        </div>
      ) : (
        <div className="fl-board">
          {columns.map((col) => (
            <div key={col.offset} className="fl-column">
              <div className="fl-column-header">
                <span className="fl-column-title">{col.label}</span>
                <span className="fl-column-date">{col.dateLabel}</span>
              </div>

              <div className="fl-column-body">
                {col.cards.length === 0 && addingOffset !== col.offset && (
                  <div className="fl-empty">No forecasts yet</div>
                )}

                {col.cards.map((card) => {
                  const colors = PILLAR_COLORS[card.pillar.code] ?? PILLAR_COLORS.S;
                  const isEditing = editingId === card.id;

                  if (isEditing) {
                    return (
                      <form
                        key={card.id}
                        className="fl-card fl-card-form"
                        style={{ borderLeftColor: colors.base }}
                        onSubmit={(e) => handleEditSubmit(e, card)}
                      >
                        <label className="field-label">KPI</label>
                        <select
                          className="input"
                          value={editForm.kpiId}
                          onChange={(e) => setEditForm((f) => ({ ...f, kpiId: e.target.value }))}
                        >
                          {kpis.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.pillar.name} — {k.name}
                            </option>
                          ))}
                        </select>
                        <label className="field-label">Forecast note</label>
                        <textarea
                          className="input fl-textarea"
                          value={editForm.note}
                          onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                          rows={3}
                        />
                        <label className="field-label">Owner (optional)</label>
                        <input
                          className="input"
                          value={editForm.ownerName}
                          onChange={(e) => setEditForm((f) => ({ ...f, ownerName: e.target.value }))}
                        />
                        {editError && <div className="alert alert-error">{editError}</div>}
                        <div className="fl-card-actions">
                          <button type="button" className="btn btn-ghost-light" onClick={closeEdit}>
                            Cancel
                          </button>
                          <button type="submit" className="btn btn-primary" disabled={editSaving}>
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div key={card.id} className="fl-card" style={{ borderLeftColor: colors.base }}>
                      <div className="fl-card-top">
                        <span className="pillar-tag" style={{ background: colors.soft, color: colors.text }}>
                          {card.pillar.name}
                        </span>
                        <div className="fl-card-menu">
                          <button
                            className="fl-icon-btn"
                            title="Move to earlier day"
                            disabled={col.offset === 1}
                            onClick={() => shiftCard(card, -1)}
                          >
                            ←
                          </button>
                          <button
                            className="fl-icon-btn"
                            title="Move to later day"
                            disabled={col.offset === 3}
                            onClick={() => shiftCard(card, 1)}
                          >
                            →
                          </button>
                        </div>
                      </div>
                      <div className="fl-card-kpi">{card.kpi.name}</div>
                      <p className="fl-card-note">{card.note}</p>
                      {card.owner_name && <div className="fl-card-owner">Owner: {card.owner_name}</div>}
                      <div className="fl-card-actions">
                        <button className="btn btn-ghost-light" onClick={() => openEdit(card)}>
                          Edit
                        </button>
                        <button className="btn btn-ghost-light fl-btn-danger" onClick={() => handleDelete(card)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}

                {addingOffset === col.offset && (
                  <form className="fl-card fl-card-form fl-card-new" onSubmit={(e) => handleAddSubmit(e, col.offset)}>
                    <label className="field-label">KPI</label>
                    <select
                      className="input"
                      value={addForm.kpiId}
                      onChange={(e) => setAddForm((f) => ({ ...f, kpiId: e.target.value }))}
                    >
                      {kpis.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.pillar.name} — {k.name}
                        </option>
                      ))}
                    </select>
                    <label className="field-label">Forecast note</label>
                    <textarea
                      className="input fl-textarea"
                      placeholder="What's expected, or what to watch for…"
                      value={addForm.note}
                      onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
                      rows={3}
                      autoFocus
                    />
                    <label className="field-label">Owner (optional)</label>
                    <input
                      className="input"
                      placeholder="Who owns this"
                      value={addForm.ownerName}
                      onChange={(e) => setAddForm((f) => ({ ...f, ownerName: e.target.value }))}
                    />
                    {addError && <div className="alert alert-error">{addError}</div>}
                    <div className="fl-card-actions">
                      <button type="button" className="btn btn-ghost-light" onClick={closeAdd}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={addSaving}>
                        {addSaving ? 'Adding…' : 'Add card'}
                      </button>
                    </div>
                  </form>
                )}

                {addingOffset !== col.offset && (
                  <button className="fl-add-btn" onClick={() => openAdd(col.offset)}>
                    + Add card
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
