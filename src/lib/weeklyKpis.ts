/** Column headings of the OPS SQDC Weekly workbook -> KPI base name, used
 * only by the OPS Weekly upload parser (excelUpload.ts). Which KPIs show on
 * the Board's Weekly view is no longer hard-coded here — it's the
 * "Weekly view" tick box per KPI in Admin → KPIs (kpis.track_weekly). */
export const WEEKLY_HEADER_TO_BASE: Record<string, string> = {
  'Accident During Operation': 'Accident During Operation',
  'Delay – Waiting for CHE (L&D)': 'Delay – Waiting for CHE (L&D)',
  'Overall Mixing Yard': 'Overall Mixing Yard',
  'GMPH Mainliner': 'GMPH Mainliner',
  'GMPH Feeder': 'GMPH Feeder',
  'Mainliner Load GMPH': 'Mainliner Load GMPH',
  'QC Preventive Maintenance & Service': 'QC Preventive Maintenance & Service',
};
