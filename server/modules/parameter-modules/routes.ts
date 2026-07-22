import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  createModuleMappingBodySchema,
  moduleMappingParamsSchema,
  recomputeBindingsBodySchema
} from "./schemas";
import {
  createModuleMapping,
  deleteModuleMapping,
  getModuleDiscoveryHints,
  getParameterModuleRegistry,
  recomputeBindingModules
} from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter module routes.", 500);
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter module route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

/**
 * Additive surface for the workbench registry:
 * - GET registry (v1 modules + DTS mappings)
 * - mappings CRUD
 * Module create/update/delete stays on `/api/v1/parameter-modules`.
 */
export function registerParameterModuleRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v2/parameter-modules", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await getParameterModuleRegistry(db, auth);
    return { status: 200, body: result };
  });

  router.get("/api/v2/parameter-modules/discovery-hints", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await getModuleDiscoveryHints(db, auth);
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-modules/mappings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createModuleMappingBodySchema, request.body ?? {});
    const result = await createModuleMapping(db, auth, body);
    return { status: 201, body: result };
  });

  router.delete("/api/v2/parameter-modules/mappings/:mappingId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(moduleMappingParamsSchema, request.params);
    const result = await deleteModuleMapping(db, auth, { mappingId: params.mappingId });
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-modules/recompute-bindings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(recomputeBindingsBodySchema, request.body ?? {});
    const result = await recomputeBindingModules(db, auth, { projectId: body.projectId });
    return { status: 200, body: result };
  });
}
