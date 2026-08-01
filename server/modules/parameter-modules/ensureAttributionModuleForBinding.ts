/**
 * Ensure attribution-level parameter_modules rows during ingest and resolve
 * binding.module_id via the shared resolver (compatible → node-type → unclassified).
 *
 * Stable identity is `source_key` (ADR-0004). Name is display-only once a module
 * is curated — ingest must never rename or move curated modules.
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
 * When an existing auto-discovered module lacks attribution_subject_id, ensure a
 * catalog subject (compatible-like for driver-groups) and link it. Avoids returning
 * subject-less modules that break provisional surface writes after migration 0088.
 */
async function ensureLinkedAttributionSubjectForExistingModule(
  db: Queryable,
  input: {
    organizationId: string;
    moduleId: string;
    kind: ModuleKind;
    name: string;
    sourceKey: string;
    description?: string;
  },
): Promise<void> {
  if (input.kind !== "driver-group" && input.kind !== "node-type") return;

  let subjectId: string | null = null;
  if (input.kind === "driver-group") {
    const { ensureAttributionSubjectForCompatible } = await import("./resolveAttributionSubject");
    const compatibleToken = input.sourceKey.startsWith("compatible:")
      ? input.sourceKey.slice("compatible:".length)
      : input.name;
    subjectId = await ensureAttributionSubjectForCompatible(db, {
      organizationId: input.organizationId,
      compatible: compatibleToken,
      displayName: input.name,
    });
  } else {
    const { insertAttributionSubjectForNewModule } = await import("./attributionSubjectRepository");
    subjectId = await insertAttributionSubjectForNewModule(db, {
      moduleId: input.moduleId,
      organizationId: input.organizationId,
      kind: "node-type",
      displayName: input.name,
      origin: "auto",
      sourceKey: input.sourceKey,
      notes: input.description ?? "",
    });
  }

  await db.query(
    `
    update parameter_modules
    set attribution_subject_id = coalesce(attribution_subject_id, $2),
        updated_at = now()
    where id = $1
    `,
    [input.moduleId, subjectId],
  );
}

/**
 * Resolve or create a module by stable source_key, with a one-time name fallback
 * that adopts unkeyed rows. Never renames or moves curated modules.
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
    if (!byKey.attributionSubjectId) {
      await ensureLinkedAttributionSubjectForExistingModule(db, {
        organizationId: input.organizationId,
        moduleId: byKey.id,
        kind: input.kind,
        name: input.name,
        sourceKey: input.sourceKey,
        description: input.description,
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
    if (existing && !existing.attributionSubjectId) {
      await ensureLinkedAttributionSubjectForExistingModule(db, {
        organizationId: input.organizationId,
        moduleId: existingId,
        kind: input.kind,
        name: input.name,
        sourceKey: input.sourceKey,
        description: input.description,
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
  });
  return created.id;
}

async function ensureBusinessLeafModuleId(
  db: Queryable,
  input: { organizationId: string; businessCategory: string },
): Promise<string> {
  const existing = await findModuleIdByNameAnyParent(db, {
    organizationId: input.organizationId,
    name: input.businessCategory,
  });
  if (existing) return existing;
  return resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: null,
    compatible: null,
    nodeType: null,
  });
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
  const businessCategory = businessCategoryForNodePath(input.nodePath);
  const parentId = await ensureBusinessLeafModuleId(db, {
    organizationId: input.organizationId,
    businessCategory,
  });
  await ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: groupName,
    parentId,
    kind: "driver-group",
    sourceKey: compatibleSourceKey(compatibleKey),
    description: `${groupName} 驱动组（compatible: ${compatibleKey}）。`,
    scope: `共享 compatible ${compatibleKey} 的节点类型分组`,
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
  const businessCategory = businessCategoryForNodePath(input.nodePath);
  let parentId = await ensureBusinessLeafModuleId(db, {
    organizationId: input.organizationId,
    businessCategory,
  });

  const normalizedCompatible = normalizeMatchToken(input.compatible);
  if (normalizedCompatible) {
    const groupName = driverGroupDisplayNameFromCompatible(normalizedCompatible);
    const groupId = await findModuleIdByNameAnyParent(db, {
      organizationId: input.organizationId,
      name: groupName,
    });
    if (groupId) parentId = groupId;
  }

  await ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: input.nodeType,
    parentId,
    kind: "node-type",
    sourceKey: nodeTypeSourceKey(input.nodeType),
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
