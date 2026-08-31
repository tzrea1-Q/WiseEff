-- Deterministic, non-production PostgreSQL graph for Wayfinder Issue #671.
-- All identifiers and values are synthetic. No source database row is copied.
-- The importer supplies the surrounding transaction so this file and the
-- verification script either commit together or leave no fixture rows.
set local session_replication_role = replica;

insert into organizations (id, name, created_at) values
  ('wf671-org', 'Wayfinder 671 Synthetic Organization', '2026-01-01T00:00:00Z');

insert into projects (
  id, organization_id, name, code, status, created_at, updated_at, initialization_status
) values (
  'wf671-project', 'wf671-org', 'Wayfinder 671 Synthetic Project',
  'WF671-SYNTHETIC', 'initialized', '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z', 'initialized'
);

insert into dts_config_set (
  id, organization_id, project_id, name, description, created_at, updated_at
) values (
  'wf671-config-set', 'wf671-org', 'wf671-project',
  'Wayfinder 671 synthetic DTS set', 'Synthetic fixture only',
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
);

insert into dts_config_revisions (
  id, organization_id, project_id, config_set_id, revision_number, status,
  created_at, resolved_at, entry_file, include_search_paths, overlay_order,
  manifest_state
) values (
  'wf671-config-revision', 'wf671-org', 'wf671-project', 'wf671-config-set',
  1, 'validated', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
  'synthetic-fixture.dts', '["synthetic/include"]'::jsonb, '[]'::jsonb,
  'complete'
);

insert into attribution_subjects (
  id, organization_id, subject_kind, display_name, origin, source_key,
  created_at, updated_at
) values
  (
    'wf671-platform-driver-subject', null, 'driver-registration',
    'Wayfinder 671 Platform Driver', 'curated', 'wf671-platform-driver',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-platform-node-subject', null, 'node-type-definition',
    'Wayfinder 671 Platform NodeType', 'curated', 'wf671-platform-node-type',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-org-node-subject', 'wf671-org', 'node-type-definition',
    'Wayfinder 671 Organization NodeType', 'curated', 'wf671-org-node-type',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
  );

insert into driver_registrations (
  attribution_subject_id, driver_nature, instance_cardinality, notes
) values (
  'wf671-platform-driver-subject', 'physical-device', 'multiple',
  'Synthetic fixture only'
);

insert into node_type_definitions (attribution_subject_id, bare_node_name) values
  ('wf671-platform-node-subject', 'wf671-platform-node'),
  ('wf671-org-node-subject', 'wf671-organization-node');

insert into parameter_specs (
  id, organization_id, source_kind, specification_key, created_at,
  semantic_module, risk, attribution_subject_id, definition_lifecycle,
  property_key
) values
  (
    'wf671-driver-root-spec', null, 'dts', 'wf671.platform.driver.root',
    '2026-01-01T00:00:00Z', 'synthetic.driver', 'Low',
    'wf671-platform-driver-subject', 'active', null
  ),
  (
    'wf671-node-root-spec', null, 'dts', 'wf671.platform.node.root',
    '2026-01-01T00:00:00Z', 'synthetic.node', 'Low',
    'wf671-platform-node-subject', 'active', null
  ),
  (
    'wf671-platform-driver-definition', null, 'dts',
    'wf671.platform.driver.property', '2026-01-01T00:00:00Z',
    'synthetic.driver', 'Low', 'wf671-platform-driver-subject', 'active',
    'wf671,driver-property'
  ),
  (
    'wf671-platform-node-definition', null, 'dts',
    'wf671.platform.node.property', '2026-01-01T00:00:00Z',
    'synthetic.node', 'Low', 'wf671-platform-node-subject', 'active',
    'wf671,node-property'
  ),
  (
    'wf671-platform-subjectless-draft', null, 'dts',
    'wf671.platform.subjectless.draft', '2026-01-01T00:00:00Z',
    'synthetic.unlinked', 'Low', null, 'draft', 'synthetic.legacy-twin'
  ),
  (
    'wf671-org-manual-node-draft', 'wf671-org', 'manual',
    'wf671.organization.manual.node.draft', '2026-01-01T00:00:00Z',
    'synthetic.node', 'Low', 'wf671-org-node-subject', 'draft',
    'synthetic.legacy-twin'
  );

insert into parameter_spec_versions (
  id, parameter_spec_id, version, display_name, description, value_shape,
  schema_default, example_value, lifecycle, created_at, version_status,
  activated_at, units, constraints, documentation, reference_rules
) values
  (
    'wf671-driver-root-version', 'wf671-driver-root-spec', 1,
    'Synthetic Driver Root', 'Synthetic fixture schema root',
    '{"type":"object"}'::jsonb, null, null, 'active',
    '2026-01-01T00:00:00Z', 'active', '2026-01-01T00:00:00Z', null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  ),
  (
    'wf671-node-root-version', 'wf671-node-root-spec', 1,
    'Synthetic NodeType Root', 'Synthetic fixture schema root',
    '{"type":"object"}'::jsonb, null, null, 'active',
    '2026-01-01T00:00:00Z', 'active', '2026-01-01T00:00:00Z', null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  ),
  (
    'wf671-platform-driver-version', 'wf671-platform-driver-definition', 1,
    'Synthetic Platform Driver Property', 'Synthetic active definition',
    '{"type":"string"}'::jsonb, null, null, 'active',
    '2026-01-01T00:00:00Z', 'active', '2026-01-01T00:00:00Z', null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  ),
  (
    'wf671-platform-node-version', 'wf671-platform-node-definition', 1,
    'Synthetic Platform NodeType Property', 'Synthetic active definition',
    '{"type":"string"}'::jsonb, null, null, 'active',
    '2026-01-01T00:00:00Z', 'active', '2026-01-01T00:00:00Z', null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  ),
  (
    'wf671-platform-subjectless-version', 'wf671-platform-subjectless-draft', 1,
    'Synthetic Subjectless Draft', 'Synthetic draft definition',
    '{"type":"string"}'::jsonb, null, null, 'draft',
    '2026-01-01T00:00:00Z', 'draft', null, null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  ),
  (
    'wf671-org-manual-node-version', 'wf671-org-manual-node-draft', 1,
    'Synthetic Organization Manual Draft', 'Synthetic draft definition',
    '{"type":"string"}'::jsonb, null, null, 'draft',
    '2026-01-01T00:00:00Z', 'draft', null, null,
    '{}'::jsonb, 'Synthetic fixture only', '{}'::jsonb
  );

insert into driver_schemas (
  id, parameter_spec_id, organization_id, schema_namespace, created_at,
  attribution_subject_id
) values
  (
    'wf671-driver-schema', 'wf671-driver-root-spec', null,
    'wf671.synthetic.driver', '2026-01-01T00:00:00Z',
    'wf671-platform-driver-subject'
  ),
  (
    'wf671-node-schema', 'wf671-node-root-spec', null,
    'wf671.synthetic.node', '2026-01-01T00:00:00Z',
    'wf671-platform-node-subject'
  );

insert into driver_schema_versions (
  id, driver_schema_id, parameter_spec_version_id, version,
  compatible_patterns, parent_bus_constraints, source, lifecycle, created_at
) values
  (
    'wf671-driver-schema-version', 'wf671-driver-schema',
    'wf671-driver-root-version', 1, '["wayfinder,synthetic-driver"]'::jsonb,
    '{}'::jsonb, 'manual', 'active', '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-node-schema-version', 'wf671-node-schema',
    'wf671-node-root-version', 1, '["wayfinder,synthetic-node"]'::jsonb,
    '{}'::jsonb, 'manual', 'active', '2026-01-01T00:00:00Z'
  );

insert into dts_property_specs (
  id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
  units, constraints, reference_rules, documentation, created_at
) values
  (
    'wf671-driver-property', 'wf671-platform-driver-definition',
    'wf671-driver-schema', 'wf671,driver-property', 'wf671.synthetic.driver',
    null, '{}'::jsonb, '{}'::jsonb, 'Synthetic fixture only',
    '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-node-property', 'wf671-platform-node-definition',
    'wf671-node-schema', 'wf671,node-property', 'wf671.synthetic.node',
    null, '{}'::jsonb, '{}'::jsonb, 'Synthetic fixture only',
    '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-subjectless-property', 'wf671-platform-subjectless-draft', null,
    'synthetic.legacy-twin', 'wf671.synthetic.unlinked', null,
    '{}'::jsonb, '{}'::jsonb, 'Synthetic fixture only',
    '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-org-property', 'wf671-org-manual-node-draft', null,
    'synthetic.legacy-twin', 'wf671.synthetic.organization', null,
    '{}'::jsonb, '{}'::jsonb, 'Synthetic fixture only',
    '2026-01-01T00:00:00Z'
  );

insert into parameter_modules (
  id, organization_id, parent_id, name, path, depth, sort_order, description,
  scope, created_at, updated_at, importance, kind, origin, source_key,
  attribution_subject_id
) values
  (
    'wf671-business-module', 'wf671-org', null, 'Synthetic Business Category',
    'wf671-business', 1, 10, 'Synthetic fixture only', 'organization',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'medium', 'business',
    'curated', 'wf671-business', null
  ),
  (
    'wf671-driver-module', 'wf671-org', null, 'Synthetic Driver Group',
    'wf671-driver', 1, 20, 'Synthetic fixture only', 'organization',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'high', 'driver-group',
    'curated', 'wf671-driver-module', 'wf671-platform-driver-subject'
  ),
  (
    'wf671-org-node-module', 'wf671-org', null, 'Synthetic Organization NodeType',
    'wf671-org-node', 1, 30, 'Synthetic fixture only', 'organization',
    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'medium', 'node-type',
    'curated', 'wf671-org-node-module', 'wf671-org-node-subject'
  );

insert into parameter_module_mappings (
  id, organization_id, parameter_module_id, match_kind, match_value, priority,
  created_at
) values
  (
    'wf671-driver-mapping', 'wf671-org', 'wf671-driver-module', 'compatible',
    'wayfinder,synthetic-driver', 10, '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-node-mapping', 'wf671-org', 'wf671-org-node-module', 'node-type',
    'wf671-organization-node', 10, '2026-01-01T00:00:00Z'
  );

update driver_registrations
set default_business_category_module_id = 'wf671-business-module'
where attribution_subject_id = 'wf671-platform-driver-subject';

insert into driver_registration_placements (
  id, organization_id, attribution_subject_id, driver_group_module_id,
  default_business_category_module_id, created_at, updated_at
) values (
  'wf671-driver-placement', 'wf671-org', 'wf671-platform-driver-subject',
  'wf671-driver-module', 'wf671-business-module', '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

insert into dts_logical_nodes (
  id, organization_id, project_id, config_set_id, created_at
) values (
  'wf671-logical-node', 'wf671-org', 'wf671-project', 'wf671-config-set',
  '2026-01-01T00:00:00Z'
);

insert into project_parameter_bindings (
  id, organization_id, project_id, logical_node_id, parameter_spec_id,
  created_at, module_id
) values
  (
    'wf671-driver-binding', 'wf671-org', 'wf671-project',
    'wf671-logical-node', 'wf671-platform-driver-definition',
    '2026-01-01T00:00:00Z', 'wf671-driver-module'
  ),
  (
    'wf671-mismatch-binding', 'wf671-org', 'wf671-project',
    'wf671-logical-node', 'wf671-platform-node-definition',
    '2026-01-01T00:00:00Z', 'wf671-org-node-module'
  ),
  (
    'wf671-inactive-binding', 'wf671-org', 'wf671-project',
    'wf671-logical-node', 'wf671-org-manual-node-draft',
    '2026-01-01T00:00:00Z', 'wf671-org-node-module'
  );

insert into project_parameter_binding_revisions (
  id, binding_id, config_revision_id, parameter_spec_version_id, typed_value,
  canonical_value, raw_value, schema_state, policy_state, created_at
) values
  (
    'wf671-driver-binding-revision', 'wf671-driver-binding',
    'wf671-config-revision', 'wf671-platform-driver-version',
    '{"synthetic":"placeholder"}'::jsonb,
    '{"synthetic":"placeholder"}'::jsonb, 'synthetic-placeholder',
    'synthetic', 'synthetic', '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-mismatch-binding-revision', 'wf671-mismatch-binding',
    'wf671-config-revision', 'wf671-platform-node-version',
    '{"synthetic":"placeholder"}'::jsonb,
    '{"synthetic":"placeholder"}'::jsonb, 'synthetic-placeholder',
    'synthetic', 'synthetic', '2026-01-01T00:00:00Z'
  ),
  (
    'wf671-inactive-binding-revision', 'wf671-inactive-binding',
    'wf671-config-revision', 'wf671-org-manual-node-version',
    '{"synthetic":"placeholder"}'::jsonb,
    '{"synthetic":"placeholder"}'::jsonb, 'synthetic-placeholder',
    'synthetic', 'synthetic', '2026-01-01T00:00:00Z'
  );

insert into wayfinder_rehearsal.fixture_cases (
  case_name, relation_family, expected_rows
) values
  ('formal-platform-driver-definition', 'definition', 1),
  ('formal-platform-node-type-definition', 'definition', 1),
  ('platform-subjectless-dts-draft', 'definition', 1),
  ('organization-manual-node-type-draft', 'definition', 1),
  ('driver-schema-root', 'schema', 2),
  ('organization-registration-placement', 'topology', 1),
  ('binding-module-identity-mismatch', 'binding-anomaly', 1),
  ('inactive-definition-binding', 'binding-anomaly', 1),
  ('pinned-binding-revision', 'binding-revision', 3),
  ('legacy-twin-r6-r8', 'migration-identity-hazard', 2);
