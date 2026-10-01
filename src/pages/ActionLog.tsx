import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import { createAction, fetchActions, fetchKpis, fetchPillars, setActionStatus, updateAction } from '../lib/data';
import { PILLAR_COLORS, errorMessage, type ActionItem, type ActionStatus, type Kpi, type Pillar } from '../types';
import ActionTable from '../components/ActionTable';
import Modal from '../components/Modal';
import { Chip } from '@progress/kendo-react-buttons';
import { plusIcon } from '@progress/kendo-svg-icons';
import { Button, DateField, PageLoader, Select, TextField, type SelectOption } from '../components/ui';

/** The six action fields, shared by the "New action" form and the Edit
 * dialog so the two can't drift apart. */
function ActionFields({
  value,
  onChange,
  pillars,
  kpis,
}: {
  value: { pillar_id: string; kpi_id: string; related_issue: string; action: string; owner_name: string; deadline: string };
  onChange: (patch: Partial<{ pillar_id: string; kpi_id: string; related_issue: string; action: string; owner_name: string; deadline: string }>) => void;
  pillars: Pillar[];
  kpis: Kpi[];
}) {
  const kpiOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: '— None —' },
      ...kpis.filter((k) => k.pillar_id === value.pillar_id && !k.is_secondary).map((k) => ({ value: k.id, label: k.name })),
    ],
    [kpis, value.pillar_id],
  );
  return (
    <div className="form-grid">
      <label>
        Pillar
        <Select
          value={value.pillar_id}
          onChange={(v) => onChange({ pillar_id: v, kpi_id: '' })}
          options={pillars.map((p) => ({ value: p.id, label: p.name }))}
        />
      </label>
      <label>
        KPI (optional)
        <Select value={value.kpi_id} onChange={(v) => onChange({ kpi_id: v })} options={kpiOptions} />
      </label>
      <label className="span-2">
        Related reason / issue
        <TextField
          value={value.related_issue}
          onChange={(v) => onChange({ related_issue: v })}
          placeholder="e.g. Congestion at exit of the gate"
        />
      </label>
      <label className="span-2">
        Action
        <TextField value={value.action} onChange={(v) => onChange({ action: v })} placeholder="What will be done about it?" />
      </label>
      <label>
        Owner
        <TextField value={value.owner_name} onChange={(v) => onChange({ owner_name: v })} />
      </label>
      <label>
        Deadline
        <DateField value={value.deadline} onChange={(v) => onChange({ deadline: v })} />
      </label>
    </div>
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
  const [form, setForm] = useState({
    pillar_id: action.pillar_id,
    kpi_id: action.kpi_id ?? '',
    related_issue: action.related_issue,
    action: action.action,
    owner_name: action.owner_name,
    deadline: action.deadline ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.pillar_id || !form.related_issue.trim() || !form.action.trim() || !form.owner_name.trim()) {
      setError('Please fill in the pillar, issue, action, and owner.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAction({
        id: action.id,
        pillar_id: form.pillar_id,
        kpi_id: form.kpi_id || null,
        related_issue: form.related_issue.trim(),
        action: form.action.trim(),
        owner_name: form.owner_name.trim(),
        deadline: form.deadline || null,
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
        <ActionFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} pillars={pillars} kpis={kpis} />
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" themeColor="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
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

  if (loading) return <PageLoader label="Loading action log…" />;

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>Action Log</h1>
          <p className="muted">Actions raised against Pareto reasons across all four pillars.</p>
        </div>
        <Button themeColor={showForm ? 'base' : 'primary'} svgIcon={showForm ? undefined : plusIcon} onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New action'}
        </Button>
      </div>

      {showForm && (
        <form className="card action-form" onSubmit={handleSubmit}>
          <ActionFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} pillars={pillars} kpis={kpis} />
          {formError && <div className="alert alert-error">{formError}</div>}
          <div>
            <Button themeColor="primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add action'}
            </Button>
          </div>
        </form>
      )}

      <div className="filter-row" role="group" aria-label="Filter by pillar">
        <Chip text="All pillars" selected={filterPillar === 'all'} rounded="full" onClick={() => setFilterPillar('all')} />
        {pillars.map((p) => {
          const selected = filterPillar === p.id;
          const base = (PILLAR_COLORS[p.code] ?? PILLAR_COLORS.S).base;
          return (
            <Chip
              key={p.id}
              text={p.name}
              rounded="full"
              selected={selected}
              style={selected ? { background: base, borderColor: base, color: 'white' } : undefined}
              onClick={() => setFilterPillar(p.id)}
            />
          );
        })}
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
