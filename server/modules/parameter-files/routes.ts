import { z } from "zod";
import {
  canonicalBatchRollbackPrepareRequestSchema,
  canonicalBatchRollbackSubmitRequestSchema
} from "../contracts/dtoSchemas/canonicalBatchRollback";
import { canonicalManualSyncPrepareRequestSchema } from "../contracts/dtoSchemas/canonicalManualSync";

import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  assertTrustedRefusalAuditSink,
  createTrustedRefusalAuditSink,
  type TrustedRefusalAuditSink
} from "../audit/trustedRefusalSink";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters, canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import { listOpenConflicts } from "../parameters/fileSyncConflictRepository";
import { submitStructuredEdits } from "../parameters/service";
import { getRootPostgresPool, isRootDatabase, type Database } from "../../shared/database/client";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
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
import { getProjectParameterFileContent, rollbackProjectParameterFileVersion, uploadProjectParameterFile } from "./service";
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
import {
  getCanonicalSourceWorkflow,
  prepareCanonicalBatchRollbackCandidate,
  prepareCanonicalManualSyncBatchCandidate,
  prepareCanonicalConflictDecision,
  previewCanonicalCandidate,
  rollbackCanonicalSource,
  submitCanonicalConflictDecision,
  submitCanonicalBatchRollback,
  submitCanonicalCandidate,
  syncCanonicalSource
} from "./canonicalFileWorkflow";

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

const canonicalSourceSubmitBodySchema = z.object({
  expectedCurrentVersionId: z.string().min(1),
  expectedProofToken: z.string().min(1),
  reason: z.string().trim().min(1).max(2000)
}).strict();

const canonicalSourceRollbackBodySchema = z.object({
  versionId: z.string().min(1),
  expectedCurrentVersionId: z.string().min(1),
  expectedProofToken: z.string().min(1),
  reason: z.string().trim().min(1).max(2000)
}).strict();

const canonicalConflictSubmitBodySchema = z.object({
  selectedBindingId: z.string().min(1),
  selectedDraftId: z.string().min(1),
  choice: z.enum(["file", "draft"]),
  expectedDecisionProofDigest: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000),
  assignedToUserId: z.string().min(1)
}).strict();

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
    refusalAuditSink?: TrustedRefusalAuditSink;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  const refusalAuditSink = options.refusalAuditSink
    ? (assertTrustedRefusalAuditSink(options.refusalAuditSink), options.refusalAuditSink)
    : options.db && isRootDatabase(options.db)
      ? createTrustedRefusalAuditSink(options.db)
      : undefined;

  function requireSubmissionRefusalSink() {
    if (!refusalAuditSink) {
      throw new ApiError("INTERNAL_ERROR", "Server-owned parameter submission refusal audit sink is required.");
    }
    assertTrustedRefusalAuditSink(refusalAuditSink);
    return refusalAuditSink;
  }
  function validationDeps() {
    return {
      objectStore: requireObjectStore(options.objectStore),
      validator: options.validator
    };
  }
  router.post("/api/v2/projects/:projectId/parameter-files/:fileId/configuration-instances", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithFileIdSchema,request.params);
    const body = parseWithSchema(z.object({
      configSetId: z.string().min(1),fileVersionId: z.string().min(1),configurationSchemaId: z.string().min(1),rootPointer: z.string(),
      mappings: z.array(z.object({ definitionId: z.string().min(1),pointer: z.string() }).strict()).min(1)
    }).strict(),request.body);
    const pool = getRootPostgresPool(db);
    if (!pool || !isRootDatabase(db)) throw new ApiError("INTERNAL_ERROR", "JSON registration requires the root database.");
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new ApiError("CONFLICT", "The published catalog snapshot is unavailable.");
    const refusalSink = createTrustedRefusalAuditSink(db);
    const registered = await withAuditedWrite(db,auth,{ requestId: request.requestId },async (tx) => ({
      result: await registerCanonicalJsonSource(tx,requireObjectStore(options.objectStore),auth,snapshot,{
        ...params,...body,invocation: createUserInvocation(auth),requestId: request.requestId,refusalSink
      }),audit: null
    }));
    return { status: 201,body: { items: registered.bindings } };
  });
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

  router.get("/api/v1/projects/:projectId/parameter-files/:fileId/source-workflow", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const item = await getCanonicalSourceWorkflow(db, auth, params);
    return { status: 200, body: { item } };
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

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/versions/:versionId/rollback", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithVersionIdSchema, request.params);
    await requireProjectFile(db, auth, params.projectId, params.fileId);
    const result = await rollbackProjectParameterFileVersion(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        fileId: params.fileId,
        versionId: params.versionId
      },
      { requestId: request.requestId }
    );

    return {
      status: 201,
      body: {
        item: result.version,
        file: result.file
      }
    };
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
      {
        invocation: createUserInvocation(auth),
        requestId: request.requestId,
        refusalSink: requireSubmissionRefusalSink()
      }
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
    const canonicalSummary = await syncCanonicalSource(
      db,
      requireObjectStore(options.objectStore),
      auth,
      { projectId: params.projectId, fileId: file.id, versionId }
    );
    if (canonicalSummary) {
      return { status: 200, body: { item: canonicalSummary } };
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
      projectId: params.projectId,
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

  router.get("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/source-preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanView(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const item = await previewCanonicalCandidate(db, requireObjectStore(options.objectStore), auth, params);
    return { status: 200, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/source-conflicts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    if (!canAdminParameters(auth) || !canEditParameters(auth, params.projectId)) {
      throw new ApiError("FORBIDDEN", "Parameter administration and project edit permission are required.");
    }
    const objectStore = requireObjectStore(options.objectStore);
    const preview = await previewCanonicalCandidate(db, objectStore, auth, params);
    const bindings = preview.bindings ?? (preview.bindingId && preview.sourcePinId && preview.baseCurrentValueId
      ? [{ bindingId: preview.bindingId, sourcePinId: preview.sourcePinId,
        baseCurrentValueId: preview.baseCurrentValueId, configRevisionId: preview.configRevisionId }]
      : []);
    if (preview.kind !== "canonical" || preview.request || bindings.length === 0) {
      return { status: 200, body: { items: [], ineligible: [] } };
    }
    const rows = await db.query<{ id: string; binding_id: string; user_id: string;
      source_pin_id: string; base_current_value_id: string; config_revision_id: string }>(
      `select draft.id,draft.binding_id,draft.user_id,draft.source_pin_id,
              draft.base_current_value_id,draft.config_revision_id
         from project_parameter_value_drafts draft
        where draft.organization_id=$1 and draft.project_id=$2 and draft.binding_id=any($3::text[])
          and draft.candidate_id is not null
          and not exists (select 1 from project_parameter_value_change_requests request
                           where request.draft_id=draft.id and request.status='pending')
        order by draft.binding_id,draft.id`,
      [auth.organization.id, params.projectId, bindings.map((binding) => binding.bindingId)]
    );
    const items = [];
    const ineligible = [];
    for (const draft of rows.rows) {
      const binding = bindings.find((item) => item.bindingId === draft.binding_id);
      if (!binding) continue;
      if (binding.sourcePinId !== draft.source_pin_id
        || binding.baseCurrentValueId !== draft.base_current_value_id
        || binding.configRevisionId !== draft.config_revision_id) {
        ineligible.push({ selectedBindingId: draft.binding_id, selectedDraftId: draft.id,
          reason: "selected-draft-stale" });
        continue;
      }
      try {
        const file = await prepareCanonicalConflictDecision(db, objectStore, auth, {
          ...params, selectedBindingId: draft.binding_id, selectedDraftId: draft.id, choice: "file"
        });
        const draftChoice = await prepareCanonicalConflictDecision(db, objectStore, auth, {
          ...params, selectedBindingId: draft.binding_id, selectedDraftId: draft.id, choice: "draft"
        });
        items.push({ selectedBindingId: draft.binding_id, selectedDraftId: draft.id,
          authorUserId: draft.user_id, choices: { file, draft: draftChoice } });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "CONFLICT") throw error;
        ineligible.push({ selectedBindingId: draft.binding_id, selectedDraftId: draft.id,
          reason: typeof error.details?.reason === "string" ? error.details.reason : "source-proof-stale" });
      }
    }
    return { status: 200, body: { items, ineligible } };
  });

  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/source-conflict-submit", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const body = parseWithSchema(canonicalConflictSubmitBodySchema, request.body,
      "Invalid canonical source conflict decision payload.");
    if (!isRootDatabase(db)) throw new ApiError("INTERNAL_ERROR", "Canonical source conflict submit requires root database.");
    const item = await submitCanonicalConflictDecision(db, requireObjectStore(options.objectStore), auth, {
      ...params, ...body, requestId: request.requestId,
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    return { status: 201, body: { item } };
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

  router.post("/api/v1/projects/:projectId/parameter-file-candidates/:candidateId/source-submit", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithCandidateIdSchema, request.params);
    const body = parseWithSchema(canonicalSourceSubmitBodySchema, request.body, "Invalid canonical source submit payload.");
    const item = await submitCanonicalCandidate(db, objectStore, auth, {
      projectId: params.projectId,
      candidateId: params.candidateId,
      expectedCurrentVersionId: body.expectedCurrentVersionId,
      expectedProofToken: body.expectedProofToken,
      reason: body.reason,
      requestId: request.requestId,
      refusalSink: requireSubmissionRefusalSink()
    });
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/source-rollback", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(canonicalSourceRollbackBodySchema, request.body, "Invalid canonical source rollback payload.");
    const item = await rollbackCanonicalSource(db, objectStore, auth, {
      projectId: params.projectId,
      fileId: params.fileId,
      versionId: body.versionId,
      expectedCurrentVersionId: body.expectedCurrentVersionId,
      expectedProofToken: body.expectedProofToken,
      reason: body.reason,
      requestId: request.requestId,
      refusalSink: requireSubmissionRefusalSink()
    });
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/source-batch-rollback/prepare", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(canonicalBatchRollbackPrepareRequestSchema, request.body,
      "Invalid canonical batch rollback preparation payload.");
    const item = await prepareCanonicalBatchRollbackCandidate(db, requireObjectStore(options.objectStore), auth, {
      projectId: params.projectId, fileId: params.fileId, ...body, requestId: request.requestId
    });
    return { status: 201, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/source-manual-sync/prepare", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(canonicalManualSyncPrepareRequestSchema, request.body,
      "Invalid canonical manual sync preparation payload.");
    const item = await prepareCanonicalManualSyncBatchCandidate(db, requireObjectStore(options.objectStore), auth, {
      projectId: params.projectId, fileId: params.fileId,
      bytes: decodeContentBase64(body.contentBase64),
      expectedCurrentVersionId: body.expectedCurrentVersionId,
      expectedWorkflowProofToken: body.expectedWorkflowProofToken,
      requestId: request.requestId
    });
    return { status: 201, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/parameter-files/:fileId/source-batch-rollback/submit", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithFileIdSchema, request.params);
    const body = parseWithSchema(canonicalBatchRollbackSubmitRequestSchema, request.body,
      "Invalid canonical batch rollback submission payload.");
    const item = await submitCanonicalBatchRollback(db, requireObjectStore(options.objectStore), auth, {
      projectId: params.projectId, fileId: params.fileId, ...body, requestId: request.requestId,
      refusalSink: requireSubmissionRefusalSink()
    });
    return { status: 201, body: { item } };
  });
}
