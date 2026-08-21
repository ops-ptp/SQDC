-- ============================================================================
-- SQDC Board MVP — seed data
-- ============================================================================
-- Run AFTER schema.sql. Loads: 4 pillars, ~8 example KPIs (from your
-- template: LTI, TTT, etc.), sample employees, curated reason lists, ~20
-- days of demo daily entries (with a realistic miss rate) and a couple of
-- demo actions — so the app is fully demoable end to end immediately.
--
-- Safe to re-run: it clears its own seed rows first (by known codes/names)
-- rather than truncating your whole database.
-- ============================================================================

-- ---- Clean slate for demo tables (order matters for FKs) -------------------
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
insert into employees (employee_code, name, role) values
  ('E001', 'Nasser',   'Frontliner'),
  ('E002', 'Noura',    'Frontliner'),
  ('E003', 'Aiman',    'Shift Supervisor'),
  ('E004', 'Farah',    'Quality Lead'),
  ('E005', 'Hassan',   'Delivery Lead'),
  ('E006', 'Zaid',     'Cost Controller'),
  ('E007', 'Iris',     'Frontliner'),
  ('E008', 'Marcus',   'Frontliner');

-- ---- KPIs -----------------------------------------------------------------
-- Safety
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'LTI (Lost Time Injury)', 'Count', false, 0,
  'Marker for a safe working environment. An incident counts as LTI if the person involved, after treatment, cannot immediately resume work.', 1
from pillars where code = 'S';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'Near Misses Reported', 'Count', true, 5,
  'Number of near-miss incidents proactively reported by staff. Higher reporting means a healthier safety culture, not more incidents.', 2
from pillars where code = 'S';

-- Quality
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'First Pass Yield', '%', true, 95,
  'Percentage of units that pass quality inspection on the first attempt, without rework.', 1
from pillars where code = 'Q';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'Customer Complaints', 'Count', false, 2,
  'Number of quality-related complaints received from customers this day.', 2
from pillars where code = 'Q';

-- Delivery
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'TTT (Truck Turnaround Time)', 'Minutes', false, 20,
  'Marker for how we service external truckers. Average time a trucker spends on the terminal, from entering till leaving the gate.', 1
from pillars where code = 'D';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'On-Time Delivery', '%', true, 98,
  'Percentage of shipments delivered within the promised time window.', 2
from pillars where code = 'D';

-- Cost
insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'Overtime Hours', 'Hours', false, 10,
  'Total overtime hours logged across the shift. Lower is better for cost control.', 1
from pillars where code = 'C';

insert into kpis (pillar_id, name, unit, is_higher_better, target, info, sort_order)
select id, 'Cost per Unit', '$', false, 12.5,
  'Average operating cost per unit handled/produced this day.', 2
from pillars where code = 'C';

-- ---- KPI assignments (who is responsible for updating each KPI) ----------
insert into kpi_assignments (kpi_id, employee_id)
select k.id, e.id from kpis k, employees e
where (k.name = 'LTI (Lost Time Injury)' and e.employee_code in ('E001','E003'))
   or (k.name = 'Near Misses Reported' and e.employee_code in ('E001','E007'))
   or (k.name = 'First Pass Yield' and e.employee_code in ('E004'))
   or (k.name = 'Customer Complaints' and e.employee_code in ('E004','E007'))
   or (k.name = 'TTT (Truck Turnaround Time)' and e.employee_code in ('E005','E008'))
   or (k.name = 'On-Time Delivery' and e.employee_code in ('E005'))
   or (k.name = 'Overtime Hours' and e.employee_code in ('E006'))
   or (k.name = 'Cost per Unit' and e.employee_code in ('E006','E003'));

-- ---- Reasons per KPI (curated lists, feed the Pareto chart) --------------
insert into reasons (kpi_id, label, sort_order)
select k.id, r.label, r.ord
from kpis k
join (values
  ('LTI (Lost Time Injury)', 'Did not wear PPE', 1),
  ('LTI (Lost Time Injury)', 'Not aware of safety standard', 2),
  ('LTI (Lost Time Injury)', 'Slips and trips on board of vessel', 3),
  ('LTI (Lost Time Injury)', 'Equipment malfunction', 4),

  ('Near Misses Reported', 'Staff forgot to log it', 1),
  ('Near Misses Reported', 'Reporting tool unavailable', 2),

  ('First Pass Yield', 'Machine calibration drift', 1),
  ('First Pass Yield', 'Raw material defect', 2),
  ('First Pass Yield', 'Operator error', 3),
  ('First Pass Yield', 'Incorrect work instruction', 4),

  ('Customer Complaints', 'Packaging damaged in transit', 1),
  ('Customer Complaints', 'Wrong item shipped', 2),
  ('Customer Complaints', 'Late delivery', 3),

  ('TTT (Truck Turnaround Time)', 'Congestion at exit of the gate', 1),
  ('TTT (Truck Turnaround Time)', 'Issues locating the right container to load', 2),
  ('TTT (Truck Turnaround Time)', 'Not enough straddle carriers available', 3),
  ('TTT (Truck Turnaround Time)', 'Gate system downtime', 4),

  ('On-Time Delivery', 'Traffic / route delay', 1),
  ('On-Time Delivery', 'Vehicle breakdown', 2),
  ('On-Time Delivery', 'Late dispatch from warehouse', 3),

  ('Overtime Hours', 'Understaffed shift', 1),
  ('Overtime Hours', 'Unplanned rush order', 2),
  ('Overtime Hours', 'Equipment downtime caused delay', 3),

  ('Cost per Unit', 'Higher raw material price', 1),
  ('Cost per Unit', 'Low production volume', 2),
  ('Cost per Unit', 'Excess overtime', 3)
) as r(kpi_name, label, ord) on r.kpi_name = k.name;

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
  entrant uuid;
  seed_val double precision;
begin
  for k in select * from kpis loop
    for day_offset in 0..19 loop
      d := current_date - day_offset;
      -- deterministic pseudo-random in [0,1) from kpi id + day, so re-running seed.sql is stable
      seed_val := ( (hashtext(k.id::text || d::text))::bigint % 1000 ) / 1000.0;
      if seed_val < 0 then seed_val := seed_val + 1; end if;

      if k.unit = '%' then
        variation := (seed_val - 0.5) * 10;          -- +/-5 pts around target
      elsif k.unit = 'Count' then
        variation := round((seed_val - 0.7) * 6);     -- mostly low counts, occasional spikes
      elsif k.unit = 'Minutes' then
        variation := (seed_val - 0.4) * 16;           -- +/-~8 min around target
      elsif k.unit = 'Hours' then
        variation := (seed_val - 0.4) * 8;
      else -- $ and anything else
        variation := (seed_val - 0.4) * 3;
      end if;

      entry_actual := k.target + variation;
      if k.unit in ('Count') then
        entry_actual := greatest(0, round(entry_actual));
      elsif k.unit = '%' then
        entry_actual := least(100, greatest(0, round(entry_actual::numeric, 2)));
      else
        entry_actual := round(entry_actual::numeric, 2);
      end if;

      entry_met := case when k.is_higher_better then entry_actual >= k.target
                        else entry_actual <= k.target end;

      chosen_reason := null;
      if not entry_met then
        select id into chosen_reason from reasons
          where kpi_id = k.id
          order by sort_order, id
          limit 1 offset (abs(hashtext(k.id::text || d::text || 'r')) % greatest(1,(select count(*) from reasons where kpi_id = k.id)));
      end if;

      select employee_id into entrant from kpi_assignments where kpi_id = k.id limit 1;

      insert into daily_entries (kpi_id, entry_date, target, actual, met_target, reason_id, entered_by)
      values (k.id, d, k.target, entry_actual, entry_met, chosen_reason, entrant)
      on conflict (kpi_id, entry_date) do nothing;
    end loop;
  end loop;
end $$;

-- ---- Demo actions ----------------------------------------------------------
insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, done)
select p.id, k.id, 'Slips and trips on board of vessel',
  'Do first night-time test with flashlight illumination attached to jacket', 'Nasser',
  current_date + 5, false
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'LTI (Lost Time Injury)'
where p.code = 'S';

insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, done)
select p.id, k.id, 'Slips and trips on board of vessel',
  'Order additional flashlights for night shift crew', 'Noura',
  current_date - 2, true
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'LTI (Lost Time Injury)'
where p.code = 'S';

insert into actions (pillar_id, kpi_id, related_issue, action, owner_name, deadline, done)
select p.id, k.id, 'Congestion at exit of the gate',
  'Trial a second exit lane during peak hours (12pm-2pm)', 'Hassan',
  current_date + 10, false
from pillars p join kpis k on k.pillar_id = p.id and k.name = 'TTT (Truck Turnaround Time)'
where p.code = 'D';
