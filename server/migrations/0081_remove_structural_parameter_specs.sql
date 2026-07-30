-- Close ADR-0003's historical cleanup gap.
-- Structural DTS properties describe topology / node enablement, never parameters.
-- Migration 0068 soft-deprecated `status`; this migration removes the complete
-- structural cohort and prevents it from re-entering dts_property_specs.
-- Fail-closed: any remaining workflow/audit/history reference aborts the
-- migration with a typed count report so operators can archive or re-point
-- rows before retrying. Audit facts are never cascade-deleted here.

create temp table structural_parameter_specs (
  id text primary key
) on commit drop;

insert into structural_parameter_specs (id)
select distinct dps.parameter_spec_id
from dts_property_specs dps
where lower(trim(dps.property_key)) = any (array[
  'compatible',
  'device_type',
  'gpio-controller',
  'interrupt-controller',
  'linux,phandle',
  'phandle',
  'ranges',
  'reg',
  'status',
  '#address-cells',
  '#gpio-cells',
  '#interrupt-cells',
  '#size-cells'
])
or trim(dps.property_key) like '#%';

do $$
declare
  drafts_count integer;
  change_requests_count integer;
  submission_items_count integer;
  history_via_binding_count integer;
  history_via_spec_count integer;
  debugging_via_binding_count integer;
  debugging_via_spec_count integer;
  node_ops_via_binding_count integer;
  node_ops_via_spec_count integer;
  sync_conflicts_via_binding_count integer;
  sync_conflicts_via_spec_count integer;
  legacy_evidence_count integer;
  occurrence_decisions_count integer;
  total_count integer;
begin
  select count(*)::integer into drafts_count
  from parameter_drafts d
  where d.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into change_requests_count
  from parameter_change_requests r
  where r.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  )
  or r.parameter_spec_id in (select id from structural_parameter_specs);

  select count(*)::integer into submission_items_count
  from parameter_submission_items i
  where i.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into history_via_binding_count
  from parameter_history_entries h
  where h.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into history_via_spec_count
  from parameter_history_entries h
  where h.parameter_spec_id in (select id from structural_parameter_specs);

  select count(*)::integer into debugging_via_binding_count
  from debugging_parameters d
  where d.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into debugging_via_spec_count
  from debugging_parameters d
  where d.parameter_spec_id in (select id from structural_parameter_specs);

  select count(*)::integer into node_ops_via_binding_count
  from node_operations o
  where o.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into node_ops_via_spec_count
  from node_operations o
  where o.parameter_spec_id in (select id from structural_parameter_specs);

  select count(*)::integer into sync_conflicts_via_binding_count
  from parameter_file_sync_conflicts c
  where c.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into sync_conflicts_via_spec_count
  from parameter_file_sync_conflicts c
  where c.parameter_spec_id in (select id from structural_parameter_specs);

  select count(*)::integer into legacy_evidence_count
  from legacy_parameter_migration_evidence e
  where e.project_parameter_binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  )
  or e.parameter_spec_id in (select id from structural_parameter_specs)
  or e.parameter_spec_version_id in (
    select psv.id from parameter_spec_versions psv
    where psv.parameter_spec_id in (select id from structural_parameter_specs)
  );

  select count(*)::integer into occurrence_decisions_count
  from dts_property_occurrence_spec_decisions d
  where d.binding_id in (
    select b.id from project_parameter_bindings b
    where b.parameter_spec_id in (select id from structural_parameter_specs)
  )
  or d.parameter_spec_id in (select id from structural_parameter_specs);

  total_count :=
    drafts_count
    + change_requests_count
    + submission_items_count
    + history_via_binding_count
    + history_via_spec_count
    + debugging_via_binding_count
    + debugging_via_spec_count
    + node_ops_via_binding_count
    + node_ops_via_spec_count
    + sync_conflicts_via_binding_count
    + sync_conflicts_via_spec_count
    + legacy_evidence_count
    + occurrence_decisions_count;

  if total_count > 0 then
    raise exception
      '0081_remove_structural_parameter_specs: refuse destructive cleanup; total=% drafts=% change_requests=% submission_items=% history_binding=% history_spec=% debugging_binding=% debugging_spec=% node_ops_binding=% node_ops_spec=% sync_binding=% sync_spec=% legacy_evidence=% occurrence_decisions=%',
      total_count,
      drafts_count,
      change_requests_count,
      submission_items_count,
      history_via_binding_count,
      history_via_spec_count,
      debugging_via_binding_count,
      debugging_via_spec_count,
      node_ops_via_binding_count,
      node_ops_via_spec_count,
      sync_conflicts_via_binding_count,
      sync_conflicts_via_spec_count,
      legacy_evidence_count,
      occurrence_decisions_count;
  end if;
end;
$$;

delete from driver_schema_overlay_properties
where parameter_spec_id in (select id from structural_parameter_specs);

delete from parameter_policy_targets
where parameter_spec_id in (select id from structural_parameter_specs);

delete from parameter_spec_matcher_overrides
where parameter_spec_id in (select id from structural_parameter_specs);

delete from dts_property_occurrence_spec_decisions
where parameter_spec_id in (select id from structural_parameter_specs);

delete from parameter_spec_review_tasks
where parameter_spec_id in (select id from structural_parameter_specs);

delete from project_parameter_bindings
where parameter_spec_id in (select id from structural_parameter_specs);

delete from driver_schema_versions
where parameter_spec_version_id in (
  select psv.id
  from parameter_spec_versions psv
  where psv.parameter_spec_id in (select id from structural_parameter_specs)
);

delete from dts_property_specs
where parameter_spec_id in (select id from structural_parameter_specs);

delete from driver_schemas
where parameter_spec_id in (select id from structural_parameter_specs);

delete from parameter_spec_versions
where parameter_spec_id in (select id from structural_parameter_specs);

delete from parameter_specs
where id in (select id from structural_parameter_specs);

alter table dts_property_specs
  drop constraint if exists dts_property_specs_non_structural_key_check;

alter table dts_property_specs
  add constraint dts_property_specs_non_structural_key_check
  check (
    lower(trim(property_key)) <> all (array[
      'compatible',
      'device_type',
      'gpio-controller',
      'interrupt-controller',
      'linux,phandle',
      'phandle',
      'ranges',
      'reg',
      'status',
      '#address-cells',
      '#gpio-cells',
      '#interrupt-cells',
      '#size-cells'
    ])
    and trim(property_key) not like '#%'
  );
