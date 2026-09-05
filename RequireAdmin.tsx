import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

/** Gates the Admin tab: requires both a logged-in employee AND is_admin. A
 * logged-in non-admin gets bounced to the Board rather than the login page —
 * logging in again wouldn't help them. */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { employee, loading } = useEmployee();
  const location = useLocation();

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!employee) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!employee.is_admin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
