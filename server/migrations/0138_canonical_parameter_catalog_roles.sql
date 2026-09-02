-- Wayfinder #668 / Issue #689 (S2-RBAC): least-privilege Catalog roles and grants.
--
-- Grant manifest (database-local ACLs; roles themselves are cluster-global):
--   catalog_migration_owner (NOLOGIN)
--     owns parameter_catalog and every relation/function in it
--     SELECT on public FK targets needed for internal referential-integrity checks
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

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'catalog_migration_owner') then
    create role catalog_migration_owner;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'catalog_synchronizer_role') then
    create role catalog_synchronizer_role;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'parameter_governance_writer_role') then
    create role parameter_governance_writer_role;
  end if;
end;
$$;

alter role catalog_migration_owner with
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role catalog_synchronizer_role with
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role parameter_governance_writer_role with
  nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

revoke catalog_migration_owner from current_user;
revoke catalog_synchronizer_role from current_user;
revoke parameter_governance_writer_role from current_user;

comment on role catalog_migration_owner is
  'NOLOGIN owner of parameter_catalog relations. Production logins cannot SET ROLE to this role.';
comment on role catalog_synchronizer_role is
  'NOLOGIN Catalog synchronizer: insert immutable Catalog rows and column-limited head updates only.';
comment on role parameter_governance_writer_role is
  'NOLOGIN Parameter Governance writer: governance DML, success-audit append, and execute-only current-release guard.';

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
  public.organizations,
  public.projects,
  public.parameter_modules
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
