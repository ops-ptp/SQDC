import { NavLink } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

export default function Navbar() {
  const { employee, logout } = useEmployee();

  return (
    <header className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">SQDC</span>
        <span className="navbar-title">Daily Performance Board</span>
      </div>
      <nav className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Board
        </NavLink>
        <NavLink to="/forward-looking" className={({ isActive }) => (isActive ? 'active' : '')}>
          Forward Looking
        </NavLink>
        <NavLink to="/entry" className={({ isActive }) => (isActive ? 'active' : '')}>
          Enter KPI Data
        </NavLink>
        <NavLink to="/actions" className={({ isActive }) => (isActive ? 'active' : '')}>
          Action Log
        </NavLink>
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
