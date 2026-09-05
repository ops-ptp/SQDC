import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

export default function Navbar() {
  const { employee, logout } = useEmployee();
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="navbar">
      <div className="navbar-row">
        <div className="navbar-brand">
          <img src="/logo-lean-for-all.png" alt="Lean For All" className="navbar-logo-img" />
          <span className="navbar-title">Operations Division</span>
        </div>

        <button
          type="button"
          className="navbar-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`navbar-toggle-bar ${menuOpen ? 'is-open' : ''}`} />
        </button>
      </div>

      {/* Tapping any link/button inside closes the panel directly (rather
          than syncing to the route in an effect), so opening/closing stays
          a single, traceable state update per user action. */}
      <div className={`navbar-collapse ${menuOpen ? 'is-open' : ''}`}>
        <nav className="navbar-links">
          <NavLink to="/" end className={linkClass} onClick={closeMenu}>
            SQDC Board
          </NavLink>
          <NavLink to="/forward-looking" className={linkClass} onClick={closeMenu}>
            Next 24 Hours
          </NavLink>
          <NavLink to="/entry" className={linkClass} onClick={closeMenu}>
            Enter Remarks
          </NavLink>
          <NavLink to="/actions" className={linkClass} onClick={closeMenu}>
            Action Log
          </NavLink>
          {employee?.is_admin && (
            <NavLink to="/admin" className={linkClass} onClick={closeMenu}>
              Admin
            </NavLink>
          )}
          {employee?.is_admin && (
            <NavLink to="/insights" className={linkClass} onClick={closeMenu}>
              Insights
            </NavLink>
          )}
        </nav>
        <div className="navbar-user">
          {employee ? (
            <>
              <span className="navbar-employee">
                {employee.name} <span className="navbar-employee-code">({employee.employee_code})</span>
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  closeMenu();
                  logout();
                }}
              >
                Switch user
              </button>
            </>
          ) : (
            <NavLink to="/login" className="btn btn-primary" onClick={closeMenu}>
              Log in
            </NavLink>
          )}
        </div>
      </div>
    </header>
  );
}
