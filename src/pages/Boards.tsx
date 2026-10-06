import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import { departmentPath, useDepartments } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import { fetchBoardRollups, type BoardRollup } from '../lib/data';
import { errorMessage } from '../types';
import { Button, InfoTip, PageLoader } from '../components/ui';

// ===========================================================================
// All boards — every active department's SQDC board, each with yesterday's
// result at a glance (how many of its KPIs met / missed target). Public,
// like the boards themselves.
// ===========================================================================

export default function Boards() {
  const { departments, loading } = useDepartments();
  const { isSiteAdmin, memberships } = useEmployee();
  const navigate = useNavigate();
  const [rollups, setRollups] = useState<Map<string, BoardRollup> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yesterday = subDays(new Date(), 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

  useEffect(() => {
    fetchBoardRollups(yesterdayStr)
      .then(setRollups)
      .catch((e) => setError(errorMessage(e, 'Failed to load results')));
  }, [yesterdayStr]);

  if (loading) return <PageLoader label="Loading boards…" />;
  const active = departments.filter((d) => d.active);
  const mine = new Set(memberships.map((m) => m.department_id));

  return (
    <div className="page">
      <div className="page-header page-header-row">
        <div>
          <h1>
            All boards{' '}
            <InfoTip>
              Each department's SQDC board. The bar shows {format(yesterday, 'EEEE d MMM')}'s result: how many of its board KPIs met (green)
              or missed (red) target, and how many have no figure yet (grey). A KPI with Day and Night shifts counts as missed if either shift
              missed.
            </InfoTip>
          </h1>
          <span className="muted">Results for {format(yesterday, 'EEEE, d MMMM yyyy')}</span>
        </div>
        {isSiteAdmin && (
          <Button themeColor="primary" onClick={() => navigate('/site-admin')}>
            Manage departments
          </Button>
        )}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {active.length === 0 ? (
        <div className="empty-state">No departments yet.{isSiteAdmin ? ' Create the first one in Site Admin.' : ''}</div>
      ) : (
        <div className="boards-grid">
          {active.map((d) => {
            const r = rollups?.get(d.id);
            const total = r ? r.met + r.missed + r.noData : 0;
            return (
              <Link key={d.id} to={departmentPath(d)} className="card board-card">
                <div className="board-card-head">
                  <h2>{d.name}</h2>
                  {mine.has(d.id) && <span className="pill admin-kpi-tag">your team</span>}
                </div>
                {!rollups ? (
                  <span className="muted">Loading…</span>
                ) : !r || total === 0 ? (
                  <span className="muted">No KPIs set up yet</span>
                ) : (
                  <>
                    <div className="board-card-bar" role="img" aria-label={`${r.met} met, ${r.missed} missed, ${r.noData} no data`}>
                      {r.met > 0 && <span className="seg-met" style={{ flexGrow: r.met }} />}
                      {r.missed > 0 && <span className="seg-missed" style={{ flexGrow: r.missed }} />}
                      {r.noData > 0 && <span className="seg-nodata" style={{ flexGrow: r.noData }} />}
                    </div>
                    <div className="board-card-counts">
                      <span className="value-good">{r.met} met</span>
                      <span className="value-bad">{r.missed} missed</span>
                      <span className="muted">{r.noData} no data</span>
                    </div>
                  </>
                )}
                <span className="board-card-link">Open board →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
