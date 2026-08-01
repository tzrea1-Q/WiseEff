/**
 * Ensure attribution-level parameter_modules rows during ingest and resolve
 * binding.module_id via the shared resolver (compatible → node-type → unclassified).
 *
 * Stable identity is `source_key` (ADR-0004). Name is display-only once a module
 * is curated — ingest must never rename or move curated modules.
 *
 * Placement (D-AG-04 / TD-046): auto driver-groups land under the driver
 * registration's default business category. Existing modules found by
 * source_key are not silently reparented on every ingest — movement happens
 * when the registration default changes or via explicit Admin replay.
 */

import {
  BOARD_INSTANCE_MODULE_NAME,
  businessCategoryForNodePath,
  driverGroupDisplayNameFromCompatible,
  isModuleScaffoldingNode,
  isScaffoldingDriverLabel,
  nodeTypeKeyForNode,
  nodeTypeSourceKey,
  normalizeMatchToken,
} from "./modulePlacement";
import {
  adoptParameterModuleSourceKey,
  createParameterModule,
  getParameterModuleById,
  getParameterModuleBySourceKey,
  reassertAutoParameterModuleKind,
} from "../parameters/parameterModuleRepository";
import type { ModuleKind } from "../parameters/types";
import type { Queryable } from "../../shared/database/client";
import { resolveModuleIdForBinding } from "./resolveModuleForBinding";
import {
  bootstrapDriverRegistrationDefaultIfNull,
  findAttributionSubjectIdBySourceKey,
  getDriverRegistrationDefaultBusinessCategoryId,
} from "./driverPlacement";

export function compatibleSourceKey(compatible: string): string {
  return `compatible:${normalizeMatchToken(compatible) ?? compatible.trim().toLowerCase()}`;
}

function nodePathFromLocator(locator: string | null | undefined): string {
  if (!locator || locator === "/") return "";
  return locator.startsWith("/") ? locator.slice(1) : locator;
}

function parseNodeIdentity(input: {
  instanceName: string | null;
  nodeLocator?: string | null;
}): { name: string; unitAddress?: string | null; nodePath: string } {
  const nodePath = nodePathFromLocator(input.nodeLocator);
  if (input.instanceName === "/" || (input.instanceName === null && nodePath === "")) {
    return { name: "/", nodePath: "" };
  }
  const rawName =
    input.instanceName ??
    (nodePath ? nodePath.split("/").filter(Boolean).at(-1) ?? "" : "");
  if (rawName.includes("@")) {
    const [name, unitAddress] = rawName.split("@");
    return { name: name ?? rawName, unitAddress, nodePath };
  }
  return { name: rawName, nodePath };
}

async function findModuleIdByName(
  db: Queryable,
  input: { organizationId: string; name: string; parentId?: string | null },
): Promise<string | null> {
  const parentId = input.parentId ?? null;
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_modules
    where organization_id = $1
      and name = $2
      and coalesce(parent_id, '') = coalesce($3::text, '')
    limit 1
    `,
    [input.organizationId, input.name, parentId],
  );
  return result.rows[0]?.id ?? null;
}

async function findBusinessModuleIdByName(
  db: Queryable,
  input: { organizationId: string; name: string },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_modules
    where organization_id = $1
      and name = $2
      and kind = 'business'
    order by depth asc, sort_order asc, id asc
    limit 1
    `,
    [input.organizationId, input.name],
  );
  return result.rows[0]?.id ?? null;
}

async function findModuleIdByNameAnyParent(
  db: Queryable,
  input: { organizationId: string; name: string },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from parameter_modules
    where organization_id = $1
      and name = $2
    order by depth asc, sort_order asc, id asc
    limit 1
    `,
    [input.organizationId, input.name],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Resolve or create a module by stable source_key, with a one-time name fallback
 * that adopts unkeyed rows. Never renames or moves curated modules.
 * Existing keyed modules are returned as-is (no silent reparent on ingest).
 */
async function ensureNamedModule(
  db: Queryable,
  input: {
    organizationId: string;
    name: string;
    parentId: string | null;
    kind: ModuleKind;
    sourceKey: string;
    description?: string;
    scope?: string;
    defaultBusinessCategoryModuleId?: string | null;
  },
): Promise<string> {
  const byKey = await getParameterModuleBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey: input.sourceKey,
  });
  if (byKey) {
    if (byKey.origin === "auto" && byKey.kind !== input.kind) {
      await reassertAutoParameterModuleKind(db, {
        organizationId: input.organizationId,
        moduleId: byKey.id,
        kind: input.kind,
      });
    }
    return byKey.id;
  }

  const existingId = await findModuleIdByName(db, {
    organizationId: input.organizationId,
    name: input.name,
    parentId: input.parentId,
  });
  if (existingId) {
    const existing = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: existingId,
    });
    if (existing && !existing.sourceKey) {
      await adoptParameterModuleSourceKey(db, {
        organizationId: input.organizationId,
        moduleId: existingId,
        sourceKey: input.sourceKey,
        kind: input.kind,
        origin: existing.origin === "curated" ? "curated" : "auto",
      });
    }
    return existingId;
  }

  const created = await createParameterModule(db, {
    organizationId: input.organizationId,
    name: input.name,
    parentId: input.parentId,
    description: input.description ?? "",
    scope: input.scope ?? "",
    kind: input.kind,
    origin: "auto",
    sourceKey: input.sourceKey,
    defaultBusinessCategoryModuleId: input.defaultBusinessCategoryModuleId ?? null,
  });
  return created.id;
}

/**
 * Ensure a real business-category leaf exists (never park under unclassified).
 * Seed/bootstrap path only — product placement prefers an existing registration default.
 */
async function ensureBusinessLeafModuleId(
  db: Queryable,
  input: { organizationId: string; businessCategory: string },
): Promise<string> {
  const existing = await findBusinessModuleIdByName(db, {
    organizationId: input.organizationId,
    name: input.businessCategory,
  });
  if (existing) return existing;

  // Root name may already be taken by a non-business module (legacy seed fixtures
  // sometimes reuse heuristic category labels as driver-group names). Never collide.
  const rootNameTaken = await findModuleIdByName(db, {
    organizationId: input.organizationId,
    name: input.businessCategory,
    parentId: null,
  });
  if (rootNameTaken) {
    return resolveModuleIdForBinding(db, {
      organizationId: input.organizationId,
      driverModule: null,
      compatible: null,
      nodeType: null,
    });
  }

  try {
    const created = await createParameterModule(db, {
      organizationId: input.organizationId,
      name: input.businessCategory,
      parentId: null,
      kind: "business",
      origin: "auto",
      description: `Bootstrap business category (${input.businessCategory}).`,
      scope: "registration-default-bootstrap",
    });
    return created.id;
  } catch {
    // Concurrent bootstrap or residual unique race — prefer existing business, else unclassified.
    const raced = await findBusinessModuleIdByName(db, {
      organizationId: input.organizationId,
      name: input.businessCategory,
    });
    if (raced) return raced;
    return resolveModuleIdForBinding(db, {
      organizationId: input.organizationId,
      driverModule: null,
      compatible: null,
      nodeType: null,
    });
  }
}

/**
 * Resolve the authoritative business parent for a driver-group source_key.
 * Uses registration default when set; otherwise bootstraps once from the
 * demoted keyword heuristic and persists that default onto the registration.
 */
async function resolveDriverGroupBusinessParentId(
  db: Queryable,
  input: {
    organizationId: string;
    sourceKey: string;
    nodePath: string;
  },
): Promise<string> {
  const subjectId = await findAttributionSubjectIdBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey: input.sourceKey,
  });

  if (subjectId) {
    const existingDefault = await getDriverRegistrationDefaultBusinessCategoryId(db, {
      attributionSubjectId: subjectId,
    });
    if (existingDefault) {
      const parent = await getParameterModuleById(db, {
        organizationId: input.organizationId,
        moduleId: existingDefault,
      });
      if (parent?.kind === "business") {
        return parent.id;
      }
    }
  }

  // Seed / bootstrap-once only — not the steady-state product placement rule.
  const businessCategory = businessCategoryForNodePath(input.nodePath);
  const parentId = await ensureBusinessLeafModuleId(db, {
    organizationId: input.organizationId,
    businessCategory,
  });

  if (subjectId) {
    await bootstrapDriverRegistrationDefaultIfNull(db, {
      attributionSubjectId: subjectId,
      defaultBusinessCategoryModuleId: parentId,
    });
  }

  return parentId;
}

async function ensureDriverGroupModuleForAutoDiscovery(
  db: Queryable,
  input: {
    organizationId: string;
    compatible: string;
    nodePath: string;
  },
): Promise<void> {
  const compatibleKey = normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  const groupName = driverGroupDisplayNameFromCompatible(compatibleKey);
  const sourceKey = compatibleSourceKey(compatibleKey);

  // Existing keyed modules stay put — movement is default-change / explicit replay only.
  const existing = await getParameterModuleBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey,
  });
  if (existing) {
    if (existing.origin === "auto" && existing.kind !== "driver-group") {
      await reassertAutoParameterModuleKind(db, {
        organizationId: input.organizationId,
        moduleId: existing.id,
        kind: "driver-group",
      });
    }
    return;
  }

  const parentId = await resolveDriverGroupBusinessParentId(db, {
    organizationId: input.organizationId,
    sourceKey,
    nodePath: input.nodePath,
  });
  await ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: groupName,
    parentId,
    kind: "driver-group",
    sourceKey,
    description: `${groupName} 驱动组（compatible: ${compatibleKey}）。`,
    scope: `共享 compatible ${compatibleKey} 的节点类型分组`,
    defaultBusinessCategoryModuleId: parentId,
  });
}

async function ensureNodeTypeModuleForAutoDiscovery(
  db: Queryable,
  input: {
    organizationId: string;
    nodeType: string;
    nodePath: string;
    compatible: string | null;
  },
): Promise<void> {
  const sourceKey = nodeTypeSourceKey(input.nodeType);
  const existing = await getParameterModuleBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey,
  });
  if (existing) {
    if (existing.origin === "auto" && existing.kind !== "node-type") {
      await reassertAutoParameterModuleKind(db, {
        organizationId: input.organizationId,
        moduleId: existing.id,
        kind: "node-type",
      });
    }
    return;
  }

  // Prefer nesting under an existing driver-group for the compatible.
  // Standalone node-types (no mapped group) bootstrap a real business leaf
  // via the demoted heuristic — not a temporary staging category.
  let parentId: string | null = null;

  const normalizedCompatible = normalizeMatchToken(input.compatible);
  if (normalizedCompatible) {
    const groupName = driverGroupDisplayNameFromCompatible(normalizedCompatible);
    const groupId = await findModuleIdByNameAnyParent(db, {
      organizationId: input.organizationId,
      name: groupName,
    });
    if (groupId) parentId = groupId;
  }

  if (!parentId) {
    const businessCategory = businessCategoryForNodePath(input.nodePath);
    parentId = await ensureBusinessLeafModuleId(db, {
      organizationId: input.organizationId,
      businessCategory,
    });
  }

  await ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: input.nodeType,
    parentId,
    kind: "node-type",
    sourceKey,
    description: `${input.nodeType} DTS 节点类型模块。`,
    scope: `节点类型 ${input.nodeType}`,
  });
}

/**
 * Resolve (and when needed, materialize) the durable attribution module for a binding write.
 */
export async function resolveAttributionModuleForBinding(
  db: Queryable,
  input: {
    organizationId: string;
    driverModule: string | null;
    compatible: string | null;
    instanceName: string | null;
    nodeLocator?: string | null;
  },
): Promise<string> {
  const identity = parseNodeIdentity(input);
  const nodeType = nodeTypeKeyForNode(identity);
  const scaffolding = isModuleScaffoldingNode({
    name: identity.name === "/" ? BOARD_INSTANCE_MODULE_NAME : identity.name,
    compatible: input.compatible,
    nodePath: identity.nodePath,
    unitAddress: identity.unitAddress,
  });

  if (!scaffolding) {
    const normalizedCompatible = normalizeMatchToken(input.compatible);
    if (
      normalizedCompatible &&
      !isScaffoldingDriverLabel(normalizedCompatible) &&
      !isScaffoldingDriverLabel(input.driverModule)
    ) {
      await ensureDriverGroupModuleForAutoDiscovery(db, {
        organizationId: input.organizationId,
        compatible: normalizedCompatible,
        nodePath: identity.nodePath,
      });
    }
    if (nodeType) {
      await ensureNodeTypeModuleForAutoDiscovery(db, {
        organizationId: input.organizationId,
        nodeType,
        nodePath: identity.nodePath,
        compatible: input.compatible,
      });
    }
  }

  return resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: input.driverModule,
    compatible: input.compatible,
    nodeType,
  });
}
