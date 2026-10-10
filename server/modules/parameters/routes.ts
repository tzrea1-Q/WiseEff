import { z } from "zod";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  assertTrustedRefusalAuditSink,
  createTrustedRefusalAuditSink,
  type TrustedRefusalAuditSink
} from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import { getRootPostgresPool, isRootDatabase, type Database } from "../../shared/database/client";
import { resolveCanonicalParameter } from "../parameter-bindings/canonicalCompatibilityRead";
import { listCatalogBindingRowsForProject, loadPublishedCatalog, readCanonicalBindingChangeHistory, type CatalogBindingView } from "../parameter-bindings/catalogProjectValueSync";
import { catalogLegacyGoneResult, LEGACY_WRITE_GONE_MESSAGE } from "../parameter-catalog-api/legacy/gone";
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
  attachDraftCanonicalPins
} from "./canonicalParameterPin";
import {
  getProjectAdminDetail,
  getProjectById,
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
import type { CanonicalParameterCompatibilityRecordDto } from "./types";
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
  status: z.union([z.enum(parameterSubmissionRoundStatuses), z.array(z.enum(parameterSubmissionRoundStatuses))]).optional(),
  mine: z.enum(["true", "false"]).optional()
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

function requireSubmissionRefusalSink(sink: TrustedRefusalAuditSink | undefined) {
  if (!sink) {
    throw new ApiError("INTERNAL_ERROR", "Server-owned parameter submission refusal audit sink is required.");
  }
  assertTrustedRefusalAuditSink(sink);
  return sink;
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

function toCanonicalCompatibilityRecord(binding: CatalogBindingView, modulesById: Map<string, Awaited<ReturnType<typeof listParameterModulesForAuth>>[number]>): CanonicalParameterCompatibilityRecordDto {
  return {
    id: binding.id,
    bindingId: binding.id,
    projectParameterBindingId: binding.id,
    definitionId: binding.definitionId,
    effectiveRevisionId: binding.effectiveRevisionId,
    currentValueId: binding.currentValueId,
    projectId: binding.projectId,
    name: binding.propertyKey,
    description: binding.description ?? "",
    explanation: binding.documentation ?? "",
    configFormat: binding.typedValue.kind === "json" ? "JSON" : "DTS",
    module: binding.driverModule ?? "",
    moduleId: binding.moduleId || undefined,
    modulePath: modulesById.get(binding.moduleId)?.path.split("/").map((id) => modulesById.get(id)?.name ?? id),
    sourceFileId: binding.sourceFileId,
    sourceNodePath: binding.sourceNodePath ?? undefined,
    sourceOccurrenceId: binding.sourceOccurrenceId,
    currentValue: binding.rawValue,
    recommendedValue: null,
    range: null,
    unit: null,
    risk: null,
    updatedAt: null,
    updatedAtTs: null,
    history: null,
    metadataAvailability: { status: "unavailable", reason: "canonical-compatibility-metadata-unavailable" }
  };
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
    refusalAuditSink?: TrustedRefusalAuditSink;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  const refusalAuditSink = options.refusalAuditSink
    ? (assertTrustedRefusalAuditSink(options.refusalAuditSink), options.refusalAuditSink)
    : options.db && isRootDatabase(options.db)
      ? createTrustedRefusalAuditSink(options.db)
      : undefined;
  const retireModuleWrite = async (request: RouteRequest, auth: AuthContext, routeId: string) => {
    if (!refusalAuditSink) {
      throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for module retirement.");
    }
    await refusalAuditSink.write({
      invocation: createUserInvocation(auth),
      projectId: null,
      app: "parameter-catalog",
      kind: "legacy-surface-retired",
      action: "deny",
      severity: "Low",
      targetType: "legacy-route",
      targetId: routeId,
      metadata: { reason: "legacy-surface-retired", routeId, method: request.method },
      traceId: request.requestId,
    });
    return catalogLegacyGoneResult(request.requestId, LEGACY_WRITE_GONE_MESSAGE);
  };
  router.get("/api/v1/projects", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const items = (await listProjects(db, { organizationId: auth.organization.id }))
      .filter((project) => auth.roles.some((role) => role.projectId === null || role.projectId === project.id));

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
    let item;
    try {
      item = await createParameterModuleForAuth(db, auth, body, { requestId: request.requestId });
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "legacy-surface-retired") {
        return retireModuleWrite(request, auth, "parameterModules.v1.create");
      }
      throw error;
    }

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/parameter-modules/:moduleId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    const body = parseWithSchema(updateParameterModuleBodySchema, request.body, "Invalid parameter module update payload.");
    let item;
    try {
      item = await updateParameterModuleForAuth(db, auth, params.moduleId, body, { requestId: request.requestId });
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "legacy-surface-retired") {
        return retireModuleWrite(request, auth, "parameterModules.v1.update");
      }
      throw error;
    }

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/parameter-modules/:moduleId/move", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    const body = parseWithSchema(moveParameterModuleBodySchema, request.body, "Invalid parameter module move payload.");
    let item;
    try {
      item = await moveParameterModuleForAuth(db, auth, params.moduleId, body, { requestId: request.requestId });
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "legacy-surface-retired") {
        return retireModuleWrite(request, auth, "parameterModules.v1.move");
      }
      throw error;
    }

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/parameter-modules/:moduleId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(parameterModuleParamsSchema, request.params);
    try {
      await deleteParameterModuleForAuth(db, auth, params.moduleId, { requestId: request.requestId });
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "legacy-surface-retired") {
        return retireModuleWrite(request, auth, "parameterModules.v1.delete");
      }
      throw error;
    }

    return { status: 204, body: null };
  });

  router.get("/api/v1/parameters", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    if (!auth.user.isActive) {
      throw new ApiError("FORBIDDEN", "Missing permission: parameter:view.");
    }
    const query = parseWithSchema(listParametersQuerySchema, request.query) as ListParametersQuery;
    const resolved = await resolveParameterListQuery(db, auth.organization.id, query);
    const project = resolved.projectId
      ? await getProjectById(db, { organizationId: auth.organization.id, projectId: resolved.projectId })
      : null;
    if (resolved.projectId && !project) {
      throw new ApiError("NOT_FOUND", "Project was not found for this organization.", { projectId: resolved.projectId });
    }
    const projects = project ? [project] : (await listProjects(db, { organizationId: auth.organization.id }))
      .filter((candidate) => auth.roles.some((role) => role.projectId === null || role.projectId === candidate.id));
    if (project && !auth.roles.some((role) => role.projectId === null || role.projectId === project.id)) {
      throw new ApiError("FORBIDDEN", "Project parameter scope is required.");
    }
    if (resolved.risk !== undefined) return { status: 200, body: { items: [] } };
    const modules = await listParameterModulesForAuth(db, auth);
    const modulesById = new Map(modules.map((module) => [module.id, module]));
    const moduleIds = new Set(modules.filter((module) =>
      module.id === resolved.moduleId ||
      (resolved.includeDescendants !== false && module.path.split("/").includes(resolved.moduleId!))
    ).map((module) => module.id));
    const bindings: CatalogBindingView[] = [];
    const limit = resolved.limit ?? 100;
    for (const scopedProject of projects) {
      if (bindings.length === limit) break;
      const rows = await listCatalogBindingRowsForProject(db, auth, {
        projectId: scopedProject.id,
        limit: limit - bindings.length,
        moduleIds: resolved.moduleId ? [...moduleIds] : undefined,
        module: resolved.module,
        q: resolved.q
      });
      bindings.push(...rows);
    }
    const items = bindings.map((binding) => toCanonicalCompatibilityRecord(binding, modulesById));

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/parameters/:parameterId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithParameterIdSchema, request.params);
    const binding = await resolveCanonicalParameter(db, auth, params.parameterId);
    if (!binding) return catalogLegacyGoneResult(request.requestId, "Legacy parameter identity has no exact canonical Binding mapping.");
    const rows = await listCatalogBindingRowsForProject(db, auth, {
      projectId: binding.project_id, bindingId: binding.id, limit: 1
    });
    if (!rows[0]) {
      throw new ApiError("NOT_FOUND", "Parameter was not found.", { parameterId: params.parameterId });
    }
    const modules = await listParameterModulesForAuth(db, auth);
    return { status: 200, body: { item: toCanonicalCompatibilityRecord(rows[0], new Map(modules.map((module) => [module.id, module]))) } };
  });

  router.get("/api/v1/parameters/:parameterId/history", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithParameterIdSchema, request.params);
    const binding = await resolveCanonicalParameter(db, auth, params.parameterId);
    if (!binding) return catalogLegacyGoneResult(request.requestId, "Legacy parameter identity has no exact canonical Binding mapping.");
    const pool = getRootPostgresPool(db);
    if (!pool) throw new ApiError("INTERNAL_ERROR", "Canonical history requires the root database.");
    const items = await readCanonicalBindingChangeHistory(pool, {
      organizationId: auth.organization.id, projectId: binding.project_id, bindingId: binding.id
    });
    if (!items) throw new ApiError("NOT_FOUND", "Parameter was not found.", { parameterId: params.parameterId });
    return { status: 200, body: { items } };
  });

  router.post("/api/v1/parameter-drafts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(saveDraftBodySchema, request.body);
    const item = await saveDraft(db, auth, body);
    const [pinned] = await attachDraftCanonicalPins(db, [item]);

    return { status: 201, body: { item: pinned ?? item } };
  });

  router.get("/api/v1/parameter-drafts/mine", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listDraftsQuerySchema, request.query);
    const items = await listDrafts(db, auth, query, { invocation: createUserInvocation(auth) });

    return { status: 200, body: { items: await attachDraftCanonicalPins(db, items) } };
  });

  router.delete("/api/v1/parameter-drafts/:draftId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithDraftIdSchema, request.params);

    await deleteDraft(db, auth, params.draftId, {
      invocation: createUserInvocation(auth),
      requestId: request.requestId
    });

    return { status: 200, body: { ok: true } };
  });

  router.post("/api/v1/parameter-submission-rounds", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(submitRoundBodySchema, request.body);
    const refusalSink = requireSubmissionRefusalSink(refusalAuditSink);
    const item = await submitParameterChanges(db, auth, body, {
      invocation: createUserInvocation(auth),
      requestId: request.requestId,
      refusalSink
    });

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
    const { mine, ...query } = parseWithSchema(listSubmissionRoundsQuerySchema, request.query);
    const status = normalizeArray(query.status);
    if (mine !== "true") {
      const items = await listSubmissionRounds(db, auth, { ...query, status });
      return { status: 200, body: { items } };
    }

    if (!auth.user.isActive) {
      throw new ApiError("FORBIDDEN", "Active parameter view access is required for the personal archive.");
    }
    const hasOrganizationWideRole = auth.roles.some((role) =>
      role.projectId === null || role.roleId === "admin" || role.roleId === "platform-admin"
    );
    const projectIds = [...new Set(auth.roles.flatMap((role) => role.projectId ? [role.projectId] : []))];
    if (query.projectId && !hasOrganizationWideRole && !projectIds.includes(query.projectId)) {
      return { status: 200, body: { items: [] } };
    }
    if (!query.projectId && !hasOrganizationWideRole && projectIds.length === 0) {
      return { status: 200, body: { items: [] } };
    }

    const rounds = query.projectId || hasOrganizationWideRole
      ? await listSubmissionRounds(db, auth, { ...query, status })
      : (await Promise.all(projectIds.map((projectId) =>
          listSubmissionRounds(db, auth, { status, projectId })
        ))).flat();
    const authorizedProjectIds = query.projectId
      ? new Set([query.projectId])
      : hasOrganizationWideRole
        ? null
        : new Set(projectIds);
    if (rounds.length === 0) return { status: 200, body: { items: [] } };

    // ponytail: The legacy DTO has no owner ID, so filter the already-authorized round IDs in one query; this loads O(n) archive rows, with a repository-owned scoped projection as the upgrade path if that history grows.
    const roundIds = rounds.map((round) => round.id);
    const ownership = authorizedProjectIds === null
      ? await db.query<{ id: string }>(
          `select id from parameter_submission_rounds
            where organization_id = $1
              and submitter_user_id = $2
              and id = any($3::text[])`,
          [auth.organization.id, auth.user.id, roundIds]
        )
      : await db.query<{ id: string }>(
          `select id from parameter_submission_rounds
            where organization_id = $1
              and submitter_user_id = $2
              and id = any($3::text[])
              and project_id = any($4::text[])`,
          [auth.organization.id, auth.user.id, roundIds, [...authorizedProjectIds]]
        );
    const ownRoundIds = new Set(ownership.rows.map((row) => row.id));
    const items = rounds.filter((round) =>
      ownRoundIds.has(round.id)
      && (authorizedProjectIds === null || authorizedProjectIds.has(round.projectId))
    );

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
    if (!refusalAuditSink) {
      throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for parameter review.");
    }
    const item = await reviewChange(db, auth, body, {
      invocation: createUserInvocation(auth),
      requestId: request.requestId,
      refusalSink: refusalAuditSink,
      objectStore: options.objectStore
    });

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
    const pool = getRootPostgresPool(db);
    const catalogSnapshot = pool ? await loadPublishedCatalog(pool) : null;
    const item = await approveReview(db, auth, { reviewId: params.reviewId }, {
      requestId: request.requestId,
      invocation: createUserInvocation(auth),
      refusalSink: refusalAuditSink,
      objectStore: options.objectStore,
      catalogSnapshot: catalogSnapshot ?? undefined
    });
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
