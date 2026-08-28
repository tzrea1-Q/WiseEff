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
import {
  ensureDriverRegistrationPlacement,
  getDriverRegistrationPlacement,
  getNodeTypeDefinitionPlacement,
} from "./driverRegistrationPlacement";

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
    preferredAttributionSubjectId?: string | null;
  },
): Promise<void> {
  if (input.kind !== "driver-group" && input.kind !== "node-type") return;

  let subjectId: string | null = input.preferredAttributionSubjectId ?? null;
  if (input.kind === "driver-group") {
    if (!subjectId) {
      const { ensureAttributionSubjectForCompatible } = await import("./resolveAttributionSubject");
      const compatibleToken = input.sourceKey.startsWith("compatible:")
        ? input.sourceKey.slice("compatible:".length)
        : input.name;
      subjectId = await ensureAttributionSubjectForCompatible(db, {
        organizationId: input.organizationId,
        compatible: compatibleToken,
        displayName: input.name,
      });
    }
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
    attributionSubjectId?: string | null;
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
        preferredAttributionSubjectId: input.attributionSubjectId,
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
        preferredAttributionSubjectId: input.attributionSubjectId,
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
    attributionSubjectId: input.attributionSubjectId ?? null,
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
    attributionSubjectId?: string | null;
  },
): Promise<string> {
  const subjectId =
    input.attributionSubjectId ??
    (await findAttributionSubjectIdBySourceKey(db, {
      organizationId: input.organizationId,
      sourceKey: input.sourceKey,
    }));

  if (subjectId) {
    const existingDefault = await getDriverRegistrationDefaultBusinessCategoryId(db, {
      attributionSubjectId: subjectId,
      organizationId: input.organizationId,
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
      organizationId: input.organizationId,
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
    attributionSubjectId?: string | null;
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
    if (
      existing.origin === "auto" &&
      input.attributionSubjectId &&
      existing.attributionSubjectId !== input.attributionSubjectId
    ) {
      // A module may already be referenced by an organization placement. Move
      // that placement together with the auto module, in trigger-safe order,
      // instead of leaving a stale (org, old-subject) row behind. A curated
      // placement for the target subject wins; in that collision case retain
      // the old module and let the recognized-binding seam fail closed.
      const placements = await db.query<{
        id: string;
        organization_id: string;
        attribution_subject_id: string;
      }>(
        `
        select id, organization_id, attribution_subject_id
        from driver_registration_placements
        where driver_group_module_id = $1
        for update
        `,
        [existing.id],
      );
      const collision = await db.query<{ id: string }>(
        `
        select id
        from driver_registration_placements
        where attribution_subject_id = $1
          and organization_id = $2
          and driver_group_module_id <> $3
        limit 1
        `,
        [input.attributionSubjectId, input.organizationId, existing.id],
      );
      if (collision.rows.length === 0) {
        await db.query(
          `update parameter_modules set attribution_subject_id = $2, updated_at = now() where id = $1`,
          [existing.id, input.attributionSubjectId],
        );
        for (const placement of placements.rows) {
          await db.query(
            `
            update driver_registration_placements
            set attribution_subject_id = $2, updated_at = now()
            where id = $1
            `,
            [placement.id, input.attributionSubjectId],
          );
        }
      }
    }
    const refreshed = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: existing.id,
    });
    if (refreshed?.attributionSubjectId) {
      await ensureDriverRegistrationPlacement(db, {
        organizationId: input.organizationId,
        attributionSubjectId: refreshed.attributionSubjectId,
        driverGroupModuleId: refreshed.id,
        defaultBusinessCategoryModuleId: refreshed.parentId,
      });
    }
    return;
  }

  const parentId = await resolveDriverGroupBusinessParentId(db, {
    organizationId: input.organizationId,
    sourceKey,
    nodePath: input.nodePath,
    attributionSubjectId: input.attributionSubjectId,
  });
  const createdId = await ensureNamedModule(db, {
    organizationId: input.organizationId,
    name: groupName,
    parentId,
    kind: "driver-group",
    sourceKey,
    description: `${groupName} 驱动组（compatible: ${compatibleKey}）。`,
    scope: `共享 compatible ${compatibleKey} 的节点类型分组`,
    defaultBusinessCategoryModuleId: parentId,
    attributionSubjectId: input.attributionSubjectId ?? null,
  });
  const created = await getParameterModuleById(db, {
    organizationId: input.organizationId,
    moduleId: createdId,
  });
  if (created?.attributionSubjectId) {
    await ensureDriverRegistrationPlacement(db, {
      organizationId: input.organizationId,
      attributionSubjectId: created.attributionSubjectId,
      driverGroupModuleId: created.id,
      defaultBusinessCategoryModuleId: parentId,
    });
  }
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
    attributionSubjectId?: string | null;
    /** Admin remap/seed replay must honor an explicit curated mapping first. */
    preferExplicitMapping?: boolean;
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

  if (input.preferExplicitMapping) {
    const mappedId = await resolveModuleIdForBinding(db, {
      organizationId: input.organizationId,
      driverModule: input.driverModule,
      compatible: input.compatible,
      nodeType,
    });
    const mapped = await getParameterModuleById(db, {
      organizationId: input.organizationId,
      moduleId: mappedId,
    });
    // A replay mapping is only authoritative for the same canonical subject.
    // Never let a stale compatible/node-name mapping move a recognized
    // definition into another driver's module (or into a subjectless business
    // module) just because the display name still matches.
    if (
      mapped &&
      mapped.kind !== "unclassified" &&
      (!input.attributionSubjectId || mapped.attributionSubjectId === input.attributionSubjectId)
    ) {
      return mapped.id;
    }
  }

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
        attributionSubjectId: input.attributionSubjectId,
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

  // A matched driver definition has a declared driver-group placement. Use it
  // as the binding fallback before the legacy compatible/node-type mapping
  // resolver; this keeps recognized bindings subject-aligned instead of
  // parking them in the subjectless unclassified bucket.
  if (input.attributionSubjectId) {
    const subjectKind = await db.query<{ subject_kind: "driver-registration" | "node-type-definition" }>(
      `select subject_kind from attribution_subjects where id = $1 limit 1`,
      [input.attributionSubjectId],
    );
    if (nodeType && subjectKind.rows[0]?.subject_kind === "node-type-definition") {
      const nodeTypePlacement = await getNodeTypeDefinitionPlacement(db, {
        organizationId: input.organizationId,
        attributionSubjectId: input.attributionSubjectId,
        sourceKey: nodeTypeSourceKey(nodeType),
      });
      if (nodeTypePlacement) return nodeTypePlacement.moduleId;
    }
    const placement = await getDriverRegistrationPlacement(db, {
      organizationId: input.organizationId,
      attributionSubjectId: input.attributionSubjectId,
    });
    if (placement) return placement.driverGroupModuleId;
  }

  return resolveModuleIdForBinding(db, {
    organizationId: input.organizationId,
    driverModule: input.driverModule,
    compatible: input.compatible,
    nodeType,
  });
}
