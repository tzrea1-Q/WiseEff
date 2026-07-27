-- Batch 1 of DTS node enablement (ADR-0003):
-- 1) Dismiss open spec-review tasks for structural DTS keys (status, compatible, …).
-- 2) Deprecate parameter specs that describe the `status` property.
-- Rows are retained for audit continuity; nothing is deleted.

-- ---------------------------------------------------------------------------
-- 1. Dismiss structural-key review tasks
-- ---------------------------------------------------------------------------

update parameter_spec_review_tasks
set
  status = 'dismissed',
  reason = 'systemic:structural-property-not-a-parameter',
  resolved_at = coalesce(resolved_at, now()),
  source_evidence = coalesce(source_evidence, '{}'::jsonb) || jsonb_build_object(
    'systemicDismiss',
    jsonb_build_object(
      'code', 'structural_property_not_a_parameter',
      'migration', '0068',
      'adr', '0003'
    )
  )
where status = 'open'
  and (
    lower(coalesce(source_evidence->>'propertyKey', '')) in (
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
    )
    or coalesce(source_evidence->>'propertyKey', '') like '#%'
  );

-- ---------------------------------------------------------------------------
-- 2. Deprecate status property specs (and linked driver-schema versions)
-- ---------------------------------------------------------------------------

update parameter_spec_versions psv
set lifecycle = 'deprecated'
from dts_property_specs dps
where dps.parameter_spec_id = psv.parameter_spec_id
  and lower(dps.property_key) = 'status'
  and psv.lifecycle <> 'deprecated';

update driver_schema_versions dsv
set lifecycle = 'deprecated'
from dts_property_specs dps
where dps.driver_schema_id = dsv.driver_schema_id
  and lower(dps.property_key) = 'status'
  and dsv.lifecycle <> 'deprecated';
