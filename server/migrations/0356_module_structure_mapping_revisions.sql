-- Keep every confirmed target and its copy baseline, including deleted targets.
alter table parameter_catalog.module_structure_created_refs
  add column revision integer not null default 1 check (revision > 0),
  drop constraint module_structure_created_refs_pkey,
  add primary key (organization_id, source_organization_id, export_id, package_ref, revision);
