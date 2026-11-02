import { LEGACY_IDENTITY_SQL } from "../parameter-kernel/legacyParameterIdentityNames";
import { parameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { assertNoCycle, buildPath, depthOf } from "../shared/moduleTree";
import {
  countCurrentBindingsForModule,
  countSubjectPlacementsForModules,
} from "../parameter-catalog-api/governance/index";
import type { ParameterModuleDto } from "./types";

type ParameterModuleRow = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number | string;
  sort_order: number | string;
  description: string;
  scope: string;
  importance: "high" | "medium" | "low" | null;
  kind: "business" | "driver-group" | "node-type" | "unclassified" | null;
  origin: "curated" | "auto" | null;
  source_key: string | null;
  attribution_subject_id: string | null;
};

function toParameterModuleDto(row: ParameterModuleRow): ParameterModuleDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    path: row.path,
    depth: Number(row.depth),
    sortOrder: Number(row.sort_order),
    description: row.description,
    scope: row.scope,
    importance: row.importance ?? "medium",
    kind: row.kind ?? "business",
    origin: row.origin ?? "curated",
    sourceKey: row.source_key ?? null,
    attributionSubjectId: row.attribution_subject_id ?? null
  };
}

const parameterModuleColumns = `
  id,
  organization_id,
  parent_id,
  name,
  path,
  depth,
  sort_order,
  description,
  scope,
  importance,
  kind,
  origin,
  source_key,
  attribution_subject_id
`;

export async function listParameterModules(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ParameterModuleRow>(
    `
    select ${parameterModuleColumns}
    from parameter_modules
    where organization_id = $1
      and archived_at is null
    order by path asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toParameterModuleDto);
}

export async function getParameterModuleById(
  db: Queryable,
  query: { organizationId: string; moduleId: string; forUpdate?: boolean; activeOnly?: boolean }
): Promise<ParameterModuleDto | null> {
  const result = await db.query<ParameterModuleRow>(
    `
    select ${parameterModuleColumns}
    from parameter_modules
    where organization_id = $1
      and id = $2
      ${query.activeOnly ? "and archived_at is null" : ""}
    limit 1
    ${query.forUpdate ? "for update" : ""}
    `,
    [query.organizationId, query.moduleId]
  );

  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

export async function getParameterModuleByName(
  db: Queryable,
  query: { organizationId: string; name: string; parentId?: string | null }
): Promise<ParameterModuleDto | null> {
  const parentId = query.parentId ?? null;
  const result = await db.query<ParameterModuleRow>(
    `
    select ${parameterModuleColumns}
    from parameter_modules
    where organization_id = $1
      and name = $2
      and coalesce(parent_id, '') = coalesce($3::text, '')
      and archived_at is null
    limit 1
    `,
    [query.organizationId, query.name, parentId]
  );

  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

/** Count active children; archived children are retained historical references. */
export async function countParameterModuleChildren(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from parameter_modules
    where organization_id = $1
      and parent_id = $2
      and archived_at is null
    `,
    [query.organizationId, query.moduleId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function countParametersForModule(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  return countCurrentBindingsForModule(db, query);
}

export async function countCanonicalPlacementsForModule(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  return countSubjectPlacementsForModules(db, {
    organizationId: query.organizationId,
    moduleIds: [query.moduleId],
  });
}

export async function countCanonicalPlacementsForModules(
  db: Queryable,
  query: { organizationId: string; moduleIds: string[] },
) {
  return countSubjectPlacementsForModules(db, query);
}

export async function createParameterModule(
  db: Queryable,
  input: {
    organizationId: string;
    name: string;
    parentId?: string | null;
    description?: string;
    scope?: string;
    sortOrder?: number;
    importance?: "high" | "medium" | "low";
    kind?: import("./types").WritableModuleKind;
    origin?: ParameterModuleDto["origin"];
    sourceKey?: string | null;
  }
) {
  const id = randomUUID();
  const kind = input.kind ?? "business";
  if (kind !== "business" && kind !== "unclassified") throw new Error("Only business modules and the reserved unclassified root may be created.");
  if (kind === "unclassified" && input.parentId) throw new Error("The unclassified module must be a root.");
  const origin = input.origin ?? "curated";
  const name = input.name.trim();
  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId,
      activeOnly: true
    });
    if (!parent || parent.kind !== "business") {
      throw new Error("Parent parameter module not found");
    }
    parentPath = parent.path;
  }

  const path = buildPath(parentPath, id);
  const depth = depthOf(path);


  const result = await db.query<ParameterModuleRow>(
    `
    insert into parameter_modules (
      id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
      importance, kind, origin, source_key, attribution_subject_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    returning ${parameterModuleColumns}
    `,
    [
      id,
      input.organizationId,
      input.parentId ?? null,
      name,
      path,
      depth,
      input.sortOrder ?? 0,
      input.description ?? "",
      input.scope ?? "",
      input.importance ?? "medium",
      kind,
      origin,
      input.sourceKey ?? null,
      null
    ]
  );

  return toParameterModuleDto(result.rows[0]);
}

export async function updateParameterModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    name?: string;
    description?: string;
    scope?: string;
    sortOrder?: number;
    importance?: "high" | "medium" | "low" | null;
    kind?: import("./types").WritableModuleKind;
    promoteToCurated?: boolean;
  }
) {
  const existing = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId,
    activeOnly: true
  });
  if (!existing) {
    return null;
  }
  if (existing.kind !== "business" || (input.kind !== undefined && input.kind !== "business")) {
    throw new ApiError("CONFLICT", "Only business modules can be edited.");
  }

  const nextName = input.name?.trim() ?? existing.name;
  const shouldPromote =
    existing.origin === "auto" &&
    (input.promoteToCurated || input.name !== undefined || input.description !== undefined || input.scope !== undefined ||
      input.sortOrder !== undefined || input.importance !== undefined || input.kind !== undefined);

  const clearImportance = input.kind !== undefined && input.kind !== "business" && existing.kind === "business";
  const nextImportance = clearImportance
    ? "medium"
    : input.importance ?? null;

  const result = await db.query<ParameterModuleRow>(
    `
    update parameter_modules
    set
      name = coalesce($3, name),
      description = coalesce($4, description),
      scope = coalesce($5, scope),
      sort_order = coalesce($6, sort_order),
      importance = case
        when $9::boolean then 'medium'
        when $7::text is not null then $7
        else importance
      end,
      importance_override = importance_override or $7::text is not null,
      kind = coalesce($10, kind),
      origin = case when $8::boolean then 'curated' else origin end,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and archived_at is null
      and kind = 'business'
    returning ${parameterModuleColumns}
    `,
    [
      input.organizationId,
      input.moduleId,
      input.name?.trim() ?? null,
      input.description ?? null,
      input.scope ?? null,
      input.sortOrder ?? null,
      nextImportance,
      shouldPromote,
      clearImportance,
      input.kind ?? null
    ]
  );

  // Structural module renames change display metadata, never retained flat
  // labels. Registered business placements also read their live module label.
  if (result.rows[0] && nextName !== existing.name && parameterIdentityMode() === "legacy"
    && await countCanonicalPlacementsForModule(db, input) === 0) {
    const linked = await db.query<{ present: boolean }>(
      `select exists (
        select 1 from ${LEGACY_IDENTITY_SQL.definitionsTable}
        where organization_id = $1
          and parameter_module_id = $2
      ) as present`,
      [input.organizationId, input.moduleId]
    );
    if (linked.rows[0].present) {
      await db.query(
        `
      update ${LEGACY_IDENTITY_SQL.definitionsTable}
      set module = $3,
        updated_at = now()
      where organization_id = $1
        and parameter_module_id = $2
      `,
        [input.organizationId, input.moduleId, nextName]
      );
    }
  }

  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

export async function moveParameterModule(
  db: Queryable,
  input: { organizationId: string; moduleId: string; parentId: string | null }
) {
  return reparentParameterModule(db, {
    ...input,
    promoteAutoToCurated: true,
  });
}

export async function lockParameterModuleTree(db: Queryable, organizationId: string) {
  // The caller's transaction owns this lock until commit, so reciprocal moves
  // cannot both validate against the same old tree and create a cycle.
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `parameter-module-tree:${organizationId}`,
  ]);
}

async function reparentParameterModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    parentId: string | null;
    promoteAutoToCurated: boolean;
  }
) {
  await lockParameterModuleTree(db, input.organizationId);
  const node = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId,
    activeOnly: true
  });
  if (!node) {
    return null;
  }
  if (node.kind !== "business") {
    throw new ApiError("CONFLICT", "Only business modules can be moved");
  }

  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId,
      activeOnly: true
    });
    if (!parent) {
      throw new Error("Target parent parameter module not found");
    }
    if (parent.kind !== "business") {
      throw new ApiError("CONFLICT", "Target parent is not valid for this module kind", {
        moduleId: node.id, kind: node.kind, parentId: parent.id, parentKind: parent.kind,
      });
    }
    parentPath = parent.path;
  }

  const allModules = await listParameterModules(db, { organizationId: input.organizationId });
  if (allModules.some((module) => module.path.startsWith(`${node.path}/`) && module.kind !== "business")) {
    throw new ApiError("CONFLICT", "请先迁移业务模块下的遗留技术模块。");
  }
  const byId = new Map(allModules.map((item) => ({ id: item.id, path: item.path })).map((item) => [item.id, item]));
  assertNoCycle(input.moduleId, input.parentId, byId);

  const oldPath = node.path;
  const newPath = buildPath(parentPath, input.moduleId);
  const depthDelta = depthOf(newPath) - node.depth;

  await db.query(
    `
    update parameter_modules
    set
      parent_id = case when id = $2 then $3 else parent_id end,
      path = case
        when id = $2 then $4
        else $4 || substring(path from length($5) + 1)
      end,
      depth = depth + $6,
      origin = case
        when $7::boolean and id = $2 and origin = 'auto' then 'curated'
        else origin
      end,
      updated_at = now()
    where organization_id = $1
      and archived_at is null
      and (id = $2 or path like $5 || '/%')
    `,
    [
      input.organizationId,
      input.moduleId,
      input.parentId,
      newPath,
      oldPath,
      depthDelta,
      input.promoteAutoToCurated,
    ]
  );

  return getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
}

export async function deleteParameterModule(
  db: Queryable,
  input: { organizationId: string; moduleId: string }
) {
  const existing = await getParameterModuleById(db, { ...input, forUpdate: true, activeOnly: true });
  if (!existing) {
    return false;
  }
  if (existing.kind === "driver-group" || existing.kind === "node-type") {
    throw new ApiError("CONFLICT", "Legacy technical modules are read-only.");
  }
  if (existing.kind === "unclassified" && existing.parentId === null) {
    throw new ApiError("CONFLICT", "Cannot delete the unclassified root module", { moduleId: input.moduleId });
  }

  const childCount = await countParameterModuleChildren(db, input);
  if (childCount > 0) {
    throw new ApiError("CONFLICT", "Cannot delete parameter module with child modules", {
      moduleId: input.moduleId, childCount,
    });
  }

  const result = await db.query(
    `
    delete from parameter_modules
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.moduleId]
  );

  return (result.rowCount ?? 0) > 0;
}

export function buildParameterModuleSubtreeFilter(
  values: unknown[],
  moduleId: string,
  includeDescendants: boolean,
  parameterModuleIdColumn = "pd.parameter_module_id"
) {
  if (includeDescendants) {
    values.push(moduleId);
    const moduleIdPlaceholder = `$${values.length}`;
    return `
      exists (
        select 1
        from parameter_modules pm_sel
        inner join parameter_modules pm_node on pm_node.id = ${parameterModuleIdColumn}
        where pm_sel.id = ${moduleIdPlaceholder}
          and pm_sel.organization_id = pm_node.organization_id
          and (
            pm_node.id = pm_sel.id
            or pm_node.path like pm_sel.path || '/%'
          )
      )
    `;
  }

  values.push(moduleId);
  return `${parameterModuleIdColumn} = $${values.length}`;
}

export async function resolveParameterModulePathNames(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
): Promise<string[]> {
  const module = await getParameterModuleById(db, query);
  if (!module) {
    return [];
  }

  const segments = module.path.split("/");
  const result = await db.query<{ id: string; name: string }>(
    `
    select id, name
    from parameter_modules
    where organization_id = $1
      and id = any($2::text[])
    `,
    [query.organizationId, segments]
  );

  const nameById = new Map(result.rows.map((row) => [row.id, row.name]));
  return segments.map((id) => nameById.get(id) ?? id);
}
