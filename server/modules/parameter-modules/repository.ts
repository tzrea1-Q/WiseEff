import type { Queryable } from "../../shared/database/client";
import {
  driverGroupDisplayNameFromCompatible,
  isScaffoldingDriverLabel,
  normalizeMatchToken,
} from "./modulePlacement";
import type {
  ModuleImportance,
  ModuleMatchKind,
  ParameterModuleMappingRow,
  ParameterModuleRegistryDto,
  ParameterModuleRow
} from "./types";

function moduleFromRow(
  row: ParameterModuleRow,
  effectiveImportance: ModuleImportance,
) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? null,
    sortOrder: row.sort_order,
    description: row.description ?? "",
    scope: row.scope ?? "",
    importance: row.importance ?? "medium",
    kind: row.kind ?? "business",
    origin: row.origin ?? "curated",
    sourceKey: row.source_key ?? null,
    effectiveImportance,
    parameterCount: Number(row.parameter_count ?? 0),
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

function resolveEffectiveImportance(
  moduleId: string,
  byId: Map<string, ParameterModuleRow>,
): ModuleImportance {
  const seen = new Set<string>();
  let current = byId.get(moduleId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === "business") {
      return current.importance ?? "medium";
    }
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return byId.get(moduleId)?.importance ?? "medium";
}

/**
 * Bindings hang on leaf modules (usually instances). Roll direct counts up the
 * parentId tree so business / driver-group rows show subtree totals.
 */
function rollupSubtreeParameterCounts(
  rows: readonly ParameterModuleRow[],
): Map<string, number> {
  const direct = new Map(rows.map((row) => [row.id, Number(row.parameter_count ?? 0)]));
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const siblings = childrenByParent.get(row.parent_id) ?? [];
    siblings.push(row.id);
    childrenByParent.set(row.parent_id, siblings);
  }

  const totals = new Map<string, number>();
  const visiting = new Set<string>();

  const totalFor = (moduleId: string): number => {
    const cached = totals.get(moduleId);
    if (cached !== undefined) return cached;
    if (visiting.has(moduleId)) return direct.get(moduleId) ?? 0;
    visiting.add(moduleId);
    let sum = direct.get(moduleId) ?? 0;
    for (const childId of childrenByParent.get(moduleId) ?? []) {
      sum += totalFor(childId);
    }
    visiting.delete(moduleId);
    totals.set(moduleId, sum);
    return sum;
  };

  for (const row of rows) {
    totalFor(row.id);
  }
  return totals;
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
    `select
       pm.id,
       pm.name,
       pm.parent_id,
       pm.sort_order,
       coalesce(pm.description, '') as description,
       coalesce(pm.scope, '') as scope,
       coalesce(pm.importance, 'medium') as importance,
       coalesce(pm.kind, 'business') as kind,
       coalesce(pm.origin, 'curated') as origin,
       pm.source_key,
       pm.path,
       (
         select count(*)::text
         from project_parameter_bindings b
         where b.module_id = pm.id
       ) as parameter_count
       from parameter_modules pm
      where pm.organization_id = $1
      order by pm.sort_order asc, pm.path asc, pm.name asc`,
    [organizationId]
  );
  const byId = new Map(modules.rows.map((row) => [row.id, row]));
  const subtreeCounts = rollupSubtreeParameterCounts(modules.rows);
  const mappings = await db.query<ParameterModuleMappingRow>(
    `select id, parameter_module_id, match_kind, match_value, priority
       from parameter_module_mappings
      where organization_id = $1
      order by priority desc, match_value asc`,
    [organizationId]
  );
  return {
    modules: modules.rows.map((row) =>
      moduleFromRow(
        { ...row, parameter_count: subtreeCounts.get(row.id) ?? 0 },
        resolveEffectiveImportance(row.id, byId),
      ),
    ),
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
  const matchValue =
    normalizeMatchToken(input.matchValue) ?? input.matchValue.trim().toLowerCase();
  await db.query(
    `insert into parameter_module_mappings
       (id, organization_id, parameter_module_id, match_kind, match_value, priority)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, match_kind, match_value)
       do update set parameter_module_id = excluded.parameter_module_id,
                     priority = excluded.priority`,
    [input.id, input.organizationId, input.moduleId, input.matchKind, matchValue, input.priority]
  );
}

export async function findCompatibleMapping(
  db: Queryable,
  input: { organizationId: string; compatible: string },
): Promise<{ id: string; moduleId: string; matchValue: string; priority: number } | null> {
  const matchValue =
    normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  const result = await db.query<{
    id: string;
    parameter_module_id: string;
    match_value: string;
    priority: number;
  }>(
    `
    select id, parameter_module_id, match_value, priority
    from parameter_module_mappings
    where organization_id = $1
      and match_kind = 'compatible'
      and match_value = $2
    limit 1
    `,
    [input.organizationId, matchValue],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    moduleId: row.parameter_module_id,
    matchValue: row.match_value,
    priority: row.priority,
  };
}

export async function listRegisteredCompatibles(
  db: Queryable,
  organizationId: string,
): Promise<string[]> {
  const result = await db.query<{ match_value: string }>(
    `
    select distinct match_value
    from parameter_module_mappings
    where organization_id = $1
      and match_kind = 'compatible'
    order by match_value asc
    `,
    [organizationId],
  );
  return result.rows.map((row) => row.match_value);
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

export async function listSubtreeModuleIds(
  db: Queryable,
  input: { organizationId: string; moduleId: string },
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `
    select child.id
    from parameter_modules root
    inner join parameter_modules child
      on child.organization_id = root.organization_id
     and (child.id = root.id or child.path like root.path || '/%')
    where root.organization_id = $1
      and root.id = $2
    order by child.depth desc, child.path desc
    `,
    [input.organizationId, input.moduleId],
  );
  return result.rows.map((row) => row.id);
}

export async function deleteMappingsForModules(
  db: Queryable,
  input: { organizationId: string; moduleIds: string[] },
): Promise<Array<{ id: string; matchKind: ModuleMatchKind; matchValue: string }>> {
  if (input.moduleIds.length === 0) return [];
  const result = await db.query<{
    id: string;
    match_kind: ModuleMatchKind;
    match_value: string;
  }>(
    `
    delete from parameter_module_mappings
    where organization_id = $1
      and parameter_module_id = any($2::text[])
    returning id, match_kind, match_value
    `,
    [input.organizationId, input.moduleIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    matchKind: row.match_kind,
    matchValue: row.match_value,
  }));
}

/** Delete empty auto instance/driver-group modules in a subtree, deepest first. Keeps the root id. */
export async function deleteEmptyAutoDescendants(
  db: Queryable,
  input: { organizationId: string; rootModuleId: string; subtreeModuleIds: string[] },
): Promise<string[]> {
  const deleted: string[] = [];
  for (const moduleId of input.subtreeModuleIds) {
    if (moduleId === input.rootModuleId) continue;
    const result = await db.query<{ id: string }>(
      `
      delete from parameter_modules pm
      where pm.organization_id = $1
        and pm.id = $2
        and pm.origin = 'auto'
        and pm.kind in ('instance', 'logical', 'driver-group', 'unclassified')
        and not exists (
          select 1 from parameter_modules child where child.parent_id = pm.id
        )
        and not exists (
          select 1 from project_parameter_bindings b where b.module_id = pm.id
        )
      returning pm.id
      `,
      [input.organizationId, moduleId],
    );
    if (result.rows[0]) deleted.push(result.rows[0].id);
  }
  return deleted;
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
  projectCount: number;
  suggestedGroupName: string;
};

export type ObservedCompatibleHintsPage = {
  items: ObservedCompatibleHintRow[];
  total: number;
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
  input: { organizationId: string; limit?: number },
): Promise<ObservedCompatibleHintsPage> {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
  const result = await db.query<{
    compatible: string;
    binding_count: string;
    project_count: string;
  }>(
    `
    select
      lower(trim(both '"' from trim(both '''' from trim(both from lnr.compatible)))) as compatible,
      count(*)::text as binding_count,
      count(distinct b.project_id)::text as project_count
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
      and not exists (
        select 1
        from parameter_module_mappings mm
        where mm.organization_id = b.organization_id
          and mm.match_kind = 'compatible'
          and lower(trim(both '"' from trim(both '''' from trim(both from mm.match_value))))
            = lower(trim(both '"' from trim(both '''' from trim(both from lnr.compatible))))
      )
      and not exists (
        select 1
        from parameter_module_dismissed_compatibles dc
        where dc.organization_id = b.organization_id
          and lower(trim(both '"' from trim(both '''' from trim(both from dc.compatible))))
            = lower(trim(both '"' from trim(both '''' from trim(both from lnr.compatible))))
      )
    group by lower(trim(both '"' from trim(both '''' from trim(both from lnr.compatible))))
    order by count(*) desc, compatible asc
    `,
    [input.organizationId],
  );

  const filtered = result.rows
    .filter((row) => !isScaffoldingDriverLabel(row.compatible))
    .map((row) => ({
      compatible: row.compatible,
      bindingCount: Number(row.binding_count),
      projectCount: Number(row.project_count),
      suggestedGroupName: driverGroupDisplayNameFromCompatible(row.compatible),
    }));

  return {
    items: filtered.slice(0, limit),
    total: filtered.length,
  };
}

export async function insertDismissedCompatible(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    compatible: string;
    reason: string;
    dismissedByUserId: string | null;
  },
): Promise<void> {
  const compatible =
    normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  await db.query(
    `
    delete from parameter_module_dismissed_compatibles
    where organization_id = $1
      and lower(trim(both '"' from trim(both '''' from trim(both from compatible)))) = $2
    `,
    [input.organizationId, compatible],
  );
  await db.query(
    `
    insert into parameter_module_dismissed_compatibles
      (id, organization_id, compatible, reason, dismissed_by_user_id)
    values ($1, $2, $3, $4, $5)
    `,
    [
      input.id,
      input.organizationId,
      compatible,
      input.reason,
      input.dismissedByUserId,
    ],
  );
}

export async function deleteDismissedCompatible(
  db: Queryable,
  input: { organizationId: string; compatible: string },
): Promise<number> {
  const compatible =
    normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  const result = await db.query(
    `
    delete from parameter_module_dismissed_compatibles
    where organization_id = $1
      and lower(trim(both '"' from trim(both '''' from trim(both from compatible)))) = $2
    `,
    [input.organizationId, compatible],
  );
  return result.rowCount ?? 0;
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

export async function collectEmptyUnclassifiedBuckets(
  db: Queryable,
  organizationId: string,
): Promise<string[]> {
  const result = await db.query<{ id: string; name: string }>(
    `
    delete from parameter_modules pm
    where pm.organization_id = $1
      and pm.origin = 'auto'
      and pm.kind = 'unclassified'
      and pm.name like '未分类 · %'
      and not exists (
        select 1 from parameter_modules child
        where child.parent_id = pm.id
      )
      and not exists (
        select 1 from project_parameter_bindings b
        where b.module_id = pm.id
      )
    returning pm.id, pm.name
    `,
    [organizationId],
  );
  return result.rows.map((row) => row.id);
}

export async function getModuleNamesByIds(
  db: Queryable,
  input: { organizationId: string; moduleIds: string[] },
): Promise<Map<string, string>> {
  if (input.moduleIds.length === 0) return new Map();
  const result = await db.query<{ id: string; name: string }>(
    `
    select id, name
    from parameter_modules
    where organization_id = $1
      and id = any($2::text[])
    `,
    [input.organizationId, input.moduleIds],
  );
  return new Map(result.rows.map((row) => [row.id, row.name]));
}
