import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { useEmployee } from '../context/EmployeeContext';
import { fetchEntryForKpiAndDate, fetchKpisForEmployee, fetchReasonsForKpi, upsertDailyEntry } from '../lib/data';
import { PILLAR_COLORS, metTarget, type DailyEntry, type KpiWithPillar, type Reason } from '../types';

const TODAY = format(new Date(), 'yyyy-MM-dd');

interface KpiRowState {
  kpi: KpiWithPillar;
  reasons: Reason[];
  actualInput: string;
  reasonId: string;
  reasonOther: string;
  existing: DailyEntry | null;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

export default function DataEntry() {
  const { employee } = useEmployee();
  const [rows, setRows] = useState<KpiRowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const kpis = await fetchKpisForEmployee(employee.id);
        const built = await Promise.all(
          kpis.map(async (kpi) => {
            const [reasons, existing] = await Promise.all([
              fetchReasonsForKpi(kpi.id),
              fetchEntryForKpiAndDate(kpi.id, TODAY),
            ]);
            const row: KpiRowState = {
              kpi,
              reasons,
              actualInput: existing ? String(existing.actual) : '',
              reasonId: existing?.reason_id ?? '',
              reasonOther: existing?.reason_other ?? '',
              existing,
              saving: false,
              saved: false,
              error: null,
            };
            return row;
          })
        );
        if (!cancelled) setRows(built.sort((a, b) => a.kpi.sort_order - b.kpi.sort_order));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load your KPIs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employee]);

  function updateRow(kpiId: string, patch: Partial<KpiRowState>) {
    setRows((prev) => prev.map((r) => (r.kpi.id === kpiId ? { ...r, ...patch, saved: false } : r)));
  }

  async function handleSave(row: KpiRowState) {
    if (!employee) return;
    const actual = Number(row.actualInput);
    if (row.actualInput.trim() === '' || Number.isNaN(actual)) {
      updateRow(row.kpi.id, { error: 'Enter a numeric value.' });
      return;
    }
    const met = metTarget(row.kpi, row.kpi.target, actual);
    if (!met && !row.reasonId && !row.reasonOther.trim()) {
      updateRow(row.kpi.id, { error: 'Target missed — please select or enter a reason so it can be tracked on the Pareto chart.' });
      return;
    }

    updateRow(row.kpi.id, { saving: true, error: null });
    try {
      const saved = await upsertDailyEntry({
        kpi_id: row.kpi.id,
        entry_date: TODAY,
        target: row.kpi.target,
        actual,
        met_target: met,
        reason_id: met ? null : row.reasonId || null,
        reason_other: met ? null : row.reasonOther.trim() || null,
        entered_by: employee.id,
      });
      updateRow(row.kpi.id, { saving: false, saved: true, existing: saved });
    } catch (e) {
      updateRow(row.kpi.id, { saving: false, error: e instanceof Error ? e.message : 'Failed to save' });
    }
  }

  if (loading) return <div className="page-loading">Loading your KPIs…</div>;
  if (loadError) return <div className="alert alert-error page-margin">{loadError}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Enter today's KPI results</h1>
        <p className="muted">{format(new Date(), 'EEEE, d MMMM yyyy')} · Logged in as {employee?.name}</p>
      </div>

      {rows.length === 0 && (
        <div className="empty-state page-margin">
          No KPIs are currently assigned to your Employee ID. Ask your supervisor to add you in the{' '}
          <code>kpi_assignments</code> table.
        </div>
      )}

      <div className="entry-grid">
        {rows.map((row) => {
          const colors = PILLAR_COLORS[row.kpi.pillar.code] ?? PILLAR_COLORS.S;
          const actualNum = Number(row.actualInput);
          const hasValidActual = row.actualInput.trim() !== '' && !Number.isNaN(actualNum);
          const met = hasValidActual ? metTarget(row.kpi, row.kpi.target, actualNum) : null;

          return (
            <div key={row.kpi.id} className="card entry-card" style={{ borderTopColor: colors.base }}>
              <div className="entry-card-header">
                <span className="pillar-tag" style={{ background: colors.soft, color: colors.text }}>
                  {row.kpi.pillar.name}
                </span>
                <h3>{row.kpi.name}</h3>
                <span className="muted">Target: {row.kpi.target} {row.kpi.unit} ({row.kpi.is_higher_better ? 'higher is good' : 'lower is good'})</span>
              </div>

              <label className="field-label">Today's actual ({row.kpi.unit})</label>
              <input
                type="number"
                step="any"
                className="input"
                value={row.actualInput}
                onChange={(e) => updateRow(row.kpi.id, { actualInput: e.target.value })}
                placeholder="Enter value"
              />

              {met === false && (
                <div className="reason-block">
                  <span className="pill pill-bad">Target missed</span>
                  <label className="field-label">Reason</label>
                  <select
                    className="input"
                    value={row.reasonId}
                    onChange={(e) => updateRow(row.kpi.id, { reasonId: e.target.value, reasonOther: '' })}
                  >
                    <option value="">— Select a reason —</option>
                    {row.reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                    <option value="">Other (specify below)</option>
                  </select>
                  {!row.reasonId && (
                    <input
                      className="input"
                      placeholder="Describe the reason…"
                      value={row.reasonOther}
                      onChange={(e) => updateRow(row.kpi.id, { reasonOther: e.target.value })}
                    />
                  )}
                </div>
              )}
              {met === true && <span className="pill pill-good" style={{ marginTop: 8 }}>Target met</span>}

              {row.error && <div className="alert alert-error">{row.error}</div>}

              <button className="btn btn-primary" disabled={row.saving} onClick={() => handleSave(row)}>
                {row.saving ? 'Saving…' : row.saved ? 'Saved ✓' : row.existing ? 'Update entry' : 'Save entry'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

