import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { assertNoCycle, buildPath, depthOf } from "../shared/moduleTree";
import type { DebugNodeModuleRecord } from "./types";

type DebugNodeModuleRow = {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number | string;
  sort_order: number | string;
  description: string;
  scope: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date | null | undefined) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDebugNodeModuleRecord(row: DebugNodeModuleRow): DebugNodeModuleRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    path: row.path,
    depth: Number(row.depth),
    sortOrder: Number(row.sort_order),
    description: row.description,
    scope: row.scope,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

const debugNodeModuleColumns = `
  id,
  organization_id,
  parent_id,
  name,
  path,
  depth,
  sort_order,
  description,
  scope,
  created_at,
  updated_at
`;

export async function listDebugNodeModules(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<DebugNodeModuleRow>(
    `
    select ${debugNodeModuleColumns}
    from debug_node_modules
    where organization_id = $1
    order by path asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toDebugNodeModuleRecord);
}

export async function getDebugNodeModuleById(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
): Promise<DebugNodeModuleRecord | null> {
  const result = await db.query<DebugNodeModuleRow>(
    `
    select ${debugNodeModuleColumns}
    from debug_node_modules
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.moduleId]
  );

  return result.rows[0] ? toDebugNodeModuleRecord(result.rows[0]) : null;
}

export async function getDebugNodeModuleByName(
  db: Queryable,
  query: { organizationId: string; name: string; parentId?: string | null }
): Promise<DebugNodeModuleRecord | null> {
  const parentId = query.parentId ?? null;
  const result = await db.query<DebugNodeModuleRow>(
    `
    select ${debugNodeModuleColumns}
    from debug_node_modules
    where organization_id = $1
      and name = $2
      and coalesce(parent_id, '') = coalesce($3::text, '')
    limit 1
    `,
    [query.organizationId, query.name, parentId]
  );

  return result.rows[0] ? toDebugNodeModuleRecord(result.rows[0]) : null;
}

export async function countDebugNodeModuleChildren(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from debug_node_modules
    where organization_id = $1
      and parent_id = $2
    `,
    [query.organizationId, query.moduleId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function countDebugNodesForModuleId(
  db: Queryable,
  query: { organizationId: string; moduleId: string }
) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from debug_nodes
    where organization_id = $1
      and debug_node_module_id = $2
    `,
    [query.organizationId, query.moduleId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function createDebugNodeModule(
  db: Queryable,
  input: {
    organizationId: string;
    name: string;
    parentId?: string | null;
    description?: string;
    scope?: string;
    sortOrder?: number;
  }
) {
  const id = randomUUID();
  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getDebugNodeModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId
    });
    if (!parent) {
      throw new Error("Parent debug node module not found");
    }
    parentPath = parent.path;
  }

  const path = buildPath(parentPath, id);
  const depth = depthOf(path);

  const result = await db.query<DebugNodeModuleRow>(
    `
    insert into debug_node_modules (
      id, organization_id, parent_id, name, path, depth, sort_order, description, scope
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning ${debugNodeModuleColumns}
    `,
    [
      id,
      input.organizationId,
      input.parentId ?? null,
      input.name.trim(),
      path,
      depth,
      input.sortOrder ?? 0,
      input.description ?? "",
      input.scope ?? ""
    ]
  );

  return toDebugNodeModuleRecord(result.rows[0]);
}

export async function updateDebugNodeModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    name?: string;
    description?: string;
    scope?: string;
    sortOrder?: number;
  }
) {
  const existing = await getDebugNodeModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
  if (!existing) {
    return null;
  }

  const nextName = input.name?.trim() ?? existing.name;
  const result = await db.query<DebugNodeModuleRow>(
    `
    update debug_node_modules
    set
      name = $3,
      description = coalesce($4, description),
      scope = coalesce($5, scope),
      sort_order = coalesce($6, sort_order),
      updated_at = now()
    where organization_id = $1
      and id = $2
    returning ${debugNodeModuleColumns}
    `,
    [
      input.organizationId,
      input.moduleId,
      nextName,
      input.description ?? null,
      input.scope ?? null,
      input.sortOrder ?? null
    ]
  );

  if (result.rows[0] && nextName !== existing.name) {
    await db.query(
      `
      update debug_nodes
      set module = $3,
        updated_at = now()
      where organization_id = $1
        and debug_node_module_id = $2
      `,
      [input.organizationId, input.moduleId, nextName]
    );
  }

  return result.rows[0] ? toDebugNodeModuleRecord(result.rows[0]) : null;
}

export async function moveDebugNodeModule(
  db: Queryable,
  input: { organizationId: string; moduleId: string; parentId: string | null }
) {
  const node = await getDebugNodeModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
  if (!node) {
    return null;
  }

  let parentPath: string | null = null;
  if (input.parentId) {
    const parent = await getDebugNodeModuleById(db, {
      organizationId: input.organizationId,
      moduleId: input.parentId
    });
    if (!parent) {
      throw new Error("Target parent debug node module not found");
    }
    parentPath = parent.path;
  }

  const allModules = await listDebugNodeModules(db, { organizationId: input.organizationId });
  const byId = new Map(allModules.map((item) => [item.id, { id: item.id, path: item.path }]));
  assertNoCycle(input.moduleId, input.parentId, byId);

  const oldPath = node.path;
  const newPath = buildPath(parentPath, input.moduleId);
  const depthDelta = depthOf(newPath) - node.depth;

  await db.query(
    `
    update debug_node_modules
    set
      parent_id = $3,
      path = case
        when id = $2 then $4
        else $4 || substring(path from length($5) + 1)
      end,
      depth = depth + $6,
      updated_at = now()
    where organization_id = $1
      and (id = $2 or path like $5 || '/%')
    `,
    [input.organizationId, input.moduleId, input.parentId, newPath, oldPath, depthDelta]
  );

  return getDebugNodeModuleById(db, {
    organizationId: input.organizationId,
    moduleId: input.moduleId
  });
}

export async function deleteDebugNodeModuleById(
  db: Queryable,
  input: { organizationId: string; moduleId: string }
) {
  const childCount = await countDebugNodeModuleChildren(db, input);
  if (childCount > 0) {
    throw new Error("Cannot delete debug node module with child modules");
  }

  const nodeCount = await countDebugNodesForModuleId(db, input);
  if (nodeCount > 0) {
    throw new Error("Cannot delete debug node module referenced by debug nodes");
  }

  const result = await db.query(
    `
    delete from debug_node_modules
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.moduleId]
  );

  return (result.rowCount ?? 0) > 0;
}

export function buildDebugNodeModuleSubtreeFilter(
  values: unknown[],
  moduleId: string,
  includeDescendants: boolean,
  debugNodeModuleIdColumn = "n.debug_node_module_id"
) {
  if (includeDescendants) {
    values.push(moduleId);
    const moduleIdPlaceholder = `$${values.length}`;
    return `
      exists (
        select 1
        from debug_node_modules dm_sel
        inner join debug_node_modules dm_node on dm_node.id = ${debugNodeModuleIdColumn}
        where dm_sel.id = ${moduleIdPlaceholder}
          and dm_sel.organization_id = dm_node.organization_id
          and (
            dm_node.id = dm_sel.id
            or dm_node.path like dm_sel.path || '/%'
          )
      )
    `;
  }

  values.push(moduleId);
  return `${debugNodeModuleIdColumn} = $${values.length}`;
}
