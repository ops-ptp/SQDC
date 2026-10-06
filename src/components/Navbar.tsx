import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { chevronDownIcon, logoutIcon, userIcon } from '@progress/kendo-svg-icons';
import { SvgIcon } from '@progress/kendo-react-common';
import { Button } from './ui';
import { useEmployee } from '../context/EmployeeContext';
import { departmentPath, useDepartments } from '../context/DepartmentContext';

/** Department name + switcher. Lists every active department plus the All
 * boards overview; anyone can switch (boards are public to view). */
function DepartmentSwitcher({ currentSlug, title, onNavigate }: { currentSlug?: string; title: string; onNavigate: () => void }) {
  const { departments } = useDepartments();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = departments.filter((d) => d.active);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="dept-switcher" ref={ref}>
      <button type="button" className="navbar-title dept-switcher-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="dept-switcher-name">{title}</span>
        <SvgIcon icon={chevronDownIcon} size="small" />
      </button>
      {open && (
        <div className="dept-switcher-menu" role="menu">
          {active.map((d) => (
            <Link
              key={d.id}
              role="menuitem"
              to={departmentPath(d)}
              className={d.slug === currentSlug ? 'is-current' : ''}
              onClick={() => {
                setOpen(false);
                onNavigate();
              }}
            >
              {d.name}
            </Link>
          ))}
          <div className="dept-switcher-sep" />
          <Link
            role="menuitem"
            to="/boards"
            onClick={() => {
              setOpen(false);
              onNavigate();
            }}
          >
            All boards
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { employee, logout, isDeptAdmin, isSiteAdmin } = useEmployee();
  const { departments } = useDepartments();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const match = useMatch('/d/:slug/*');
  const dept = departments.find((d) => d.slug === match?.params.slug && d.active);

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  const closeMenu = () => setMenuOpen(false);
  const title = dept?.name ?? (location.pathname.startsWith('/site-admin') ? 'Site Admin' : 'All boards');

  return (
    <header className="navbar">
      <div className="navbar-row">
        <div className="navbar-brand">
          <img src="/logo-lean-for-all.png" alt="Lean For All" className="navbar-logo-img" />
          <DepartmentSwitcher currentSlug={dept?.slug} title={title} onNavigate={closeMenu} />
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
          {dept ? (
            <>
              <NavLink to={departmentPath(dept)} end className={linkClass} onClick={closeMenu}>
                SQDC Board
              </NavLink>
              <NavLink to={departmentPath(dept, 'next-24-hours')} className={linkClass} onClick={closeMenu}>
                Next 24 Hours
              </NavLink>
              <NavLink to={departmentPath(dept, 'entry')} className={linkClass} onClick={closeMenu}>
                {dept.entry_mode === 'upload' ? 'Enter Remarks' : 'Enter Data'}
              </NavLink>
              <NavLink to={departmentPath(dept, 'actions')} className={linkClass} onClick={closeMenu}>
                Action Log
              </NavLink>
              {isDeptAdmin(dept.id) && (
                <NavLink to={departmentPath(dept, 'admin')} className={linkClass} onClick={closeMenu}>
                  Admin
                </NavLink>
              )}
              {isDeptAdmin(dept.id) && (
                <NavLink to={departmentPath(dept, 'insights')} className={linkClass} onClick={closeMenu}>
                  Insights
                </NavLink>
              )}
            </>
          ) : (
            <NavLink to="/boards" className={linkClass} onClick={closeMenu}>
              All boards
            </NavLink>
          )}
          {isSiteAdmin && (
            <NavLink to="/site-admin" className={({ isActive }) => `${isActive ? 'active' : ''} navbar-link-site`} onClick={closeMenu}>
              Site Admin
            </NavLink>
          )}
        </nav>
        <div className="navbar-user">
          {employee ? (
            <>
              <span className="navbar-employee">
                {employee.name} <span className="navbar-employee-code">({employee.employee_code})</span>
              </span>
              <Button
                fillMode="outline"
                className="navbar-btn"
                svgIcon={logoutIcon}
                onClick={() => {
                  closeMenu();
                  logout();
                }}
              >
                Switch user
              </Button>
            </>
          ) : (
            <Button
              themeColor="primary"
              svgIcon={userIcon}
              onClick={() => {
                closeMenu();
                // After logging in, land on this department's Enter page —
                // same as before departments existed.
                navigate('/login', dept ? { state: { from: departmentPath(dept, 'entry') } } : undefined);
              }}
            >
              Log in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
