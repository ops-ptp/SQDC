import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pencilIcon, plusIcon } from '@progress/kendo-svg-icons';
import { departmentPath, useDepartments } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import {
  createDepartment,
  createEmployee,
  fetchAllEmployeesAdmin,
  fetchKpiCountsByDepartment,
  fetchMemberships,
  saveEmployeeSiteUpdates,
  updateDepartment,
  upsertDepartmentMember,
  type EmployeeSiteUpdate,
} from '../lib/data';
import { slugify } from '../lib/slug';
import { ENTRY_MODE_LABELS, errorMessage, normalizeEmployeeCode, type Department, type DepartmentMember, type Employee, type EntryMode } from '../types';
import Modal from '../components/Modal';
import { Button, CheckField, InfoTip, InlineLoader, Select, TextField } from '../components/ui';
import { EditIdentityModal } from './admin/MembersSection';
import { ENTRY_MODE_OPTIONS } from './admin/SettingsSection';

// ===========================================================================
// Site Admin — create and archive departments, appoint each one's first
// department admin, and look after the company-wide employee roster and
// the site admins themselves. Everything inside a department (its KPIs,
// uploads, team, settings) is that department's admins' job, from their
// own Admin page.
// ===========================================================================

function NewDepartmentModal({ employees, existingSlugs, onCancel, onCreated }: { employees: Employee[]; existingSlugs: Set<string>; onCancel: () => void; onCreated: (d: Department) => void }) {
  const { departments } = useDepartments();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>('manual');
  const [adminCode, setAdminCode] = useState('');
  const [adminName, setAdminName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const normalized = normalizeEmployeeCode(adminCode);
  const validCode = /^\d{6}$/.test(normalized);
  const existingAdmin = validCode ? employees.find((e) => e.employee_code === normalized) : undefined;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the department a name.');
    if (!effectiveSlug) return setError('The web address needs at least one letter or number.');
    if (existingSlugs.has(effectiveSlug)) return setError(`"/d/${effectiveSlug}" is already used by another department — pick a different web address.`);
    if (!validCode) return setError('Enter the Employee ID (6 digits) of the person who will run this department’s board.');
    if (existingAdmin && !existingAdmin.active) return setError(`${existingAdmin.name} is deactivated — reactivate them in Employees below first.`);
    if (!existingAdmin && !adminName.trim()) return setError('That Employee ID is new — enter their name too.');
    setSaving(true);
    setError(null);
    try {
      const dept = await createDepartment({
        name: name.trim(),
        slug: effectiveSlug,
        entry_mode: entryMode,
        upload_format: 'template',
        sort_order: Math.max(0, ...departments.map((d) => d.sort_order)) + 1,
      });
      const admin = existingAdmin ?? (await createEmployee({ employee_code: normalized, name: adminName.trim() }));
      await upsertDepartmentMember(dept.id, admin.id, 'admin');
      onCreated(dept);
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the department'));
      setSaving(false);
    }
  }

  return (
    <Modal title="New department" onClose={onCancel} maxWidth={560}>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="span-2">
            Department name
            <TextField autoFocus value={name} onChange={setName} placeholder="e.g. Engineering" />
          </label>
          <label className="span-2">
            Board web address
            <TextField
              value={slugTouched ? slug : effectiveSlug}
              onChange={(v) => {
                setSlugTouched(true);
                setSlug(v.toLowerCase());
              }}
            />
            <span className="muted field-hint">
              {window.location.origin}/d/{effectiveSlug || '…'}
            </span>
          </label>
          <label className="span-2">
            <span className="field-title">
              How data gets in{' '}
            <InfoTip>The department admin can change this later in their Settings tab.</InfoTip>
            </span>
            <Select value={entryMode} onChange={(v) => setEntryMode(v as EntryMode)} options={ENTRY_MODE_OPTIONS} />
          </label>
          <label>
            Department admin's Employee ID
            <TextField value={adminCode} onChange={setAdminCode} inputMode="numeric" placeholder="000001" />
            {existingAdmin && <span className="muted field-hint">{existingAdmin.name}</span>}
          </label>
          {validCode && !existingAdmin && (
            <label>
              <span className="field-title">
              Their name <span className="muted">(new ID)</span>
            </span>
              <TextField value={adminName} onChange={setAdminName} />
            </label>
          )}
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          The department admin then sets up the KPIs and adds the rest of the team from their own Admin page — no code or database
          needed.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-actions">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" themeColor="primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create department'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DepartmentsCard({ employees, memberships, onChanged }: { employees: Employee[]; memberships: DepartmentMember[]; onChanged: () => void }) {
  const { departments, reload } = useDepartments();
  const navigate = useNavigate();
  const [kpiCounts, setKpiCounts] = useState<Map<string, number>>(new Map());
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKpiCountsByDepartment().then(setKpiCounts).catch(() => setKpiCounts(new Map()));
  }, [departments]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  async function setActive(d: Department, active: boolean) {
    setBusyId(d.id);
    setError(null);
    setMessage(null);
    try {
      await updateDepartment(d.id, { active });
      await reload();
      setMessage(active ? `${d.name} is back on the boards list.` : `${d.name} archived — its board is hidden and all its data is kept. Restore it any time.`);
    } catch (e) {
      setError(errorMessage(e, 'Failed to update'));
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...departments].sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <div className="card">
      <div className="page-header-row" style={{ marginBottom: 14 }}>
        <h3>
          Departments{' '}
          <InfoTip>Each department gets its own SQDC board at /d/&lt;web address&gt;. Archiving hides a board without deleting anything.</InfoTip>
        </h3>
        <Button themeColor="primary" svgIcon={plusIcon} onClick={() => setCreating(true)}>
          New department
        </Button>
      </div>
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="table-scroll admin-kpi-table-scroll">
        <table className="action-table admin-kpi-table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Board link</th>
              <th>Data</th>
              <th>KPIs</th>
              <th>Team</th>
              <th>Department admins</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const members = memberships.filter((m) => m.department_id === d.id);
              const admins = members
                .filter((m) => m.role === 'admin')
                .map((m) => employeeById.get(m.employee_id)?.name)
                .filter(Boolean);
              return (
                <tr key={d.id} className={d.active ? '' : 'row-dropped'}>
                  <td>
                    <strong>{d.name}</strong>
                    {!d.active && <span className="pill admin-kpi-tag">archived</span>}
                  </td>
                  <td>{d.active ? <Link to={departmentPath(d)}>/d/{d.slug}</Link> : `/d/${d.slug}`}</td>
                  <td>{ENTRY_MODE_LABELS[d.entry_mode]}</td>
                  <td>{kpiCounts.get(d.id) ?? 0}</td>
                  <td>{members.length}</td>
                  <td>{admins.length > 0 ? admins.join(', ') : <span className="value-bad">None — add one</span>}</td>
                  <td className="admin-row-actions">
                    {d.active && (
                      <Button size="small" fillMode="flat" svgIcon={pencilIcon} onClick={() => navigate(departmentPath(d, 'admin'))}>
                        Manage
                      </Button>
                    )}
                    <Button size="small" fillMode="flat" disabled={busyId === d.id} onClick={() => setActive(d, !d.active)}>
                      {d.active ? 'Archive' : 'Restore'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {creating && (
        <NewDepartmentModal
          employees={employees}
          existingSlugs={new Set(departments.map((d) => d.slug))}
          onCancel={() => setCreating(false)}
          onCreated={async (d) => {
            setCreating(false);
            await reload();
            onChanged();
            setMessage(`Created ${d.name}. Its admin can now set up KPIs and add the team — or open it yourself with Manage.`);
          }}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({ onCancel, onSaved }: { onCancel: () => void; onSaved: (msg: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeEmployeeCode(code);
    if (!/^\d{6}$/.test(normalized)) return setError('Employee ID must be 6 digits (e.g. 000042).');
    if (!name.trim()) return setError('Name is required.');
    setSaving(true);
    setError(null);
    try {
      await createEmployee({ employee_code: normalized, name: name.trim() });
      onSaved(`Added ${name.trim()} (${normalized}). Add them to a department from that department's Admin → Members.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to add employee'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Add employee" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="field-label">Employee ID</label>
        <TextField autoFocus placeholder="000001" inputMode="numeric" value={code} onChange={setCode} ariaLabel="Employee ID" />
        <label className="field-label" style={{ marginTop: 12, display: 'block' }}>
          Name
        </label>
        <TextField value={name} onChange={setName} ariaLabel="Name" />
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
            {saving ? 'Saving…' : 'Add employee'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EmployeesCard({
  employees,
  memberships,
  onChanged,
  notice,
}: {
  employees: Employee[];
  memberships: DepartmentMember[];
  /** Reloads the roster (which remounts this card) — pass the confirmation
   * to show, so it survives the remount. */
  onChanged: (message: string) => void;
  notice: string | null;
}) {
  const { departments } = useDepartments();
  const { employee: me, refresh } = useEmployee();
  const [rows, setRows] = useState<Employee[]>(employees);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(notice);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const original = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const dirty = rows.filter((r) => {
    const o = original.get(r.id);
    return o && (o.active !== r.active || o.is_site_admin !== r.is_site_admin);
  });

  function patch(id: string, p: Partial<Employee>) {
    setMessage(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function save() {
    if (!rows.some((r) => r.is_site_admin && r.active)) {
      setError('Keep at least one active site admin — otherwise nobody can create departments.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updates: EmployeeSiteUpdate[] = dirty.map((r) => ({ id: r.id, active: r.active, is_site_admin: r.is_site_admin }));
      await saveEmployeeSiteUpdates(updates);
      onChanged(`Saved ${updates.length} change${updates.length === 1 ? '' : 's'}.`);
      if (updates.some((u) => u.id === me?.id)) await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.employee_code.includes(q))
    .sort((a, b) => Number(b.is_site_admin) - Number(a.is_site_admin) || a.name.localeCompare(b.name));

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="page-header-row" style={{ marginBottom: 14 }}>
        <h3>
          Employees{' '}
          <InfoTip>
            The company-wide roster of Employee IDs people log in with. Department admins add people to their own team from Admin → Members;
            here you can also make someone a site admin, or deactivate a leaver (blocks their login, keeps their history).
          </InfoTip>
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TextField className="site-admin-search" value={filter} onChange={setFilter} placeholder="Search name or ID" ariaLabel="Search employees" />
          <Button svgIcon={plusIcon} onClick={() => setAdding(true)}>
            Add employee
          </Button>
          <Button themeColor="primary" disabled={saving || dirty.length === 0} onClick={save}>
            {saving ? 'Saving…' : dirty.length > 0 ? `Save changes (${dirty.length})` : 'Save changes'}
          </Button>
        </div>
      </div>
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="table-scroll admin-kpi-table-scroll">
        <table className="action-table admin-kpi-table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Departments</th>
              <th>
                Site admin <InfoTip>Can create/archive departments and act as admin in every department.</InfoTip>
              </th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const mine = memberships.filter((m) => m.employee_id === r.id);
              return (
                <tr key={r.id} className={r.active ? '' : 'row-dropped'}>
                  <td>{r.employee_code}</td>
                  <td>{r.name}</td>
                  <td className="site-admin-depts">
                    {mine.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      mine.map((m) => {
                        const d = deptById.get(m.department_id);
                        return d ? (
                          <span key={m.id} className={`pill admin-kpi-tag ${m.role === 'admin' ? 'tag-admin' : ''}`}>
                            {d.name}
                            {m.role === 'admin' ? ' · admin' : ''}
                          </span>
                        ) : null;
                      })
                    )}
                  </td>
                  <td>
                    <CheckField checked={r.is_site_admin} onChange={(v) => patch(r.id, { is_site_admin: v })} />
                  </td>
                  <td>
                    <CheckField checked={r.active} onChange={(v) => patch(r.id, { active: v })} />
                  </td>
                  <td>
                    <Button size="small" fillMode="flat" svgIcon={pencilIcon} onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && (
        <AddEmployeeModal
          onCancel={() => setAdding(false)}
          onSaved={(msg) => {
            setAdding(false);
            onChanged(msg);
          }}
        />
      )}
      {editing && (
        <EditIdentityModal
          employee={editing}
          onCancel={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            onChanged(msg);
          }}
        />
      )}
    </div>
  );
}

export default function SiteAdmin() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [memberships, setMemberships] = useState<DepartmentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Remounts the Employees card (resetting its unsaved toggles) whenever the
  // roster is reloaded.
  const [version, setVersion] = useState(0);
  const [employeesNotice, setEmployeesNotice] = useState<string | null>(null);

  function load() {
    Promise.all([fetchAllEmployeesAdmin(), fetchMemberships()])
      .then(([e, m]) => {
        setEmployees(e);
        setMemberships(m);
        setVersion((v) => v + 1);
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load')))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          Site Admin{' '}
          <InfoTip>
            Create a department and name its admin — they take it from there (KPIs, team, uploads) from their own Admin page. You can also
            open any department's Admin page yourself with Manage.
          </InfoTip>
        </h1>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <InlineLoader label="Loading…" />
      ) : (
        <>
          <DepartmentsCard employees={employees} memberships={memberships} onChanged={load} />
          <EmployeesCard
            key={version}
            employees={employees}
            memberships={memberships}
            notice={employeesNotice}
            onChanged={(msg) => {
              setEmployeesNotice(msg);
              load();
            }}
          />
        </>
      )}
    </div>
  );
}
