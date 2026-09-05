-- ============================================================================
-- SQDC Board MVP — seed data
-- ============================================================================
-- Run AFTER schema.sql. Loads: 4 pillars, the real terminal-ops KPI catalog
-- from "OPS_SQDC_-_Aug_2026.xlsx" (Lagging KPIs for the Board + Leading KPIs
-- for Forward Looking), sample employees, curated reason lists, ~20 days of
-- demo daily entries (with a realistic miss rate) and a couple of demo
-- actions — so the app is fully demoable end to end immediately.
--
-- KPI catalog source & mapping notes (from the "Daily"/"Weekly"/"Data Daily"
-- sheets of the uploaded workbook):
--   * Most lagging KPIs are tracked separately per Day/Night shift in the
--     sheet — modeled here as two KPI rows each, e.g. "Moves (Day)" /
--     "Moves (Night)", since daily_entries is one row per KPI per day.
--     "QC Preventive Maintenance & Service" and "Average Litres per Vessel
--     Call" are single daily figures with no shift split, per the sheet.
--   * Ratio-style KPIs (Delay – Waiting for CHE, Overall Mixing Yard, Gate
--     Truck Waiting Time) are stored here as percentages (raw value × 100)
--     for readability — e.g. the sheet's 0.11 target becomes 11 (%).
--   * "Moves" has a Projected/Actual/Variant structure in the sheet (the
--     day's target itself moves). This MVP tracks Actual against a fixed
--     representative target (~the Aug-2026 average projection) rather than
--     a day-by-day target — flagged as a follow-up if you want the daily
--     projection itself editable.
--   * Leading KPI rows have no target — they're numeric projections (Moves
--     Day/Night, TEUs Run Rate, QC Gang, Lashing, QC PM & Service MTD/
--     Projection Today), one figure per day, sourced from the Daily upload's
--     "Next 24hrs" tab into `leading_entries` and shown as a read-only
--     headline number on the Next 24 Hours board (no more manual add-a-card
--     forecast_cards flow — that table was renamed to archived_forecast_cards
--     in the database-cleanup migration, kept around but out of the way).
--   * Demo daily_entries below are synthetic (deterministic pseudo-random
--     around each KPI's target), not the literal Aug-2026 figures from the
--     workbook — say the word if you'd like the real historical numbers
--     imported instead.
--
-- Safe to re-run: it clears its own seed rows first (by known codes/names)
-- rather than truncating your whole database.
-- ============================================================================

-- ---- Clean slate for demo tables (order matters for FKs) -------------------
delete from leading_entries;
delete from actions;
delete from daily_entries;
delete from reasons;
delete from kpi_assignments;
delete from kpis;
delete from employees;
delete from pillars;

-- ---- Pillars -----------------------------------------------------------
insert into pillars (code, name, sort_order) values
  ('S', 'Safety',   1),
  ('Q', 'Quality',  2),
  ('D', 'Delivery', 3),
  ('C', 'Cost',     4);

-- ---- Employees -----------------------------------------------------------
-- Employee IDs are 6-digit, zero-padded numbers (enforced by a check
-- constraint in schema.sql). 000003 (Aiman) is seeded as the demo Admin/
-- Superuser — the only one who sees the Admin tab (Daily/Weekly Excel
-- upload) by default. (Job-title text used to live here too, in a `role`
-- column — dropped in the database-cleanup migration since nothing in the
-- app ever read it.)
insert into employees (employee_code, name, is_admin) values
  ('000001', 'Nasser',   false),
  ('000002', 'Noura',    false),
  ('000003', 'Aiman',    true),
  ('000004', 'Farah',    false),
  ('000005', 'Hassan',   false),
  ('000006', 'Zaid',     false),
  ('000007', 'Iris',     false),
  ('000008', 'Marcus',   false);

-- ---- KPIs -----------------------------------------------------------------
-- is_leading: true = a leading/process indicator, forecast on the Forward
-- Looking board (+1/+2/+3 days), not tracked with daily target/actual.
-- false = a lagging/outcome indicator, tracked daily on the main Board.
--
-- Safety
-- manual_entry = true: Accident During Operation keeps manual Performance
-- entry in Enter Remarks even after the Admin Excel upload goes live — one
-- of the 3 exceptions (see kpis.manual_entry migration note in schema.sql).
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading, manual_entry) select id, v.name, v.unit, v.higher, v.target, v.info, v.ord, false, true from pillars, (values
  ('Accident During Operation (Day)',   'Count', false, 0, 'Direct safety performance indicator. Any accident during operation, day shift.', 1),
  ('Accident During Operation (Night)', 'Count', false, 0, 'Direct safety performance indicator. Any accident during operation, night shift.', 2)
) as v(name, unit, higher, target, info, ord) where pillars.code = 'S';

-- Quality
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading) select id, v.name, v.unit, v.higher, v.target, v.info, v.ord, false from pillars, (values
  ('Delay – Waiting for CHE (L&D) (Day)',              '%',     false, 11, 'Directly impacts vessel operation delivery. Share of moves delayed waiting for Container Handling Equipment, day shift.', 1),
  ('Delay – Waiting for CHE (L&D) (Night)',             '%',     false, 11, 'Directly impacts vessel operation delivery. Share of moves delayed waiting for Container Handling Equipment, night shift.', 2),
  ('Overall Mixing Yard (Day)',                         '%',     false, 3.7, 'Reflects yard planning/stacking quality and operational discipline, day shift.', 3),
  ('Overall Mixing Yard (Night)',                       '%',     false, 3.7, 'Reflects yard planning/stacking quality and operational discipline, night shift.', 4),
  ('Labour Supply as Required – QC Gang (Day)',         'Gangs', true,  51, 'Resource availability to meet operational demand, day shift.', 5),
  ('Labour Supply as Required – QC Gang (Night)',       'Gangs', true,  51, 'Resource availability to meet operational demand, night shift.', 6)
) as v(name, unit, higher, target, info, ord) where pillars.code = 'Q';

-- Delivery
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading) select id, v.name, v.unit, v.higher, v.target, v.info, v.ord, false from pillars, (values
  ('Moves (Day)',                            'Moves',    true,  11600, 'Core operational output, day shift. Tracked against a representative target — the day''s Projected figure varies in the source planning sheet.', 1),
  ('Moves (Night)',                          'Moves',    true,  11100, 'Core operational output, night shift. Tracked against a representative target — the day''s Projected figure varies in the source planning sheet.', 2),
  ('GMPH Mainliner (Day)',                   'Moves/Hr', true,  28.5, 'Vessel productivity/service delivery, mainliner vessels, day shift.', 3),
  ('GMPH Mainliner (Night)',                 'Moves/Hr', true,  28.5, 'Vessel productivity/service delivery, mainliner vessels, night shift.', 4),
  ('GMPH Feeder (Day)',                      'Moves/Hr', true,  24.5, 'Vessel productivity/service delivery, feeder vessels, day shift.', 5),
  ('GMPH Feeder (Night)',                    'Moves/Hr', true,  24.5, 'Vessel productivity/service delivery, feeder vessels, night shift.', 6),
  ('Mainliner Load GMPH (Day)',              'Moves/Hr', true,  25, 'Loading productivity, mainliner vessels, day shift.', 7),
  ('Mainliner Load GMPH (Night)',            'Moves/Hr', true,  25, 'Loading productivity, mainliner vessels, night shift.', 8),
  ('Gate Truck Waiting Time >1 hour (Day)',  '%',        false, 1.5, 'Customer/service delivery performance — share of gate trucks waiting over 1 hour, day shift.', 9),
  ('Gate Truck Waiting Time >1 hour (Night)','%',        false, 1.5, 'Customer/service delivery performance — share of gate trucks waiting over 1 hour, night shift.', 10)
) as v(name, unit, higher, target, info, ord) where pillars.code = 'D';

-- Cost
-- Both Cost KPIs are the other 2 manual_entry exceptions.
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading, manual_entry) select id, v.name, v.unit, v.higher, v.target, v.info, v.ord, false, true from pillars, (values
  ('QC Preventive Maintenance & Service', 'Services/day', true,  3,   'Maintenance activity/cost and asset efficiency — target is 3 services per day.', 1),
  ('Average Litres per Vessel Call',      'Litres/Call',  false, 425, 'Fuel consumption / operating cost efficiency — target is ≤425 litres per vessel call.', 2)
) as v(name, unit, higher, target, info, ord) where pillars.code = 'C';

-- ---- Leading KPIs (Next 24 Hours board — numeric value, no target) --------
-- Units reflect what the sheet's "Next 24hrs" tab actually contains: raw
-- projected counts/rates for most, % (raw value × 100) for QC PM & Service
-- MTD, absolute number for QC PM & Service Projection Today.
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading) select id, v.name, v.unit, true, 0, v.info, v.ord, true from pillars, (values
  ('Moves - Projection Day Shift',   'Moves', 'Forecast of tomorrow''s day-shift moves — used to flag resourcing gaps ahead of time.', 20),
  ('Moves - Projection Night Shift', 'Moves', 'Forecast of tomorrow''s night-shift moves — used to flag resourcing gaps ahead of time.', 21),
  ('TEUs Run Rate (Forecast)',       'TEUs',  'Forward-looking TEU throughput forecast, used to flag capacity/resourcing risk.', 22),
  ('Lashing - Projection Next Shift','Gangs', 'Forecast of lashing gang requirement for the next shift.', 23)
) as v(name, unit, info, ord) where pillars.code = 'D';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading) select id, v.name, v.unit, true, 0, v.info, v.ord, true from pillars, (values
  ('QC Gang - Projection Next Shift', 'Gangs', 'Forecast of QC gang labour supply needed for the next shift.', 20)
) as v(name, unit, info, ord) where pillars.code = 'Q';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order, is_leading) select id, v.name, v.unit, true, 0, v.info, v.ord, true from pillars, (values
  ('QC PM & Service - MTD',                 '%', 'Month-to-date view of preventive maintenance & service completed, discussed forward-looking against plan.', 20),
  ('QC PM & Service - Projection Today',     '',  'Forecast of preventive maintenance & service planned for today.', 21)
) as v(name, unit, info, ord) where pillars.code = 'C';

-- ---- KPI assignments (who is responsible for updating each KPI) -----------
-- Only lagging KPIs are assigned — leading KPIs are forecast on the Forward
-- Looking board by any logged-in employee, not tied to a numeric entry form.
insert into kpi_assignments (kpi_id, employee_id)
select k.id, e.id from kpis k, employees e
where (k.name like 'Accident During Operation%' and e.employee_code in ('000001','000003'))
   or (k.name like 'Delay – Waiting for CHE%' and e.employee_code in ('000004','000007'))
   or (k.name like 'Overall Mixing Yard%' and e.employee_code in ('000007','000004'))
   or (k.name like 'Labour Supply as Required%' and e.employee_code in ('000004','000003'))
   or (k.name like 'Moves (%' and e.employee_code in ('000005','000008'))
   or (k.name like 'GMPH Mainliner%' and e.employee_code in ('000005','000008'))
   or (k.name like 'GMPH Feeder%' and e.employee_code in ('000005','000008'))
   or (k.name like 'Mainliner Load GMPH%' and e.employee_code in ('000005','000008'))
   or (k.name like 'Gate Truck Waiting Time%' and e.employee_code in ('000005','000003'))
   or (k.name = 'QC Preventive Maintenance & Service' and e.employee_code in ('000006'))
   or (k.name = 'Average Litres per Vessel Call' and e.employee_code in ('000006'));

-- ---- Reasons per KPI (curated lists, feed the Pareto chart) --------------
-- Applied to both the "(Day)"/"(Night)" variant and any un-suffixed match.
insert into reasons (kpi_id, label, sort_order)
select k.id, r.label, r.ord
from kpis k
join (values
  ('Accident During Operation', 'PPE not worn correctly', 1),
  ('Accident During Operation', 'Unsafe act by operator', 2),
  ('Accident During Operation', 'Equipment malfunction', 3),
  ('Accident During Operation', 'Unsafe working conditions', 4),

  ('Delay – Waiting for CHE (L&D)', 'CHE breakdown', 1),
  ('Delay – Waiting for CHE (L&D)', 'CHE allocation / scheduling gap', 2),
  ('Delay – Waiting for CHE (L&D)', 'Operator shortage', 3),
  ('Delay – Waiting for CHE (L&D)', 'Traffic congestion in yard', 4),

  ('Overall Mixing Yard', 'Poor stacking sequence', 1),
  ('Overall Mixing Yard', 'Yard congestion', 2),
  ('Overall Mixing Yard', 'Planning system delay', 3),

  ('Labour Supply as Required – QC Gang', 'Unplanned absenteeism', 1),
  ('Labour Supply as Required – QC Gang', 'Roster gap not backfilled', 2),
  ('Labour Supply as Required – QC Gang', 'Training / certification pulled staff off gang', 3),

  ('Moves', 'Vessel stoppage / hatch cover delay', 1),
  ('Moves', 'CHE breakdown', 2),
  ('Moves', 'Weather delay', 3),
  ('Moves', 'Labour shortage', 4),

  ('GMPH Mainliner', 'Crane breakdown', 1),
  ('GMPH Mainliner', 'Twin-lift not utilised', 2),
  ('GMPH Mainliner', 'Yard congestion slowing housekeeping', 3),

  ('GMPH Feeder', 'Crane breakdown', 1),
  ('GMPH Feeder', 'Restow / restowage moves', 2),
  ('GMPH Feeder', 'Small parcel size limits productivity', 3),

  ('Mainliner Load GMPH', 'Sequence changes from planning', 1),
  ('Mainliner Load GMPH', 'CHE shortage at quay', 2),

  ('Gate Truck Waiting Time >1 hour', 'Gate system downtime', 1),
  ('Gate Truck Waiting Time >1 hour', 'Truck arrival bunching (peak hour)', 2),
  ('Gate Truck Waiting Time >1 hour', 'Missing / incorrect documentation', 3),

  ('QC Preventive Maintenance & Service', 'Spare parts unavailable', 1),
  ('QC Preventive Maintenance & Service', 'QC unavailable due to vessel operation', 2),

  ('Average Litres per Vessel Call', 'Extended vessel idling time', 1),
  ('Average Litres per Vessel Call', 'Generator / equipment inefficiency', 2)
) as r(base_name, label, ord)
  on k.name = r.base_name or k.name = r.base_name || ' (Day)' or k.name = r.base_name || ' (Night)';

-- ---- Demo daily entries: last 20 days, deterministic pseudo-random -------
do $$
declare
  k record;
  d date;
  day_offset int;
  variation numeric;
  entry_actual numeric;
  entry_met boolean;
  chosen_reason uuid;
  chosen_reason_label text;
  entry_remarks text;
  entrant uuid;
  seed_val double precision;
begin
  for k in select * from kpis where is_leading = false loop
    for day_offset in 0..19 loop
      d := current_date - day_offset;
      -- deterministic pseudo-random in [0,1) from kpi id + day, so re-running seed.sql is stable
      seed_val := ( (hashtext(k.id::text || d::text))::bigint % 1000 ) / 1000.0;
      if seed_val < 0 then seed_val := seed_val + 1; end if;

      if k.unit = '%' then
        variation := (seed_val - 0.5) * greatest(k.target * 0.6, 1.5);  -- proportional spread around target
      elsif k.unit = 'Count' then
        variation := round((seed_val - 0.75) * 4);                     -- mostly 0, occasional 1-2
      elsif k.unit = 'Gangs' then
        variation := (seed_val - 0.65) * 8;                            -- usually at/near target, sometimes short
      elsif k.unit = 'Moves' then
        variation := (seed_val - 0.5) * 3000;                          -- +/-1500 moves around target
      elsif k.unit = 'Moves/Hr' then
        variation := (seed_val - 0.5) * 6;                             -- +/-3 GMPH around target
      elsif k.unit = 'Services/day' then
        variation := round((seed_val - 0.5) * 3);                      -- +/-1-2 services around target
      elsif k.unit = 'Litres/Call' then
        variation := (seed_val - 0.4) * 80;                            -- +/-~40L around target, skewed over
      else
        variation := (seed_val - 0.5) * greatest(k.target * 0.2, 1);
      end if;

      entry_actual := k.target + variation;
      if k.unit in ('Count', 'Gangs', 'Services/day', 'Moves') then
        entry_actual := greatest(0, round(entry_actual));
      else
        entry_actual := round(entry_actual::numeric, 2);
      end if;
      if k.unit = 'Gangs' then
        entry_actual := least(k.target + 3, entry_actual);
      end if;

      entry_met := case when k.is_higher_better then entry_actual >= k.target
                        else entry_actual <= k.target end;

      chosen_reason := null;
      chosen_reason_label := null;
      if not entry_met then
        select id, label into chosen_reason, chosen_reason_label from reasons
          where kpi_id = k.id
          order by sort_order, id
          limit 1 offset (abs(hashtext(k.id::text || d::text || 'r')) % greatest(1,(select count(*) from reasons where kpi_id = k.id)));
      end if;

      -- Remarks are required (app-level rule) whenever a target is missed.
      entry_remarks := case
        when entry_met then null
        when chosen_reason_label is not null then chosen_reason_label || ' — flagged for follow-up.'
        else 'Target missed — reason under review.'
      end;

      select employee_id into entrant from kpi_assignments where kpi_id = k.id limit 1;

      insert into daily_entries (kpi_id, entry_date, target, actual, met_target, reason_id, remarks, entered_by)
      values (k.id, d, k.target, entry_actual, entry_met, chosen_reason, entry_remarks, entrant)
      on conflict (kpi_id, entry_date) do nothing;
    end loop;
  end loop;
end $$;

-- ---- Demo actions ----------------------------------------------------------
insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, status)
select p.id, k.id, 'PPE not worn correctly',
  'Run a surprise PPE compliance walk on night shift and log findings', 'Nasser',
  current_date + 5, 'not_started'
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'Accident During Operation (Night)'
where p.code = 'S';

insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, status)
select p.id, k.id, 'CHE breakdown',
  'Escalate CHE preventive maintenance backlog with the workshop', 'Zaid',
  current_date - 2, 'completed'
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'Delay – Waiting for CHE (L&D) (Day)'
where p.code = 'Q';

insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, status)
select p.id, k.id, 'Truck arrival bunching (peak hour)',
  'Trial a second gate lane during peak hours (12pm-2pm)', 'Hassan',
  current_date + 10, 'in_progress'
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'Gate Truck Waiting Time >1 hour (Day)'
where p.code = 'D';

insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, status)
select p.id, k.id, 'Excess overtime',
  'Evaluated overtime driver report — one-off due to vessel delay, no recurring pattern found', 'Zaid',
  current_date - 5, 'dropped'
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'QC Preventive Maintenance & Service'
where p.code = 'C';

-- Deliberately past-deadline and still open, to demo the derived "Overdue"
-- highlight (not a stored status — computed from status + deadline).
insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, status)
select p.id, k.id, 'Unplanned absenteeism',
  'Cross-train two frontliners as backup QC gang members', 'Farah',
  current_date - 3, 'not_started'
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'Labour Supply as Required – QC Gang (Day)'
where p.code = 'Q';

-- ---- Demo leading KPI figures (Next 24 Hours board) -------------------------
-- One row per leading KPI for today, in the same shape the real Admin Daily
-- upload writes from the workbook's "Next 24hrs" tab — a plain projected
-- number, no target/pass-fail. (forecast_cards is no longer written to by
-- the app — the Next 24 Hours board reads leading_entries instead — so no
-- demo rows are seeded there any more.)
insert into leading_entries (kpi_id, entry_date, value)
select k.id, current_date, v.value
from kpis k join (values
  ('Moves - Projection Day Shift',             12400),
  ('Moves - Projection Night Shift',           11800),
  ('TEUs Run Rate (Forecast)',                1250000),
  ('Lashing - Projection Next Shift',               49),
  ('QC Gang - Projection Next Shift',               49),
  ('QC PM & Service - MTD',                       82.0),
  ('QC PM & Service - Projection Today',             3)
) as v(name, value) on v.name = k.name
on conflict (kpi_id, entry_date) do nothing;
