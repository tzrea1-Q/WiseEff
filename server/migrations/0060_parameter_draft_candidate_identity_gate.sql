-- Fail closed for drafts created before exact draft -> candidate identity existed.
-- Forward-only: 0059 may already be applied, so do not rewrite it.
--
-- Policy: manual drafts without a candidate revision are invalidated and must be
-- recreated through the typed binding editor. Keep identifier-only evidence so
-- operators can count/notify affected users without retaining draft values.

create table if not exists parameter_draft_identity_invalidations (
  draft_id text primary key,
  organization_id text not null,
  project_id text not null,
  user_id text not null,
  project_parameter_binding_id text,
  invalidation_reason text not null
    check (invalidation_reason in ('missing-candidate-config-revision')),
  invalidated_at timestamptz not null default now()
);

create index if not exists parameter_draft_identity_invalidations_scope_idx
  on parameter_draft_identity_invalidations (organization_id, project_id, invalidated_at);

insert into parameter_draft_identity_invalidations (
  draft_id,
  organization_id,
  project_id,
  user_id,
  project_parameter_binding_id,
  invalidation_reason
)
select
  d.id,
  d.organization_id,
  d.project_id,
  d.user_id,
  d.project_parameter_binding_id,
  'missing-candidate-config-revision'
from parameter_drafts d
where d.origin = 'manual'
  and d.candidate_config_revision_id is null
on conflict (draft_id) do nothing;

delete from parameter_drafts d
using parameter_draft_identity_invalidations invalidation
where d.id = invalidation.draft_id
  and d.origin = 'manual'
  and d.candidate_config_revision_id is null;
