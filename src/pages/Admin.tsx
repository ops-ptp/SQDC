import { lazy, Suspense, useState } from 'react';
import { TabStrip, TabStripTab } from '@progress/kendo-react-layout';
import { useDepartment, useDepartments } from '../context/DepartmentContext';
import { departmentHasUpload, ENTRY_MODE_LABELS } from '../types';
import { InfoTip, InlineLoader } from '../components/ui';
import KpiSection from './admin/KpiSection';
import MembersSection from './admin/MembersSection';
import SettingsSection from './admin/SettingsSection';
const OpsUploads = lazy(() => import('./admin/OpsUploads'));
const TemplateUploads = lazy(() => import('./admin/TemplateUploads'));

// ===========================================================================
// Department Admin — everything a department admin needs to run their own
// SQDC board without touching code or the database: uploads (when the
// department uses them), the KPI list, the team, and settings.
// ===========================================================================

export default function Admin() {
  const department = useDepartment();
  const { reload } = useDepartments();
  const hasUpload = departmentHasUpload(department);
  const [tab, setTab] = useState(0);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const bumpCatalog = () => setCatalogVersion((v) => v + 1);

  const tabs = [
    ...(hasUpload
      ? [
          {
            title: 'Uploads',
            body: (
              <Suspense fallback={<InlineLoader />}>
                {department.upload_format === 'ops' ? <OpsUploads onCatalogChanged={bumpCatalog} /> : <TemplateUploads />}
              </Suspense>
            ),
          },
        ]
      : []),
    { title: 'KPIs', body: <KpiSection refreshKey={catalogVersion} onChanged={bumpCatalog} /> },
    { title: 'Members', body: <MembersSection /> },
    { title: 'Settings', body: <SettingsSection key={department.id} /> },
  ];
  const selected = Math.min(tab, tabs.length - 1);

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          Admin <span className="muted admin-dept-name">· {department.name}</span>{' '}
          <InfoTip>
            Data gets in by: {ENTRY_MODE_LABELS[department.entry_mode].toLowerCase()} (change it in Settings).
            {department.upload_format === 'ops' && hasUpload
              ? ' The Daily upload also reads the Target sheet’s per-day targets and the Next 24hrs sheet’s leading-KPI figures in the same pass.'
              : ''}
          </InfoTip>
        </h1>
      </div>

      <TabStrip
        selected={selected}
        onSelect={(e) => {
          setTab(e.selected);
          // Settings can change which tabs exist — make sure the list of
          // departments (and so this page) is fresh when leaving it.
          if (tabs[selected]?.title === 'Settings') reload();
        }}
        className="admin-tabs"
        keepTabsMounted
      >
        {tabs.map((t) => (
          <TabStripTab key={t.title} title={t.title}>
            {t.body}
          </TabStripTab>
        ))}
      </TabStrip>
    </div>
  );
}
