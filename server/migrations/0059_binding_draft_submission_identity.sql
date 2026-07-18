-- Bind topology drafts to the exact candidate revision submitted for review.
-- Forward-only: previously migrated databases must not rely on editing 0053/0058.

alter table parameter_drafts
  add column if not exists candidate_config_revision_id text
    references dts_config_revisions(id);

create index if not exists parameter_drafts_candidate_revision_idx
  on parameter_drafts (organization_id, project_id, candidate_config_revision_id)
  where candidate_config_revision_id is not null;
