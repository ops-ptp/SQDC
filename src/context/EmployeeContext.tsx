import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchMemberships } from '../lib/data';
import { errorMessage, normalizeEmployeeCode, type DepartmentMember, type Employee } from '../types';

const STORAGE_KEY = 'sqdc.employee_code';

interface EmployeeContextValue {
  employee: Employee | null;
  /** The logged-in person's department memberships (empty when logged out). */
  memberships: DepartmentMember[];
  loading: boolean;
  error: string | null;
  loginWithCode: (code: string) => Promise<Employee>;
  logout: () => void;
  /** Re-reads the logged-in person's own record and memberships — call after
   * changing your own role or a site-admin flag so the navbar catches up. */
  refresh: () => Promise<void>;
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

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [memberships, setMemberships] = useState<DepartmentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(code: string): Promise<Employee> {
    const emp = await fetchEmployee(code);
    const m = await fetchMemberships({ employeeId: emp.id });
    setEmployee(emp);
    setMemberships(m);
    return emp;
  }

  useEffect(() => {
    let savedCode: string | null = null;
    try {
      savedCode = localStorage.getItem(STORAGE_KEY);
    } catch {
      savedCode = null;
    }
    if (!savedCode) {
      setLoading(false);
      return;
    }
    load(savedCode)
      .catch(() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* storage unavailable */
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function loginWithCode(code: string): Promise<Employee> {
    setError(null);
    try {
      const emp = await load(code);
      try {
        localStorage.setItem(STORAGE_KEY, emp.employee_code);
      } catch {
        /* storage unavailable — stays logged in for this tab only */
      }
      return emp;
    } catch (e) {
      const message = errorMessage(e, 'Login failed');
      setError(message);
      throw e;
    }
  }

  function logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    setEmployee(null);
    setMemberships([]);
  }

  const refresh = useCallback(async () => {
    if (!employee) return;
    try {
      await load(employee.employee_code);
    } catch {
      logout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.employee_code]);

  const isSiteAdmin = Boolean(employee?.is_site_admin);
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
