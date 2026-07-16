import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  identityMappingTaskParamsSchema,
  listIdentityMappingTasksQuerySchema,
  projectBindingsParamsSchema,
  projectBindingsQuerySchema,
  resolveIdentityMappingTaskBodySchema,
  topologyParamsSchema,
  topologyQuerySchema,
  validateConfigRevisionBodySchema,
  validateConfigRevisionParamsSchema
} from "./schemas";
import {
  getTopology,
  listIdentityMappingTasks,
  listProjectBindings,
  resolveIdentityMappingTask,
  validateConfigRevision
} from "./service";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter topology routes.", 500);
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter topology route input.") {
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

export function registerParameterTopologyRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get(
    "/api/v2/projects/:projectId/config-sets/:configSetId/revisions/:revisionId/topology",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      requireCanView(auth);
      const params = parseWithSchema(topologyParamsSchema, request.params);
      const query = parseWithSchema(topologyQuerySchema, flattenQuery(request.query));
      const item = await getTopology(db, auth, {
        ...params,
        view: query.view ?? "effective"
      });
      return { status: 200, body: { item } };
    }
  );

  router.get("/api/v2/projects/:projectId/parameter-bindings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(projectBindingsParamsSchema, request.params);
    const query = parseWithSchema(projectBindingsQuerySchema, flattenQuery(request.query));
    const result = await listProjectBindings(db, auth, {
      projectId: params.projectId,
      revisionId: query.revisionId
    });
    return { status: 200, body: result };
  });

  router.get("/api/v2/identity-mapping-tasks", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const query = parseWithSchema(listIdentityMappingTasksQuerySchema, flattenQuery(request.query));
    const result = await listIdentityMappingTasks(db, auth, query);
    return { status: 200, body: result };
  });

  router.post("/api/v2/identity-mapping-tasks/:taskId/resolve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(identityMappingTaskParamsSchema, request.params);
    const body = parseWithSchema(resolveIdentityMappingTaskBodySchema, request.body);
    const item = await resolveIdentityMappingTask(
      db,
      auth,
      { ...body, taskId: params.taskId },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item } };
  });

  router.post("/api/v2/projects/:projectId/config-revisions/:revisionId/validate", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(validateConfigRevisionParamsSchema, request.params);
    const body = parseWithSchema(validateConfigRevisionBodySchema, request.body ?? {});
    const item = await validateConfigRevision(
      db,
      auth,
      { projectId: params.projectId, revisionId: params.revisionId, stage: body.stage },
      { requestId: request.requestId },
      { objectStore: options.objectStore }
    );
    return { status: 200, body: { item } };
  });
}
