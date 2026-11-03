-- Different packages may explicitly reuse the same target module. Package
-- references remain unique within their target/source/export identity.
alter table parameter_catalog.module_structure_created_refs
  drop constraint module_structure_created_refs_organization_id_module_id_key;
