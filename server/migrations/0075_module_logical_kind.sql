-- ADR-0006: add `logical` module kind for DTS nodes without compatible evidence.
-- Constraint-only — no bulk backfill. Kind is asserted at ingest (C taxonomy) or
-- corrected manually; SQL cannot distinguish logical config nodes from hardware
-- nodes that simply lack a compatible string on their latest revision.

alter table parameter_modules
  drop constraint if exists parameter_modules_kind_check;

alter table parameter_modules
  add constraint parameter_modules_kind_check
  check (kind in ('business', 'driver-group', 'instance', 'logical', 'unclassified'));
