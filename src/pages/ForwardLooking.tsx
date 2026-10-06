import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { pencilIcon } from '@progress/kendo-svg-icons';
import { bulkUpsertLeadingEntriesFromUpload, fetchLatestLeadingEntries, fetchLeadingKpis } from '../lib/data';
import { useDepartment, useDeptPath } from '../context/DepartmentContext';
import { useEmployee } from '../context/EmployeeContext';
import { PILLAR_COLORS, errorMessage, round2, type KpiWithPillar, type LeadingEntry } from '../types';
import { Button, NumberField, PageLoader, InfoTip } from '../components/ui';

const TODAY = new Date();

/** '%' KPIs get a % sign; everything else is a plain thousands-separated
 * number with its unit suffixed. Both are capped at 2 decimal places. */
function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${round2(value)}%`;
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
}

// Requested board order: Quality, Delivery, Cost (Safety has no leading
// KPIs today, but is placed last as a safe default if one is ever added).
const PILLAR_DISPLAY_ORDER = ['Q', 'D', 'C', 'S'];
function pillarOrderIndex(code: string): number {
  const idx = PILLAR_DISPLAY_ORDER.indexOf(code);
  return idx === -1 ? PILLAR_DISPLAY_ORDER.length : idx;
}

/** Inline "type today's figure" for departments that enter data in the app
 * (no Next 24hrs sheet to upload). Writes today's leading_entries row. */
function LeadingValueEditor({ kpi, current, employeeId, onSaved }: { kpi: KpiWithPillar; current?: LeadingEntry; employeeId: string | null; onSaved: (e: LeadingEntry) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  if (!editing) {
    return (
      <Button
        size="small"
        fillMode="flat"
        svgIcon={pencilIcon}
        className="fl-card-edit"
        onClick={() => {
          setValue(current?.entry_date === today ? String(current.value) : '');
          setEditing(true);
        }}
      >
        Update today
      </Button>
    );
  }

  async function save() {
    const n = Number(value);
    if (value.trim() === '' || Number.isNaN(n)) {
      setError('Enter a number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await bulkUpsertLeadingEntriesFromUpload([{ kpi_id: kpi.id, entry_date: today, value: n, uploaded_by: employeeId }]);
      onSaved({ id: `${kpi.id}|${today}`, kpi_id: kpi.id, entry_date: today, value: n, uploaded_by: employeeId, created_at: '', updated_at: '' });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fl-card-editor">
      <NumberField value={value} onChange={setValue} placeholder={`Today's figure${kpi.unit ? ` (${kpi.unit})` : ''}`} />
      <div className="fl-card-editor-actions">
        <Button size="small" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
        <Button size="small" themeColor="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}

export default function ForwardLooking() {
  const department = useDepartment();
  const deptPath = useDeptPath();
  const { employee, isDeptMember, isDeptAdmin } = useEmployee();
  const canType = department.entry_mode !== 'upload' && isDeptMember(department.id);
  const [kpis, setKpis] = useState<KpiWithPillar[]>([]);
  const [entries, setEntries] = useState<LeadingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayStr = format(TODAY, 'yyyy-MM-dd');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLeadingKpis(department.id)
      .then((k) => {
        if (cancelled) return [];
        setKpis(k);
        return fetchLatestLeadingEntries(
          k.map((x) => x.id),
          todayStr
        );
      })
      .then((e) => !cancelled && setEntries(e))
      .catch((e) => !cancelled && setError(errorMessage(e, 'Failed to load Next 24 Hours board')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department.id]);

  const entryByKpi = useMemo(() => new Map(entries.map((e) => [e.kpi_id, e])), [entries]);

  // Group the leading KPI catalog by pillar, in catalog sort order, then
  // reorder the sections themselves to Quality, Delivery, Cost.
  const groups = useMemo(() => {
    const byPillar = new Map<string, { pillar: KpiWithPillar['pillar']; kpis: KpiWithPillar[] }>();
    for (const k of kpis) {
      const key = k.pillar.code;
      if (!byPillar.has(key)) byPillar.set(key, { pillar: k.pillar, kpis: [] });
      byPillar.get(key)!.kpis.push(k);
    }
    return Array.from(byPillar.values()).sort((a, b) => pillarOrderIndex(a.pillar.code) - pillarOrderIndex(b.pillar.code));
  }, [kpis]);

  if (loading) return <PageLoader label="Loading Next 24 Hours board…" />;
  if (error) return <div className="alert alert-error page-margin">{error}</div>;

  return (
    <div className="page fl-page">
      <div className="page-header">
        <h1>Next 24 Hours <InfoTip>Leading indicators for the day ahead.</InfoTip></h1>
      </div>

      {kpis.length === 0 ? (
        <div className="empty-state">
          No Next 24 Hours KPIs are set up for {department.name} yet.{' '}
          {isDeptAdmin(department.id) ? (
            <Link to={deptPath('admin')}>Add one in Admin → KPIs</Link>
          ) : (
            'A department admin can add them in Admin → KPIs.'
          )}
        </div>
      ) : (
        <div className="fl-board">
          {groups.map((g) => {
            const colors = PILLAR_COLORS[g.pillar.code] ?? PILLAR_COLORS.S;
            return (
              <div key={g.pillar.code} className="fl-column">
                <div className="fl-column-header">
                  <span className="fl-column-title">{g.pillar.name}</span>
                </div>
                <div className="fl-column-body">
                  {g.kpis.map((k) => {
                    const entry = entryByKpi.get(k.id);
                    return (
                      <div key={k.id} className="fl-card" style={{ borderLeftColor: colors.base }}>
                        <div className="fl-card-kpi">{k.name}</div>
                        {entry ? (
                          <>
                            <div className="fl-card-value">
                              {formatValue(entry.value, k.unit)}
                              {k.unit && k.unit !== '%' && <span className="fl-card-unit">{k.unit}</span>}
                            </div>
                            <div className="fl-card-asof">
                              As of {entry.entry_date === todayStr ? 'today' : format(parseISO(entry.entry_date), 'EEE, d MMM')}
                            </div>
                          </>
                        ) : (
                          <div className="fl-card-nodata">{department.entry_mode === 'upload' ? 'No data uploaded yet' : 'No figure yet'}</div>
                        )}
                        {canType && (
                          <LeadingValueEditor
                            kpi={k}
                            current={entry}
                            employeeId={employee?.id ?? null}
                            onSaved={(e) => setEntries((prev) => [...prev.filter((x) => x.kpi_id !== e.kpi_id), e])}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
