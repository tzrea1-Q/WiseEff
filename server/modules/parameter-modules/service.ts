import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import { createAuditEvent, writePlatformAuditEvent } from "../audit/repository";
import {
  asAuditTx,
  withAuditedWrite,
  writeAuditEventInTx,
  type AuditTx,
} from "../audit/auditedWrite";
import {
  canAdminParameters,
  canViewParameters,
} from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { syncSingletonCardinalityBlockingTasks } from "../parameter-topology/bindingService";
import {
  bindingModuleConflictExists,
  collectEmptyUnclassifiedBuckets,
  deleteDismissedCompatible,
  deleteEmptyAutoDescendants,
  deleteMappingRow,
  deleteMappingsForModules,
  findCompatibleMapping,
  getModuleNamesByIds,
  insertDismissedCompatible,
  insertMapping,
  listBindingsForModuleRecompute,
  listDismissedCompatiblesForDiscovery,
  listObservedCompatiblesForDiscovery,
  listSubtreeModuleIds,
  moduleExists,
  readRegistry,
  updateBindingModuleId,
  type RecomputeBindingRow,
} from "./repository";
import {
  compatibleSourceKey,
  resolveAttributionModuleForBinding,
} from "./ensureAttributionModuleForBinding";
import {
  createParameterModule,
  deleteParameterModule,
  getParameterModuleById,
  moveParameterModule,
  updateParameterModule,
} from "../parameters/parameterModuleRepository";
import type { ParameterModuleDto } from "../parameters/types";
import {
  isScaffoldingDriverLabel,
  nodeTypeKeyForNode,
  normalizeMatchToken,
} from "./modulePlacement";
import type { CreateModuleMappingBody } from "./schemas";
import type {
  ModuleMatchKind,
  ModuleOrigin,
  ParameterModuleRegistryDto,
} from "./types";
import { getCachedOrganizationSchemaRegistry } from "../parameter-specs/schemaRegistryCache";
import { listOrganizationDriverSchemas } from "../parameter-specs/driverSchemaOverlayRepository";
import {
  lookupParseCoverage,
  type ParseCoverage,
} from "../parameter-specs/parseCoverage";
import type { DriverNature, InstanceCardinality } from "./attributionSubjects";
import {
  replayAutoDriverGroupToRegistrationDefault,
  setDriverRegistrationDefaultBusinessCategoryId,
  type DriverPlacementReplayCounts,
} from "./driverPlacement";
import { ensureDriverRegistrationPlacement } from "./driverRegistrationPlacement";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemasRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/dts",
);

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

function isPlatformSuperAdmin(auth: AuthContext) {
  return auth.roles.some((binding) => binding.roleId === "platform-admin");
}

function actorRoleIds(auth: AuthContext): string[] {
  return [...new Set(auth.roles.map((binding) => binding.roleId))];
}

async function writeModuleAttributionAudit(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    kind: string;
    action: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
  context: { requestId?: string } = {},
) {
  // requestId fallback survives only until attribution contexts become mandatory
  // (ADR-0027); previously the traceId was always a fresh random UUID.
  await writeAuditEventInTx(
    tx,
    auth,
    { requestId: context.requestId ?? randomUUID() },
    {
      app: "parameter-management",
      kind: input.kind,
      action: input.action,
      severity: "Low",
      projectId: null,
      targetType: "parameter-module-mapping",
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    },
  );
}

function normalizeMatch(value: string | null | undefined): string | null {
  return normalizeMatchToken(value);
}

function nodeTypeFromInstanceName(
  instanceName: string | null | undefined,
): string | null {
  if (!instanceName) return null;
  const at = instanceName.indexOf("@");
  const name = at >= 0 ? instanceName.slice(0, at) : instanceName;
  return nodeTypeKeyForNode({ name });
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
  return nodeTypeFromInstanceName(binding.instanceName) === expected;
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
  const scoped = bindings.filter((binding) =>
    input.moduleIds.has(binding.moduleId),
  );
  const moves: PlannedMove[] = [];
  const conflicts: string[] = [];

  for (const binding of scoped) {
    const nextModuleId = await resolveAttributionModuleForBinding(db, {
      organizationId: input.organizationId,
      driverModule: binding.driverModule,
      compatible: binding.compatible,
      instanceName: binding.instanceName,
      nodeLocator: binding.nodeLocator,
      attributionSubjectId: binding.attributionSubjectId,
      preferExplicitMapping: true,
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
    throw new ApiError("NOT_FOUND", "Parameter module was not found.", {
      moduleId: input.moduleId,
    });
  }
  if (current.kind !== "driver-group") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Only driver-group modules can be disbanded.",
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
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, organizationId, moves);

    const deletedDescendants = await deleteEmptyAutoDescendants(tx, {
      organizationId,
      rootModuleId: input.moduleId,
      subtreeModuleIds: subtreeIds,
    });
    const emptiedBuckets = await collectEmptyUnclassifiedBuckets(
      tx,
      organizationId,
    );

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
        /child modules|referenced by parameters|device-instance|unclassified root/i.test(
          error.message,
        )
      ) {
        throw new ApiError("CONFLICT", error.message, {
          moduleId: input.moduleId,
        });
      }
      throw error;
    }
    if (!deleted) {
      throw new ApiError("NOT_FOUND", "Parameter module was not found.", {
        moduleId: input.moduleId,
      });
    }

    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
      kind: "parameter-module-driver-group-disbanded",
      action: "disband",
      targetId: input.moduleId,
      metadata: {
        name: current.name,
        removedMappings: removedMappings.map(
          (row) => `${row.matchKind}:${row.matchValue}`,
        ),
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
    const nextModuleId = await resolveAttributionModuleForBinding(db, {
      organizationId: input.organizationId,
      driverModule: binding.driverModule,
      compatible: binding.compatible,
      instanceName: binding.instanceName,
      nodeLocator: binding.nodeLocator,
      attributionSubjectId: binding.attributionSubjectId,
      preferExplicitMapping: true,
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
    byProjectMap.set(
      move.binding.projectId,
      (byProjectMap.get(move.binding.projectId) ?? 0) + 1,
    );
    fromModuleMap.set(
      move.binding.moduleId,
      (fromModuleMap.get(move.binding.moduleId) ?? 0) + 1,
    );
    toIds.add(move.nextModuleId);
  }

  const names = await getModuleNamesByIds(db, {
    organizationId,
    moduleIds: [...fromModuleMap.keys()],
  });

  return {
    affectedBindings: moves.length,
    byProject: [...byProjectMap.entries()].map(([projectId, count]) => ({
      projectId,
      count,
    })),
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
  auth: AuthContext,
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
  dismissedCompatibles: Array<{
    compatible: string;
    bindingCount: number;
    projectCount: number;
    suggestedGroupName: string;
    reason: string;
    dismissedAt: string;
  }>;
  total: number;
};

export async function getModuleDiscoveryHints(
  db: Database,
  auth: AuthContext,
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanView(auth);
  const [page, dismissedCompatibles] = await Promise.all([
    listObservedCompatiblesForDiscovery(db, {
      organizationId: auth.organization.id,
    }),
    listDismissedCompatiblesForDiscovery(db, {
      organizationId: auth.organization.id,
    }),
  ]);
  return {
    item: { compatibles: page.items, dismissedCompatibles, total: page.total },
  };
}

export async function dismissCompatible(
  db: Database,
  auth: AuthContext,
  input: { compatible: string; reason?: string },
  context: { requestId?: string } = {},
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanAdmin(auth);
  const compatible =
    normalizeMatchToken(input.compatible) ??
    input.compatible.trim().toLowerCase();
  if (!compatible) {
    throw new ApiError("VALIDATION_FAILED", "compatible is required.");
  }
  // Insert and audit commit together (ADR-0027); previously the insert
  // auto-committed and the audit could be lost after it.
  await withAuditedWrite(
    db,
    auth,
    { requestId: context.requestId ?? randomUUID() },
    async (tx) => {
      await insertDismissedCompatible(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        compatible,
        reason: input.reason?.trim() ?? "",
        dismissedByUserId: auth.user.id,
      });
      await writeModuleAttributionAudit(
        asAuditTx(tx),
        auth,
        {
          kind: "parameter-module-compatible-dismissed",
          action: "dismiss",
          targetId: compatible,
          metadata: { compatible, reason: input.reason?.trim() ?? "" },
        },
        context,
      );
      return { result: undefined, audit: null };
    },
  );
  return getModuleDiscoveryHints(db, auth);
}

export async function restoreDismissedCompatible(
  db: Database,
  auth: AuthContext,
  input: { compatible: string },
  context: { requestId?: string } = {},
): Promise<{ item: ModuleDiscoveryHintsDto }> {
  requireCanAdmin(auth);
  const compatible =
    normalizeMatchToken(input.compatible) ??
    input.compatible.trim().toLowerCase();
  // Delete and audit commit together (ADR-0027).
  await withAuditedWrite(
    db,
    auth,
    { requestId: context.requestId ?? randomUUID() },
    async (tx) => {
      const removed = await deleteDismissedCompatible(tx, {
        organizationId: auth.organization.id,
        compatible,
      });
      if (removed === 0) {
        throw new ApiError("NOT_FOUND", "Dismissed compatible not found.");
      }
      await writeModuleAttributionAudit(
        asAuditTx(tx),
        auth,
        {
          kind: "parameter-module-compatible-restored",
          action: "restore",
          targetId: input.compatible,
          metadata: { compatible: input.compatible },
        },
        context,
      );
      return { result: undefined, audit: null };
    },
  );
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
        throw new ApiError(
          "VALIDATION_FAILED",
          "Target module does not exist.",
        );
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
      const preview = await summarizeMoves(
        tx,
        auth.organization.id,
        moves,
        conflicts,
      );
      throw new PreviewRollbackError(preview);
    });
    throw new ApiError(
      "INTERNAL_ERROR",
      "Preview transaction completed unexpectedly.",
    );
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
  input: CreateModuleMappingBody,
): Promise<{ item: ParameterModuleRegistryDto; apply: MappingApplyPreview }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const moduleOk = await moduleExists(tx, {
      organizationId: auth.organization.id,
      moduleId: input.moduleId,
    });
    if (!moduleOk) {
      throw new ApiError("VALIDATION_FAILED", "Target module does not exist.");
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
    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Applying this mapping would collide with existing bindings under the module unique key.",
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(
      tx,
      auth.organization.id,
    );
    const apply = await summarizeMoves(
      tx,
      auth.organization.id,
      moves,
      [],
      emptiedModules,
    );
    const item = await readRegistry(tx, auth.organization.id);
    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
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
class RecomputeDryRunRollback extends Error {
  constructor(readonly result: RecomputeBindingModulesResult) {
    super("recompute-dry-run-rollback");
    this.name = "RecomputeDryRunRollback";
  }
}

export async function recomputeBindingModules(
  db: Database,
  auth: AuthContext,
  input: { projectId?: string; dryRun?: boolean },
): Promise<RecomputeBindingModulesResult> {
  requireCanAdmin(auth);

  if (input.dryRun) {
    // Preview only: plan + summarize inside a transaction, then force a rollback so the
    // auto-discovery module/subject materialization that planScopedMoves performs has zero
    // side effects (mirrors previewModuleMapping).
    try {
      await db.transaction(async (tx) => {
        const { moves, conflicts } = await planScopedMoves(tx, {
          organizationId: auth.organization.id,
          projectId: input.projectId ?? null,
        });
        const preview = await summarizeMoves(
          tx,
          auth.organization.id,
          moves,
          conflicts,
        );
        throw new RecomputeDryRunRollback({
          updated: preview.affectedBindings,
          conflicts,
          dryRun: true,
          preview,
        });
      });
      throw new ApiError(
        "INTERNAL_ERROR",
        "Recompute dry-run transaction completed unexpectedly.",
      );
    } catch (error) {
      if (error instanceof RecomputeDryRunRollback) {
        return error.result;
      }
      throw error;
    }
  }

  return db.transaction(async (tx) => {
    const { moves, conflicts } = await planScopedMoves(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId ?? null,
    });

    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Recompute would collide with existing bindings under the module unique key.",
        { conflicts },
      );
    }

    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(
      tx,
      auth.organization.id,
    );
    const preview = await summarizeMoves(
      tx,
      auth.organization.id,
      moves,
      [],
      emptiedModules,
    );
    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
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
  input: { mappingId: string },
): Promise<{ item: ParameterModuleRegistryDto; apply: MappingApplyPreview }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const registryBefore = await readRegistry(tx, auth.organization.id);
    const mapping = registryBefore.mappings.find(
      (item) => item.id === input.mappingId,
    );
    const removed = await deleteMappingRow(tx, {
      organizationId: auth.organization.id,
      mappingId: input.mappingId,
    });
    if (removed === 0) {
      throw new ApiError("NOT_FOUND", "Mapping not found.");
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
        { conflicts },
      );
    }
    await applyPlannedMoves(tx, auth.organization.id, moves);
    const emptiedModules = await collectEmptyUnclassifiedBuckets(
      tx,
      auth.organization.id,
    );
    const apply = await summarizeMoves(
      tx,
      auth.organization.id,
      moves,
      [],
      emptiedModules,
    );
    const item = await readRegistry(tx, auth.organization.id);
    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
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

export type RegisterOrClaimDriverInput = {
  displayName: string;
  businessCategoryId: string;
  compatibles: string[];
  notes?: string;
};

export type RegisterOrClaimDriverResult = {
  mode: "registered" | "claimed";
  item: ParameterModuleDto;
  apply: MappingApplyPreview;
};

export async function registerOrClaimDriver(
  db: Database,
  auth: AuthContext,
  input: RegisterOrClaimDriverInput,
): Promise<RegisterOrClaimDriverResult> {
  requireCanAdmin(auth);

  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new ApiError("VALIDATION_FAILED", "displayName is required.");
  }
  const notes = input.notes?.trim() ?? "";
  const compatibles = [
    ...new Set(
      input.compatibles
        .map(
          (value) => normalizeMatchToken(value) ?? value.trim().toLowerCase(),
        )
        .filter((value) => value.length > 0),
    ),
  ];
  if (compatibles.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "At least one exact compatible is required.",
    );
  }

  return db.transaction(async (tx) => {
    const business = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: input.businessCategoryId,
    });
    if (!business || business.kind !== "business") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Target must be an existing business-category module.",
      );
    }

    const existingByCompatible: Array<{
      compatible: string;
      moduleId: string;
    }> = [];
    for (const compatible of compatibles) {
      const mapping = await findCompatibleMapping(tx, {
        organizationId: auth.organization.id,
        compatible,
      });
      if (mapping) {
        existingByCompatible.push({ compatible, moduleId: mapping.moduleId });
      }
    }

    const distinctModuleIds = [
      ...new Set(existingByCompatible.map((row) => row.moduleId)),
    ];
    if (distinctModuleIds.length > 1) {
      throw new ApiError(
        "CONFLICT",
        "Compatibles already map to different driver groups; resolve the conflict before registering.",
        { moduleIds: distinctModuleIds },
      );
    }

    let mode: "registered" | "claimed" = "registered";
    let module: ParameterModuleDto;

    if (distinctModuleIds.length === 1) {
      mode = "claimed";
      const moduleId = distinctModuleIds[0];
      const existing = await getParameterModuleById(tx, {
        organizationId: auth.organization.id,
        moduleId,
      });
      if (!existing || existing.kind !== "driver-group") {
        throw new ApiError(
          "CONFLICT",
          "Existing compatible mapping does not target a driver-group module.",
        );
      }

      if (existing.parentId !== input.businessCategoryId) {
        const moved = await moveParameterModule(tx, {
          organizationId: auth.organization.id,
          moduleId,
          parentId: input.businessCategoryId,
        });
        if (!moved) {
          throw new ApiError("NOT_FOUND", "Driver group module not found.");
        }
      }

      const updated = await updateParameterModule(tx, {
        organizationId: auth.organization.id,
        moduleId,
        name: displayName,
        description: notes,
      });
      if (!updated) {
        throw new ApiError("NOT_FOUND", "Driver group module not found.");
      }
      module = updated;
    } else {
      module = await createParameterModule(tx, {
        organizationId: auth.organization.id,
        name: displayName,
        parentId: input.businessCategoryId,
        description: notes,
        kind: "driver-group",
        origin: "curated",
        sourceKey: compatibleSourceKey(compatibles[0]),
      });
    }

    const appliedMoves: PlannedMove[] = [];
    for (const compatible of compatibles) {
      await insertMapping(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        moduleId: module.id,
        matchKind: "compatible",
        matchValue: compatible,
        priority: 0,
      });

      // Same scoped apply as createModuleMapping — register/claim must not leave
      // existing bindings on unclassified/auto groups until a full-org recompute.
      const { moves, conflicts } = await planScopedMoves(tx, {
        organizationId: auth.organization.id,
        matchKind: "compatible",
        matchValue: compatible,
      });
      if (conflicts.length > 0) {
        throw new ApiError(
          "CONFLICT",
          "Applying this driver registration would collide with existing bindings under the module unique key.",
          { conflicts },
        );
      }
      await applyPlannedMoves(tx, auth.organization.id, moves);
      appliedMoves.push(...moves);
    }

    const emptiedModules = await collectEmptyUnclassifiedBuckets(
      tx,
      auth.organization.id,
    );
    const apply = await summarizeMoves(
      tx,
      auth.organization.id,
      appliedMoves,
      [],
      emptiedModules,
    );

    // Persist registration default business category (authoritative placement).
    const fresh = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: module.id,
    });
    if (fresh?.attributionSubjectId) {
      await ensureDriverRegistrationPlacement(tx, {
        organizationId: auth.organization.id,
        attributionSubjectId: fresh.attributionSubjectId,
        driverGroupModuleId: fresh.id,
        defaultBusinessCategoryModuleId: input.businessCategoryId,
      });
      await setDriverRegistrationDefaultBusinessCategoryId(tx, {
        attributionSubjectId: fresh.attributionSubjectId,
        defaultBusinessCategoryModuleId: input.businessCategoryId,
        organizationId: auth.organization.id,
      });
    }

    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
      kind: "parameter-module-driver-registered",
      action: mode === "claimed" ? "claim" : "register",
      targetId: module.id,
      metadata: {
        mode,
        displayName,
        businessCategoryId: input.businessCategoryId,
        defaultBusinessCategoryId: input.businessCategoryId,
        compatibles,
        notes,
        affectedBindings: apply.affectedBindings,
        emptiedModules,
      },
    });

    return { mode, item: module, apply };
  });
}

export type UpdateDriverRegistrationDefaultInput = {
  moduleId: string;
  defaultBusinessCategoryId: string;
};

export type UpdateDriverRegistrationDefaultResult = {
  item: ParameterModuleDto;
  defaultBusinessCategoryId: string;
  replay: DriverPlacementReplayCounts;
};

/**
 * Update registration default business category and replay auto placements
 * for that subject in the same transaction (D-AG-04).
 */
export async function updateDriverRegistrationDefaultBusinessCategory(
  db: Database,
  auth: AuthContext,
  input: UpdateDriverRegistrationDefaultInput,
): Promise<UpdateDriverRegistrationDefaultResult> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const module = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: input.moduleId,
    });
    if (!module || module.kind !== "driver-group") {
      throw new ApiError("NOT_FOUND", "Driver-group module not found.");
    }
    if (!module.attributionSubjectId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Driver-group module has no attribution subject / registration.",
      );
    }

    const business = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: input.defaultBusinessCategoryId,
    });
    if (!business || business.kind !== "business") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Target must be an existing business-category module.",
      );
    }

    await setDriverRegistrationDefaultBusinessCategoryId(tx, {
      attributionSubjectId: module.attributionSubjectId,
      defaultBusinessCategoryModuleId: input.defaultBusinessCategoryId,
      organizationId: auth.organization.id,
    });

    const replay = await replayAutoDriverGroupToRegistrationDefault(tx, {
      organizationId: auth.organization.id,
      moduleId: module.id,
    });

    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
      kind: "parameter-module-driver-default-business-category-updated",
      action: "update-default-business-category",
      targetId: module.id,
      metadata: {
        defaultBusinessCategoryId: input.defaultBusinessCategoryId,
        replay,
      },
    });

    const refreshed = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: module.id,
    });

    return {
      item: refreshed ?? module,
      defaultBusinessCategoryId: input.defaultBusinessCategoryId,
      replay,
    };
  });
}

export type ReplayDriverPlacementResult = DriverPlacementReplayCounts & {
  moduleId: string;
};

/**
 * Explicit Admin operator action: reparent auto driver-group to registration default.
 */
export async function replayDriverPlacementFromRegistration(
  db: Database,
  auth: AuthContext,
  input: { moduleId: string },
): Promise<ReplayDriverPlacementResult> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const module = await getParameterModuleById(tx, {
      organizationId: auth.organization.id,
      moduleId: input.moduleId,
    });
    if (!module || module.kind !== "driver-group") {
      throw new ApiError("NOT_FOUND", "Driver-group module not found.");
    }

    const counts = await replayAutoDriverGroupToRegistrationDefault(tx, {
      organizationId: auth.organization.id,
      moduleId: module.id,
    });

    await writeModuleAttributionAudit(asAuditTx(tx), auth, {
      kind: "parameter-module-driver-placement-replayed",
      action: "replay-placement",
      targetId: module.id,
      metadata: { ...counts },
    });

    return { moduleId: module.id, ...counts };
  });
}

export type DriverRegistryEntry = {
  moduleId: string;
  name: string;
  origin: ModuleOrigin;
  businessCategoryId: string | null;
  businessCategoryName: string | null;
  /** Authoritative registration default (may differ from current tree parent). */
  defaultBusinessCategoryId: string | null;
  compatibles: string[];
  parameterCount: number;
  observed: boolean;
  notYetObserved: boolean;
  driverNature: DriverNature | null;
  instanceCardinality: InstanceCardinality | null;
  parseCoverages: Array<{ compatible: string; coverage: ParseCoverage }>;
};

export async function listDriverRegistry(
  db: Database,
  auth: AuthContext,
): Promise<{ items: DriverRegistryEntry[]; total: number }> {
  requireCanView(auth);
  const registry = await readRegistry(db, auth.organization.id);
  const schemaRegistry = await getCachedOrganizationSchemaRegistry(db, {
    schemasRoot,
    organizationId: auth.organization.id,
  });
  const supersededOverlays = await listOrganizationDriverSchemas(db, {
    organizationId: auth.organization.id,
    lifecycle: "superseded",
  });
  const promotedCompatibles = new Set(
    supersededOverlays
      .filter((overlay) => Boolean(overlay.supersededBySchemaId))
      .map((overlay) => overlay.compatible.toLowerCase()),
  );
  const registrationByModuleId = new Map<
    string,
    {
      driverNature: DriverNature;
      instanceCardinality: InstanceCardinality;
      defaultBusinessCategoryId: string | null;
    }
  >();
  const registrationRows = await db.query<{
    module_id: string;
    driver_nature: DriverNature;
    instance_cardinality: InstanceCardinality;
    default_business_category_module_id: string | null;
  }>(
    `
    select
      pm.id as module_id,
      dr.driver_nature,
      dr.instance_cardinality,
      case
        when placement.organization_id is not null then placement.default_business_category_module_id
        else dr.default_business_category_module_id
      end as default_business_category_module_id
    from parameter_modules pm
    inner join attribution_subjects asub
      on asub.id = pm.attribution_subject_id
     and asub.subject_kind = 'driver-registration'
     and (asub.organization_id is null or asub.organization_id = pm.organization_id)
    inner join driver_registrations dr on dr.attribution_subject_id = pm.attribution_subject_id
    left join driver_registration_placements placement
      on placement.organization_id = pm.organization_id
     and placement.attribution_subject_id = pm.attribution_subject_id
    where pm.organization_id = $1
      and pm.kind = 'driver-group'
      and pm.attribution_subject_id is not null
    `,
    [auth.organization.id],
  );
  for (const row of registrationRows.rows) {
    registrationByModuleId.set(row.module_id, {
      driverNature: row.driver_nature,
      instanceCardinality: row.instance_cardinality,
      defaultBusinessCategoryId: row.default_business_category_module_id,
    });
  }
  const byId = new Map(registry.modules.map((module) => [module.id, module]));
  const mappingsByModule = new Map<string, string[]>();
  for (const mapping of registry.mappings) {
    if (mapping.matchKind !== "compatible") continue;
    const list = mappingsByModule.get(mapping.moduleId) ?? [];
    list.push(mapping.matchValue);
    mappingsByModule.set(mapping.moduleId, list);
  }

  const items: DriverRegistryEntry[] = [];
  for (const module of registry.modules) {
    if (module.kind !== "driver-group") continue;
    if (isScaffoldingDriverLabel(module.name)) continue;
    const compatibles = mappingsByModule.get(module.id) ?? [];
    if (
      compatibles.length > 0 &&
      compatibles.every((compatible) => isScaffoldingDriverLabel(compatible))
    ) {
      continue;
    }
    const parent = module.parentId ? byId.get(module.parentId) : null;
    const observed = module.parameterCount > 0;
    const registration = registrationByModuleId.get(module.id);
    items.push({
      moduleId: module.id,
      name: module.name,
      origin: module.origin,
      businessCategoryId:
        parent?.kind === "business" ? parent.id : module.parentId,
      businessCategoryName:
        parent?.kind === "business" ? parent.name : (parent?.name ?? null),
      defaultBusinessCategoryId:
        registration?.defaultBusinessCategoryId ?? null,
      compatibles,
      parameterCount: module.parameterCount,
      observed,
      notYetObserved: module.origin === "curated" && !observed,
      driverNature: registration?.driverNature ?? null,
      instanceCardinality: registration?.instanceCardinality ?? null,
      parseCoverages: compatibles.map((compatible) => {
        const coverage = lookupParseCoverage(compatible, schemaRegistry);
        if (
          coverage.covered &&
          coverage.scope === "platform" &&
          promotedCompatibles.has(compatible.toLowerCase())
        ) {
          return { compatible, coverage: { ...coverage, promoted: true } };
        }
        return { compatible, coverage };
      }),
    });
  }

  items.sort((left, right) => left.name.localeCompare(right.name));
  return { items, total: items.length };
}

export type UpdateDriverRegistrationInput = {
  moduleId: string;
  driverNature?: DriverNature;
  instanceCardinality?: InstanceCardinality;
};

export type UpdateDriverRegistrationResult = {
  moduleId: string;
  driverNature: DriverNature;
  instanceCardinality: InstanceCardinality;
  attributionSubjectId: string;
};

export async function updateDriverRegistration(
  db: Database,
  auth: AuthContext,
  input: UpdateDriverRegistrationInput,
): Promise<UpdateDriverRegistrationResult> {
  requireCanAdmin(auth);

  if (
    input.driverNature === undefined &&
    input.instanceCardinality === undefined
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "At least one of driverNature or instanceCardinality is required.",
    );
  }

  const loaded = await db.query<{
    module_id: string;
    attribution_subject_id: string;
    subject_organization_id: string | null;
    driver_nature: DriverNature;
    instance_cardinality: InstanceCardinality;
  }>(
    `
    select
      pm.id as module_id,
      pm.attribution_subject_id,
      subject.organization_id as subject_organization_id,
      dr.driver_nature,
      dr.instance_cardinality
    from parameter_modules pm
    inner join attribution_subjects subject
      on subject.id = pm.attribution_subject_id
    inner join driver_registrations dr
      on dr.attribution_subject_id = subject.id
    where pm.organization_id = $1
      and pm.id = $2
      and pm.kind = 'driver-group'
      and pm.attribution_subject_id is not null
    limit 1
    `,
    [auth.organization.id, input.moduleId],
  );

  const row = loaded.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "Driver registration module not found.", {
      moduleId: input.moduleId,
    });
  }

  const subjectOrganizationId = row.subject_organization_id;
  if (subjectOrganizationId == null) {
    if (!isPlatformSuperAdmin(auth)) {
      throw new ApiError(
        "FORBIDDEN",
        "Only platform-admin may edit platform-tier driver registrations.",
      );
    }
  } else if (subjectOrganizationId !== auth.organization.id) {
    throw new ApiError("NOT_FOUND", "Driver registration module not found.", {
      moduleId: input.moduleId,
    });
  }

  const beforeNature = row.driver_nature;
  const beforeCardinality = row.instance_cardinality;
  const nextNature = input.driverNature ?? beforeNature;
  const nextCardinality = input.instanceCardinality ?? beforeCardinality;

  return db.transaction(async (tx) => {
    await tx.query(
      `
      update driver_registrations
      set driver_nature = $2,
          instance_cardinality = $3
      where attribution_subject_id = $1
      `,
      [row.attribution_subject_id, nextNature, nextCardinality],
    );

    const auditMetadata = {
      moduleId: row.module_id,
      attributionSubjectId: row.attribution_subject_id,
      actorRoles: actorRoleIds(auth),
      before: {
        driverNature: beforeNature,
        instanceCardinality: beforeCardinality,
      },
      after: {
        driverNature: nextNature,
        instanceCardinality: nextCardinality,
      },
    };

    if (subjectOrganizationId == null) {
      await writePlatformAuditEvent(tx, {
        projectId: null,
        actorUserId: auth.user.id,
        actorType: "user",
        app: "parameter-management",
        kind: "parameter-module-driver-registration-updated",
        action: "update",
        severity: "Low",
        targetType: "driver-registration",
        targetId: row.attribution_subject_id,
        metadata: auditMetadata,
        traceId: randomUUID(),
        affectedOrganizationIds: [auth.organization.id],
      });
    } else {
      // Stays on the direct path (ratchet allowlist): this audit is attributed to the
      // SUBJECT's organization, not the actor's — outside the seam's auth-derived axis.
      // It is already inside the surrounding transaction.
      await createAuditEvent(tx, {
        id: randomUUID(),
        organizationId: subjectOrganizationId,
        projectId: null,
        actorUserId: auth.user.id,
        actorType: "user",
        app: "parameter-management",
        kind: "parameter-module-driver-registration-updated",
        action: "update",
        severity: "Low",
        targetType: "driver-registration",
        targetId: row.attribution_subject_id,
        metadata: auditMetadata,
        traceId: randomUUID(),
      });
    }

    // Re-sync singleton-cardinality tasks for tip revisions; never rewrite topology.
    const tipRevisions = await tx.query<{
      id: string;
      project_id: string;
    }>(
      `
      select distinct on (project_id, config_set_id)
        id,
        project_id
      from dts_config_revisions
      where organization_id = $1
        and status <> 'resolving'
      order by project_id, config_set_id, revision_number desc
      `,
      [auth.organization.id],
    );

    for (const revision of tipRevisions.rows) {
      await syncSingletonCardinalityBlockingTasks(tx, {
        organizationId: auth.organization.id,
        projectId: revision.project_id,
        configRevisionId: revision.id,
      });
    }

    return {
      moduleId: row.module_id,
      driverNature: nextNature,
      instanceCardinality: nextCardinality,
      attributionSubjectId: row.attribution_subject_id,
    };
  });
}
