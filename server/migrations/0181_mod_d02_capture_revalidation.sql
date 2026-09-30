-- Forward-only #1002 follow-up to the already-applied 0180 capture contract.
-- Revalidate Catalog readiness under its mutable policy/receipt locks and bind each
-- redacted audit event to the stable request ID, while preserving case/result replay.

grant usage on schema catalog_publication to catalog_mod_d02_capture_owner;
grant select (singleton, capability_contract_revision), update (singleton)
  on catalog_publication.publication_policies to catalog_mod_d02_capture_owner;
grant select (id, kind, release_id, release_digest, created_at)
  on parameter_catalog.catalog_activation_receipts to catalog_mod_d02_capture_owner;
-- PostgreSQL requires table UPDATE privilege for LOCK TABLE ... IN SHARE MODE.
-- The NOLOGIN owner is protected by the immutable-receipt trigger; the capture LOGIN
-- receives no relation privilege and can only invoke the fixed SECURITY DEFINER function.
grant update on parameter_catalog.catalog_activation_receipts to catalog_mod_d02_capture_owner;
grant select (artifact_digest)
  on catalog_publication.release_artifacts to catalog_mod_d02_capture_owner;

create or replace function parameter_catalog.capture_mod_d02_pre_activation_v2(
  p_run_id text,
  p_session_id text,
  p_token_hash text,
  p_principal_id text,
  p_organization_id text,
  p_batch jsonb,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  session_row public.auth_sessions%rowtype;
  run_row parameter_catalog.parameter_catalog_cutover_runs%rowtype;
  p7_payload jsonb;
  p7_digest text;
  manifest jsonb;
  item jsonb;
  selection jsonb;
  persisted_selection jsonb;
  module_row public.parameter_modules%rowtype;
  association record;
  subject_row record;
  case_row parameter_catalog.parameter_catalog_comparison_cases%rowtype;
  result_row parameter_catalog.parameter_catalog_comparison_results%rowtype;
  audit_row public.audit_events%rowtype;
  audit_id text;
  batch_digest text;
  item_count integer;
  inserted_count integer := 0;
  module_count integer;
  selected_count integer;
  matching_count integer;
  appended_count integer := 0;
  replayed_count integer := 0;
  projection_selections jsonb;
  projection_digest text;
  expected_case_id text;
  identity_digest text;
  capability_revision text;
  readiness_receipt_kind text;
begin
  if session_user <> 'wiseeff_mod_d02_capture'
     or current_user <> 'catalog_mod_d02_capture_owner' then
    raise exception using errcode = '42501', message = 'MOD D02 capture requires the fixed maintenance login';
  end if;
  if p_run_id is null or p_run_id = '' or p_session_id is null or p_session_id = ''
     or p_token_hash !~ '^[A-Za-z0-9_-]{43}$'
     or p_principal_id is null or p_principal_id = ''
     or p_organization_id is null or p_organization_id = ''
     or p_request_id is null or p_request_id = '' or length(p_request_id) > 200
     or btrim(p_request_id) <> p_request_id or p_request_id ~ '[[:cntrl:]]'
     or pg_catalog.jsonb_typeof(p_batch) is distinct from 'object'
     or p_batch ->> 'contractVersion' is distinct from 'pcat-comparison-case-batch/v2'
     or p_batch ->> 'family' is distinct from 'MOD'
     or p_batch ->> 'comparisonId' is distinct from 'PCAT-CMP-D02-SUBJECT-IDENTITY'
     or p_batch ->> 'phase' is distinct from 'pre-activation'
     or p_batch ->> 'organizationId' is distinct from p_organization_id
     or p_batch ->> 'selectionRunId' is distinct from p_run_id
     or pg_catalog.jsonb_typeof(p_batch -> 'cases') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_batch -> 'inventory') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_batch -> 'modSelectionIdentityIds') is distinct from 'array'
     or p_batch - array['contractVersion','family','comparisonId','phase','organizationId',
         'selectionRunId','selectionProjectionDigest','selectionProjectionCount',
         'modSelectionIdentityIds','inventory','sourceInventoryCount','sourceInventoryChecksum',
         'cases','blockers'] is distinct from '{}'::jsonb
     or p_batch -> 'blockers' is distinct from '[]'::jsonb then
    raise exception using errcode = '23514', message = 'MOD D02 capture input is incomplete or out of scope';
  end if;

  select * into session_row from public.auth_sessions
   where id = p_session_id and token_hash = p_token_hash
     and user_id = p_principal_id and organization_id = p_organization_id
   for share;
  if not found or session_row.revoked_at is not null
     or session_row.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '42501', message = 'MOD D02 capture session is unavailable';
  end if;
  perform 1 from public.organizations where id = p_organization_id for share;
  if not found then
    raise exception using errcode = '42501', message = 'MOD D02 capture organization is unavailable';
  end if;
  perform 1 from public.users
   where id = p_principal_id and organization_id = p_organization_id and is_active is true
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'MOD D02 capture principal is unavailable';
  end if;
  perform 1 from public.user_role_bindings
   where user_id = p_principal_id and organization_id = p_organization_id
     and project_id is null and role_id = 'admin'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'MOD D02 capture organization admin is unavailable';
  end if;

  select * into run_row from parameter_catalog.parameter_catalog_cutover_runs
   where id = p_run_id for share;
  if not found or run_row.state <> 'completed' or run_row.current_phase <> 'P10'
     or run_row.migration_contract_version <> 's7-orc-p0-p10-v2' then
    raise exception using errcode = '23514', message = 'MOD D02 capture requires a completed v2 P10 run';
  end if;
  select checkpoint.payload, checkpoint.checkpoint_digest
    into p7_payload, p7_digest
    from parameter_catalog.parameter_catalog_cutover_checkpoints checkpoint
   where checkpoint.cutover_run_id = p_run_id and checkpoint.phase = 'P7';
  manifest := p7_payload -> 'mappingManifest';
  if pg_catalog.jsonb_typeof(manifest) is distinct from 'object'
     or manifest ->> 'schemaVersion' is distinct from '2'
     or manifest ->> 'selectionRunId' is distinct from p_run_id
     or manifest ->> 'planDigest' is distinct from run_row.plan_digest
     or manifest ->> 'sourceSnapshotFingerprint' is distinct from run_row.source_snapshot_fingerprint
     or manifest ->> 'targetArtifactSha' is distinct from run_row.target_artifact_sha
     or manifest ->> 'catalogReleaseDigest' is distinct from run_row.target_catalog_release_digest
     or manifest ->> 'digest' is null
     or pg_catalog.jsonb_typeof(manifest -> 'selections') is distinct from 'array'
     or not exists (
       select 1 from parameter_catalog.catalog_releases release
        where release.id = manifest ->> 'catalogReleaseId'
          and release.release_digest = manifest ->> 'catalogReleaseDigest'
     ) or not exists (
       select 1 from parameter_catalog.parameter_catalog_cutover_events event
        where event.cutover_run_id = p_run_id and event.phase = 'P7'
          and event.event_kind = 'checkpoint'
          and event.payload ->> 'checkpointDigest' = p7_digest
     ) then
    raise exception using errcode = '23514', message = 'MOD D02 capture manifest or release pin drifted';
  end if;
  select count(*) into matching_count
    from parameter_catalog.parameter_catalog_cutover_checkpoints checkpoint
   where checkpoint.cutover_run_id = p_run_id
     and checkpoint.phase in ('P0','P1','P2','P3','P4','P5','P6','P7','P8','P9','P10');
  if matching_count <> 11 then
    raise exception using errcode = '23514', message = 'MOD D02 capture checkpoint set is incomplete';
  end if;
  if p7_digest is distinct from 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to('{"phase":"P7","payload":' ||
         parameter_catalog.mod_d02_canonical_json(p7_payload) || '}', 'UTF8')), 'hex') then
    raise exception using errcode = '23514', message = 'MOD D02 capture P7 checkpoint digest changed';
  end if;
  if manifest ->> 'digest' is distinct from 'sha256:' || pg_catalog.encode(pg_catalog.sha256(
       pg_catalog.convert_to(parameter_catalog.mod_d02_canonical_json(pg_catalog.jsonb_build_array(
         manifest -> 'schemaVersion', manifest -> 'selectionRunId', manifest -> 'planDigest',
         manifest -> 'sourceSnapshotFingerprint', manifest -> 'targetArtifactSha',
         manifest -> 'catalogReleaseId', manifest -> 'catalogReleaseDigest',
         manifest -> 'selectionCount',
         (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
           selected -> 'legacyIdentityId', selected -> 'sourceKind', selected -> 'sourceId',
           selected -> 'ownerScopeKind', selected -> 'ownerScopeId', selected -> 'rClass',
           selected -> 'disposition', selected -> 'status', selected -> 'headCasVersion',
           selected -> 'mappingVersion' -> 'id', selected -> 'mappingVersion' -> 'legacyIdentityId',
           selected -> 'mappingVersion' -> 'cutoverRunId', selected -> 'mappingVersion' -> 'versionNumber',
           selected -> 'mappingVersion' -> 'sourceChecksum', selected -> 'mappingVersion' -> 'graphFingerprint',
           selected -> 'mappingVersion' -> 'rClass', selected -> 'mappingVersion' -> 'targetKind',
           selected -> 'mappingVersion' -> 'targetId', selected -> 'mappingVersion' -> 'archiveId',
           selected -> 'mappingVersion' -> 'evidenceArchiveId',
           selected -> 'mappingVersion' -> 'supersedesVersionId') order by ordinal)
         from pg_catalog.jsonb_array_elements(manifest -> 'selections') with ordinality as element(selected, ordinal))
       )), 'UTF8')), 'hex') then
    raise exception using errcode = '23514', message = 'MOD D02 capture P7 manifest digest changed';
  end if;
  lock table public.projects, parameter_catalog.catalog_state in share mode;
  if not exists (select 1 from parameter_catalog.catalog_state
      where current_catalog_release_id = manifest ->> 'catalogReleaseId') then
    raise exception using errcode = '23514', message = 'MOD D02 capture current Catalog release drifted';
  end if;
  select policy.capability_contract_revision into capability_revision
    from catalog_publication.publication_policies policy
   where policy.singleton
   for share;
  if not found or capability_revision not in (
       'catalog-capability/v1', 'catalog-capability/v2',
       'catalog-capability/v3', 'catalog-capability/v4'
     ) then
    raise exception using errcode = '23514', message = 'MOD D02 capture Catalog readiness capability drifted';
  end if;
  -- Receipts are append-only, but a second receipt can alter the runtime's newest-receipt choice.
  -- SHARE blocks receipt INSERT/UPDATE/DELETE until this batch and its audit row commit.
  lock table parameter_catalog.catalog_activation_receipts in share mode;
  select receipt.kind into readiness_receipt_kind
    from parameter_catalog.catalog_activation_receipts receipt
   where receipt.release_id = manifest ->> 'catalogReleaseId'
     and receipt.release_digest = manifest ->> 'catalogReleaseDigest'
   order by receipt.created_at desc, receipt.id desc
   limit 1;
  if not found or (readiness_receipt_kind = 'online-publication' and not exists (
       select 1 from catalog_publication.release_artifacts artifact
        where artifact.artifact_digest = manifest ->> 'catalogReleaseDigest'
     )) then
    raise exception using errcode = '23514', message = 'MOD D02 capture Catalog readiness receipt or artifact drifted';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      selected -> 'legacyIdentityId', selected -> 'mappingVersion' -> 'id', selected -> 'headCasVersion')
      order by ordinal), '[]'::jsonb) into projection_selections
    from pg_catalog.jsonb_array_elements(manifest -> 'selections') with ordinality as element(selected, ordinal)
   where (selected ->> 'ownerScopeKind' = 'organization' and selected ->> 'ownerScopeId' = p_organization_id)
      or (selected ->> 'ownerScopeKind' = 'project' and exists (
        select 1 from public.projects project where project.id = selected ->> 'ownerScopeId'
          and project.organization_id = p_organization_id));
  projection_digest := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    parameter_catalog.mod_d02_canonical_json(pg_catalog.jsonb_build_array(
      's7-orc-organization-projection-v1', manifest ->> 'digest', p_organization_id,
      projection_selections)), 'UTF8')), 'hex');
  if p_batch ->> 'selectionProjectionDigest' is distinct from projection_digest
     or (p_batch ->> 'selectionProjectionCount')::integer is distinct from pg_catalog.jsonb_array_length(projection_selections)
     or p_batch ->> 'selectionRunId' is distinct from manifest ->> 'selectionRunId'
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_batch -> 'cases') case_item
        where case_item -> 'context' ->> 'selectionPlanDigest' is distinct from run_row.plan_digest
           or case_item -> 'context' ->> 'selectionTargetArtifactSha' is distinct from run_row.target_artifact_sha
           or case_item -> 'context' ->> 'selectionCatalogReleaseId' is distinct from manifest ->> 'catalogReleaseId'
           or case_item -> 'context' ->> 'selectionCatalogReleaseDigest' is distinct from manifest ->> 'catalogReleaseDigest'
           or case_item -> 'context' ->> 'selectionManifestDigest' is distinct from manifest ->> 'digest'
           or case_item -> 'context' ->> 'selectionP7CheckpointDigest' is distinct from p7_digest
           or case_item -> 'context' ->> 'selectionProjectionDigest' is distinct from p_batch ->> 'selectionProjectionDigest'
           or case_item -> 'context' ->> 'contractVersion' is distinct from 'pcat-comparison-case-context/v2'
           or case_item -> 'context' ->> 'selectionRunId' is distinct from p_run_id
           or case_item -> 'context' ->> 'selectionProjectionCoverage' is distinct from
                case when pg_catalog.jsonb_array_length(projection_selections) = (manifest ->> 'selectionCount')::integer
                  then 'complete-run' else 'organization-projection' end
           or (case_item -> 'context' ->> 'selectionProjectionCount')::integer is distinct from
                pg_catalog.jsonb_array_length(projection_selections)
           or (case_item -> 'context' ->> 'sourceInventoryCount')::integer is distinct from
                (p_batch ->> 'sourceInventoryCount')::integer
           or case_item -> 'context' ->> 'sourceInventoryChecksum' is distinct from
                p_batch ->> 'sourceInventoryChecksum'
     ) then
    raise exception using errcode = '23514', message = 'MOD D02 capture case pin drifted';
  end if;

  -- The only mutation boundary for these source relations is the SQL function.
  -- SHARE excludes concurrent INSERT/UPDATE/DELETE until commit, including
  -- retry calls. It requires UPDATE privilege held only by the NOLOGIN owner.
  lock table public.parameter_modules,
    parameter_catalog.organization_subject_registrations,
    parameter_catalog.subject_placements in share mode;
  select count(*) into module_count from public.parameter_modules
   where organization_id = p_organization_id;
  item_count := pg_catalog.jsonb_array_length(p_batch -> 'cases');
  select count(*) into selected_count
    from pg_catalog.jsonb_array_elements(manifest -> 'selections') selected
   where selected ->> 'sourceKind' = 'parameter-module'
     and selected ->> 'ownerScopeKind' = 'organization'
     and selected ->> 'ownerScopeId' = p_organization_id;
  if item_count = 0 or item_count <> module_count or selected_count <> module_count
     or pg_catalog.jsonb_array_length(p_batch -> 'inventory') <> module_count
     or pg_catalog.jsonb_array_length(p_batch -> 'modSelectionIdentityIds') <> selected_count
     or (p_batch ->> 'sourceInventoryCount')::integer <> module_count then
    raise exception using errcode = '23514', message = 'MOD D02 capture source or selection inventory changed';
  end if;
  if p_batch -> 'modSelectionIdentityIds' is distinct from (
    select pg_catalog.jsonb_agg(selected ->> 'legacyIdentityId'
      order by selected ->> 'legacyIdentityId' collate "C")
      from pg_catalog.jsonb_array_elements(manifest -> 'selections') selected
     where selected ->> 'sourceKind' = 'parameter-module'
       and selected ->> 'ownerScopeKind' = 'organization'
       and selected ->> 'ownerScopeId' = p_organization_id
  ) then
    raise exception using errcode = '23514', message = 'MOD D02 capture selected identity list changed';
  end if;
  if p_batch ->> 'sourceInventoryChecksum' is distinct from pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(parameter_catalog.mod_d02_canonical_json(p_batch -> 'inventory') || E'\n', 'UTF8')), 'hex') then
    raise exception using errcode = '23514', message = 'MOD D02 capture inventory checksum changed';
  end if;
  if exists (
    select 1 from public.parameter_modules module
     where module.organization_id = p_organization_id
       and (select count(*) from pg_catalog.jsonb_array_elements(p_batch -> 'inventory') inventory
             where inventory ->> 'id' = module.id
               and inventory ->> 'kind' = 'parameter-module'
               and inventory ->> 'ownerScopeKind' = 'organization'
               and inventory ->> 'ownerScopeId' = p_organization_id
               and inventory - array['kind','id','ownerScopeKind','ownerScopeId'] = '{}'::jsonb) <> 1
  ) then
    raise exception using errcode = '23514', message = 'MOD D02 capture inventory differs from locked modules';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(manifest -> 'selections') selected
     where selected ->> 'sourceKind' = 'parameter-module'
       and selected ->> 'ownerScopeKind' = 'organization'
       and selected ->> 'ownerScopeId' = p_organization_id
       and (select count(*) from pg_catalog.jsonb_array_elements(p_batch -> 'cases') case_item
             where case_item -> 'context' -> 'selection' ->> 'legacyIdentityId'
                   = selected ->> 'legacyIdentityId') <> 1
  ) or (select count(distinct case_item ->> 'caseId')
          from pg_catalog.jsonb_array_elements(p_batch -> 'cases') case_item) <> item_count then
    raise exception using errcode = '23514', message = 'MOD D02 capture case set is incomplete or duplicated';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_batch -> 'cases') as value loop
    selection := item -> 'context' -> 'selection';
    identity_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      parameter_catalog.mod_d02_canonical_json(pg_catalog.jsonb_build_array(
        p_run_id, 'pre-activation', 'MOD', 'PCAT-CMP-D02-SUBJECT-IDENTITY',
        item -> 'protectedReference' ->> 'kind', item -> 'protectedReference' ->> 'id',
        'organization', p_organization_id, selection ->> 'legacyIdentityId')), 'UTF8')), 'hex');
    expected_case_id := 'pcat_cmp_v2:organization:' || parameter_catalog.mod_d02_uri_component(p_organization_id)
      || ':' || parameter_catalog.mod_d02_uri_component(item -> 'protectedReference' ->> 'kind')
      || ':' || parameter_catalog.mod_d02_uri_component(item -> 'protectedReference' ->> 'id')
      || ':' || parameter_catalog.mod_d02_uri_component(selection ->> 'legacyIdentityId')
      || ':' || identity_digest;
    if item ->> 'contractVersion' is distinct from 'pcat-comparison-case-contribution/v2'
       or item - array['contractVersion','family','caseId','comparisonId','protectedReference',
           'protectedReferenceOwnerScopeKind','protectedReferenceOwnerScopeId','legacyObservation',
           'canonicalObservation','result','expectedDifference','unqueryableReason','context','checksum']
         is distinct from '{}'::jsonb
       or (item -> 'context') - array['contractVersion','phase','selectionRunId','selectionPlanDigest',
           'selectionTargetArtifactSha','selectionCatalogReleaseId','selectionCatalogReleaseDigest',
           'selectionManifestDigest','selectionP7CheckpointDigest','selectionProjectionDigest',
           'selectionProjectionCoverage','selectionProjectionCount','selection',
           'sourceInventoryCount','sourceInventoryChecksum'] is distinct from '{}'::jsonb
       or (item -> 'legacyObservation') - array['status','value'] is distinct from '{}'::jsonb
       or (item -> 'canonicalObservation') - array['status','value'] is distinct from '{}'::jsonb
       or pg_catalog.jsonb_typeof(item -> 'protectedReference') is distinct from 'object'
       or (item -> 'protectedReference') - array['kind','id'] is distinct from '{}'::jsonb
       or item ->> 'caseId' is distinct from expected_case_id
       or item ->> 'checksum' is distinct from pg_catalog.encode(pg_catalog.sha256(
         pg_catalog.convert_to(parameter_catalog.mod_d02_canonical_json(item - 'checksum') || E'\n', 'UTF8')), 'hex')
       or item ->> 'family' is distinct from 'MOD'
       or item ->> 'comparisonId' is distinct from 'PCAT-CMP-D02-SUBJECT-IDENTITY'
       or item -> 'protectedReference' ->> 'kind' is distinct from 'parameter-module'
       or item ->> 'protectedReferenceOwnerScopeKind' is distinct from 'organization'
       or item ->> 'protectedReferenceOwnerScopeId' is distinct from p_organization_id
       or item -> 'context' ->> 'phase' is distinct from 'pre-activation'
       or item ->> 'result' is distinct from 'unexplained-difference'
       or item -> 'expectedDifference' is distinct from 'null'::jsonb
       or item -> 'unqueryableReason' is distinct from 'null'::jsonb
       or item -> 'legacyObservation' ->> 'status' is distinct from 'value'
       or item -> 'canonicalObservation' ->> 'status' is distinct from 'value'
       or pg_catalog.jsonb_typeof(selection) is distinct from 'object' then
      raise exception using errcode = '23514', message = 'MOD D02 capture case is not a resolved scoped observation';
    end if;
    select * into module_row from public.parameter_modules
     where id = item -> 'protectedReference' ->> 'id'
       and organization_id = p_organization_id;
    if not found or item -> 'legacyObservation' -> 'value' is distinct from
       pg_catalog.jsonb_build_object('id',module_row.id,'kind',module_row.kind,'origin',module_row.origin,
         'parentId',module_row.parent_id,'attributionSubjectId',module_row.attribution_subject_id,
         'sourceKey',module_row.source_key) then
      raise exception using errcode = '23514', message = 'MOD D02 capture module observation changed';
    end if;
    select count(*) into matching_count
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement
        on placement.id = registration.current_placement_id
       and placement.organization_id = registration.organization_id
     where registration.organization_id = p_organization_id and placement.module_id = module_row.id;
    if matching_count <> 1 then
      raise exception using errcode = '23514', message = 'MOD D02 capture association is missing or ambiguous';
    end if;
    select registration.id registration_id, registration.subject_id,
           registration.status registration_status, registration.registration_method,
           placement.id placement_id, placement.module_id
      into association
      from parameter_catalog.organization_subject_registrations registration
      join parameter_catalog.subject_placements placement
        on placement.id = registration.current_placement_id
       and placement.organization_id = registration.organization_id
     where registration.organization_id = p_organization_id and placement.module_id = module_row.id;
    if association.registration_status <> 'active'
       or item -> 'canonicalObservation' -> 'value' ->> 'catalogReleaseId' is distinct from manifest ->> 'catalogReleaseId'
       or item -> 'canonicalObservation' -> 'value' ->> 'catalogReleaseDigest' is distinct from manifest ->> 'catalogReleaseDigest'
       or item -> 'canonicalObservation' -> 'value' ->> 'organizationId' is distinct from p_organization_id
       or item -> 'canonicalObservation' -> 'value' -> 'association' is distinct from
          pg_catalog.jsonb_build_object('registrationId',association.registration_id,
            'placementId',association.placement_id,'moduleId',association.module_id,
            'registrationStatus',association.registration_status,'registrationMethod',association.registration_method)
       or item -> 'canonicalObservation' -> 'value' -> 'subject' ->> 'id' is distinct from association.subject_id then
      raise exception using errcode = '23514', message = 'MOD D02 capture association observation changed';
    end if;
    select subject.id, subject.kind, subject.canonical_key, membership.selector_snapshot,
           membership.lifecycle
      into subject_row
      from parameter_catalog.catalog_subjects subject
      join parameter_catalog.catalog_release_subjects membership
        on membership.subject_id = subject.id
       and membership.release_id = manifest ->> 'catalogReleaseId'
     where subject.id = association.subject_id;
    if not found or subject_row.lifecycle <> 'active'
       or item -> 'canonicalObservation' -> 'value' -> 'subject' ->> 'type' is distinct from subject_row.kind
       or item -> 'canonicalObservation' -> 'value' -> 'subject' ->> 'canonicalName' is distinct from subject_row.canonical_key
       or item -> 'canonicalObservation' -> 'value' -> 'subject' -> 'selector' is distinct from subject_row.selector_snapshot
       or item -> 'canonicalObservation' -> 'value' -> 'subject' ->> 'lifecycle' is distinct from subject_row.lifecycle
       or item -> 'canonicalObservation' -> 'value' -> 'subject' ->> 'membershipReleaseId' is distinct from manifest ->> 'catalogReleaseId'
       or (item -> 'canonicalObservation' -> 'value') - array['catalogReleaseId','catalogReleaseDigest',
           'organizationId','association','subject'] is distinct from '{}'::jsonb
       or (item -> 'canonicalObservation' -> 'value' -> 'subject') - array['id','type','canonicalName',
           'selector','lifecycle','membershipReleaseId'] is distinct from '{}'::jsonb
       or (item -> 'canonicalObservation' -> 'value' -> 'association') - array['registrationId',
           'placementId','moduleId','registrationStatus','registrationMethod'] is distinct from '{}'::jsonb
       or subject_row.kind is distinct from (case when module_row.kind = 'driver-group' then 'driver'
          when module_row.kind = 'node-type' then 'node-type' else null end) then
      raise exception using errcode = '23514', message = 'MOD D02 capture Subject observation changed';
    end if;
    perform parameter_catalog.assert_catalog_subject_active(
      manifest ->> 'catalogReleaseId', manifest ->> 'catalogReleaseDigest', subject_row.id, 'active');

    select count(*) into matching_count from pg_catalog.jsonb_array_elements(manifest -> 'selections') selected
     where selected ->> 'legacyIdentityId' = selection ->> 'legacyIdentityId';
    if matching_count <> 1 then
      raise exception using errcode = '23514', message = 'MOD D02 capture selection is missing or duplicated';
    end if;
    select selected into persisted_selection
      from pg_catalog.jsonb_array_elements(manifest -> 'selections') selected
     where selected ->> 'legacyIdentityId' = selection ->> 'legacyIdentityId';
    if selection is distinct from persisted_selection
       or selection ->> 'sourceKind' is distinct from 'parameter-module'
       or selection ->> 'sourceId' is distinct from module_row.id
       or selection ->> 'ownerScopeId' is distinct from p_organization_id
       or selection ->> 'disposition' is distinct from 'archived'
       or (selection ->> 'rClass' is distinct from 'R1'
           and selection ->> 'rClass' is distinct from 'R10')
       or selection -> 'mappingVersion' ->> 'targetKind' is not null
       or selection -> 'mappingVersion' ->> 'targetId' is not null
       or selection -> 'mappingVersion' ->> 'archiveId' is null
       or not exists (
         select 1 from parameter_catalog.legacy_mapping_versions version
         join parameter_catalog.legacy_identities identity on identity.id = version.legacy_identity_id
          where version.id = selection -> 'mappingVersion' ->> 'id'
            and version.legacy_identity_id = selection ->> 'legacyIdentityId'
            and version.cutover_run_id = selection -> 'mappingVersion' ->> 'cutoverRunId'
            and version.version_number = (selection -> 'mappingVersion' ->> 'versionNumber')::integer
            and version.source_checksum = selection -> 'mappingVersion' ->> 'sourceChecksum'
            and version.graph_fingerprint = selection -> 'mappingVersion' ->> 'graphFingerprint'
            and version.r_class = selection ->> 'rClass'
            and version.r_class = selection -> 'mappingVersion' ->> 'rClass'
            and version.target_kind is not distinct from selection -> 'mappingVersion' ->> 'targetKind'
            and version.target_id is not distinct from selection -> 'mappingVersion' ->> 'targetId'
            and version.archive_id is not distinct from selection -> 'mappingVersion' ->> 'archiveId'
            and version.evidence_archive_id is not distinct from selection -> 'mappingVersion' ->> 'evidenceArchiveId'
            and version.supersedes_version_id is not distinct from selection -> 'mappingVersion' ->> 'supersedesVersionId'
            and identity.source_kind = 'parameter-module'
            and identity.source_id = module_row.id
            and identity.owner_scope_kind = 'organization'
            and identity.owner_scope_id = p_organization_id
       ) then
      raise exception using errcode = '23514', message = 'MOD D02 capture exact P7 selection changed';
    end if;
    if selection ->> 'status' = 'appended' then appended_count := appended_count + 1;
    elsif selection ->> 'status' = 'replayed' then replayed_count := replayed_count + 1;
    else raise exception using errcode = '23514', message = 'MOD D02 capture selection status is invalid';
    end if;

    insert into parameter_catalog.parameter_catalog_comparison_cases (
      id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference,
      comparison_phase, protected_reference_kind, protected_reference_id,
      protected_reference_owner_scope_kind, protected_reference_owner_scope_id
    ) values (
      item ->> 'caseId', p_run_id, 'PCAT-CMP-D02', 'MOD', item ->> 'caseId', true,
      'pre-activation', 'parameter-module', module_row.id, 'organization', p_organization_id
    ) on conflict (id) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
    select * into case_row from parameter_catalog.parameter_catalog_comparison_cases
     where id = item ->> 'caseId';
    if not found or case_row.cutover_run_id is distinct from p_run_id
       or case_row.gate_id is distinct from 'PCAT-CMP-D02'
       or case_row.consumer_family is distinct from 'MOD'
       or case_row.case_key is distinct from item ->> 'caseId'
       or case_row.protected_reference is distinct from true
       or case_row.comparison_phase is distinct from 'pre-activation'
       or case_row.protected_reference_kind is distinct from 'parameter-module'
       or case_row.protected_reference_id is distinct from module_row.id
       or case_row.protected_reference_owner_scope_kind is distinct from 'organization'
       or case_row.protected_reference_owner_scope_id is distinct from p_organization_id then
      raise exception using errcode = '23514', message = 'MOD D02 capture case ID conflict';
    end if;
    insert into parameter_catalog.parameter_catalog_comparison_results (
      comparison_case_id, outcome, mapping_version_id, rule_id, evidence,
      selection_run_id, selection_plan_digest, selection_catalog_release_id,
      selection_catalog_release_digest, selection_manifest_digest,
      selection_p7_checkpoint_digest, selection_legacy_identity_id,
      selection_mapping_version_id
    ) values (
      item ->> 'caseId', item ->> 'result',
      case when item ->> 'result' = 'declared-expected-difference'
        then selection -> 'mappingVersion' ->> 'id' else null end,
      case when item ->> 'result' = 'declared-expected-difference'
        then item -> 'expectedDifference' ->> 'ruleId' else null end,
      item, p_run_id, run_row.plan_digest, manifest ->> 'catalogReleaseId',
      manifest ->> 'catalogReleaseDigest', manifest ->> 'digest', p7_digest,
      selection ->> 'legacyIdentityId', selection -> 'mappingVersion' ->> 'id'
    ) on conflict (comparison_case_id) do nothing;
    select * into result_row from parameter_catalog.parameter_catalog_comparison_results
     where comparison_case_id = item ->> 'caseId';
    if not found or result_row.outcome is distinct from item ->> 'result'
       or result_row.evidence is distinct from item
       or result_row.selection_run_id is distinct from p_run_id
       or result_row.selection_plan_digest is distinct from run_row.plan_digest
       or result_row.selection_catalog_release_id is distinct from manifest ->> 'catalogReleaseId'
       or result_row.selection_catalog_release_digest is distinct from manifest ->> 'catalogReleaseDigest'
       or result_row.selection_manifest_digest is distinct from manifest ->> 'digest'
       or result_row.selection_p7_checkpoint_digest is distinct from p7_digest
       or result_row.selection_legacy_identity_id is distinct from selection ->> 'legacyIdentityId'
       or result_row.selection_mapping_version_id is distinct from selection -> 'mappingVersion' ->> 'id' then
      raise exception using errcode = '23514', message = 'MOD D02 capture result ID conflict';
    end if;
  end loop;
  if appended_count + replayed_count <> selected_count then
    raise exception using errcode = '23514', message = 'MOD D02 capture did not cover every selected identity';
  end if;
  batch_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_batch::text, 'UTF8')), 'hex');
  audit_id := 'mod-d02-capture:' || pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(p_run_id, p_organization_id, p_request_id)::text, 'UTF8')), 'hex');
  insert into public.audit_events (
    id, organization_id, project_id, actor_user_id, actor_type, app, kind,
    action, severity, target_type, target_id, metadata, trace_id
  ) values (
    audit_id, p_organization_id, null, p_principal_id, 'user', 'release-verification',
    'mod-d02-comparison-capture', 'capture-pre-activation', 'Medium', 'cutover-run', p_run_id,
    pg_catalog.jsonb_build_object('batchDigest', batch_digest,
      'manifestDigest', manifest ->> 'digest', 'caseCount', item_count), p_request_id
  ) on conflict (id) do nothing;
  select * into audit_row from public.audit_events where id = audit_id;
  if not found or audit_row.organization_id is distinct from p_organization_id
     or audit_row.project_id is not null
     or audit_row.actor_user_id is distinct from p_principal_id
     or audit_row.actor_type is distinct from 'user'
     or audit_row.app is distinct from 'release-verification'
     or audit_row.kind is distinct from 'mod-d02-comparison-capture'
     or audit_row.action is distinct from 'capture-pre-activation'
     or audit_row.severity is distinct from 'Medium'
     or audit_row.target_type is distinct from 'cutover-run'
     or audit_row.target_id is distinct from p_run_id
     or audit_row.metadata is distinct from pg_catalog.jsonb_build_object(
       'batchDigest', batch_digest, 'manifestDigest', manifest ->> 'digest', 'caseCount', item_count)
     or audit_row.trace_id is distinct from p_request_id then
    raise exception using errcode = '23514', message = 'MOD D02 capture audit ID conflict';
  end if;
  set constraints all immediate;
  return pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id, 'selectionRunId', p_run_id,
    'selectionProjectionDigest', p_batch ->> 'selectionProjectionDigest',
    'caseCount', item_count, 'newlyWrittenCount', inserted_count,
    'replayedWriteCount', item_count - inserted_count,
    'selectionStatusCounts', pg_catalog.jsonb_build_object('appended', appended_count, 'replayed', replayed_count),
    'fullReport', pg_catalog.jsonb_build_object('available', false,
      'reason', 'eleven-family-and-nine-gate-coverage-not-collected'));
end;
$$;

alter function parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,jsonb,text)
  owner to catalog_mod_d02_capture_owner;
revoke all on function parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,jsonb,text)
  from public;
grant execute on function parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,jsonb,text)
  to wiseeff_mod_d02_capture;
