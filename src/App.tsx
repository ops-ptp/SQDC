import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { EmployeeProvider } from './context/EmployeeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import RequireEmployee from './components/RequireEmployee';
import RequireAdmin from './components/RequireAdmin';
import Dashboard from './pages/Dashboard';
const DataEntry = lazy(() => import('./pages/DataEntry'));
const ActionLog = lazy(() => import('./pages/ActionLog'));
const ForwardLooking = lazy(() => import('./pages/ForwardLooking'));
const Admin = lazy(() => import('./pages/Admin'));
const Insights = lazy(() => import('./pages/Insights'));
import Login from './pages/Login';
import { PageLoader } from './components/ui';

// The Board is the landing page and stays in the main bundle; everything
// else (notably Admin/Insights, which pull in the Excel parser) loads on
// first visit so a shared board screen starts faster.

export default function App() {
  return (
    <EmployeeProvider>
      <BrowserRouter>
        <Navbar />
        <main>
          <Suspense fallback={<PageLoader label="Loading…" />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forward-looking" element={<ForwardLooking />} />
            <Route
              path="/entry"
              element={
                <RequireEmployee>
                  <DataEntry />
                </RequireEmployee>
              }
            />
            <Route path="/actions" element={<ActionLog />} />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <Admin />
                </RequireAdmin>
              }
            />
            <Route
              path="/insights"
              element={
                <RequireAdmin>
                  <Insights />
                </RequireAdmin>
              }
            />
          </Routes>
          </Suspense>
        </main>
        <Footer />
      </BrowserRouter>
    </EmployeeProvider>
  );
}
