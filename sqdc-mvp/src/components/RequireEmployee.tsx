import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

export default function RequireEmployee({ children }: { children: ReactNode }) {
  const { employee, loading } = useEmployee();
  const location = useLocation();

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!employee) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
