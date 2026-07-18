-- Close the 0060 origin gap without rewriting an already-applied migration.
-- Every post-cutover draft must prove the exact candidate revision it represents.
-- Candidate-less drafts from file sync/conflict resolution are no more trustworthy
-- than manual rows and must be recreated through the typed binding editor.

alter table parameter_draft_identity_invalidations
  add column if not exists draft_origin text,
  add column if not exists origin_file_version_id text;

update parameter_draft_identity_invalidations
set draft_origin = 'manual'
where draft_origin is null;

alter table parameter_draft_identity_invalidations
  drop constraint if exists parameter_draft_identity_invalidations_origin_check;

alter table parameter_draft_identity_invalidations
  add constraint parameter_draft_identity_invalidations_origin_check
  check (draft_origin in ('manual', 'file_sync'));

insert into parameter_draft_identity_invalidations (
  draft_id,
  organization_id,
  project_id,
  user_id,
  project_parameter_binding_id,
  invalidation_reason,
  draft_origin,
  origin_file_version_id
)
select
  d.id,
  d.organization_id,
  d.project_id,
  d.user_id,
  d.project_parameter_binding_id,
  'missing-candidate-config-revision',
  d.origin,
  d.origin_file_version_id
from parameter_drafts d
where d.candidate_config_revision_id is null
on conflict (draft_id) do update set
  draft_origin = excluded.draft_origin,
  origin_file_version_id = excluded.origin_file_version_id;

delete from parameter_drafts d
using parameter_draft_identity_invalidations invalidation
where d.id = invalidation.draft_id
  and d.candidate_config_revision_id is null;
