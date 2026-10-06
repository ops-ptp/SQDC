import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';
import { departmentPath, useDepartment } from '../context/DepartmentContext';
import { PageLoader } from './ui';

function NotAllowed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="center-page">
      <div className="card login-card">
        <h1>{title}</h1>
        <p className="muted">{children}</p>
      </div>
    </div>
  );
}

/** Logged in at all — otherwise off to the login page, then back here. */
function useLoginGate(): ReactNode | null {
  const { employee, loading } = useEmployee();
  const location = useLocation();
  if (loading) return <PageLoader label="Loading…" />;
  if (!employee) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return null;
}

/** Enter Data / Remarks: a member of this department (any role), or a site
 * admin. */
export function RequireDeptMember({ children }: { children: ReactNode }) {
  const gate = useLoginGate();
  const { employee, isDeptMember } = useEmployee();
  const dept = useDepartment();
  if (gate) return <>{gate}</>;
  if (!isDeptMember(dept.id)) {
    return (
      <NotAllowed title="Not a member of this department">
        {employee?.name} isn't on the {dept.name} team yet. Ask one of its department admins to add you under Admin →
        Members. <Link to={departmentPath(dept)}>Back to the board</Link>
      </NotAllowed>
    );
  }
  return <>{children}</>;
}

/** Admin / Insights: a department admin of this department, or a site
 * admin. Anyone else goes back to the board — logging in again wouldn't help. */
export function RequireDeptAdmin({ children }: { children: ReactNode }) {
  const gate = useLoginGate();
  const { isDeptAdmin } = useEmployee();
  const dept = useDepartment();
  if (gate) return <>{gate}</>;
  if (!isDeptAdmin(dept.id)) return <Navigate to={departmentPath(dept)} replace />;
  return <>{children}</>;
}

export function RequireSiteAdmin({ children }: { children: ReactNode }) {
  const gate = useLoginGate();
  const { isSiteAdmin } = useEmployee();
  if (gate) return <>{gate}</>;
  if (!isSiteAdmin) {
    return (
      <NotAllowed title="Site admins only">
        This page is for creating departments and appointing their admins. <Link to="/boards">See all boards</Link>
      </NotAllowed>
    );
  }
  return <>{children}</>;
}
