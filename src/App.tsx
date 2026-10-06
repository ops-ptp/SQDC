import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { EmployeeProvider } from './context/EmployeeContext';
import { DepartmentLayout, DepartmentsProvider, RedirectToHomeDepartment } from './context/DepartmentContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import { RequireDeptAdmin, RequireDeptMember, RequireSiteAdmin } from './components/RouteGuards';
import Dashboard from './pages/Dashboard';
const DataEntry = lazy(() => import('./pages/DataEntry'));
const ActionLog = lazy(() => import('./pages/ActionLog'));
const ForwardLooking = lazy(() => import('./pages/ForwardLooking'));
const Admin = lazy(() => import('./pages/Admin'));
const Insights = lazy(() => import('./pages/Insights'));
const Boards = lazy(() => import('./pages/Boards'));
const SiteAdmin = lazy(() => import('./pages/SiteAdmin'));
import Login from './pages/Login';
import { PageLoader } from './components/ui';
import { supabaseConfigured } from './lib/supabaseClient';

// The Board is the landing page and stays in the main bundle; everything
// else (notably Admin/Insights, which pull in the Excel parser) loads on
// first visit so a shared board screen starts faster.
//
// Every department's board lives under /d/<slug>/… . The old single-board
// URLs (/, /actions, /entry, …) still work: they open the same page of the
// last department this screen viewed, or Operations — so bookmarks and TV
// screens set up before departments existed keep showing the same board.

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="center-page">
        <div className="card login-card">
          <h1>Database not configured</h1>
          <p className="muted">
            This deployment was built without <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. In
            Vercel, open the project's Settings → Environment Variables, tick <strong>Preview</strong> (as well as
            Production) for both, then redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <EmployeeProvider>
      <DepartmentsProvider>
        <BrowserRouter>
          <Navbar />
          <main>
            <Suspense fallback={<PageLoader label="Loading…" />}>
              <Routes>
                <Route path="/d/:slug" element={<DepartmentLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="next-24-hours" element={<ForwardLooking />} />
                  <Route
                    path="entry"
                    element={
                      <RequireDeptMember>
                        <DataEntry />
                      </RequireDeptMember>
                    }
                  />
                  <Route path="actions" element={<ActionLog />} />
                  <Route
                    path="admin"
                    element={
                      <RequireDeptAdmin>
                        <Admin />
                      </RequireDeptAdmin>
                    }
                  />
                  <Route
                    path="insights"
                    element={
                      <RequireDeptAdmin>
                        <Insights />
                      </RequireDeptAdmin>
                    }
                  />
                </Route>
                <Route path="/boards" element={<Boards />} />
                <Route
                  path="/site-admin"
                  element={
                    <RequireSiteAdmin>
                      <SiteAdmin />
                    </RequireSiteAdmin>
                  }
                />
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<RedirectToHomeDepartment />} />
                <Route path="/forward-looking" element={<RedirectToHomeDepartment sub="next-24-hours" />} />
                <Route path="/entry" element={<RedirectToHomeDepartment sub="entry" />} />
                <Route path="/actions" element={<RedirectToHomeDepartment sub="actions" />} />
                <Route path="/admin" element={<RedirectToHomeDepartment sub="admin" />} />
                <Route path="/insights" element={<RedirectToHomeDepartment sub="insights" />} />
                <Route path="*" element={<RedirectToHomeDepartment />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </BrowserRouter>
      </DepartmentsProvider>
    </EmployeeProvider>
  );
}
