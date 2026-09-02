-- Wayfinder #668 / Issue #689 (S2-RBAC): least-privilege Catalog roles and grants.
--
-- Grant manifest (database-local ACLs; roles themselves are cluster-global):
--   catalog_migration_owner (NOLOGIN)
--     owns parameter_catalog and every relation/function in it
--     SELECT on public FK targets needed for internal referential-integrity checks
--     SELECT on every public relation read by SECURITY DEFINER Catalog functions,
--       including resolve_legacy_identity_owner, so ownership transfer does not
--       42501 on public.parameter_specs and the rest of the source graph
--     UPDATE on public.parameter_modules so the SECURITY DEFINER placement
--       lock can SELECT ... FOR SHARE without writer table grants
--   catalog_synchronizer_role (NOLOGIN)
--     USAGE on parameter_catalog
--     SELECT, INSERT on immutable Catalog relations
--     SELECT, INSERT, UPDATE on catalog_command_idempotency
--     UPDATE (current_catalog_release_id) on catalog_state
--     UPDATE (current_revision_id) on parameter_definitions
--     EXECUTE only on CHECK identity predicates and
--       acquire_current_pointer_lock_exclusive()
--     no Binding / Cutover / Verification / Governance DML
--     no EXECUTE on assert_catalog_subject_active or trigger-only functions
--   parameter_governance_writer_role (NOLOGIN)
--     USAGE on parameter_catalog
--     necessary Organization-governance DML
--     INSERT (append-only) on public.audit_events
--     EXECUTE only on parameter_catalog.assert_catalog_subject_active(text,text,text,text)
--     no Catalog table SELECT or DML
--     no Binding / Cutover / Verification capability
--     no EXECUTE on CHECK predicates, exclusive lock, or trigger-only functions
--   PUBLIC remains revoked on the schema, tables, sequences, and functions
--   assert_subject_placement_kind and assert_observation_match_binding_revision
--     are SECURITY DEFINER so writer INSERTs can fire deferred guards without
--     Catalog / Binding table grants; writer roles are not granted EXECUTE
--
-- Privilege negatives (executed SQLSTATE 42501):
--   PCAT-DB-P01 / PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS
--     production roles fail Catalog SELECT/DML and cannot SET ROLE to
--     catalog_synchronizer_role or catalog_migration_owner
--   PCAT-DB-P02 / PCAT-PRIV-LEGACY-WRITER-BYPASS
--     production roles fail legacy structural writes on public parameter
--     tables; leftover SECURITY DEFINER functions are not executable writers

select pg_catalog.pg_advisory_lock(689013800138);

do $$
declare
  attempt integer;
  role_name text;
  role_comment text;
begin
  for attempt in 1..20 loop
    begin
      foreach role_name in array array[
        'catalog_migration_owner',
        'catalog_synchronizer_role',
        'parameter_governance_writer_role'
      ] loop
        if not exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
          execute format(
            'create role %I nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
            role_name
          );
        elsif exists (
          select 1
          from pg_catalog.pg_roles
          where rolname = role_name
            and (
              rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
              or rolinherit or rolreplication or rolbypassrls
            )
        ) then
          execute format(
            'alter role %I with nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls',
            role_name
          );
        end if;

        if pg_catalog.pg_has_role(current_user, role_name, 'member') then
          execute format('revoke %I from current_user', role_name);
        end if;
      end loop;

      foreach role_comment in array array[
        'catalog_migration_owner|NOLOGIN owner of parameter_catalog relations. Production logins cannot SET ROLE to this role.',
        'catalog_synchronizer_role|NOLOGIN Catalog synchronizer: insert immutable Catalog rows and column-limited head updates only.',
        'parameter_governance_writer_role|NOLOGIN Parameter Governance writer: governance DML, success-audit append, and execute-only current-release guard.'
      ] loop
        role_name := split_part(role_comment, '|', 1);
        if coalesce(shobj_description(to_regrole(role_name), 'pg_authid'), '')
             is distinct from split_part(role_comment, '|', 2) then
          execute format('comment on role %I is %L', role_name, split_part(role_comment, '|', 2));
        end if;
      end loop;

      exit;
    exception
      when duplicate_object then
        null;
      when others then
        if sqlerrm like '%tuple concurrently updated%' and attempt < 20 then
          perform pg_catalog.pg_sleep(0.05 * attempt);
        else
          raise;
        end if;
    end;
  end loop;
end;
$$;

alter schema parameter_catalog owner to catalog_migration_owner;

do $$
declare
  obj record;
begin
  for obj in
    select class.relkind, format('%I.%I', namespace.nspname, class.relname) as object_id
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'parameter_catalog'
      and class.relkind in ('r', 'p', 'S', 'v', 'm')
  loop
    if obj.relkind = 'S' then
      execute format('alter sequence %s owner to catalog_migration_owner', obj.object_id);
    else
      execute format('alter table %s owner to catalog_migration_owner', obj.object_id);
    end if;
  end loop;

  for obj in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    ) as object_id
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'parameter_catalog'
  loop
    execute format('alter function %s owner to catalog_migration_owner', obj.object_id);
  end loop;
end;
$$;

grant usage on schema public to catalog_migration_owner;
grant select on table
  public.attribution_subjects,
  public.audit_events,
  public.audit_subject_links,
  public.driver_registration_placements,
  public.driver_schema_overlay_promotions,
  public.driver_schema_overlay_properties,
  public.driver_schema_overlays,
  public.driver_schema_versions,
  public.driver_schemas,
  public.dts_config_revisions,
  public.dts_config_set,
  public.dts_logical_node_revisions,
  public.dts_logical_nodes,
  public.dts_node_occurrences,
  public.dts_occurrence_effects,
  public.dts_property_occurrence_spec_decisions,
  public.dts_property_occurrences,
  public.dts_property_specs,
  public.legacy_parameter_migration_evidence,
  public.organizations,
  public.parameter_change_requests,
  public.parameter_definition_reconciliation_items,
  public.parameter_definition_reconciliation_runs,
  public.parameter_definitions,
  public.parameter_drafts,
  public.parameter_file_sync_conflicts,
  public.parameter_history_entries,
  public.parameter_identity_cutovers,
  public.parameter_identity_migration_phases,
  public.parameter_identity_migration_runs,
  public.parameter_import_batches,
  public.parameter_module_dismissed_compatibles,
  public.parameter_module_mappings,
  public.parameter_modules,
  public.parameter_policy_targets,
  public.parameter_review_decisions,
  public.parameter_spec_matcher_overrides,
  public.parameter_spec_property_key_cutover_items,
  public.parameter_spec_property_key_cutover_runs,
  public.parameter_spec_review_tasks,
  public.parameter_spec_version_cutover_items,
  public.parameter_spec_version_cutover_runs,
  public.parameter_spec_versions,
  public.parameter_specs,
  public.parameter_submission_items,
  public.parameter_submission_rounds,
  public.project_parameter_binding_revisions,
  public.project_parameter_bindings,
  public.project_parameter_initialization_drafts,
  public.project_parameter_initialization_reviews,
  public.project_parameter_values,
  public.projects
to catalog_migration_owner;
grant update on table public.parameter_modules to catalog_migration_owner;

revoke all on schema parameter_catalog from public;
revoke all on all tables in schema parameter_catalog from public;
revoke all on all sequences in schema parameter_catalog from public;
revoke all on all functions in schema parameter_catalog from public;

do $$
declare
  fn_signature text;
begin
  for fn_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'parameter_catalog'
  loop
    execute format('revoke all on function %s from public', fn_signature);
    execute format('revoke all on function %s from catalog_synchronizer_role', fn_signature);
    execute format(
      'revoke all on function %s from parameter_governance_writer_role',
      fn_signature
    );
  end loop;
end;
$$;

grant usage on schema parameter_catalog to catalog_synchronizer_role;
grant usage on schema parameter_catalog to parameter_governance_writer_role;

grant select, insert on table
  parameter_catalog.catalog_releases,
  parameter_catalog.catalog_subjects,
  parameter_catalog.catalog_drivers,
  parameter_catalog.catalog_node_types,
  parameter_catalog.catalog_release_subjects,
  parameter_catalog.catalog_subject_aliases,
  parameter_catalog.catalog_release_subject_aliases,
  parameter_catalog.parameter_definitions,
  parameter_catalog.definition_revisions,
  parameter_catalog.catalog_release_definition_heads,
  parameter_catalog.catalog_materializations,
  parameter_catalog.catalog_state
to catalog_synchronizer_role;

grant select, insert, update on table
  parameter_catalog.catalog_command_idempotency
to catalog_synchronizer_role;

grant update (current_catalog_release_id) on table
  parameter_catalog.catalog_state
to catalog_synchronizer_role;

grant update (current_revision_id) on table
  parameter_catalog.parameter_definitions
to catalog_synchronizer_role;

grant select, insert, update on table
  parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements,
  parameter_catalog.parameter_review_items,
  parameter_catalog.definition_proposals,
  parameter_catalog.governance_command_idempotency
to parameter_governance_writer_role;

grant select, insert on table
  parameter_catalog.parameter_observations,
  parameter_catalog.parameter_observation_matches,
  parameter_catalog.parameter_review_evidence,
  parameter_catalog.parameter_review_resolutions,
  parameter_catalog.definition_proposal_revisions,
  parameter_catalog.catalog_publication_intents
to parameter_governance_writer_role;

grant insert on table public.audit_events to parameter_governance_writer_role;

grant execute on function
  parameter_catalog.assert_catalog_subject_active(text, text, text, text)
to parameter_governance_writer_role;

grant execute on function
  parameter_catalog.is_canonical_compatible_selector(text),
  parameter_catalog.is_canonical_node_type_name(text),
  parameter_catalog.is_canonical_property_key(text),
  parameter_catalog.acquire_current_pointer_lock_exclusive()
to catalog_synchronizer_role;

revoke all on function
  parameter_catalog.is_canonical_compatible_selector(text),
  parameter_catalog.is_canonical_node_type_name(text),
  parameter_catalog.is_canonical_property_key(text),
  parameter_catalog.acquire_current_pointer_lock_exclusive()
from public, parameter_governance_writer_role;

alter function parameter_catalog.assert_subject_placement_kind() security definer;
alter function parameter_catalog.assert_observation_match_binding_revision() security definer;

revoke all on function parameter_catalog.assert_subject_placement_kind()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
revoke all on function parameter_catalog.assert_observation_match_binding_revision()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

revoke all on table
  parameter_catalog.project_parameter_bindings,
  parameter_catalog.project_parameter_values,
  parameter_catalog.binding_history_events,
  parameter_catalog.legacy_identities,
  parameter_catalog.legacy_mapping_versions,
  parameter_catalog.legacy_mapping_heads,
  parameter_catalog.parameter_catalog_archives,
  parameter_catalog.parameter_catalog_cutover_runs,
  parameter_catalog.parameter_catalog_cutover_events,
  parameter_catalog.parameter_catalog_cutover_checkpoints,
  parameter_catalog.parameter_catalog_classification_ledger,
  parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results
from public, catalog_synchronizer_role, parameter_governance_writer_role;

alter default privileges for role catalog_migration_owner in schema parameter_catalog
  revoke all on tables from public;
alter default privileges for role catalog_migration_owner in schema parameter_catalog
  revoke all on sequences from public;
alter default privileges for role catalog_migration_owner in schema parameter_catalog
  revoke all on functions from public;
alter default privileges in schema parameter_catalog
  revoke all on tables from public;
alter default privileges in schema parameter_catalog
  revoke all on sequences from public;
alter default privileges in schema parameter_catalog
  revoke all on functions from public;

select pg_catalog.pg_advisory_unlock(689013800138);
