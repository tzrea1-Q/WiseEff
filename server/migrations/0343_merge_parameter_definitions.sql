-- Existing-target merges need a frozen preview but do not publish a Catalog release.
alter table parameter_catalog.definition_replacement_previews
  alter column candidate_id drop not null,
  alter column artifact_digest drop not null,
  add constraint definition_replacement_preview_publication_pair_ck
    check ((candidate_id is null) = (artifact_digest is null));

-- A publication still owns one replacement identity. Organization-scoped
-- merge manifests can subsequently migrate other current bindings to an
-- already-published target. Each completed edge is still unique per binding.
drop index parameter_catalog.definition_replacements_current_successor_unique;
create unique index definition_replacements_current_successor_unique
  on parameter_catalog.definition_replacements (old_definition_id)
  where candidate_id is not null and status in ('pending', 'executing', 'completed', 'blocked');

create unique index definition_replacement_completed_source_unique
  on parameter_catalog.definition_replacement_projects (old_binding_id)
  where status = 'completed';
