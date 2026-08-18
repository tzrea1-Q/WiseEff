import { z } from "zod";

import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameter-kernel/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  activateParameterSpecBodySchema,
  createOrganizationDriverSchemaBodySchema,
  createParameterSpecBodySchema,
  deprecateOrganizationDriverSchemaBodySchema,
  deprecateParameterSpecBodySchema,
  finalizeParameterSpecCutoverBodySchema,
  listParameterSpecsQuerySchema,
  listSpecReviewTasksQuerySchema,
  driverSchemaPromotionParamsSchema,
  organizationDriverSchemaParamsSchema,
  promoteDriverSchemaOverlayBodySchema,
  parameterSpecParamsSchema,
  parameterSpecReviewTaskParamsSchema,
  prepareParameterSpecCutoverBodySchema,
  reattributeParameterSpecBodySchema,
  renameParameterSpecPropertyKeyBodySchema,
  resolveSpecReviewTaskBodySchema,
  restoreParameterSpecBodySchema,
  updateOrganizationDriverSchemaBodySchema,
  updateParameterSpecBodySchema
} from "./schemas";
import {
  activateParameterSpec,
  createParameterSpec,
  deprecateParameterSpec,
  finalizeParameterSpecVersionCutoverForSpec,
  getParameterSpec,
  getParameterSpecVersionCutoverImpact,
  listParameterSpecs,
  listSpecReviewTasks,
  prepareParameterSpecVersionCutover,
  reattributeParameterSpec,
  renameParameterSpecPropertyKey,
  resolveSpecReviewTask,
  restoreParameterSpec,
  updateParameterSpec,
} from "./service";
import {
  activateOrganizationDriverSchemaForAuth,
  createOrganizationDriverSchemaForAuth,
  deprecateOrganizationDriverSchemaForAuth,
  getOrganizationDriverSchemaForAuth,
  listOrganizationDriverSchemasForAuth,
  previewOrganizationDriverSchemaDeprecationForAuth,
  updateOrganizationDriverSchemaForAuth,
} from "./driverSchemaOverlayService";
import {
  listPromotionCandidatesForAuth,
  promoteDriverSchemaOverlayForAuth,
  revertDriverSchemaOverlayPromotionForAuth,
} from "./driverSchemaPromotion";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter spec routes.");
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter spec route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }
  return parsed.data;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

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

export function registerParameterSpecRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v2/parameter-specs", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const query = parseWithSchema(listParameterSpecsQuerySchema, flattenQuery(request.query));
    const result = await listParameterSpecs(db, auth, query);
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const body = parseWithSchema(createParameterSpecBodySchema, request.body ?? {});
    const result = await createParameterSpec(
      db,
      auth,
      {
        ...body,
        constraints: body.constraints ?? {},
        valueShape: body.valueShape ?? { kind: "unknown" },
        documentation: body.documentation ?? "",
      },
      { requestId: request.requestId },
    );
    return { status: 201, body: result };
  });

  router.get("/api/v2/parameter-specs/:specId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const result = await getParameterSpec(db, auth, params.specId);
    return { status: 200, body: result };
  });

  router.get("/api/v2/parameter-spec-review-tasks", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const query = parseWithSchema(listSpecReviewTasksQuerySchema, flattenQuery(request.query));
    const result = await listSpecReviewTasks(db, auth, query);
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-spec-review-tasks/:taskId/resolve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecReviewTaskParamsSchema, request.params);
    const body = parseWithSchema(resolveSpecReviewTaskBodySchema, request.body);
    const item = await resolveSpecReviewTask(
      db,
      auth,
      { ...body, taskId: params.taskId },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item } };
  });

  router.post("/api/v2/parameter-specs/:specId/activate", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(activateParameterSpecBodySchema, request.body ?? {});
    const result = await activateParameterSpec(
      db,
      auth,
      {
        ...body,
        constraints: body.constraints ?? {},
        specId: params.specId,
      },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.get("/api/v2/parameter-specs/:specId/cutover", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const result = await getParameterSpecVersionCutoverImpact(db, auth, params.specId);
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/cutover/prepare", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(prepareParameterSpecCutoverBodySchema, request.body ?? {});
    const result = await prepareParameterSpecVersionCutover(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/cutover/finalize", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(finalizeParameterSpecCutoverBodySchema, request.body ?? {});
    const result = await finalizeParameterSpecVersionCutoverForSpec(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/deprecate", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(deprecateParameterSpecBodySchema, request.body ?? {});
    const result = await deprecateParameterSpec(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/restore", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(restoreParameterSpecBodySchema, request.body ?? {});
    const result = await restoreParameterSpec(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/reattribute", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(reattributeParameterSpecBodySchema, request.body ?? {});
    const result = await reattributeParameterSpec(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.post("/api/v2/parameter-specs/:specId/rename-property-key", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(renameParameterSpecPropertyKeyBodySchema, request.body ?? {});
    const result = await renameParameterSpecPropertyKey(
      db,
      auth,
      { ...body, specId: params.specId },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.patch("/api/v2/parameter-specs/:specId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(parameterSpecParamsSchema, request.params);
    const body = parseWithSchema(updateParameterSpecBodySchema, request.body ?? {});
    const result = await updateParameterSpec(
      db,
      auth,
      {
        ...body,
        specId: params.specId,
      },
      { requestId: request.requestId },
    );
    return { status: 200, body: result };
  });

  router.get("/api/v2/organization-driver-schemas", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await listOrganizationDriverSchemasForAuth(db, auth);
    return { status: 200, body: result };
  });

  router.get("/api/v2/organization-driver-schemas/:schemaId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(organizationDriverSchemaParamsSchema, request.params);
    const item = await getOrganizationDriverSchemaForAuth(db, auth, params.schemaId);
    return { status: 200, body: { item } };
  });

  router.post("/api/v2/organization-driver-schemas", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createOrganizationDriverSchemaBodySchema, request.body ?? {});
    const item = await createOrganizationDriverSchemaForAuth(db, auth, body, { requestId: request.requestId });
    return { status: 201, body: { item } };
  });

  router.patch("/api/v2/organization-driver-schemas/:schemaId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(organizationDriverSchemaParamsSchema, request.params);
    const body = parseWithSchema(updateOrganizationDriverSchemaBodySchema, request.body ?? {});
    const item = await updateOrganizationDriverSchemaForAuth(db, auth, params.schemaId, body, { requestId: request.requestId });
    return { status: 200, body: { item } };
  });

  router.post("/api/v2/organization-driver-schemas/:schemaId/activate", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(organizationDriverSchemaParamsSchema, request.params);
    const result = await activateOrganizationDriverSchemaForAuth(db, auth, params.schemaId);
    return { status: 200, body: result };
  });

  router.post("/api/v2/organization-driver-schemas/:schemaId/deprecate", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(organizationDriverSchemaParamsSchema, request.params);
    const body = parseWithSchema(deprecateOrganizationDriverSchemaBodySchema, request.body ?? {});
    const item = await deprecateOrganizationDriverSchemaForAuth(db, auth, params.schemaId, body, { requestId: request.requestId });
    return { status: 200, body: { item } };
  });

  router.get("/api/v2/organization-driver-schemas/:schemaId/deprecation-impact", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(organizationDriverSchemaParamsSchema, request.params);
    const item = await previewOrganizationDriverSchemaDeprecationForAuth(db, auth, params.schemaId);
    return { status: 200, body: { item } };
  });

  router.get("/api/v2/platform/driver-schemas/promotion-candidates", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await listPromotionCandidatesForAuth(db, auth);
    return { status: 200, body: result };
  });

  router.post("/api/v2/platform/driver-schemas/promotions", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(promoteDriverSchemaOverlayBodySchema, request.body ?? {});
    const result = await promoteDriverSchemaOverlayForAuth(db, auth, body);
    return { status: 201, body: result };
  });

  router.post("/api/v2/platform/driver-schemas/promotions/:promotionId/revert", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(driverSchemaPromotionParamsSchema, {
      promotionId: request.params.promotionId,
    });
    const result = await revertDriverSchemaOverlayPromotionForAuth(db, auth, params.promotionId);
    return { status: 200, body: result };
  });
}
