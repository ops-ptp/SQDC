import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DatePicker } from '@progress/kendo-react-dateinputs';
import { DropDownList } from '@progress/kendo-react-dropdowns';
import { useEmployee } from '../context/EmployeeContext';
import { createAction, fetchActions, fetchKpis, fetchPillars, setActionStatus, updateAction } from '../lib/data';
import { PILLAR_COLORS, errorMessage, type ActionItem, type ActionStatus, type Kpi, type Pillar } from '../types';
import ActionTable from '../components/ActionTable';
import Modal from '../components/Modal';

const NO_KPI = { id: '', name: '— None —' };

/** Pillar and KPI pickers shared by the "New action" form and the Edit
 * pop-up — both need the exact same pillar select + KPI-filtered-by-pillar
 * select, so they're defined once here rather than duplicated. Kendo's
 * DropDownList wants the actual data-item object as its value (matched via
 * dataItemKey), not the raw id string the rest of the app stores state as,
 * hence the find-by-id plumbing at each call site. */
function PillarSelect({ pillars, value, onChange }: { pillars: Pillar[]; value: string; onChange: (id: string) => void }) {
  return (
    <DropDownList
      style={{ width: '100%' }}
      data={pillars}
      textField="name"
      dataItemKey="id"
      value={pillars.find((p) => p.id === value) ?? null}
      onChange={(e) => onChange(e.value.id)}
    />
  );
}

function KpiSelect({ kpis, value, onChange }: { kpis: Kpi[]; value: string; onChange: (id: string) => void }) {
  const data = useMemo(() => [NO_KPI, ...kpis], [kpis]);
  return (
    <DropDownList
      style={{ width: '100%' }}
      data={data}
      textField="name"
      dataItemKey="id"
      value={data.find((k) => k.id === value) ?? NO_KPI}
      onChange={(e) => onChange(e.value.id)}
    />
  );
}

function DeadlinePicker({ value, onChange }: { value: string; onChange: (yyyyMmDd: string) => void }) {
  return (
    <DatePicker
      style={{ width: '100%' }}
      format="dd MMM yyyy"
      value={value ? parseISO(value) : null}
      onChange={(e) => onChange(e.value ? format(e.value, 'yyyy-MM-dd') : '')}
    />
  );
}

// ---------------------------------------------------------------------------
// Edit Action — a pop-up form (mirrors the "New action" fields) so an admin
// can fix any field of an existing action, not just its status. Opened from
// ActionTable's per-row "Edit" button, shown to admins only.
// ---------------------------------------------------------------------------
function ActionEditModal({
  action,
  pillars,
  kpis,
  onCancel,
  onSaved,
}: {
  action: ActionItem;
  pillars: Pillar[];
  kpis: Kpi[];
  onCancel: () => void;
  onSaved: (updated: ActionItem) => void;
}) {
  const [pillarId, setPillarId] = useState(action.pillar_id);
  const [kpiId, setKpiId] = useState(action.kpi_id ?? '');
  const [relatedIssue, setRelatedIssue] = useState(action.related_issue);
  const [actionText, setActionText] = useState(action.action);
  const [ownerName, setOwnerName] = useState(action.owner_name);
  const [deadline, setDeadline] = useState(action.deadline ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kpisForPillar = useMemo(() => kpis.filter((k) => k.pillar_id === pillarId && !k.is_secondary), [kpis, pillarId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pillarId || !relatedIssue.trim() || !actionText.trim() || !ownerName.trim()) {
      setError('Please fill in the pillar, issue, action, and owner.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAction({
        id: action.id,
        pillar_id: pillarId,
        kpi_id: kpiId || null,
        related_issue: relatedIssue.trim(),
        action: actionText.trim(),
        owner_name: ownerName.trim(),
        deadline: deadline || null,
      });
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save changes'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit Action" onClose={onCancel} maxWidth={560}>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>
            Pillar
            <PillarSelect
              pillars={pillars}
              value={pillarId}
              onChange={(id) => {
                setPillarId(id);
                setKpiId('');
              }}
            />
          </label>
          <label>
            KPI (optional)
            <KpiSelect kpis={kpisForPillar} value={kpiId} onChange={setKpiId} />
          </label>
          <label className="span-2">
            Related reason / issue
            <input className="input" value={relatedIssue} onChange={(e) => setRelatedIssue(e.target.value)} />
          </label>
          <label className="span-2">
            Action
            <input className="input" value={actionText} onChange={(e) => setActionText(e.target.value)} />
          </label>
          <label>
            Owner
            <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </label>
          <label>
            Deadline
            <DeadlinePicker value={deadline} onChange={setDeadline} />
          </label>
        </div>
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost-light" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ActionLog() {
  const { employee } = useEmployee();
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPillar, setFilterPillar] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null);

  const [form, setForm] = useState({
    pillar_id: '',
    kpi_id: '',
    related_issue: '',
    action: '',
    owner_name: '',
    deadline: '',
  });

  async function loadAll() {
    setLoading(true);
    try {
      const [p, k, a] = await Promise.all([fetchPillars(), fetchKpis(), fetchActions()]);
      setPillars(p);
      setKpis(k);
      setActions(a);
      if (p.length > 0) setForm((f) => ({ ...f, pillar_id: f.pillar_id || p[0].id }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    if (employee) setForm((f) => ({ ...f, owner_name: f.owner_name || employee.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpisForFormPillar = useMemo(() => kpis.filter((k) => k.pillar_id === form.pillar_id && !k.is_secondary), [kpis, form.pillar_id]);

  const filteredActions = useMemo(
    () => (filterPillar === 'all' ? actions : actions.filter((a) => a.pillar_id === filterPillar)),
    [actions, filterPillar],
  );

  function handleActionUpdated(updated: ActionItem) {
    setActions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setEditingAction(null);
  }

  async function handleStatusChange(a: ActionItem, status: ActionStatus) {
    const prevStatus = a.status;
    setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, status } : x)));
    try {
      await setActionStatus(a.id, status);
    } catch {
      setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: prevStatus } : x)));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.pillar_id || !form.related_issue.trim() || !form.action.trim() || !form.owner_name.trim()) {
      setFormError('Please fill in the pillar, issue, action, and owner.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createAction({
        pillar_id: form.pillar_id,
        kpi_id: form.kpi_id || null,
        related_issue: form.related_issue.trim(),
        action: form.action.trim(),
        owner_name: form.owner_name.trim(),
        deadline: form.deadline || null,
        created_by: employee?.id ?? null,
      });
      setActions((prev) => [created, ...prev]);
      setForm((f) => ({ ...f, kpi_id: '', related_issue: '', action: '', deadline: '' }));
      setShowForm(false);
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to add action'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page-loading">Loading action log…</div>;

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>Action Log</h1>
          <p className="muted">Actions raised against Pareto reasons across all four pillars.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ New action'}
        </button>
      </div>

      {showForm && (
        <form className="card action-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Pillar
              <PillarSelect
                pillars={pillars}
                value={form.pillar_id}
                onChange={(id) => setForm((f) => ({ ...f, pillar_id: id, kpi_id: '' }))}
              />
            </label>
            <label>
              KPI (optional)
              <KpiSelect kpis={kpisForFormPillar} value={form.kpi_id} onChange={(id) => setForm((f) => ({ ...f, kpi_id: id }))} />
            </label>
            <label className="span-2">
              Related reason / issue
              <input
                className="input"
                value={form.related_issue}
                onChange={(e) => setForm((f) => ({ ...f, related_issue: e.target.value }))}
                placeholder="e.g. Congestion at exit of the gate"
              />
            </label>
            <label className="span-2">
              Action
              <input
                className="input"
                value={form.action}
                onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                placeholder="What will be done about it?"
              />
            </label>
            <label>
              Owner
              <input className="input" value={form.owner_name} onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))} />
            </label>
            <label>
              Deadline
              <DeadlinePicker value={form.deadline} onChange={(d) => setForm((f) => ({ ...f, deadline: d }))} />
            </label>
          </div>
          {formError && <div className="alert alert-error">{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add action'}
          </button>
        </form>
      )}

      <div className="filter-row">
        <button className={`chip ${filterPillar === 'all' ? 'chip-active' : ''}`} onClick={() => setFilterPillar('all')}>
          All pillars
        </button>
        {pillars.map((p) => (
          <button
            key={p.id}
            className={`chip ${filterPillar === p.id ? 'chip-active' : ''}`}
            style={filterPillar === p.id ? { background: PILLAR_COLORS[p.code].base, color: 'white' } : undefined}
            onClick={() => setFilterPillar(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <section className="card action-section">
        <ActionTable
          actions={filteredActions}
          pillars={pillars}
          onStatusChange={employee?.is_admin ? handleStatusChange : undefined}
          onEdit={employee?.is_admin ? (a) => setEditingAction(a) : undefined}
        />
      </section>

      {editingAction && (
        <ActionEditModal
          action={editingAction}
          pillars={pillars}
          kpis={kpis}
          onCancel={() => setEditingAction(null)}
          onSaved={handleActionUpdated}
        />
      )}
    </div>
  );
}
