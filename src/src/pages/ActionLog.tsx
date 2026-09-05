import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import { createAction, fetchActions, fetchKpis, fetchPillars, setActionStatus } from '../lib/data';
import { PILLAR_COLORS, errorMessage, type ActionItem, type ActionStatus, type Kpi, type Pillar } from '../types';
import ActionTable from '../components/ActionTable';

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

  const grouped = useMemo(() => {
    const filtered = filterPillar === 'all' ? actions : actions.filter((a) => a.pillar_id === filterPillar);
    const byPillar = new Map<string, ActionItem[]>();
    for (const a of filtered) {
      const list = byPillar.get(a.pillar_id) ?? [];
      list.push(a);
      byPillar.set(a.pillar_id, list);
    }
    return byPillar;
  }, [actions, filterPillar]);

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
              <select
                className="input"
                value={form.pillar_id}
                onChange={(e) => setForm((f) => ({ ...f, pillar_id: e.target.value, kpi_id: '' }))}
              >
                {pillars.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              KPI (optional)
              <select className="input" value={form.kpi_id} onChange={(e) => setForm((f) => ({ ...f, kpi_id: e.target.value }))}>
                <option value="">— None —</option>
                {kpisForFormPillar.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
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
              <input
                type="date"
                className="input"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              />
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

      {pillars
        .filter((p) => filterPillar === 'all' || filterPillar === p.id)
        .map((p) => (
          <section key={p.id} className="card action-section" style={{ borderTopColor: PILLAR_COLORS[p.code].base }}>
            <h2 style={{ color: PILLAR_COLORS[p.code].text }}>{p.name}</h2>
            <ActionTable
              actions={grouped.get(p.id) ?? []}
              onStatusChange={employee?.is_admin ? handleStatusChange : undefined}
            />
          </section>
        ))}
    </div>
  );
}
