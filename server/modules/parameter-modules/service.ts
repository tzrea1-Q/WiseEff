import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import { createAuditEvent } from "../audit/repository";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  bindingModuleConflictExists,
  collectEmptyUnclassifiedBuckets,
  deleteDismissedCompatible,
  deleteEmptyAutoDescendants,
  deleteMappingRow,
  deleteMappingsForModules,
  getModuleNamesByIds,
  insertDismissedCompatible,
  insertMapping,
  listBindingsForModuleRecompute,
  listObservedCompatiblesForDiscovery,
  listSubtreeModuleIds,
  moduleExists,
  readRegistry,
  updateBindingModuleId,
  type RecomputeBindingRow,
} from "./repository";
import { resolveBindingInstanceModuleId } from "./ensureInstanceModuleForBinding";
import { deleteParameterModule, getParameterModuleById } from "../parameters/parameterModuleRepository";
import { normalizeMatchToken } from "./modulePlacement";
import type { CreateModuleMappingBody } from "./schemas";
import type { ModuleMatchKind, ParameterModuleRegistryDto } from "./types";

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

async function writeModuleAttributionAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: string;
    action: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: input.kind,
    action: input.action,
    severity: "Low",
    targetType: "parameter-module-mapping",
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    traceId: randomUUID(),
  });
}

function normalizeMatch(value: string | null | undefined): string | null {
  return normalizeMatchToken(value);
}

function bindingMatchesRule(
  binding: RecomputeBindingRow,
  rule: { matchKind: ModuleMatchKind; matchValue: string },
): boolean {
  const expected = normalizeMatch(rule.matchValue);
  if (!expected) return false;
  if (rule.matchKind === "compatible") {
    return normalizeMatch(binding.compatible) === expected;
  }
  return normalizeMatch(binding.instanceName) === expected;
}

export type MappingApplyPreview = {
  affectedBindings: number;
  byProject: Array<{ projectId: string; count: number }>;
  fromModules: Array<{ moduleId: string; moduleName: string; count: number }>;
  toModuleId: string | null;
  emptiedModules: string[];
  conflicts: string[];
};

type PlannedMove = {
  binding: RecomputeBindingRow;
  nextModuleId: string;
};

async function planMovesForModuleIds(
  db: Queryable,
  input: { organizationId: string; moduleIds: ReadonlySet<string> },
): Promise<{ moves: PlannedMove[]; conflicts: string[] }> {
  const bindings = await listBindingsForModuleRecompute(db, {
    organizationId: input.organizationId,
    projectId: null,
  });
  const scoped = bindings.filter((binding) => input.moduleIds.has(binding.moduleId));
  const moves: PlannedMove[] = [];
  const conflicts: string[] = [];

  for (const binding of scoped) {
    const nextModuleId = await resolveBindingInstanceModuleId(db, {
      organizationId: input.organizationId,
      driverModule: binding.driverModule,
      compatible: binding.compatible,
      instanceName: binding.instanceName,
      nodeLocator: binding.nodeLocator,
    });
    if (nextModuleId === binding.moduleId) continue;

    const collides = await bindingModuleConflictExists(db, {
      organizationId: input.organizationId,
      projectId: binding.projectId,
      logicalNodeId: binding.logicalNodeId,
      parameterSpecId: binding.parameterSpecId,
      moduleId: nextModuleId,
      excludeBindingId: binding.id,
    });
    if (collides) {
      conflicts.push(binding.id);
      continue;
    }
    moves.push({ binding, nextModuleId });
  }

  return { moves, conflicts };
}

/**
 * Disband a driver-group module: drop its (and descendants') mappings so the
 * compatible returns to the unclassified queue, re-park bindings, remove empty
 * auto descendants, then delete the group itself.
 */
export async function disbandDriverGroupModule(
  db: Database,
  auth: AuthContext,
  input: { moduleId: string },
): Promise<{
  removedMappings: number;
  reparkedBindings: number;
  deletedDescendants: number;
}> {
  requireCanAdmin(auth);
  const organizationId = auth.organization.id;
  const current = await getParameterModuleById(db, {
    organizationId,
    moduleId: input.moduleId,
  });
  if (!current) {
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, {
      moduleId: input.moduleId,
    });
  }
  if (current.kind !== "driver-group") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Only driver-group modules can be disbanded.",
      400,
      { moduleId: input.moduleId, kind: current.kind },
    );
  }

  return db.transaction(async (tx) => {
    const subtreeIds = await listSubtreeModuleIds(tx, {
      organizationId,
      moduleId: input.moduleId,
    });
    const removedMappings = await deleteMappingsForModules(tx, {
      organizationId,
      moduleIds: subtreeIds,
    });

    const { moves, conflicts } = await planMovesForModuleIds(tx, {
      organizationId,
      moduleIds: new Set(subtreeIds),
    });
    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Disbanding this driver group would collide with existing bindings under the module unique key.",
        409,
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, organizationId, moves);

    const deletedDescendants = await deleteEmptyAutoDescendants(tx, {
      organizationId,
      rootModuleId: input.moduleId,
      subtreeModuleIds: subtreeIds,
    });
    const emptiedBuckets = await collectEmptyUnclassifiedBuckets(tx, organizationId);

    // After reparking, the group itself must be empty of bindings and children.
    const remainingChildren = await tx.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_modules
      where organization_id = $1 and parent_id = $2
      `,
      [organizationId, input.moduleId],
    );
    if (Number(remainingChildren.rows[0]?.count ?? 0) > 0) {
      throw new ApiError(
        "CONFLICT",
        "Cannot disband a driver group that still has non-empty child modules (for example curated instances).",
        409,
        { moduleId: input.moduleId },
      );
    }

    let deleted: boolean;
    try {
      deleted = await deleteParameterModule(tx, {
        organizationId,
        moduleId: input.moduleId,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /child modules|referenced by parameters|device-instance|unclassified root/i.test(error.message)
      ) {
        throw new ApiError("CONFLICT", error.message, 409, { moduleId: input.moduleId });
      }
      throw error;
    }
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", 404, {
        moduleId: input.moduleId,
      });
    }

    await writeModuleAttributionAudit(tx, auth, {
      kind: "parameter-module-driver-group-disbanded",
      action: "disband",
      targetId: input.moduleId,
      metadata: {
        name: current.name,
        removedMappings: removedMappings.map((row) => `${row.matchKind}:${row.matchValue}`),
        reparkedBindings: moves.length,
        deletedDescendants,
        emptiedBuckets,
      },
    });

    return {
      removedMappings: removedMappings.length,
      reparkedBindings: moves.length,
      deletedDescendants: deletedDescendants.length,
    };
  });
}

async function planScopedMoves(
  db: Queryable,
  input: {
    organizationId: string;
    matchKind?: ModuleMatchKind;
    matchValue?: string;
    projectId?: string | null;
  },
): Promise<{ moves: PlannedMove[]; conflicts: string[] }> {
  const bindings = await listBindingsForModuleRecompute(db, {
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
  });
  const scoped =
    input.matchKind && input.matchValue
      ? bindings.filter((binding) =>
          bindingMatchesRule(binding, {
            matchKind: input.matchKind!,
            matchValue: input.matchValue!,
          }),
        )
      : bindings;

  const moves: PlannedMove[] = [];
  const conflicts: string[] = [];

  for (const binding of scoped) {
    const nextModuleId = await resolveBindingInstanceModuleId(db, {
      organizationId: input.organizationId,
      driverModule: binding.driverModule,
      compatible: binding.compatible,
      instanceName: binding.instanceName,
      nodeLocator: binding.nodeLocator,
    });
    if (nextModuleId === binding.moduleId) continue;

    const collides = await bindingModuleConflictExists(db, {
      organizationId: input.organizationId,
      projectId: binding.projectId,
      logicalNodeId: binding.logicalNodeId,
      parameterSpecId: binding.parameterSpecId,
      moduleId: nextModuleId,
      excludeBindingId: binding.id,
    });
    if (collides) {
      conflicts.push(binding.id);
      continue;
    }
    moves.push({ binding, nextModuleId });
  }

  return { moves, conflicts };
}

async function summarizeMoves(
  db: Queryable,
  organizationId: string,
  moves: PlannedMove[],
  conflicts: string[],
  emptiedModules: string[] = [],
): Promise<MappingApplyPreview> {
  const byProjectMap = new Map<string, number>();
  const fromModuleMap = new Map<string, number>();
  const toIds = new Set<string>();

  for (const move of moves) {
    byProjectMap.set(move.binding.projectId, (byProjectMap.get(move.binding.projectId) ?? 0) + 1);
    fromModuleMap.set(move.binding.moduleId, (fromModuleMap.get(move.binding.moduleId) ?? 0) + 1);
    toIds.add(move.nextModuleId);
  }

  const names = await getModuleNamesByIds(db, {
    organizationId,
    moduleIds: [...fromModuleMap.keys()],
  });

  return {
    affectedBindings: moves.length,
    byProject: [...byProjectMap.entries()].map(([projectId, count]) => ({ projectId, count })),
    fromModules: [...fromModuleMap.entries()].map(([moduleId, count]) => ({
      moduleId,
      moduleName: names.get(moduleId) ?? moduleId,
      count,
    })),
    toModuleId: toIds.size === 1 ? [...toIds][0]! : null,
    emptiedModules,
    conflicts,
  };
}

async function applyPlannedMoves(
  db: Queryable,
  organizationId: string,
  moves: PlannedMove[],
): Promise<void> {
  for (const move of moves) {
    await updateBindingModuleId(db, {
      organizationId,
      bindingId: move.binding.id,
      moduleId: move.nextModuleId,
    });
  }
}

export async function getParameterModuleRegistry(
  db: Database,
  auth: AuthContext
): Promise<{ item: ParameterModuleRegistryDto }> {
  requireCanView(auth);
  const item = await readRegistry(db, auth.organization.id);
  return { item };
}

export type ModuleDiscoveryHintsDto = {
  compatibles: Array<{
    compatible: string;
    bindingCount: number;
    projectCount: number;
    suggestedGroupName: string;
  }>;
  total: number;
};

export async function getModuleDiscoveryHints(
  db: Database,
  auth: AuthContext,
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanView(auth);
  const page = await listObservedCompatiblesForDiscovery(db, {
    organizationId: auth.organization.id,
  });
  return { item: { compatibles: page.items, total: page.total } };
}

export async function dismissCompatible(
  db: Database,
  auth: AuthContext,
  input: { compatible: string; reason?: string },
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanAdmin(auth);
  const compatible =
    normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  if (!compatible) {
    throw new ApiError("VALIDATION_FAILED", "compatible is required.", 400);
  }
  await insertDismissedCompatible(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    compatible,
    reason: input.reason?.trim() ?? "",
    dismissedByUserId: auth.user.id,
  });
  await writeModuleAttributionAudit(db, auth, {
    kind: "parameter-module-compatible-dismissed",
    action: "dismiss",
    targetId: compatible,
    metadata: { compatible, reason: input.reason?.trim() ?? "" },
  });
  return getModuleDiscoveryHints(db, auth);
}

export async function restoreDismissedCompatible(
  db: Database,
  auth: AuthContext,
  input: { compatible: string },
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanAdmin(auth);
  const compatible =
    normalizeMatchToken(input.compatible) ?? input.compatible.trim().toLowerCase();
  const removed = await deleteDismissedCompatible(db, {
    organizationId: auth.organization.id,
    compatible,
  });
  if (removed === 0) {
    throw new ApiError("NOT_FOUND", "Dismissed compatible not found.", 404);
  }
  await writeModuleAttributionAudit(db, auth, {
    kind: "parameter-module-compatible-restored",
    action: "restore",
    targetId: input.compatible,
    metadata: { compatible: input.compatible },
  });
  return getModuleDiscoveryHints(db, auth);
}

class PreviewRollbackError extends Error {
  constructor(readonly preview: MappingApplyPreview) {
    super("preview-rollback");
    this.name = "PreviewRollbackError";
  }
}

export async function previewModuleMapping(
  db: Database,
  auth: AuthContext,
  input: CreateModuleMappingBody,
): Promise<{ item: MappingApplyPreview }> {
  requireCanAdmin(auth);
  try {
    await db.transaction(async (tx) => {
      const moduleOk = await moduleExists(tx, {
        organizationId: auth.organization.id,
        moduleId: input.moduleId,
      });
      if (!moduleOk) {
        throw new ApiError("VALIDATION_FAILED", "Target module does not exist.", 400);
      }
      await insertMapping(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        moduleId: input.moduleId,
        matchKind: input.matchKind,
        matchValue: input.matchValue,
        priority: input.priority ?? 0,
      });
      const { moves, conflicts } = await planScopedMoves(tx, {
        organizationId: auth.organization.id,
        matchKind: input.matchKind,
        matchValue: input.matchValue,
      });
      const preview = await summarizeMoves(tx, auth.organization.id, moves, conflicts);
      throw new PreviewRollbackError(preview);
    });
    throw new ApiError("INTERNAL_ERROR", "Preview transaction completed unexpectedly.", 500);
  } catch (error) {
    if (error instanceof PreviewRollbackError) {
      return { item: error.preview };
    }
    throw error;
  }
}

export async function createModuleMapping(
  db: Database,
  auth: AuthContext,
  input: CreateModuleMappingBody
): Promise<{ item: ParameterModuleRegistryDto; apply: MappingApplyPreview }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const moduleOk = await moduleExists(tx, {
      organizationId: auth.organization.id,
      moduleId: input.moduleId
    });
    if (!moduleOk) {
      throw new ApiError("VALIDATION_FAILED", "Target module does not exist.", 400);
    }
    await insertMapping(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      moduleId: input.moduleId,
      matchKind: input.matchKind,
      matchValue: input.matchValue,
      priority: input.priority ?? 0
    });

    const { moves, conflicts } = await planScopedMoves(tx, {
      organizationId: auth.organization.id,
      matchKind: input.matchKind,
      matchValue: input.matchValue,
    });
    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Applying this mapping would collide with existing bindings under the module unique key.",
        409,
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(tx, auth.organization.id);
    const apply = await summarizeMoves(tx, auth.organization.id, moves, [], emptiedModules);
    const item = await readRegistry(tx, auth.organization.id);
    await writeModuleAttributionAudit(tx, auth, {
      kind: "parameter-module-mapping-created",
      action: "create",
      targetId: `${input.matchKind}:${input.matchValue}`,
      metadata: {
        moduleId: input.moduleId,
        matchKind: input.matchKind,
        matchValue: input.matchValue,
        affectedBindings: apply.affectedBindings,
        emptiedModules,
      },
    });
    return { item, apply };
  });
}

export type RecomputeBindingModulesResult = {
  updated: number;
  conflicts: string[];
  dryRun?: boolean;
  preview?: MappingApplyPreview;
};

/**
 * Admin remap recompute (phase 2, §5.2): re-resolve every binding's business module
 * from the current mappings and rewrite `project_parameter_bindings.module_id` under the
 * phase-2 4-tuple unique key. Runs in a single transaction — if any binding would collide
 * with an existing binding on the new key, nothing is written and the conflicting binding
 * ids are returned as a 409 (no silent skip, no dual path).
 */
export async function recomputeBindingModules(
  db: Database,
  auth: AuthContext,
  input: { projectId?: string; dryRun?: boolean }
): Promise<RecomputeBindingModulesResult> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const { moves, conflicts } = await planScopedMoves(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId ?? null,
    });

    if (input.dryRun) {
      const preview = await summarizeMoves(tx, auth.organization.id, moves, conflicts);
      return { updated: preview.affectedBindings, conflicts, dryRun: true, preview };
    }

    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Recompute would collide with existing bindings under the module unique key.",
        409,
        { conflicts }
      );
    }

    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(tx, auth.organization.id);
    const preview = await summarizeMoves(tx, auth.organization.id, moves, [], emptiedModules);
    await writeModuleAttributionAudit(tx, auth, {
      kind: "parameter-module-bindings-recomputed",
      action: "recompute",
      targetId: input.projectId ?? auth.organization.id,
      metadata: {
        updated: moves.length,
        projectId: input.projectId ?? null,
        emptiedModules,
      },
    });
    return {
      updated: moves.length,
      conflicts: [],
      preview,
    };
  });
}

export async function deleteModuleMapping(
  db: Database,
  auth: AuthContext,
  input: { mappingId: string }
): Promise<{ item: ParameterModuleRegistryDto; apply: MappingApplyPreview }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const registryBefore = await readRegistry(tx, auth.organization.id);
    const mapping = registryBefore.mappings.find((item) => item.id === input.mappingId);
    const removed = await deleteMappingRow(tx, {
      organizationId: auth.organization.id,
      mappingId: input.mappingId
    });
    if (removed === 0) {
      throw new ApiError("NOT_FOUND", "Mapping not found.", 404);
    }

    const { moves, conflicts } = await planScopedMoves(tx, {
      organizationId: auth.organization.id,
      matchKind: mapping?.matchKind,
      matchValue: mapping?.matchValue,
    });
    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Removing this mapping would collide with existing bindings under the module unique key.",
        409,
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(tx, auth.organization.id);
    const apply = await summarizeMoves(tx, auth.organization.id, moves, [], emptiedModules);
    const item = await readRegistry(tx, auth.organization.id);
    await writeModuleAttributionAudit(tx, auth, {
      kind: "parameter-module-mapping-deleted",
      action: "delete",
      targetId: input.mappingId,
      metadata: {
        matchKind: mapping?.matchKind,
        matchValue: mapping?.matchValue,
        affectedBindings: apply.affectedBindings,
        emptiedModules,
      },
    });
    return { item, apply };
  });
}
