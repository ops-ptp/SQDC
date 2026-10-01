/** The 7 KPIs the Weekly workbook actually tracks — also the definitive
 * list of which KPIs stay visible on the Board when the Daily/Weekly
 * toggle is set to Weekly (everything else, e.g. Moves, only exists in the
 * Daily file and has no weekly figure to show). Exported so
 * PillarQuadrant.tsx can filter its KPI pills from the same single source
 * of truth rather than a second hardcoded list that could drift out of
 * sync with this one. */
export const WEEKLY_HEADER_TO_BASE: Record<string, string> = {
  'Accident During Operation': 'Accident During Operation',
  'Delay – Waiting for CHE (L&D)': 'Delay – Waiting for CHE (L&D)',
  'Overall Mixing Yard': 'Overall Mixing Yard',
  'GMPH Mainliner': 'GMPH Mainliner',
  'GMPH Feeder': 'GMPH Feeder',
  'Mainliner Load GMPH': 'Mainliner Load GMPH',
  'QC Preventive Maintenance & Service': 'QC Preventive Maintenance & Service',
};
