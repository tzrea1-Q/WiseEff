-- Existing project files have immutable versions already; choosing one does
-- not manufacture another upload candidate merely to carry the frozen proof.
do $$
declare installed text;
begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass
      and conname='project_parameter_value_change_request_candidate_artifact_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_request_candidate_artifact_ck;
  execute format($sql$alter table public.project_parameter_value_change_requests
    add constraint project_parameter_value_change_request_candidate_artifact_ck check (
      (%s) or (request_kind='member_addition' and candidate_id is null
        and source_revision_context->'candidateId'='null'::jsonb
        and source_revision_context->>'fileId' is not null
        and candidate_base_digest=source_revision_context->>'baseDigest'
        and candidate_proposed_digest=source_revision_context->>'proposedDigest'
        and candidate_diff_digest=source_revision_context->>'proofDigest'
        and candidate_member_manifest=source_revision_context->'members'
        and candidate_binding_manifest=source_revision_context->'cohort') is true)$sql$,installed);
end $$;
