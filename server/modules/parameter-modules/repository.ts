import type { Queryable } from "../../shared/database/client";
import type {
  ModuleMatchKind,
  ParameterModuleMappingRow,
  ParameterModuleRegistryDto,
  ParameterModuleRow
} from "./types";

function moduleFromRow(row: ParameterModuleRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? null,
    sortOrder: row.sort_order,
    importance: row.importance ?? "medium"
  };
}

function mappingFromRow(row: ParameterModuleMappingRow) {
  return {
    id: row.id,
    moduleId: row.parameter_module_id,
    matchKind: row.match_kind,
    matchValue: row.match_value,
    priority: row.priority
  };
}

/**
 * Registry read: modules from the v1 parameter_modules tree + DTS mappings.
 * Module CRUD lives in v1 (`parameterModuleRepository`); this module only owns mappings.
 */
export async function readRegistry(
  db: Queryable,
  organizationId: string
): Promise<ParameterModuleRegistryDto> {
  const modules = await db.query<ParameterModuleRow>(
    `select id, name, parent_id, sort_order, coalesce(importance, 'medium') as importance
       from parameter_modules
      where organization_id = $1
      order by sort_order asc, path asc, name asc`,
    [organizationId]
  );
  const mappings = await db.query<ParameterModuleMappingRow>(
    `select id, parameter_module_id, match_kind, match_value, priority
       from parameter_module_mappings
      where organization_id = $1
      order by priority desc, match_value asc`,
    [organizationId]
  );
  return {
    modules: modules.rows.map(moduleFromRow),
    mappings: mappings.rows.map(mappingFromRow)
  };
}

export async function moduleExists(
  db: Queryable,
  input: { organizationId: string; moduleId: string }
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `select id from parameter_modules where organization_id = $1 and id = $2`,
    [input.organizationId, input.moduleId]
  );
  return result.rows.length > 0;
}

export async function insertMapping(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    moduleId: string;
    matchKind: ModuleMatchKind;
    matchValue: string;
    priority: number;
  }
): Promise<void> {
  await db.query(
    `insert into parameter_module_mappings
       (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, match_kind, match_value)
       do update set parameter_module_id = excluded.parameter_module_id,
                     priority = excluded.priority`,
    [input.id, input.organizationId, input.moduleId, input.matchKind, input.matchValue, input.priority]
  );
}

export async function deleteMappingRow(
  db: Queryable,
  input: { organizationId: string; mappingId: string }
): Promise<number> {
  const result = await db.query(
    `delete from parameter_module_mappings where organization_id = $1 and id = $2`,
    [input.organizationId, input.mappingId]
  );
  return result.rowCount ?? 0;
}

export type RecomputeBindingRow = {
  id: string;
  projectId: string;
  logicalNodeId: string | null;
  parameterSpecId: string;
  moduleId: string;
  driverModule: string | null;
  compatible: string | null;
  instanceName: string | null;
  nodeLocator?: string | null;
};

export type ObservedCompatibleHintRow = {
  compatible: string;
  bindingCount: number;
};

type RecomputeBindingDbRow = {
  id: string;
  project_id: string;
  logical_node_id: string | null;
  parameter_spec_id: string;
  module_id: string;
  driver_module: string | null;
  compatible: string | null;
  instance_name: string | null;
  node_locator: string | null;
};

/**
 * Load bindings (optionally scoped to one project) with the driver/compatible/instance
 * context needed to re-resolve their business module (phase 2, §5.2 remap recompute).
 * Driver derives from the spec key like the browse read path; compatible/instance come
 * from the binding's most recent logical-node revision snapshot.
 */
export async function listBindingsForModuleRecompute(
  db: Queryable,
  input: { organizationId: string; projectId: string | null }
): Promise<RecomputeBindingRow[]> {
  const result = await db.query<RecomputeBindingDbRow>(
    `
    select
      b.id,
      b.project_id,
      b.logical_node_id,
      b.parameter_spec_id,
      b.module_id,
      nullif(
        case
          when cardinality(string_to_array(ps.specification_key, '/')) >= 3
            then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
          else split_part(ps.specification_key, '/', 1)
        end,
        ''
      ) as driver_module,
      lnr.compatible,
      case
        when lnr.unit_address is not null then lnr.name || '@' || lnr.unit_address
        else lnr.name
      end as instance_name,
      lnr.node_locator
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
    left join lateral (
      select compatible, name, unit_address, node_locator
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
      order by config_revision_id desc
      limit 1
    ) lnr on true
    where b.organization_id = $1
      and ($2::text is null or b.project_id = $2)
    order by b.project_id, b.id
    `,
    [input.organizationId, input.projectId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    logicalNodeId: row.logical_node_id,
    parameterSpecId: row.parameter_spec_id,
    moduleId: row.module_id,
    driverModule: row.driver_module,
    compatible: row.compatible,
    instanceName: row.instance_name,
    nodeLocator: row.node_locator,
  }));
}

export async function listObservedCompatiblesForDiscovery(
  db: Queryable,
  input: { organizationId: string },
): Promise<ObservedCompatibleHintRow[]> {
  const result = await db.query<{ compatible: string; binding_count: string }>(
    `
    select lower(lnr.compatible) as compatible, count(*)::text as binding_count
    from project_parameter_bindings b
    left join lateral (
      select compatible
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
      order by config_revision_id desc
      limit 1
    ) lnr on true
    where b.organization_id = $1
      and lnr.compatible is not null
      and trim(lnr.compatible) <> ''
    group by lower(lnr.compatible)
    order by count(*) desc, lower(lnr.compatible) asc
    `,
    [input.organizationId],
  );
  return result.rows.map((row) => ({
    compatible: row.compatible,
    bindingCount: Number(row.binding_count),
  }));
}

/**
 * True when another binding already owns the target 4-tuple
 * (project_id, logical_node_id, parameter_spec_id, module_id), i.e. remapping this
 * binding's module_id would violate the phase-2 unique key.
 */
export async function bindingModuleConflictExists(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    logicalNodeId: string | null;
    parameterSpecId: string;
    moduleId: string;
    excludeBindingId: string;
  }
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from project_parameter_bindings
    where organization_id = $1
      and project_id = $2
      and logical_node_id is not distinct from $3
      and parameter_spec_id = $4
      and module_id = $5
      and id <> $6
    limit 1
    `,
    [
      input.organizationId,
      input.projectId,
      input.logicalNodeId,
      input.parameterSpecId,
      input.moduleId,
      input.excludeBindingId
    ]
  );
  return result.rows.length > 0;
}

export async function updateBindingModuleId(
  db: Queryable,
  input: { organizationId: string; bindingId: string; moduleId: string }
): Promise<void> {
  await db.query(
    `update project_parameter_bindings
       set module_id = $1
     where id = $2 and organization_id = $3`,
    [input.moduleId, input.bindingId, input.organizationId]
  );
}
