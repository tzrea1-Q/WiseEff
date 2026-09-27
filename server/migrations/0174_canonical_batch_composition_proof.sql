-- #906 C: reserve one immutable proof envelope for a future D-owned whole-batch
-- draft/file composition. Existing file-only requests keep all three fields NULL.
alter table public.project_parameter_value_change_requests
  add column batch_upload_candidate_id text,
  add column batch_composition_proof jsonb,
  add column batch_decision_proof_digest text;

alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_upload_candidate_fk
    foreign key (batch_upload_candidate_id, organization_id, project_id)
    references public.project_parameter_file_candidates(id, organization_id, project_id)
    on delete restrict deferrable initially deferred,
  add constraint project_parameter_value_change_requests_composition_ck check (
    (batch_upload_candidate_id is null and batch_composition_proof is null
      and batch_decision_proof_digest is null)
    or ((request_kind = 'batch' and batch_upload_candidate_id is not null
      and batch_composition_proof is not null and batch_decision_proof_digest is not null
      and batch_decision_proof_digest ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(batch_composition_proof) = 'object'
      and batch_composition_proof->>'kind' = 'canonical-batch-draft-composition'
      and batch_composition_proof->>'organizationId' = organization_id
      and batch_composition_proof->>'projectId' = project_id
      and batch_composition_proof->>'format' in ('json', 'dts')
      and batch_composition_proof->>'uploadCandidateId' = batch_upload_candidate_id
      and batch_composition_proof->>'composedCandidateId' = candidate_id
      and batch_composition_proof->>'fileId' = batch_file_id
      and batch_composition_proof->>'baseVersionId' = batch_base_version_id
      and batch_composition_proof->>'configSetId' = batch_config_set_id
      and batch_composition_proof->>'cohortProofToken' = batch_cohort_proof_token
      and batch_composition_proof->>'batchProofDigest' = batch_proof_digest
      and batch_composition_proof->>'draftImpactDigest' = batch_draft_impact_digest
      and batch_composition_proof->>'decisionProofDigest' = batch_decision_proof_digest
      and jsonb_typeof(batch_composition_proof->'uploadObject') = 'object'
      and jsonb_typeof(batch_composition_proof->'composedObject') = 'object'
      and nullif(batch_composition_proof->'uploadObject'->>'storageKey', '') is not null
      and nullif(batch_composition_proof->'uploadObject'->>'proofToken', '') is not null
      and (batch_composition_proof->'uploadObject'->>'sha256') ~ '^[0-9a-f]{64}$'
      and (batch_composition_proof->'uploadObject'->>'sizeBytes')::bigint >= 0
      and nullif(batch_composition_proof->'composedObject'->>'storageKey', '') is not null
      and nullif(batch_composition_proof->'composedObject'->>'proofToken', '') is not null
      and (batch_composition_proof->'composedObject'->>'sha256') ~ '^[0-9a-f]{64}$'
      and batch_composition_proof->'composedObject'->>'sha256' = candidate_proposed_digest
      and batch_composition_proof->'composedObject'->>'proofToken' = batch_source_proof_token
      and (batch_composition_proof->'composedObject'->>'sizeBytes')::bigint >= 0
      and jsonb_typeof(batch_composition_proof->'members') = 'array'
      and jsonb_array_length(batch_composition_proof->'members') >= 1
      and jsonb_typeof(batch_composition_proof->'targetDecisions') = 'array'
      and jsonb_array_length(batch_composition_proof->'targetDecisions') = batch_target_count
      and jsonb_typeof(batch_composition_proof->'cohort') = 'array'
      and jsonb_array_length(batch_composition_proof->'cohort') = batch_cohort_count) is true)
  );

create function parameter_catalog.protect_batch_composition_proof()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if new.batch_upload_candidate_id is distinct from old.batch_upload_candidate_id
     or new.batch_composition_proof is distinct from old.batch_composition_proof
     or new.batch_decision_proof_digest is distinct from old.batch_decision_proof_digest then
    raise exception using errcode = '55000', message = 'Frozen batch composition proof is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_value_change_request_composition_immutable
before update on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_batch_composition_proof();
alter function parameter_catalog.protect_batch_composition_proof()
  owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_batch_composition_proof()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
