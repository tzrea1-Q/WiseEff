import { z } from "zod";

import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters, canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import { listOpenConflicts } from "../parameters/fileSyncConflictRepository";
import { submitStructuredEdits } from "../parameters/service";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { resolveConflictsBulk, previewBulkConflictResolution, resolveParameterFileConflict } from "./conflictService";
import {
  getFileVersionById,
  getProjectParameterFileById,
  listFileVersions,
  listProjectParameterFiles
} from "./repository";
import {
  compareBaseline,
  createBaseline,
  getBaseline,
  listBaselines,
  previewRestoreBaseline,
  releaseBaseline,
  rollbackToBaseline
} from "./baselineService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import {
  addConfigSetFile,
  createConfigSet,
  listConfigSetFiles,
  listConfigSets,
  removeConfigSetFile
} from "./configSetService";
import type { DtcValidator } from "./dtcValidator";
import { exportConfigSet } from "./exportService";
import {
  addConfigSetFileBody,
  createBaselineBody,
  createConfigSetBody,
  dtsSearchQuerySchema,
  releaseBaselineBody,
  submitStructuredEditsBodySchema
} from "./schemas";
import { getProjectParameterFileContent, uploadProjectParameterFile } from "./service";
import {
  abandonCandidate,
  activateCandidate,
  createCandidate,
  getCandidate,
  getCandidateContent,
  getCandidateImpact,
  listCandidates,
  recomputeCandidateImpact
} from "./candidateService";
import { searchProjectDts } from "./dtsSearchService";
import { getParameterFileVersionStructure } from "./structuralReadService";
import { syncFileVersion } from "./syncService";
import type { ParameterFileFormat, ProjectParameterFileCandidateDto } from "./types";
import { configSetRoleSchema } from "./schemas";

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

const paramsWithProjectIdSchema = z.object({
  projectId: z.string().min(1)
});

const paramsWithFileIdSchema = paramsWithProjectIdSchema.extend({
  fileId: z.string().min(1)
});

const paramsWithVersionIdSchema = paramsWithFileIdSchema.extend({
  versionId: z.string().min(1)
});

const paramsWithConflictIdSchema = paramsWithProjectIdSchema.extend({
  conflictId: z.string().min(1)
});

const paramsWithConfigSetIdSchema = paramsWithProjectIdSchema.extend({
  configSetId: z.string().min(1)
});

const paramsWithConfigSetFileIdSchema = paramsWithConfigSetIdSchema.extend({
  fileId: z.string().min(1)
});

const paramsWithBaselineIdSchema = paramsWithProjectIdSchema.extend({
  baselineId: z.string().min(1)
});

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1)
});

const uploadVersionBodySchema = z.object({
  fileName: z.string().min(1).optional(),
  contentBase64: z.string().min(1)
});

const createCandidateBodySchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1),
  fileId: z.string().min(1).optional()
});

const activateCandidateBodySchema = z.object({
  expectedCurrentVersionId: z.string().min(1).nullable().optional(),
  configSetId: z.string().min(1).optional(),
  role: configSetRoleSchema.optional()
});

const paramsWithCandidateIdSchema = paramsWithProjectIdSchema.extend({
  candidateId: z.string().min(1)
});

const syncFileBodySchema = z.object({
  versionId: z.string().min(1).optional()
});

const resolveConflictBodySchema = z.object({
  resolution: z.enum(["file", "ui"]),
  reason: z.string().trim().max(2000).optional()
});

const bulkConflictPreviewBodySchema = z.object({
  resolution: z.enum(["file", "ui"]),
  conflictIds: z.array(z.string().min(1)).optional()
});

const bulkConflictResolveBodySchema = z.object({
  resolution: z.enum(["file", "ui"]),
  conflictIds: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().max(2000).optional()
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter file routes.");
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for parameter file routes.");
  }

  return objectStore;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter file route input.") {
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

function requireCanEdit(auth: AuthContext) {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter edit permission is required.");
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

function toPublicCandidate(candidate: ProjectParameterFileCandidateDto) {
  const { storageKey: _storageKey, ...publicCandidate } = candidate;
  return publicCandidate;
}

function decodeContentBase64(contentBase64: string) {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is required.");
  }

  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is invalid.");
  }
}

function contentTypeForFormat(format: ParameterFileFormat) {
  return format === "json" ? "application/json" : "text/plain";
}

async function requireProjectFile(
  db: Database,
  auth: AuthContext,
  projectId: string,
  fileId: string
) {
  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId
  });
  if (!file || file.projectId !== projectId) {
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", { fileId, projectId });
  }

  return file;
}

export function registerParameterFileRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    validator?: DtcValidator;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  function validationDeps() {
    return {
      objectStore: requireObjectStore(options.objectStore),
      validator: options.validator
    };
  }
  router.get("/api/v1/projects/:projectId/parameter-files", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const items = await listProjectParameterFiles(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(uploadBodySchema, request.body, "Invalid parameter file upload payload.");
    const result = await uploadProjectParameterFile(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        fileName: body.fileName.trim(),
        bytes: decodeContentBase64(body.contentBase64)
      },
      { requestId: request.requestId }
    );

    return {
      status: 201,
      body: {
        item: result.file,
        version: result.version,
        ...(result.driverSummary ? { driverSummary: result.driverSummary } : {}),
      }
    };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/versions", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(uploadVersionBodySchema, request.body, "Invalid parameter file version upload payload.");
    const file = await requireProjectFile(db, auth, params.projectId, params.fileId);
    if (body.fileName && body.fileName.trim() !== file.fileName) {
      throw new ApiError("VALIDATION_FAILED", "Route fileId does not match request body fileName.", {
        fileId: params.fileId,
        routeFileName: file.fileName,
        bodyFileName: body.fileName
      });
    }
    const result = await uploadProjectParameterFile(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        fileName: file.fileName,
        bytes: decodeContentBase64(body.contentBase64)
      },
      { requestId: request.requestId }
    );

    return {
      status: 201,
      body: {
        item: result.version,
        ...(result.driverSummary ? { driverSummary: result.driverSummary } : {}),
      }
    };
  });

  router.get("/api/v1/projects/:projectId/parameter-files/:fileId/versions", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    await requireProjectFile(db, auth, params.projectId, params.fileId);
    const items = await listFileVersions(db, { fileId: params.fileId });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithVersionIdSchema, request.params);
    const file = await requireProjectFile(db, auth, params.projectId, params.fileId);
    const version = await getFileVersionById(db, { versionId: params.versionId });
    if (!version || version.fileId !== file.id) {
      throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", {
        fileId: params.fileId,
        versionId: params.versionId
      });
    }
    const bytes = await getProjectParameterFileContent(objectStore, { storageKey: version.storageKey });

    return {
      status: 200,
      bytes,
      contentType: contentTypeForFormat(file.format),
      fileName: file.fileName
    };
  });

  router.get("/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/structure", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithVersionIdSchema, request.params);
    const file = await requireProjectFile(db, auth, params.projectId, params.fileId);
    const version = await getFileVersionById(db, { versionId: params.versionId });
    if (!version || version.fileId !== file.id) {
      throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", {
        fileId: params.fileId,
        versionId: params.versionId
      });
    }
    const body = await getParameterFileVersionStructure(db, version.id);

    return { status: 200, body };
  });

  router.get("/api/v1/projects/:projectId/dts-search", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const query = parseWithSchema(
      dtsSearchQuerySchema,
      {
        q: firstQueryValue(request.query.q) ?? "",
        by: firstQueryValue(request.query.by)
      },
      "Invalid DTS search query."
    );
    const body = await searchProjectDts(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId,
      q: query.q,
      ...(query.by ? { by: query.by } : {}),
    });

    return { status: 200, body };
  });

  router.post("/api/v1/projects/:projectId/dts-structured-edits/submit", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanEdit(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(
      submitStructuredEditsBodySchema,
      request.body,
      "Invalid structured edit submit payload."
    );
    const item = await submitStructuredEdits(
      db,
      auth,
      {
        projectId: params.projectId,
        edits: body.edits,
        reason: body.reason,
        assignees: body.assignees
      },
      { requestId: request.requestId }
    );

    return { status: 201, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/sync", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(syncFileBodySchema, request.body ?? {}, "Invalid parameter file sync payload.");
    const file = await requireProjectFile(db, auth, params.projectId, params.fileId);
    const versionId = body.versionId ?? file.currentVersionId;
    if (!versionId) {
      throw new ApiError("CONFLICT", "Project parameter file has no synced version.", { fileId: params.fileId });
    }
    // Manual re-sync previously ran its draft/binding/conflict writes and audits
    // auto-committed; one audited write makes the whole sync atomic (ADR-0027).
    const summary = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => ({
      result: await syncFileVersion(asAuditTx(tx), auth, { fileId: file.id, versionId }, { requestId: request.requestId }),
      audit: null
    }));

    return { status: 200, body: { item: summary } };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-conflicts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const items = await listOpenConflicts(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-conflicts/:conflictId/resolve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConflictIdSchema, request.params);
    const body = parseWithSchema(resolveConflictBodySchema, request.body, "Invalid parameter file conflict resolve payload.");
    const item = await resolveParameterFileConflict(db, auth, {
      conflictId: params.conflictId,
      resolution: body.resolution,
      reason: body.reason
    }, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-conflicts/bulk-preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(
      bulkConflictPreviewBodySchema,
      request.body,
      "Invalid parameter file conflict bulk preview payload."
    );
    const preview = await previewBulkConflictResolution(db, auth, {
      projectId: params.projectId,
      resolution: body.resolution,
      conflictIds: body.conflictIds
    });

    return { status: 200, body: preview };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-conflicts/bulk-resolve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(
      bulkConflictResolveBodySchema,
      request.body,
      "Invalid parameter file conflict bulk resolve payload."
    );
    const result = await resolveConflictsBulk(db, auth, {
      projectId: params.projectId,
      resolution: body.resolution,
      conflictIds: body.conflictIds,
      reason: body.reason
    }, { requestId: request.requestId });

    return { status: 200, body: result };
  });

  router.get("/api/v1/projects/:projectId/config-sets", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const items = await listConfigSets(db, auth, params.projectId);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/projects/:projectId/config-sets", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(createConfigSetBody, request.body, "Invalid create config set payload.");
    const item = await createConfigSet(
      db,
      auth,
      {
        projectId: params.projectId,
        name: body.name.trim(),
        description: body.description,
        derivedFromId: body.derivedFromId
      },
      { requestId: request.requestId }
    );

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/config-sets/:configSetId/files", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const items = await listConfigSetFiles(db, auth, {
      projectId: params.projectId,
      configSetId: params.configSetId
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/files", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const body = parseWithSchema(addConfigSetFileBody, request.body, "Invalid add config set file payload.");
    const item = await addConfigSetFile(
      db,
      auth,
      {
        configSetId: params.configSetId,
        fileId: body.fileId,
        role: body.role,
        sortOrder: body.sortOrder
      },
      { requestId: request.requestId }
    );

    return { status: 201, body: { item } };
  });

  router.delete("/api/v1/projects/:projectId/config-sets/:configSetId/files/:fileId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetFileIdSchema, request.params);
    await removeConfigSetFile(
      db,
      auth,
      { configSetId: params.configSetId, fileId: params.fileId },
      { requestId: request.requestId }
    );

    return { status: 200, body: {} };
  });

  router.get("/api/v1/projects/:projectId/config-sets/:configSetId/baselines", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const items = await listBaselines(db, auth, params.configSetId);

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/projects/:projectId/config-sets/:configSetId/release-readiness", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const acknowledgedRaw = firstQueryValue(request.query.acknowledgedWarningIds);
    const acknowledgedWarningIds = acknowledgedRaw
      ? acknowledgedRaw.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;
    const item = await evaluateReleaseReadiness(
      db,
      auth,
      { configSetId: params.configSetId, acknowledgedWarningIds },
      validationDeps()
    );
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/config-sets/:configSetId/baselines", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const body = parseWithSchema(createBaselineBody, request.body, "Invalid create baseline payload.");
    const item = await createBaseline(
      db,
      auth,
      {
        configSetId: params.configSetId,
        name: body.name.trim(),
        notes: body.notes,
        gateToken: body.gateToken,
        acknowledgedWarningIds: body.acknowledgedWarningIds
      },
      { requestId: request.requestId },
      validationDeps()
    );

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/baselines/:baselineId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const item = await getBaseline(db, auth, params.baselineId);
    return { status: 200, body: { item: item.baseline, members: item.members } };
  });

  router.get("/api/v1/projects/:projectId/baselines/:baselineId/compare", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const againstRaw = firstQueryValue(request.query.against);
    const against = againstRaw === "released" ? "released" : "working";
    const item = await compareBaseline(
      db,
      auth,
      params.baselineId,
      { objectStore: requireObjectStore(options.objectStore) },
      { against }
    );

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/baselines/:baselineId/restore-preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const item = await previewRestoreBaseline(db, auth, params.baselineId);
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/baselines/:baselineId/rollback", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const item = await rollbackToBaseline(db, objectStore, auth, params.baselineId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/baselines/:baselineId/release", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const body = parseWithSchema(releaseBaselineBody, request.body ?? {}, "Invalid release baseline payload.");
    const result = await releaseBaseline(
      db,
      auth,
      params.baselineId,
      validationDeps(),
      { requestId: request.requestId },
      { gateToken: body.gateToken, acknowledgedWarningIds: body.acknowledgedWarningIds }
    );

    return { status: 200, body: { item: result.baseline, gate: result.gate } };
  });

  router.get("/api/v1/projects/:projectId/config-sets/:configSetId/export", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithConfigSetIdSchema, request.params);
    const result = await exportConfigSet(db, auth, params.configSetId, validationDeps(), {
      requestId: request.requestId
    });

    return { status: 200, body: result };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-candidates", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const fileId = firstQueryValue(request.query.fileId);
    const includeAbandoned = firstQueryValue(request.query.includeAbandoned) === "true";
    const items = await listCandidates(db, auth, {
      projectId: params.projectId,
      fileId: fileId || undefined,
      includeAbandoned
    });
    return { status: 200, body: { items: items.map(toPublicCandidate) } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-candidates", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(createCandidateBodySchema, request.body, "Invalid candidate upload payload.");
    const item = await createCandidate(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        fileName: body.fileName.trim(),
        bytes: decodeContentBase64(body.contentBase64),
        fileId: body.fileId
      },
      { requestId: request.requestId }
    );
    return { status: 201, body: { item: toPublicCandidate(item) } };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const item = await getCandidate(db, auth, {
      projectId: params.projectId,
      candidateId: params.candidateId
    });
    return { status: 200, body: { item: toPublicCandidate(item) } };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/impact", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const result = await getCandidateImpact(db, auth, {
      projectId: params.projectId,
      candidateId: params.candidateId
    });
    return {
      status: 200,
      body: { item: toPublicCandidate(result.candidate), impact: result.impact }
    };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const result = await getCandidateContent(db, objectStore, auth, {
      projectId: params.projectId,
      candidateId: params.candidateId
    });
    return {
      status: 200,
      bytes: result.bytes,
      contentType: result.contentType,
      fileName: result.candidate.fileName
    };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/abandon", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const item = await abandonCandidate(
      db,
      auth,
      { projectId: params.projectId, candidateId: params.candidateId },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item: toPublicCandidate(item) } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/recompute", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const item = await recomputeCandidateImpact(
      db,
      objectStore,
      auth,
      { projectId: params.projectId, candidateId: params.candidateId },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item: toPublicCandidate(item) } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const body = parseWithSchema(activateCandidateBodySchema, request.body ?? {}, "Invalid candidate activation payload.");
    const result = await activateCandidate(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        candidateId: params.candidateId,
        expectedCurrentVersionId: body.expectedCurrentVersionId,
        configSetId: body.configSetId,
        role: body.role
      },
      { requestId: request.requestId }
    );
    return {
      status: 200,
      body: {
        item: toPublicCandidate(result.candidate),
        file: result.file,
        version: result.version
      }
    };
  });
}
