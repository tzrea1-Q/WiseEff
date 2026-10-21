-- A complete restore creates a new source revision; removing that member again
-- appends another receipt without changing the earlier removal or its audit.
alter table parameter_catalog.project_source_member_tombstones
  drop constraint project_source_member_tombsto_organization_id_project_id_co_key;
alter table parameter_catalog.project_source_member_tombstones
  add constraint project_source_member_tombstone_revision_uk
  unique(organization_id,project_id,config_set_id,file_id,config_revision_id);
