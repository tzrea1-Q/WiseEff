import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { assertNoCycle, buildPath, depthOf } from "../shared/moduleTree";
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
    order by path asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toParameterModuleDto);
}

export async function getParameterModuleById(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
): Promise<ParameterModuleDto | null> {
  const result = await db.query<ParameterModuleRow>(
    `
    select ${parameterModuleColumns}
    from parameter_modules
    where organization_id = $1
      and id = $2
    limit 1
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
    limit 1
    `,
    [query.organizationId, query.name, parentId]
  );

  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

export async function getParameterModuleBySourceKey(
  db: Queryable,
  query: { organizationId: string; sourceKey: string }
): Promise<ParameterModuleDto | null> {
  const result = await db.query<ParameterModuleRow>(
    `
    select ${parameterModuleColumns}
    from parameter_modules
    where organization_id = $1
      and source_key = $2
    limit 1
    `,
    [query.organizationId, query.sourceKey]
  );
  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

/** One-time adopt: attach a stable source_key to an unkeyed module without renaming it. */
export async function adoptParameterModuleSourceKey(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    sourceKey: string;
    kind?: ParameterModuleDto["kind"];
    origin?: ParameterModuleDto["origin"];
  }
): Promise<ParameterModuleDto | null> {
  const result = await db.query<ParameterModuleRow>(
    `
    update parameter_modules
    set
      source_key = coalesce(source_key, $3),
      kind = coalesce($4, kind),
      origin = coalesce($5, origin),
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${parameterModuleColumns}
    `,
    [
      input.organizationId,
      input.moduleId,
      input.sourceKey,
      input.kind ?? null,
      input.origin ?? null
    ]
  );
  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

/**
 * Re-assert kind on auto-discovered modules during ingest. Curated rows are never
 * overwritten — manual reclassify must stick across re-ingest (ADR-0006).
 */
export async function reassertAutoParameterModuleKind(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    kind: ParameterModuleDto["kind"];
  }
): Promise<ParameterModuleDto | null> {
  const result = await db.query<ParameterModuleRow>(
    `
    update parameter_modules
    set
      kind = $3,
      updated_at = now()
    where organization_id = $1
      and id = $2
      and origin = 'auto'
      and kind <> $3
    returning ${parameterModuleColumns}
    `,
    [input.organizationId, input.moduleId, input.kind]
  );
  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

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
    `,
    [query.organizationId, query.moduleId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function countParametersForModule(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from ${LEGACY_IDENTITY_SQL.definitionsTable}
    where organization_id = $1
      and parameter_module_id = $2
    `,
    [query.organizationId, query.moduleId]
  );

  return Number(result.rows[0]?.count ?? 0);
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
    kind?: ParameterModuleDto["kind"];
    origin?: ParameterModuleDto["origin"];
    sourceKey?: string | null;
  }
) {
  const id = randomUUID();
  const kind = input.kind ?? "business";
  const origin = input.origin ?? "curated";
  const name = input.name.trim();
  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId
    });
    if (!parent) {
      throw new Error("Parent parameter module not found");
    }
    parentPath = parent.path;
  }

  const path = buildPath(parentPath, id);
  const depth = depthOf(path);

  let attributionSubjectId: string | null = null;
  if (kind === "driver-group" || kind === "node-type") {
    const { insertAttributionSubjectForNewModule } = await import(
      "../parameter-modules/attributionSubjectRepository"
    );
    attributionSubjectId = await insertAttributionSubjectForNewModule(db, {
      moduleId: id,
      organizationId: input.organizationId,
      kind,
      displayName: name,
      origin,
      sourceKey: input.sourceKey ?? null,
      notes: input.description ?? "",
    });
  }

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
      attributionSubjectId
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
    kind?: ParameterModuleDto["kind"];
  }
) {
  const existing = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
  if (!existing) {
    return null;
  }

  const nextKind = input.kind ?? existing.kind;
  if (input.importance !== undefined && input.importance !== null && nextKind !== "business") {
    throw new Error("Importance can only be set on business-category modules");
  }

  const nextName = input.name?.trim() ?? existing.name;
  const shouldPromote =
    existing.origin === "auto" &&
    (input.name !== undefined || input.importance !== undefined || input.kind !== undefined);

  const clearImportance = input.kind !== undefined && input.kind !== "business" && existing.kind === "business";
  const nextImportance = clearImportance
    ? "medium"
    : input.importance === null
      ? existing.importance
      : input.importance ?? null;

  const result = await db.query<ParameterModuleRow>(
    `
    update parameter_modules
    set
      name = $3,
      description = coalesce($4, description),
      scope = coalesce($5, scope),
      sort_order = coalesce($6, sort_order),
      importance = case
        when $9::boolean then 'medium'
        when $7::text is not null then $7
        else importance
      end,
      kind = coalesce($10, kind),
      origin = case when $8::boolean then 'curated' else origin end,
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${parameterModuleColumns}
    `,
    [
      input.organizationId,
      input.moduleId,
      nextName,
      input.description ?? null,
      input.scope ?? null,
      input.sortOrder ?? null,
      nextImportance,
      shouldPromote,
      clearImportance,
      input.kind ?? null
    ]
  );

  if (result.rows[0] && nextName !== existing.name) {
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

  return result.rows[0] ? toParameterModuleDto(result.rows[0]) : null;
}

export async function moveParameterModule(
  db: Queryable,
  input: { organizationId: string; moduleId: string; parentId: string | null }
) {
  const node = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
  if (!node) {
    return null;
  }

  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId
    });
    if (!parent) {
      throw new Error("Target parent parameter module not found");
    }
    parentPath = parent.path;
  }

  const allModules = await listParameterModules(db, { organizationId: input.organizationId });
  const byId = new Map(allModules.map((item) => ({ id: item.id, path: item.path })).map((item) => [item.id, item]));
  assertNoCycle(input.moduleId, input.parentId, byId);

  const oldPath = node.path;
  const newPath = buildPath(parentPath, input.moduleId);
  const depthDelta = depthOf(newPath) - node.depth;

  await db.query(
    `
    update parameter_modules
    set
      parent_id = $3,
      path = case
        when id = $2 then $4
        else $4 || substring(path from length($5) + 1)
      end,
      depth = depth + $6,
      origin = case when id = $2 and origin = 'auto' then 'curated' else origin end,
      updated_at = now()
    where organization_id = $1
      and (id = $2 or path like $5 || '/%')
    `,
    [input.organizationId, input.moduleId, input.parentId, newPath, oldPath, depthDelta]
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
  const existing = await getParameterModuleById(db, input);
  if (!existing) {
    return false;
  }
  if (existing.kind === "node-type") {
    throw new Error("Cannot delete a node-type module");
  }
  if (existing.kind === "unclassified" && existing.parentId === null) {
    throw new Error("Cannot delete the unclassified root module");
  }

  const childCount = await countParameterModuleChildren(db, input);
  if (childCount > 0) {
    throw new Error("Cannot delete parameter module with child modules");
  }

  const parameterCount = await countParametersForModule(db, input);
  if (parameterCount > 0) {
    throw new Error("Cannot delete parameter module referenced by parameters");
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
