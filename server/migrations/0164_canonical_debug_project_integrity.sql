-- Issue #898: a canonical debug association must belong to the recorded
-- project as well as the organization. Keep all historical rows unchanged;
-- existing mismatches must fail migration validation rather than be relabelled.
alter table public.debug_nodes
  add constraint debug_nodes_canonical_binding_project_fk
  foreign key (canonical_binding_id, organization_id, canonical_project_id)
  references parameter_catalog.project_parameter_bindings (id, organization_id, project_id)
  on delete restrict;

alter table public.node_operations
  add constraint node_operations_canonical_binding_project_fk
  foreign key (canonical_binding_id, organization_id, canonical_project_id)
  references parameter_catalog.project_parameter_bindings (id, organization_id, project_id)
  on delete restrict;
