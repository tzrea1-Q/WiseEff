import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import {
  asAuditTx,
  writeAuditEventInTx,
  type AuditTx,
} from "../audit/auditedWrite";
import {
  canAdminParameters,
  canViewParameters,
} from "../parameter-kernel/policy";
import {
  getRootPostgresPool,
  type Database,
  type Queryable,
} from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  bindingModuleConflictExists,
  collectEmptyUnclassifiedBuckets,
  getModuleNamesByIds,
  listBindingsForModuleRecompute,
  listDismissedCompatiblesForDiscovery,
  listObservedCompatiblesForDiscovery,
  readRegistry,
  type RegistryCatalogSnapshot,
  updateBindingModuleId,
  type RecomputeBindingRow,
} from "./repository";
import { createCatalogKernel } from "../catalog-kernel/interface";
import {
  captureCurrentCatalogPin,
  createPinCapturingCatalogRuntime,
} from "../catalog-publication/runtime";
import { resolveAttributionModuleForBinding } from "./ensureAttributionModuleForBinding";
import { isScaffoldingDriverLabel } from "./modulePlacement";
import type {
  ModuleOrigin,
  ParameterModuleRegistryDto,
} from "./types";
import { getCachedOrganizationSchemaRegistry } from "../parameter-specs/schemaRegistryCache";
import {
  lookupParseCoverage,
  type ParseCoverage,
} from "../parameter-specs/parseCoverage";
import type { DriverNature, InstanceCardinality } from "./attributionSubjects";
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

/** Capture one current Catalog snapshot for every registry read in an operation. */
async function captureRegistryCatalog(
  db: Database,
): Promise<RegistryCatalogSnapshot | null> {
  const pool = getRootPostgresPool(db);
  if (!pool) return null;
  const pin = await captureCurrentCatalogPin(pool);
  if (!pin) return null;
  const loaded = await createPinCapturingCatalogRuntime(
    pool,
    createCatalogKernel(pool),
  ).loadCurrentCatalog(pin);
  if (!loaded.ok) {
    throw new Error(`Current Catalog snapshot unavailable: ${loaded.error.kind}`);
  }
  return loaded.value;
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

async function planScopedMoves(
  db: Queryable,
  input: {
    organizationId: string;
    projectId?: string | null;
  },
): Promise<{ moves: PlannedMove[]; conflicts: string[] }> {
  const bindings = await listBindingsForModuleRecompute(db, {
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
  });
  const moves: PlannedMove[] = [];
  const conflicts: string[] = [];

  for (const binding of bindings) {
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
  const catalog = await captureRegistryCatalog(db);
  const item = await readRegistry(db, auth.organization.id, catalog);
  return { item: {
    navigationOnly: true,
    modules: item.modules.map(module => ({ ...module, sourceKey: null, attributionSubjectId: null })),
    mappings: [],
  } };
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
    // side effects.
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
  const catalog = await captureRegistryCatalog(db);
  const registry = await readRegistry(db, auth.organization.id, catalog);
  const schemaRegistry = await getCachedOrganizationSchemaRegistry(db, {
    schemasRoot,
    organizationId: auth.organization.id,
  });
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
      parseCoverages: compatibles.map((compatible) => ({
        compatible,
        coverage: lookupParseCoverage(compatible, schemaRegistry),
      })),
    });
  }

  items.sort((left, right) => left.name.localeCompare(right.name));
  return { items, total: items.length };
}
