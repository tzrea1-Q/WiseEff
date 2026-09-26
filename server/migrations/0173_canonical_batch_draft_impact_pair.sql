-- Reject a one-sided frozen draft impact. PostgreSQL CHECK accepts UNKNOWN,
-- so the first 0172 form does not reject one NULL column on its own.
alter table public.project_parameter_value_change_requests
  drop constraint project_parameter_value_change_requests_draft_impact_ck;

alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_draft_impact_ck check (
    (batch_draft_impact is null and batch_draft_impact_digest is null)
    or (request_kind = 'batch' and batch_draft_impact is not null
      and batch_draft_impact_digest is not null
      and jsonb_typeof(batch_draft_impact) = 'array'
      and batch_draft_impact_digest ~ '^[0-9a-f]{64}$')
  );
