import { NavLink } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

export default function Navbar() {
  const { employee, logout } = useEmployee();

  return (
    <header className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">SQDC</span>
        <span className="navbar-title">Operations Divisions</span>
      </div>
      <nav className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          SQDC Board
        </NavLink>
        <NavLink to="/forward-looking" className={({ isActive }) => (isActive ? 'active' : '')}>
          Next 24 Hours
        </NavLink>
        <NavLink to="/entry" className={({ isActive }) => (isActive ? 'active' : '')}>
          Enter Remarks
        </NavLink>
        <NavLink to="/actions" className={({ isActive }) => (isActive ? 'active' : '')}>
          Action Log
        </NavLink>
        {employee?.is_admin && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
            Admin
          </NavLink>
        )}
      </nav>
      <div className="navbar-user">
        {employee ? (
          <>
            <span className="navbar-employee">
              {employee.name} <span className="navbar-employee-code">({employee.employee_code})</span>
            </span>
            <button className="btn btn-ghost" onClick={logout}>
              Switch user
            </button>
          </>
        ) : (
          <NavLink to="/login" className="btn btn-primary">
            Log in
          </NavLink>
        )}
      </div>
    </header>
  );
}
