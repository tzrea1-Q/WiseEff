-- A path correction can rewrite includes in more than one private member.
-- The existing composition trigger validates every frozen member/version.
do $$
declare installed text; updated text;
begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass
      and conname='project_parameter_value_change_requests_outcome_ck';
  updated := replace(installed, 'jsonb_array_length(applied_file_version_ids) = 1',
    $branch$((jsonb_array_length(applied_file_version_ids) = 1 and not coalesce(source_revision_context ? 'pathCorrection',false)) or
      (request_kind='member_addition' and source_revision_context ? 'pathCorrection'
        and applied_source_result->'pathCorrection'=source_revision_context->'pathCorrection'
        and applied_file_version_ids=jsonb_path_query_array(source_revision_context,'$.pathCorrection.versions[*].fileVersionId')
        and applied_file_version_ids ? (applied_source_result->>'fileVersionId')))$branch$);
  if updated=installed then raise exception 'Source receipt version count clause missing'; end if;
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check (%s)',updated);
end $$;
