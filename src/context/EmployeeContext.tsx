import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchMemberships } from '../lib/data';
import { currentAuthUserId, signInSiteAdmin, signOutSiteAdmin } from '../lib/siteAdminAuth';
import { errorMessage, normalizeEmployeeCode, type DepartmentMember, type Employee } from '../types';

const STORAGE_KEY = 'sqdc.employee_code';

/** What happened when someone typed their Employee ID (and maybe a password). */
export type LoginResult =
  | { status: 'ok'; employee: Employee }
  /** A site admin: ask for their password, then call again with it. */
  | { status: 'needs_password'; employee: Employee }
  /** A site admin who has no password yet — another site admin must set one. */
  | { status: 'no_password_set'; employee: Employee };

interface EmployeeContextValue {
  employee: Employee | null;
  /** The logged-in person's department memberships (empty when logged out). */
  memberships: DepartmentMember[];
  loading: boolean;
  error: string | null;
  /** Employee ID only for most people; site admins also need `password`. */
  loginWithCode: (code: string, password?: string) => Promise<LoginResult>;
  logout: () => void;
  /** Re-reads the logged-in person's own record and memberships — call after
   * changing your own role or a site-admin flag so the navbar catches up. */
  refresh: () => Promise<void>;
  /** True only while a site admin is signed in with their password. */
  isSiteAdmin: boolean;
  /** Site admins count as admin/member of every department. */
  isDeptAdmin: (departmentId: string | undefined) => boolean;
  isDeptMember: (departmentId: string | undefined) => boolean;
}

const EmployeeContext = createContext<EmployeeContextValue | undefined>(undefined);

async function fetchEmployee(code: string): Promise<Employee> {
  // The lookup is case-insensitive (ilike), where %, _ and * are wildcards —
  // "00004_" would log in as whichever employee happens to match. Real IDs
  // never contain them, so refuse them outright.
  if (/[%_*\\]/.test(code)) throw new Error(`ID "${code}" cannot access this page. Please return to SQDC Board`);
  const { data, error: err } = await supabase
    .from('employees')
    .select('*')
    .ilike('employee_code', normalizeEmployeeCode(code))
    .eq('active', true)
    .maybeSingle();
  if (err) throw new Error(err.message);
  if (!data) throw new Error(`ID "${code}" cannot access this page. Please return to SQDC Board`);
  return data as Employee;
}

async function fetchEmployeeByAuthUser(authUserId: string): Promise<Employee | null> {
  const { data } = await supabase.from('employees').select('*').eq('auth_user_id', authUserId).eq('active', true).maybeSingle();
  return (data as Employee | null) ?? null;
}

/** A site admin's session belongs to them only. Whenever someone else logs in
 * on this browser (a shared huddle screen, say), it must go — otherwise their
 * requests would still carry the admin's rights. */
async function dropSessionUnlessFor(employee: Employee | null): Promise<string | null> {
  const authUserId = await currentAuthUserId();
  if (!authUserId) return null;
  if (employee?.is_site_admin && employee.auth_user_id === authUserId) return authUserId;
  await signOutSiteAdmin();
  return null;
}

function saveCode(code: string | null) {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — stays logged in for this tab only */
  }
}

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [memberships, setMemberships] = useState<DepartmentMember[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const employeeRef = useRef<Employee | null>(null);

  async function applyLogin(emp: Employee, sessionUserId: string | null) {
    const m = await fetchMemberships({ employeeId: emp.id });
    employeeRef.current = emp;
    setEmployee(emp);
    setMemberships(m);
    setAuthUserId(sessionUserId);
    saveCode(emp.employee_code);
  }

  function clearLogin() {
    employeeRef.current = null;
    setEmployee(null);
    setMemberships([]);
    setAuthUserId(null);
    saveCode(null);
  }

  /** Restores whoever was logged in on this browser. A site admin is only
   * restored together with their own password session. */
  async function restore(code: string | null) {
    let emp: Employee | null = null;
    if (code) {
      try {
        emp = await fetchEmployee(code);
      } catch {
        emp = null;
      }
    }
    if (!emp) {
      // No Employee ID saved (or it's gone) — a live admin session can still
      // say who this is.
      const sessionUser = await currentAuthUserId();
      if (sessionUser) emp = await fetchEmployeeByAuthUser(sessionUser);
    }
    const sessionUserId = await dropSessionUnlessFor(emp);
    if (!emp || (emp.is_site_admin && !sessionUserId)) {
      clearLogin();
      return;
    }
    await applyLogin(emp, sessionUserId);
  }

  useEffect(() => {
    let savedCode: string | null = null;
    try {
      savedCode = localStorage.getItem(STORAGE_KEY);
    } catch {
      savedCode = null;
    }
    restore(savedCode)
      .catch(() => clearLogin())
      .finally(() => setLoading(false));

    // Signed out elsewhere (another tab, or the session was revoked): a site
    // admin is logged out here too.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && employeeRef.current?.is_site_admin) clearLogin();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginWithCode(code: string, password?: string): Promise<LoginResult> {
    setError(null);
    try {
      const emp = await fetchEmployee(code);
      if (emp.is_site_admin) {
        if (!emp.auth_user_id) return { status: 'no_password_set', employee: emp };
        if (password === undefined) return { status: 'needs_password', employee: emp };
        await signInSiteAdmin(emp, password);
        await applyLogin(emp, emp.auth_user_id);
        return { status: 'ok', employee: emp };
      }
      await dropSessionUnlessFor(emp);
      await applyLogin(emp, null);
      return { status: 'ok', employee: emp };
    } catch (e) {
      const message = errorMessage(e, 'Login failed');
      setError(message);
      throw e;
    }
  }

  function logout() {
    clearLogin();
    void signOutSiteAdmin();
  }

  const refresh = useCallback(async () => {
    const current = employeeRef.current;
    if (!current) return;
    try {
      await restore(current.employee_code);
    } catch {
      logout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.employee_code]);

  const isSiteAdmin = Boolean(employee?.is_site_admin && authUserId && employee.auth_user_id === authUserId);
  const isDeptAdmin = (departmentId: string | undefined) =>
    Boolean(employee) && (isSiteAdmin || memberships.some((m) => m.department_id === departmentId && m.role === 'admin'));
  const isDeptMember = (departmentId: string | undefined) =>
    Boolean(employee) && (isSiteAdmin || memberships.some((m) => m.department_id === departmentId));

  return (
    <EmployeeContext.Provider value={{ employee, memberships, loading, error, loginWithCode, logout, refresh, isSiteAdmin, isDeptAdmin, isDeptMember }}>
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployee(): EmployeeContextValue {
  const ctx = useContext(EmployeeContext);
  if (!ctx) throw new Error('useEmployee must be used within an EmployeeProvider');
  return ctx;
}
