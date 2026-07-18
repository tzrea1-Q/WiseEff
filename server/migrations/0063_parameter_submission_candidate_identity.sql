-- Preserve the exact typed-edit candidate through submission, review, and merge.
-- Historical workflow rows remain nullable: their deleted draft cannot be used to
-- reconstruct a trustworthy candidate identity, so post-cutover merge fails closed.

alter table parameter_submission_items
  add column if not exists candidate_config_revision_id text
    references dts_config_revisions(id);

alter table parameter_change_requests
  add column if not exists candidate_config_revision_id text
    references dts_config_revisions(id);

create index if not exists parameter_submission_items_candidate_revision_idx
  on parameter_submission_items (organization_id, candidate_config_revision_id)
  where candidate_config_revision_id is not null;

create index if not exists parameter_change_requests_candidate_revision_idx
  on parameter_change_requests (organization_id, project_id, candidate_config_revision_id)
  where candidate_config_revision_id is not null;
