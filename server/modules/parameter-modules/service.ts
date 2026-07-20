import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  bindingModuleConflictExists,
  deleteMappingRow,
  insertMapping,
  listBindingsForModuleRecompute,
  moduleExists,
  readRegistry,
  updateBindingModuleId
} from "./repository";
import { resolveModuleIdForBinding } from "./resolveModuleForBinding";
import type { CreateModuleMappingBody } from "./schemas";
import type { ParameterModuleRegistryDto } from "./types";

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

export async function getParameterModuleRegistry(
  db: Database,
  auth: AuthContext
): Promise<{ item: ParameterModuleRegistryDto }> {
  requireCanView(auth);
  const item = await readRegistry(db, auth.organization.id);
  return { item };
}

export async function createModuleMapping(
  db: Database,
  auth: AuthContext,
  input: CreateModuleMappingBody
): Promise<{ item: ParameterModuleRegistryDto }> {
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
    const item = await readRegistry(tx, auth.organization.id);
    return { item };
  });
}

export type RecomputeBindingModulesResult = {
  updated: number;
  conflicts: string[];
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
  input: { projectId?: string }
): Promise<RecomputeBindingModulesResult> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const bindings = await listBindingsForModuleRecompute(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId ?? null
    });

    let updated = 0;
    const conflicts: string[] = [];

    for (const binding of bindings) {
      const nextModuleId = await resolveModuleIdForBinding(tx, {
        organizationId: auth.organization.id,
        driverModule: binding.driverModule,
        compatible: binding.compatible,
        instanceName: binding.instanceName
      });
      if (nextModuleId === binding.moduleId) continue;

      const collides = await bindingModuleConflictExists(tx, {
        organizationId: auth.organization.id,
        projectId: binding.projectId,
        logicalNodeId: binding.logicalNodeId,
        parameterSpecId: binding.parameterSpecId,
        moduleId: nextModuleId,
        excludeBindingId: binding.id
      });
      if (collides) {
        conflicts.push(binding.id);
        continue;
      }

      await updateBindingModuleId(tx, {
        organizationId: auth.organization.id,
        bindingId: binding.id,
        moduleId: nextModuleId
      });
      updated += 1;
    }

    if (conflicts.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Recompute would collide with existing bindings under the module unique key.",
        409,
        { conflicts }
      );
    }

    return { updated, conflicts };
  });
}

export async function deleteModuleMapping(
  db: Database,
  auth: AuthContext,
  input: { mappingId: string }
): Promise<{ item: ParameterModuleRegistryDto }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const removed = await deleteMappingRow(tx, {
      organizationId: auth.organization.id,
      mappingId: input.mappingId
    });
    if (removed === 0) {
      throw new ApiError("NOT_FOUND", "Mapping not found.", 404);
    }
    const item = await readRegistry(tx, auth.organization.id);
    return { item };
  });
}
