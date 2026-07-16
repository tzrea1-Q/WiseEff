-- A resolved phandle target may be deleted before the referencing property
-- during project/file cleanup. Preserve the reference evidence and clear only
-- the resolved pointer so cascading project deletion cannot be blocked.
alter table dts_phandle_refs
  drop constraint if exists dts_phandle_refs_resolved_target_node_id_fkey;

alter table dts_phandle_refs
  add constraint dts_phandle_refs_resolved_target_node_id_fkey
  foreign key (resolved_target_node_id)
  references dts_nodes(id)
  on delete set null;
