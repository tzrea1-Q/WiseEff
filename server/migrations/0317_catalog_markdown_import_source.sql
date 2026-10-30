alter table catalog_publication.release_artifacts
  drop constraint release_artifacts_source_kind_check;

alter table catalog_publication.release_artifacts
  add constraint release_artifacts_source_kind_check
  check (source_kind in ('typed-changeset', 'markdown-import', 'vendor-yaml', 'repository-bundle', 'adopted-preexisting'));
