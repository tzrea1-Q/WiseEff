import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  createProject,
  deleteProject,
  getParameterById,
  getProjectAdminDetail,
  listParameterHistory,
  listParameters,
  listProjectAdminSummaries,
  listProjectModules,
  listProjects,
  updateProject
} from "./repository";
import {
  applyImportBatch,
  createImportPreview,
  createParameterModuleForAuth,
  deleteDraft,
  deleteParameterModuleForAuth,
  listChangeRequests,
  listDrafts,
  listParameterModulesForAuth,
  listSubmissionRounds,
  moveParameterModuleForAuth,
  resolveParameterListQuery,
  reviewChange,
  saveDraft,
  submitParameterChanges,
  updateParameterModuleForAuth,
  withdrawSubmissionRound
} from "./service";
import {
  applyImportBatchBodySchema,
  createImportBatchBodySchema,
  createParameterModuleBodySchema,
  createProjectBodySchema,
  listParametersQuerySchema,
  moveParameterModuleBodySchema,
  parameterModuleParamsSchema,
  paramsWithRoundIdSchema,
  reviewChangeBodySchema,
  saveDraftBodySchema,
  submitRoundBodySchema,
  updateParameterModuleBodySchema,
  updateProjectBodySchema
} from "./schemas";
import type { ListParametersQuery } from "./schemas";
import { canAdminParameters, canMergeParameters, canReviewParameters, canViewParameters } from "./policy";
import { parameterChangeRequestStatuses, parameterSubmissionRoundStatuses } from "./status";

const paramsWithProjectIdSchema = z.object({
  projectId: z.string().min(1)
});

const paramsWithParameterIdSchema = z.object({
  parameterId: z.string().min(1)
});

const paramsWithDraftIdSchema = z.object({
  draftId: z.string().min(1)
});

const paramsWithRequestIdSchema = z.object({
  requestId: z.string().min(1)
});

const paramsWithBatchIdSchema = z.object({
  batchId: z.string().min(1)
});

const listDraftsQuerySchema = z.object({
  projectId: z.string().min(1).optional()
});

const listSubmissionRoundsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  status: z.union([z.enum(parameterSubmissionRoundStatuses), z.array(z.enum(parameterSubmissionRoundStatuses))]).optional()
});

const listChangeRequestsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  status: z.union([z.enum(parameterChangeRequestStatuses), z.array(z.enum(parameterChangeRequestStatuses))]).optional(),
  assignedTo: z.string().min(1).optional()
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter routes.", 500);
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanReviewOrMerge(auth: AuthContext) {
  if (!canReviewParameters(auth) && !canMergeParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review or merge permission is required.", 403);
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

function slugifyProjectId(code: string) {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function withRouteField(value: unknown, field: string, fieldValue: string) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    field in value &&
    value[field as keyof typeof value] !== fieldValue
  ) {
    throw new ApiError("VALIDATION_FAILED", `Route ${field} must match request body ${field}.`, 400, {
      [field]: value[field as keyof typeof value],
      routeValue: fieldValue
    });
  }

  return {
    ...(typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}),
    [field]: fieldValue
  };
}

function normalizeArray<T>(value: T | T[] | undefined) {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value];
}

export function registerParameterRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.get("/api/v1/projects", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const items = await listProjects(db, { organizationId: auth.organization.id });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/parameters/admin/projects", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const items = await listProjectAdminSummaries(db, { organizationId: auth.organization.id });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/parameters/admin/projects/:projectId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const item = await getProjectAdminDetail(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });

    if (!item) {
      throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId: params.projectId });
    }

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameters/admin/projects", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const body = parseWithSchema(createProjectBodySchema, request.body, "Invalid project create payload.");
    const projectId = body.id?.trim() || slugifyProjectId(body.code);
    const item = await createProject(db, {
      organizationId: auth.organization.id,
      id: projectId,
      name: body.name.trim(),
      code: body.code.trim().toUpperCase()
    });

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/parameters/admin/projects/:projectId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(updateProjectBodySchema, request.body, "Invalid project update payload.");
    const item = await updateProject(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId,
      name: body.name?.trim(),
      code: body.code?.trim().toUpperCase(),
      status: body.status?.trim()
    });

    if (!item) {
      throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId: params.projectId });
    }

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/parameters/admin/projects/:projectId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const result = await deleteProject(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });

    if (!result.deleted) {
      throw new ApiError("NOT_FOUND", "Project was not found.", 404, { projectId: params.projectId });
    }

    return { status: 200, body: { ok: true as const } };
  });

  router.get("/api/v1/projects/:projectId/modules", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const items = await listProjectModules(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/parameter-modules", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const items = await listParameterModulesForAuth(db, auth);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameter-modules", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createParameterModuleBodySchema, request.body, "Invalid parameter module create payload.");
    const item = await createParameterModuleForAuth(db, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/parameter-modules/:moduleId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    const body = parseWithSchema(updateParameterModuleBodySchema, request.body, "Invalid parameter module update payload.");
    const item = await updateParameterModuleForAuth(db, auth, params.moduleId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameter-modules/:moduleId/move", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    const body = parseWithSchema(moveParameterModuleBodySchema, request.body, "Invalid parameter module move payload.");
    const item = await moveParameterModuleForAuth(db, auth, params.moduleId, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/parameter-modules/:moduleId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    await deleteParameterModuleForAuth(db, auth, params.moduleId, { requestId: request.requestId });

    return { status: 204, body: null };
  });

  router.get("/api/v1/parameters", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const query = parseWithSchema(listParametersQuerySchema, request.query) as ListParametersQuery;
    const resolved = await resolveParameterListQuery(db, auth.organization.id, query);
    const items = await listParameters(db, resolved);

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/parameters/:parameterId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithParameterIdSchema, request.params);
    const item = await getParameterById(db, {
      organizationId: auth.organization.id,
      parameterId: params.parameterId
    });

    if (!item) {
      throw new ApiError("NOT_FOUND", "Parameter was not found.", 404, { parameterId: params.parameterId });
    }

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/parameters/:parameterId/history", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithParameterIdSchema, request.params);
    const items = await listParameterHistory(db, {
      organizationId: auth.organization.id,
      parameterId: params.parameterId
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameter-drafts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(saveDraftBodySchema, request.body);
    const item = await saveDraft(db, auth, body);

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/parameter-drafts/mine", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listDraftsQuerySchema, request.query);
    const items = await listDrafts(db, auth, query);

    return { status: 200, body: { items } };
  });

  router.delete("/api/v1/parameter-drafts/:draftId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithDraftIdSchema, request.params);

    await deleteDraft(db, auth, params.draftId);

    return { status: 200, body: { ok: true } };
  });

  router.post("/api/v1/parameter-submission-rounds", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(submitRoundBodySchema, request.body);
    const item = await submitParameterChanges(db, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/parameter-submission-rounds", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listSubmissionRoundsQuerySchema, request.query);
    const items = await listSubmissionRounds(db, auth, {
      ...query,
      status: normalizeArray(query.status)
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameter-submission-rounds/:roundId/withdraw", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithRoundIdSchema, request.params);
    const item = await withdrawSubmissionRound(db, auth, params.roundId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/parameter-change-requests", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listChangeRequestsQuerySchema, request.query);
    const items = await listChangeRequests(db, auth, {
      ...query,
      status: normalizeArray(query.status)
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameter-change-requests/:requestId/review", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithRequestIdSchema, request.params);
    const body = parseWithSchema(reviewChangeBodySchema, withRouteField(request.body, "requestId", params.requestId));
    requireCanReviewOrMerge(auth);
    const item = await reviewChange(db, auth, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameter-import-batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createImportBatchBodySchema, request.body);
    const item = await createImportPreview(db, auth, body);

    return { status: 201, body: { item } };
  });

  router.post("/api/v1/parameter-import-batches/:batchId/apply", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithBatchIdSchema, request.params);
    const body = parseWithSchema(applyImportBatchBodySchema, withRouteField(request.body, "batchId", params.batchId));
    const item = await applyImportBatch(db, auth, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });
}
