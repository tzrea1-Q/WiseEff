import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  approveReview,
  getProjectInitializationStatus,
  listPendingReviews,
  previewSnapshot,
  rejectReview,
  submitDraft,
  upsertDraft
} from "./initializationService";
import { getDraftByProject } from "./initializationRepository";
import {
  createProjectForAuth,
  deleteProjectForAuth,
  updateProjectForAuth
} from "./projectService";
import {
  getParameterById,
  listParameterHistory,
  listParameters
} from "./repository";
import {
  getProjectAdminDetail,
  listProjectAdminSummaries,
  listProjectModules,
  listProjects
} from "../projects/repository";
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
  listWorkflowAssignees,
  moveParameterModuleForAuth,
  parseDtsImportForAuth,
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
  paramsWithInitializationReviewIdSchema,
  paramsWithRoundIdSchema,
  parseDtsImportBodySchema,
  previewInitializationSnapshotBodySchema,
  rejectInitializationReviewBodySchema,
  reviewChangeBodySchema,
  saveDraftBodySchema,
  upsertInitializationDraftBodySchema,
  submitRoundBodySchema,
  updateParameterModuleBodySchema,
  updateProjectBodySchema
} from "./schemas";
import type { ListParametersQuery } from "./schemas";
import { canAdminParameters, canMergeParameters, canReviewParameters, canViewParameters } from "../parameter-kernel/policy";
import { parameterSubmissionRoundStatuses } from "./status";
import { parameterChangeRequestStatuses } from "../parameter-kernel/workflowStatus";

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
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter routes.");
  }

  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

async function rejectRetiredLegacyParameterId(db: Queryable, legacyId: string): Promise<never | void> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from legacy_parameter_migration_evidence
    where legacy_id = $1
    order by created_at asc
    limit 1
    `,
    [legacyId]
  );
  const evidenceId = result.rows[0]?.id;
  if (!evidenceId) {
    return;
  }
  throw new ApiError("GONE", "legacy-parameter-id-retired", {
    diagnostic: "legacy-parameter-id-retired",
    migrationEvidenceId: evidenceId
  });
}

function requireCanReviewOrMerge(auth: AuthContext) {
  if (!canReviewParameters(auth) && !canMergeParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter review or merge permission is required.");
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
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
    throw new ApiError("VALIDATION_FAILED", `Route ${field} must match request body ${field}.`, {
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
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
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
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: params.projectId });
    }

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameters/admin/projects", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const body = parseWithSchema(createProjectBodySchema, request.body, "Invalid project create payload.");
    const projectId = body.id?.trim() || slugifyProjectId(body.code);
    const item = await createProjectForAuth(
      db,
      auth,
      {
        id: projectId,
        name: body.name.trim(),
        code: body.code.trim().toUpperCase()
      },
      { requestId: request.requestId }
    );

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/parameters/admin/projects/:projectId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(updateProjectBodySchema, request.body, "Invalid project update payload.");
    const item = await updateProjectForAuth(
      db,
      auth,
      {
        projectId: params.projectId,
        name: body.name?.trim(),
        code: body.code?.trim().toUpperCase(),
        status: body.status?.trim()
      },
      { requestId: request.requestId }
    );

    if (!item) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: params.projectId });
    }

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/parameters/admin/projects/:projectId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const existing = await getProjectAdminDetail(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: params.projectId });
    }

    const result = await deleteProjectForAuth(
      db,
      auth,
      { projectId: params.projectId, projectName: existing.name },
      { requestId: request.requestId }
    );

    if (!result.deleted) {
      throw new ApiError("NOT_FOUND", "Project was not found.", { projectId: params.projectId });
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
      await rejectRetiredLegacyParameterId(db, params.parameterId);
      throw new ApiError("NOT_FOUND", "Parameter was not found.", { parameterId: params.parameterId });
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

    if (items.length === 0) {
      await rejectRetiredLegacyParameterId(db, params.parameterId);
    }

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

  router.get("/api/v1/projects/:projectId/parameter-workflow-assignees", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const item = await listWorkflowAssignees(db, auth, params.projectId);

    return { status: 200, body: { item } };
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
    const item = await reviewChange(db, auth, body, { requestId: request.requestId, objectStore: options.objectStore });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameter-import-batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createImportBatchBodySchema, request.body);
    const item = await createImportPreview(db, auth, body, { requestId: request.requestId });

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

  router.post("/api/v1/parameter-import/parse-dts", async (request) => {
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(parseDtsImportBodySchema, request.body);
    const result = parseDtsImportForAuth(auth, body);

    return { status: 200, body: result };
  });

  router.get("/api/v1/parameters/projects/:projectId/initialization", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const status = await getProjectInitializationStatus(db, auth, params.projectId);
    const draft = await getDraftByProject(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });
    return { status: 200, body: { status, draft } };
  });

  router.put("/api/v1/parameters/projects/:projectId/initialization/draft", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(
      upsertInitializationDraftBodySchema,
      request.body,
      "Invalid initialization draft payload."
    );
    const item = await upsertDraft(
      db,
      auth,
      {
        projectId: params.projectId,
        ...body,
        bindingSnapshots: body.bindingSnapshots.map((snapshot) => ({
          ...snapshot,
          effectiveValue: snapshot.effectiveValue as unknown
        }))
      },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameters/projects/:projectId/initialization/preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(
      previewInitializationSnapshotBodySchema,
      request.body,
      "Invalid initialization preview payload."
    );
    const items = await previewSnapshot(db, auth, {
      projectId: params.projectId,
      primarySourceProjectId: body.primarySourceProjectId,
      supplementSourceProjectIds: body.supplementSourceProjectIds ?? [],
      selectedSourceBindingIds: body.selectedSourceBindingIds,
      selectedModuleIds: body.selectedModuleIds,
      selectedRisks: body.selectedRisks
    });
    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameters/projects/:projectId/initialization/submit", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const item = await submitDraft(db, auth, { projectId: params.projectId }, { requestId: request.requestId });
    return { status: 201, body: { item } };
  });

  router.get("/api/v1/parameters/admin/initialization-reviews", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const items = await listPendingReviews(db, auth);
    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameters/admin/initialization-reviews/:reviewId/approve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithInitializationReviewIdSchema, request.params);
    const item = await approveReview(db, auth, { reviewId: params.reviewId }, { requestId: request.requestId });
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameters/admin/initialization-reviews/:reviewId/reject", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithInitializationReviewIdSchema, request.params);
    const body = parseWithSchema(
      rejectInitializationReviewBodySchema,
      request.body,
      "Invalid initialization reject payload."
    );
    const item = await rejectReview(
      db,
      auth,
      { reviewId: params.reviewId, reason: body.reason },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item } };
  });
}
