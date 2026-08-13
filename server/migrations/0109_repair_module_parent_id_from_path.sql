-- Repair module-tree parent_id rows desynced from their materialized path (#415).
--
-- The move UPDATEs in parameterModuleRepository.reparentParameterModule and
-- debugNodeModuleRepository.moveDebugNodeModule assigned the move target's
-- parent_id to every path-descendant of the moved node (path/depth/origin were
-- scoped per-row; parent_id was not). The materialized path stayed correct, so
-- it is authoritative: recompute each multi-segment row's parent_id as the id
-- of the same-organization row whose path equals the row's parent prefix.
--
-- Repair-only; rows that cannot be repaired cleanly are left untouched for
-- manual triage (the #415 detection query still finds them):
--   - rows whose parent-prefix row is missing (second-order corruption via the
--     parent_id-based delete guard);
--   - rows whose repaired slot would collide with an existing sibling on the
--     (organization_id, coalesce(parent_id, ''), name) unique index — possible
--     when a duplicate module was created against the corrupted tree.
-- Idempotent: once parent_id agrees with the path, no row matches.

update parameter_modules child
set
  parent_id = parent.id,
  updated_at = now()
from parameter_modules parent
where parent.organization_id = child.organization_id
  and position('/' in child.path) > 0
  and parent.path = regexp_replace(child.path, '/[^/]+$', '')
  and parent.id is distinct from child.parent_id
  and not exists (
    select 1
    from parameter_modules sibling
    where sibling.organization_id = child.organization_id
      and sibling.parent_id = parent.id
      and sibling.name = child.name
      and sibling.id <> child.id
  );

update debug_node_modules child
set
  parent_id = parent.id,
  updated_at = now()
from debug_node_modules parent
where parent.organization_id = child.organization_id
  and position('/' in child.path) > 0
  and parent.path = regexp_replace(child.path, '/[^/]+$', '')
  and parent.id is distinct from child.parent_id
  and not exists (
    select 1
    from debug_node_modules sibling
    where sibling.organization_id = child.organization_id
      and sibling.parent_id = parent.id
      and sibling.name = child.name
      and sibling.id <> child.id
  );
