import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  createModuleMappingBodySchema,
  dismissCompatibleBodySchema,
  dismissedCompatibleParamsSchema,
  driverRegistryModuleParamsSchema,
  moduleMappingParamsSchema,
  registerOrClaimDriverBodySchema,
  recomputeBindingsBodySchema,
  updateDriverRegistrationBodySchema,
  updateDriverRegistrationDefaultBodySchema
} from "./schemas";
import {
  createModuleMapping,
  deleteModuleMapping,
  dismissCompatible,
  getModuleDiscoveryHints,
  getParameterModuleRegistry,
  listDriverRegistry,
  previewModuleMapping,
  recomputeBindingModules,
  registerOrClaimDriver,
  replayDriverPlacementFromRegistration,
  restoreDismissedCompatible,
  updateDriverRegistration,
  updateDriverRegistrationDefaultBusinessCategory
} from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter module routes.");
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter module route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
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

  router.post("/api/v2/parameter-modules/discovery-hints/dismissals", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(dismissCompatibleBodySchema, request.body ?? {});
    const result = await dismissCompatible(db, auth, body, { requestId: request.requestId });
    return { status: 200, body: result };
  });

  router.delete("/api/v2/parameter-modules/discovery-hints/dismissals/:compatible", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(dismissedCompatibleParamsSchema, {
      compatible: decodeURIComponent(request.params.compatible ?? "")
    });
    const result = await restoreDismissedCompatible(db, auth, params, { requestId: request.requestId });
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-modules/mappings/preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createModuleMappingBodySchema, request.body ?? {});
    const result = await previewModuleMapping(db, auth, body);
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
    const result = await recomputeBindingModules(db, auth, {
      projectId: body.projectId,
      dryRun: body.dryRun
    });
    return { status: 200, body: result };
  });

  router.get("/api/v2/parameter-modules/driver-registry", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await listDriverRegistry(db, auth);
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-modules/driver-registry", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(registerOrClaimDriverBodySchema, request.body ?? {});
    const result = await registerOrClaimDriver(db, auth, body);
    return { status: 201, body: result };
  });

  router.patch("/api/v2/parameter-modules/driver-registry/:moduleId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(driverRegistryModuleParamsSchema, request.params);
    const body = parseWithSchema(updateDriverRegistrationBodySchema, request.body ?? {});
    const result = await updateDriverRegistration(db, auth, {
      moduleId: params.moduleId,
      driverNature: body.driverNature,
      instanceCardinality: body.instanceCardinality,
    });
    return { status: 200, body: result };
  });

  // Dedicated path so it does not collide with nature/cardinality PATCH on
  // `/driver-registry/:moduleId` (D-AG-01 / PR1).
  router.patch(
    "/api/v2/parameter-modules/driver-registry/:moduleId/default-business-category",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(driverRegistryModuleParamsSchema, request.params);
      const body = parseWithSchema(updateDriverRegistrationDefaultBodySchema, request.body ?? {});
      const result = await updateDriverRegistrationDefaultBusinessCategory(db, auth, {
        moduleId: params.moduleId,
        defaultBusinessCategoryId: body.defaultBusinessCategoryId,
      });
      return { status: 200, body: result };
    },
  );

  router.post(
    "/api/v2/parameter-modules/driver-registry/:moduleId/replay-placement",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(driverRegistryModuleParamsSchema, request.params);
      const result = await replayDriverPlacementFromRegistration(db, auth, {
        moduleId: params.moduleId,
      });
      return { status: 200, body: result };
    },
  );
}
