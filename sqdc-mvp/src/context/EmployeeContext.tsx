import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Employee } from '../types';

const STORAGE_KEY = 'sqdc.employee_code';

interface EmployeeContextValue {
  employee: Employee | null;
  loading: boolean;
  error: string | null;
  loginWithCode: (code: string) => Promise<Employee>;
  logout: () => void;
}

const EmployeeContext = createContext<EmployeeContextValue | undefined>(undefined);

export function EmployeeProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedCode = localStorage.getItem(STORAGE_KEY);
    if (!savedCode) {
      setLoading(false);
      return;
    }
    fetchEmployee(savedCode)
      .then((emp) => setEmployee(emp))
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setLoading(false));
  }, []);

  async function fetchEmployee(code: string): Promise<Employee> {
    const { data, error: err } = await supabase
      .from('employees')
      .select('*')
      .ilike('employee_code', code.trim())
      .eq('active', true)
      .maybeSingle();
    if (err) throw new Error(err.message);
    if (!data) throw new Error(`No active employee found for ID "${code}".`);
    return data as Employee;
  }

  async function loginWithCode(code: string): Promise<Employee> {
    setError(null);
    try {
      const emp = await fetchEmployee(code);
      localStorage.setItem(STORAGE_KEY, emp.employee_code);
      setEmployee(emp);
      return emp;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Login failed';
      setError(message);
      throw e;
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setEmployee(null);
  }

  return (
    <EmployeeContext.Provider value={{ employee, loading, error, loginWithCode, logout }}>
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployee(): EmployeeContextValue {
  const ctx = useContext(EmployeeContext);
  if (!ctx) throw new Error('useEmployee must be used within an EmployeeProvider');
  return ctx;
}
