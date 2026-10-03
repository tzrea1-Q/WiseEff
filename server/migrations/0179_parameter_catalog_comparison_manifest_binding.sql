-- Bind new comparison rows to one exact selection in a completed v2 manifest.
-- Existing cases/results remain v1 rows with all new columns NULL.

alter table parameter_catalog.parameter_catalog_comparison_cases
  add column comparison_phase text,
  add column protected_reference_kind text,
  add column protected_reference_id text,
  add column protected_reference_owner_scope_kind text,
  add column protected_reference_owner_scope_id text,
  add constraint parameter_catalog_comparison_case_v2_binding_ck check (
    (
      comparison_phase is null
      and protected_reference_kind is null
      and protected_reference_id is null
      and protected_reference_owner_scope_kind is null
      and protected_reference_owner_scope_id is null
    ) or (
      comparison_phase is not null
      and comparison_phase in ('pre-activation', 'post-p13')
      and protected_reference
      and protected_reference_kind is not null
      and protected_reference_kind <> ''
      and btrim(protected_reference_kind) = protected_reference_kind
      and protected_reference_id is not null
      and protected_reference_id <> ''
      and btrim(protected_reference_id) = protected_reference_id
      and protected_reference_owner_scope_kind is not null
      and protected_reference_owner_scope_kind in ('platform', 'organization', 'project')
      and protected_reference_owner_scope_id is not null
      and protected_reference_owner_scope_id <> ''
      and btrim(protected_reference_owner_scope_id) = protected_reference_owner_scope_id
    )
  );

do $$
declare
  v1_unique_constraint text;
begin
  select constraint_row.conname
    into v1_unique_constraint
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation_row on relation_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
   where namespace_row.nspname = 'parameter_catalog'
     and relation_row.relname = 'parameter_catalog_comparison_cases'
     and constraint_row.contype = 'u'
     and pg_catalog.pg_get_constraintdef(constraint_row.oid) =
         'UNIQUE (cutover_run_id, gate_id, consumer_family, case_key)';

  if v1_unique_constraint is null then
    raise exception 'expected v1 comparison-case uniqueness constraint was not found';
  end if;

  execute pg_catalog.format(
    'alter table parameter_catalog.parameter_catalog_comparison_cases drop constraint %I',
    v1_unique_constraint
  );
end;
$$;

create unique index parameter_catalog_comparison_cases_v1_key_uq
  on parameter_catalog.parameter_catalog_comparison_cases (
    cutover_run_id, gate_id, consumer_family, case_key
  ) where comparison_phase is null;

create unique index parameter_catalog_comparison_cases_v2_key_uq
  on parameter_catalog.parameter_catalog_comparison_cases (
    cutover_run_id, gate_id, consumer_family, comparison_phase, case_key
  ) where comparison_phase is not null;

alter table parameter_catalog.parameter_catalog_comparison_results
  add column selection_run_id text references parameter_catalog.parameter_catalog_cutover_runs(id) on delete restrict,
  add column selection_plan_digest text,
  add column selection_catalog_release_id text references parameter_catalog.catalog_releases(id) on delete restrict,
  add column selection_catalog_release_digest text,
  add column selection_manifest_digest text,
  add column selection_p7_checkpoint_digest text,
  add column selection_legacy_identity_id text references parameter_catalog.legacy_identities(id) on delete restrict,
  add column selection_mapping_version_id text,
  add constraint parameter_catalog_comparison_result_selection_tuple_ck check (
    (
      selection_run_id is null
      and selection_plan_digest is null
      and selection_catalog_release_id is null
      and selection_catalog_release_digest is null
      and selection_manifest_digest is null
      and selection_p7_checkpoint_digest is null
      and selection_legacy_identity_id is null
      and selection_mapping_version_id is null
    ) or (
      selection_run_id is not null
      and selection_plan_digest is not null
      and selection_plan_digest <> ''
      and btrim(selection_plan_digest) = selection_plan_digest
      and selection_catalog_release_id is not null
      and selection_catalog_release_digest is not null
      and selection_catalog_release_digest <> ''
      and btrim(selection_catalog_release_digest) = selection_catalog_release_digest
      and selection_manifest_digest is not null
      and selection_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
      and selection_p7_checkpoint_digest is not null
      and selection_p7_checkpoint_digest ~ '^sha256:[0-9a-f]{64}$'
      and selection_legacy_identity_id is not null
      and selection_mapping_version_id is not null
    )
  ),
  add constraint parameter_catalog_comparison_result_selection_version_fk
    foreign key (selection_legacy_identity_id, selection_mapping_version_id)
    references parameter_catalog.legacy_mapping_versions(legacy_identity_id, id)
    on delete restrict;

create or replace function parameter_catalog.assert_comparison_result_mapping_run()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
declare
  comparison_run_id text;
  comparison_phase text;
  protected_reference boolean;
  protected_kind text;
  protected_id text;
  protected_owner_kind text;
  protected_owner_id text;
  mapping_run_id text;
  run_row parameter_catalog.parameter_catalog_cutover_runs%rowtype;
  p0_payload jsonb;
  p1_payload jsonb;
  p5_payload jsonb;
  p7_payload jsonb;
  p7_manifest jsonb;
  selected_item jsonb;
  identity_row parameter_catalog.legacy_identities%rowtype;
  version_row parameter_catalog.legacy_mapping_versions%rowtype;
  checkpoint_count integer;
  checkpoint_event_count integer;
  selected_item_count integer;
begin
  select comparison_case.cutover_run_id,
         comparison_case.comparison_phase,
         comparison_case.protected_reference,
         comparison_case.protected_reference_kind,
         comparison_case.protected_reference_id,
         comparison_case.protected_reference_owner_scope_kind,
         comparison_case.protected_reference_owner_scope_id
    into comparison_run_id, comparison_phase, protected_reference,
         protected_kind, protected_id, protected_owner_kind, protected_owner_id
    from parameter_catalog.parameter_catalog_comparison_cases comparison_case
   where comparison_case.id = new.comparison_case_id;

  if not found then
    return null;
  end if;

  if new.selection_run_id is null
     and new.selection_plan_digest is null
     and new.selection_catalog_release_id is null
     and new.selection_catalog_release_digest is null
     and new.selection_manifest_digest is null
     and new.selection_p7_checkpoint_digest is null
     and new.selection_legacy_identity_id is null
     and new.selection_mapping_version_id is null then
    if comparison_phase is not null then
      raise exception using
        errcode = '23503',
        message = 'A v2 comparison case requires a completed-manifest selection',
        constraint = 'comparison_result_manifest_selection_fk';
    end if;

    -- Preserve the v1 same-run result check for all historical/unbound rows.
    if new.mapping_version_id is null then
      return null;
    end if;

    select cutover_run_id into mapping_run_id
      from parameter_catalog.legacy_mapping_versions
     where id = new.mapping_version_id;

    if comparison_run_id is not null
       and mapping_run_id is not null
       and comparison_run_id is distinct from mapping_run_id then
      raise exception using
        errcode = '23503',
        message = 'Comparison result mapping version belongs to another CutoverRun',
        constraint = 'comparison_result_mapping_run_fk';
    end if;
    return null;
  end if;

  if new.selection_run_id is null
     or new.selection_plan_digest is null
     or new.selection_catalog_release_id is null
     or new.selection_catalog_release_digest is null
     or new.selection_manifest_digest is null
     or new.selection_p7_checkpoint_digest is null
     or new.selection_legacy_identity_id is null
     or new.selection_mapping_version_id is null
     or comparison_phase is null
     or not protected_reference
     or protected_kind is null
     or protected_id is null
     or protected_owner_kind is null
     or protected_owner_id is null then
    raise exception using
      errcode = '23503',
      message = 'Comparison result selection or exact protected identity is incomplete',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  if new.outcome = 'unqueryable/protected-reference-missing'
     or (new.mapping_version_id is not null
         and new.mapping_version_id is distinct from new.selection_mapping_version_id) then
    raise exception using
      errcode = '23503',
      message = 'V2 comparison result does not describe its exact selected mapping version',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  if comparison_run_id is distinct from new.selection_run_id then
    raise exception using
      errcode = '23503',
      message = 'Comparison case run differs from the manifest selection run',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  select * into run_row
    from parameter_catalog.parameter_catalog_cutover_runs
   where id = new.selection_run_id;
  if not found
     or run_row.state <> 'completed'
     or run_row.current_phase <> 'P10'
     or run_row.migration_contract_version <> 's7-orc-p0-p10-v2'
     or run_row.plan_digest is distinct from new.selection_plan_digest
     or run_row.target_catalog_release_digest is distinct from new.selection_catalog_release_digest then
    raise exception using
      errcode = '23503',
      message = 'Manifest selection does not reference the pinned completed v2 run',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  select count(*) into checkpoint_count
    from parameter_catalog.parameter_catalog_cutover_checkpoints
   where cutover_run_id = new.selection_run_id
     and phase in ('P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10');
  if checkpoint_count <> 11 then
    raise exception using
      errcode = '23503',
      message = 'Manifest selection run has an incomplete P0-P10 checkpoint set',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  select payload into p0_payload
    from parameter_catalog.parameter_catalog_cutover_checkpoints
   where cutover_run_id = new.selection_run_id and phase = 'P0';
  select payload into p1_payload
    from parameter_catalog.parameter_catalog_cutover_checkpoints
   where cutover_run_id = new.selection_run_id and phase = 'P1';
  select payload into p5_payload
    from parameter_catalog.parameter_catalog_cutover_checkpoints
   where cutover_run_id = new.selection_run_id and phase = 'P5';
  select checkpoint.payload into p7_payload
    from parameter_catalog.parameter_catalog_cutover_checkpoints checkpoint
   where checkpoint.cutover_run_id = new.selection_run_id
     and checkpoint.phase = 'P7'
     and checkpoint.checkpoint_digest = new.selection_p7_checkpoint_digest;
  if p0_payload is null or p1_payload is null or p5_payload is null or p7_payload is null then
    raise exception using
      errcode = '23503',
      message = 'Manifest selection checkpoint pins do not resolve',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  select count(*) into checkpoint_event_count
    from parameter_catalog.parameter_catalog_cutover_events event
   where event.cutover_run_id = new.selection_run_id
     and event.phase = 'P7'
     and event.event_kind = 'checkpoint'
     and event.payload ->> 'checkpointDigest' = new.selection_p7_checkpoint_digest;
  if checkpoint_event_count = 0 or exists (
    select 1
      from parameter_catalog.parameter_catalog_cutover_events event
     where event.cutover_run_id = new.selection_run_id
       and event.phase = 'P7'
       and event.event_kind = 'checkpoint'
       and event.payload ->> 'checkpointDigest' is distinct from new.selection_p7_checkpoint_digest
  ) then
    raise exception using
      errcode = '23503',
      message = 'P7 checkpoint digest differs from its immutable checkpoint events',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  p7_manifest := p7_payload -> 'mappingManifest';
  if pg_catalog.jsonb_typeof(p7_manifest) is distinct from 'object'
     or p7_manifest ->> 'schemaVersion' is distinct from '2'
     or p7_manifest ->> 'digest' is distinct from new.selection_manifest_digest
     or p7_manifest ->> 'selectionRunId' is distinct from new.selection_run_id
     or p7_manifest ->> 'planDigest' is distinct from new.selection_plan_digest
     or p7_manifest ->> 'sourceSnapshotFingerprint' is distinct from run_row.source_snapshot_fingerprint
     or p7_manifest ->> 'targetArtifactSha' is distinct from run_row.target_artifact_sha
     or p7_manifest ->> 'catalogReleaseId' is distinct from new.selection_catalog_release_id
     or p7_manifest ->> 'catalogReleaseDigest' is distinct from new.selection_catalog_release_digest
     or p0_payload ->> 'sourceSnapshotFingerprint' is distinct from run_row.source_snapshot_fingerprint
     or p1_payload ->> 'releaseId' is distinct from new.selection_catalog_release_id
     or p1_payload ->> 'targetCatalogReleaseDigest' is distinct from new.selection_catalog_release_digest
     or p5_payload ->> 'currentId' is distinct from new.selection_catalog_release_id
     or p5_payload ->> 'currentDigest' is distinct from new.selection_catalog_release_digest
     or not exists (
       select 1 from parameter_catalog.catalog_releases release
        where release.id = new.selection_catalog_release_id
          and release.release_digest = new.selection_catalog_release_digest
     ) then
    raise exception using
      errcode = '23503',
      message = 'Manifest header, Catalog Release, or checkpoint pins differ',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  if pg_catalog.jsonb_typeof(p7_manifest -> 'selections') is distinct from 'array' then
    raise exception using
      errcode = '23503',
      message = 'P7 mapping manifest selection list is malformed',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  select count(*)
    into selected_item_count
    from pg_catalog.jsonb_array_elements(p7_manifest -> 'selections') as selection(value)
   where selection.value ->> 'legacyIdentityId' = new.selection_legacy_identity_id;
  if selected_item_count <> 1 then
    raise exception using
      errcode = '23503',
      message = 'Manifest does not contain one exact selected legacy identity',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;
  select selection.value into selected_item
    from pg_catalog.jsonb_array_elements(p7_manifest -> 'selections') as selection(value)
   where selection.value ->> 'legacyIdentityId' = new.selection_legacy_identity_id;

  select * into identity_row
    from parameter_catalog.legacy_identities
   where id = new.selection_legacy_identity_id;
  select * into version_row
    from parameter_catalog.legacy_mapping_versions
   where id = new.selection_mapping_version_id;
  if not found
     or identity_row.id is null
     or identity_row.source_kind is distinct from protected_kind
     or identity_row.source_id is distinct from protected_id
     or identity_row.owner_scope_kind is distinct from protected_owner_kind
     or identity_row.owner_scope_id is distinct from protected_owner_id
     or version_row.legacy_identity_id is distinct from identity_row.id
     or selected_item ->> 'sourceKind' is distinct from protected_kind
     or selected_item ->> 'sourceId' is distinct from protected_id
     or selected_item ->> 'ownerScopeKind' is distinct from protected_owner_kind
     or selected_item ->> 'ownerScopeId' is distinct from protected_owner_id
     or selected_item -> 'mappingVersion' ->> 'id' is distinct from version_row.id
     or selected_item -> 'mappingVersion' ->> 'legacyIdentityId' is distinct from version_row.legacy_identity_id
     or selected_item -> 'mappingVersion' ->> 'cutoverRunId' is distinct from version_row.cutover_run_id
     or (selected_item ->> 'status' is distinct from 'appended'
         and selected_item ->> 'status' is distinct from 'replayed')
     or (selected_item ->> 'status' = 'appended' and version_row.cutover_run_id <> new.selection_run_id) then
    raise exception using
      errcode = '23503',
      message = 'Manifest selection differs from the exact protected identity or MappingVersion',
      constraint = 'comparison_result_manifest_selection_fk';
  end if;

  return null;
end;
$$;

drop trigger comparison_result_mapping_run_fk
  on parameter_catalog.parameter_catalog_comparison_results;

create constraint trigger comparison_result_mapping_run_fk
after insert or update of
  comparison_case_id,
  mapping_version_id,
  selection_run_id,
  selection_plan_digest,
  selection_catalog_release_id,
  selection_catalog_release_digest,
  selection_manifest_digest,
  selection_p7_checkpoint_digest,
  selection_legacy_identity_id,
  selection_mapping_version_id
on parameter_catalog.parameter_catalog_comparison_results
deferrable initially deferred
for each row execute function parameter_catalog.assert_comparison_result_mapping_run();
