import { z } from "zod";

import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  listParameterSpecsQuerySchema,
  listSpecReviewTasksQuerySchema,
  parameterSpecParamsSchema,
  parameterSpecReviewTaskParamsSchema,
  resolveSpecReviewTaskBodySchema
} from "./schemas";
import { getParameterSpec, listParameterSpecs, listSpecReviewTasks, resolveSpecReviewTask } from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter spec routes.", 500);
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter spec route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

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
}
