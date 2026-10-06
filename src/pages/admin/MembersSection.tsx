import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { pencilIcon, plusIcon, trashIcon } from '@progress/kendo-svg-icons';
import { useDepartment } from '../../context/DepartmentContext';
import { useEmployee } from '../../context/EmployeeContext';
import {
  createEmployee,
  fetchAllEmployeesAdmin,
  fetchMemberships,
  removeDepartmentMember,
  updateEmployeeIdentity,
  upsertDepartmentMember,
} from '../../lib/data';
import { errorMessage, normalizeEmployeeCode, type DepartmentMember, type DepartmentRole, type Employee } from '../../types';
import Modal from '../../components/Modal';
import { Button, InfoTip, InlineLoader, Select, TextField } from '../../components/ui';

// ===========================================================================
// Members — who's on this department's team. Admins manage the department
// (KPIs, uploads, members, settings, Insights, action status); members
// enter data and remarks. Employee IDs are one company-wide roster, so
// adding someone who already exists (e.g. from another department) just
// adds them here; a brand-new ID creates them.
// ===========================================================================

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Department admin' },
];

/** Add a member by Employee ID: finds them on the company roster, or creates
 * them if the ID is new. */
function AddMemberModal({
  employees,
  memberIds,
  onCancel,
  onAdded,
}: {
  employees: Employee[];
  memberIds: Set<string>;
  onCancel: () => void;
  onAdded: (message: string) => void;
}) {
  const department = useDepartment();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<DepartmentRole>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeEmployeeCode(code);
  const validCode = /^\d{6}$/.test(normalized);
  const existing = validCode ? employees.find((e) => e.employee_code === normalized) : undefined;
  const alreadyMember = existing ? memberIds.has(existing.id) : false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validCode) return setError('Employee ID must be 6 digits (e.g. 000042).');
    if (alreadyMember) return setError(`${existing!.name} is already in ${department.name}.`);
    if (existing && !existing.active) return setError(`${existing.name} (${normalized}) has been deactivated. A site admin can reactivate them in Site Admin → Employees.`);
    if (!existing && !name.trim()) return setError('This Employee ID is new — enter the person’s name to add them.');
    setSaving(true);
    setError(null);
    try {
      const emp = existing ?? (await createEmployee({ employee_code: normalized, name: name.trim() }));
      await upsertDepartmentMember(department.id, emp.id, role);
      onAdded(`Added ${emp.name} (${emp.employee_code}) as ${role === 'admin' ? 'a department admin' : 'a member'}.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to add'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add to ${department.name}`} onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="field-label">Employee ID</label>
        <TextField autoFocus placeholder="000001" inputMode="numeric" value={code} onChange={setCode} ariaLabel="Employee ID" />
        {validCode && existing && (
          <div className={`alert ${alreadyMember ? 'alert-warning' : 'alert-info'}`} style={{ marginTop: 10 }}>
            {existing.name}
            {alreadyMember ? ` is already in ${department.name}.` : ' — on the company roster already.'}
          </div>
        )}
        {validCode && !existing && (
          <>
            <label className="field-label" style={{ marginTop: 12, display: 'block' }}>
              Name <span className="muted">(new Employee ID)</span>
            </label>
            <TextField value={name} onChange={setName} ariaLabel="Name" />
          </>
        )}
        <label className="field-label" style={{ marginTop: 12, display: 'block' }}>
          Role
        </label>
        <Select value={role} onChange={(v) => setRole(v as DepartmentRole)} options={ROLE_OPTIONS} ariaLabel="Role" />
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
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EditIdentityModal({ employee, onCancel, onSaved }: { employee: Employee; onCancel: () => void; onSaved: (message: string) => void }) {
  const [code, setCode] = useState(employee.employee_code);
  const [name, setName] = useState(employee.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeEmployeeCode(code);
    if (!/^\d{6}$/.test(normalized)) return setError('Employee ID must be 6 digits (e.g. 000042) — letters and other characters aren’t allowed.');
    if (!name.trim()) return setError('Name is required.');
    setSaving(true);
    setError(null);
    try {
      await updateEmployeeIdentity({ id: employee.id, employee_code: normalized, name: name.trim() });
      onSaved(`Updated ${name.trim()}.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save changes'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit employee" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="field-label">Employee ID</label>
        <TextField autoFocus inputMode="numeric" value={code} onChange={setCode} ariaLabel="Employee ID" />
        <label className="field-label" style={{ marginTop: 12, display: 'block' }}>
          Name
        </label>
        <TextField value={name} onChange={setName} ariaLabel="Name" />
        <p className="muted" style={{ marginTop: 10 }}>
          The Employee ID is what this person types to log in.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
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

export default function MembersSection() {
  const department = useDepartment();
  const { employee: me, isSiteAdmin, refresh } = useEmployee();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allMemberships, setAllMemberships] = useState<DepartmentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  function load() {
    setLoading(true);
    Promise.all([fetchAllEmployeesAdmin(), fetchMemberships()])
      .then(([e, m]) => {
        setEmployees(e);
        setAllMemberships(m);
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load members')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department.id]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const members = allMemberships
    .filter((m) => m.department_id === department.id)
    .map((m) => ({ m, e: employeeById.get(m.employee_id) }))
    .filter((x): x is { m: DepartmentMember; e: Employee } => Boolean(x.e))
    .sort((a, b) => (a.m.role === b.m.role ? a.e.name.localeCompare(b.e.name) : a.m.role === 'admin' ? -1 : 1));
  const adminCount = members.filter((x) => x.m.role === 'admin').length;
  const deptCountByEmployee = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of allMemberships) c.set(m.employee_id, (c.get(m.employee_id) ?? 0) + 1);
    return c;
  }, [allMemberships]);

  async function changeRole(m: DepartmentMember, role: DepartmentRole) {
    if (m.role === 'admin' && role !== 'admin' && adminCount <= 1) {
      setError(`${department.name} needs at least one department admin — make someone else admin first.`);
      return;
    }
    setBusyId(m.id);
    setError(null);
    setMessage(null);
    try {
      await upsertDepartmentMember(department.id, m.employee_id, role);
      setAllMemberships((prev) => prev.map((x) => (x.id === m.id ? { ...x, role } : x)));
      if (m.employee_id === me?.id) await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Failed to change role'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: DepartmentMember, e: Employee) {
    if (m.role === 'admin' && adminCount <= 1) {
      setError(`${department.name} needs at least one department admin — make someone else admin before removing ${e.name}.`);
      return;
    }
    setBusyId(m.id);
    setError(null);
    setMessage(null);
    try {
      await removeDepartmentMember(m.id);
      setAllMemberships((prev) => prev.filter((x) => x.id !== m.id));
      setMessage(`Removed ${e.name} from ${department.name}. Their past remarks and entries are kept.`);
      if (m.employee_id === me?.id) await refresh();
    } catch (err) {
      setError(errorMessage(err, 'Failed to remove'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="page-header-row" style={{ marginBottom: 14 }}>
        <div>
          <h3>
            Members{' '}
            <InfoTip>
              Department admins manage {department.name}'s KPIs, uploads, members and settings. Members log in with their Employee ID
              to enter data and remarks. Anyone can view the board without logging in.
            </InfoTip>
          </h3>
        </div>
        <Button type="button" svgIcon={plusIcon} themeColor="primary" onClick={() => setAdding(true)} disabled={loading}>
          Add member
        </Button>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <InlineLoader label="Loading members…" />
      ) : members.length === 0 ? (
        <div className="empty-state">No members yet — add the people who'll enter {department.name}'s data.</div>
      ) : (
        <div className="table-scroll admin-kpi-table-scroll">
          <table className="action-table admin-kpi-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map(({ m, e }) => {
                // Name/ID are company-wide (the login credential), so a
                // department admin can only edit someone who's in no other
                // department; site admins can edit anyone.
                const canEditIdentity = isSiteAdmin || (deptCountByEmployee.get(e.id) ?? 0) <= 1;
                return (
                  <tr key={m.id} className={e.active ? '' : 'row-dropped'}>
                    <td>{e.employee_code}</td>
                    <td>
                      {e.name}
                      {!e.active && <span className="pill admin-kpi-tag">deactivated</span>}
                      {e.id === me?.id && <span className="pill admin-kpi-tag">you</span>}
                    </td>
                    <td>
                      <Select
                        size="small"
                        value={m.role}
                        disabled={busyId === m.id}
                        onChange={(v) => changeRole(m, v as DepartmentRole)}
                        options={ROLE_OPTIONS}
                        ariaLabel={`Role for ${e.name}`}
                      />
                    </td>
                    <td className="admin-row-actions">
                      {canEditIdentity && (
                        <Button type="button" size="small" fillMode="flat" svgIcon={pencilIcon} onClick={() => setEditing(e)}>
                          Edit
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="small"
                        fillMode="flat"
                        themeColor="error"
                        svgIcon={trashIcon}
                        disabled={busyId === m.id}
                        onClick={() => remove(m, e)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddMemberModal
          employees={employees}
          memberIds={new Set(members.map((x) => x.e.id))}
          onCancel={() => setAdding(false)}
          onAdded={(msg) => {
            setAdding(false);
            setMessage(msg);
            load();
          }}
        />
      )}
      {editing && (
        <EditIdentityModal
          employee={editing}
          onCancel={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setMessage(msg);
            load();
            if (editing.id === me?.id) refresh();
          }}
        />
      )}
    </div>
  );
}
