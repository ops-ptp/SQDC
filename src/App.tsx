import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { EmployeeProvider } from './context/EmployeeContext';
import Navbar from './components/Navbar';
import RequireEmployee from './components/RequireEmployee';
import RequireAdmin from './components/RequireAdmin';
import Dashboard from './pages/Dashboard';
import DataEntry from './pages/DataEntry';
import ActionLog from './pages/ActionLog';
import ForwardLooking from './pages/ForwardLooking';
import Admin from './pages/Admin';
import Login from './pages/Login';

export default function App() {
  return (
    <EmployeeProvider>
      <BrowserRouter>
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/forward-looking"
              element={
                <RequireEmployee>
                  <ForwardLooking />
                </RequireEmployee>
              }
            />
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
          </Routes>
        </main>
      </BrowserRouter>
    </EmployeeProvider>
  );
}
