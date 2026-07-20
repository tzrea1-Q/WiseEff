-- Clean cutover: every binding must belong to a v1 parameter_modules row.
-- Local/dev: reset DB or ensure parameter_modules + mappings exist before migrate.

alter table project_parameter_bindings
  add column if not exists module_id text references parameter_modules(id);

-- Backfill for non-empty DBs that still lack module_id (deterministic unclassified per org).
-- Prefer: wipe + reseed in this workstream. If rows exist, assign org root "未分类" module created if needed.
insert into parameter_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
select distinct
  'pmod-' || b.organization_id || '-' || md5('未分类'),
  b.organization_id,
  null,
  '未分类',
  'pmod-' || b.organization_id || '-' || md5('未分类'),
  1,
  999,
  '',
  ''
from project_parameter_bindings b
where b.module_id is null
on conflict (id) do nothing;

update project_parameter_bindings b
set module_id = pm.id
from parameter_modules pm
where b.module_id is null
  and pm.organization_id = b.organization_id
  and pm.name = '未分类'
  and pm.parent_id is null;

-- After backfill (reseed path may leave no nulls):
alter table project_parameter_bindings
  alter column module_id set not null;

alter table project_parameter_bindings
  drop constraint if exists project_parameter_bindings_project_id_logical_node_id_param_key;

alter table project_parameter_bindings
  add constraint project_parameter_bindings_project_node_spec_module_unique
  unique nulls not distinct (project_id, logical_node_id, parameter_spec_id, module_id);
