import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useParams } from 'react-router-dom';
import { fetchDepartments } from '../lib/data';
import { errorMessage, type Department } from '../types';
import { PageLoader } from '../components/ui';

// ---------------------------------------------------------------------------
// Every department board lives under /d/<slug>/… . DepartmentsProvider
// loads the department list once for the whole app (navbar switcher, the
// All boards page, Site Admin); DepartmentLayout is the route element for
// /d/:slug and provides the CURRENT department to every page below it.
// ---------------------------------------------------------------------------

const LAST_SLUG_KEY = 'sqdc.last_department';

interface DepartmentsContextValue {
  departments: Department[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const DepartmentsContext = createContext<DepartmentsContextValue | undefined>(undefined);
const CurrentDepartmentContext = createContext<Department | undefined>(undefined);

export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDepartments(await fetchDepartments());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Failed to load departments'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <DepartmentsContext.Provider value={{ departments, loading, error, reload }}>{children}</DepartmentsContext.Provider>;
}

export function useDepartments(): DepartmentsContextValue {
  const ctx = useContext(DepartmentsContext);
  if (!ctx) throw new Error('useDepartments must be used within a DepartmentsProvider');
  return ctx;
}

/** The department whose board is being viewed. Only usable on pages under
 * /d/:slug. */
export function useDepartment(): Department {
  const dept = useContext(CurrentDepartmentContext);
  if (!dept) throw new Error('useDepartment must be used on a /d/:slug page');
  return dept;
}

/** Builds a link inside the current department: deptPath('entry') ->
 * '/d/ops/entry', deptPath() -> '/d/ops'. */
export function departmentPath(dept: Pick<Department, 'slug'>, sub = ''): string {
  return `/d/${dept.slug}${sub ? `/${sub.replace(/^\//, '')}` : ''}`;
}

export function useDeptPath(): (sub?: string) => string {
  const dept = useDepartment();
  return (sub = '') => departmentPath(dept, sub);
}

function rememberDepartment(slug: string) {
  try {
    localStorage.setItem(LAST_SLUG_KEY, slug);
  } catch {
    /* storage unavailable */
  }
}

function lastDepartmentSlug(): string | null {
  try {
    return localStorage.getItem(LAST_SLUG_KEY);
  } catch {
    return null;
  }
}

/** The department a bare "/" (or an old pre-department link like /actions)
 * should open: the last one this screen viewed, else the first department
 * (Operations — the original board, so existing bookmarks and TV screens
 * keep showing the same thing). */
function useHomeDepartment(): { department: Department | undefined; loading: boolean } {
  const { departments, loading } = useDepartments();
  const active = departments.filter((d) => d.active);
  const last = lastDepartmentSlug();
  const byCreated = [...active].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { department: active.find((d) => d.slug === last) ?? byCreated[0], loading };
}

/** Redirects an old single-department URL (/, /actions, /entry, …) to the
 * same page of the home department. */
export function RedirectToHomeDepartment({ sub = '' }: { sub?: string }) {
  const { department, loading } = useHomeDepartment();
  if (loading) return <PageLoader label="Loading…" />;
  if (!department) return <Navigate to="/boards" replace />;
  return <Navigate to={departmentPath(department, sub)} replace />;
}

export function DepartmentLayout() {
  const { slug } = useParams();
  const { departments, loading, error } = useDepartments();
  const department = departments.find((d) => d.slug === slug);

  useEffect(() => {
    if (department?.active) rememberDepartment(department.slug);
  }, [department?.slug, department?.active]);

  if (loading) return <PageLoader label="Loading…" />;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;
  if (!department || !department.active) {
    return (
      <div className="center-page">
        <div className="card login-card">
          <h1>Board not found</h1>
          <p className="muted">
            {department ? `${department.name} has been archived.` : `There's no department board at "/d/${slug}".`}
          </p>
          <Link to="/boards">See all department boards →</Link>
        </div>
      </div>
    );
  }

  return (
    <CurrentDepartmentContext.Provider value={department}>
      {/* Remount every page when switching department, so no page keeps the
          previous department's data in its state. */}
      <Outlet key={department.id} />
    </CurrentDepartmentContext.Provider>
  );
}
