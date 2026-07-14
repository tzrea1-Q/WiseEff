import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import { listOpenConflicts } from "../parameters/repository";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { resolveParameterFileConflict } from "./conflictService";
import {
  getFileVersionById,
  getProjectParameterFileById,
  listFileVersions,
  listProjectParameterFiles
} from "./repository";
import {
  compareBaseline,
  createBaseline,
  listBaselines,
  releaseBaseline,
  rollbackToBaseline
} from "./baselineService";
import {
  addConfigSetFile,
  createConfigSet,
  listConfigSets,
  removeConfigSetFile
} from "./configSetService";
import type { DtcValidator } from "./dtcValidator";
import { exportConfigSet } from "./exportService";
import {
  addConfigSetFileBody,
  createBaselineBody,
  createConfigSetBody
} from "./schemas";
import { getProjectParameterFileContent, uploadProjectParameterFile } from "./service";
import { getParameterFileVersionStructure } from "./structuralReadService";
import { syncFileVersion } from "./syncService";
import type { ParameterFileFormat } from "./types";

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

const syncFileBodySchema = z.object({
  versionId: z.string().min(1).optional()
});

const resolveConflictBodySchema = z.object({
  resolution: z.enum(["file", "ui"])
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for parameter file routes.", 500);
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for parameter file routes.", 500);
  }

  return objectStore;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid parameter file route input.") {
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

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

function decodeContentBase64(contentBase64: string) {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is required.", 400);
  }

  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is invalid.", 400);
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
    throw new ApiError("NOT_FOUND", "Project parameter file was not found.", 404, { fileId, projectId });
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
        ...(result.unsupportedConstructs ? { unsupportedConstructs: result.unsupportedConstructs } : {})
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
      throw new ApiError("VALIDATION_FAILED", "Route fileId does not match request body fileName.", 400, {
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
        ...(result.unsupportedConstructs ? { unsupportedConstructs: result.unsupportedConstructs } : {})
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
      throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", 404, {
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
      throw new ApiError("NOT_FOUND", "Project parameter file version was not found.", 404, {
        fileId: params.fileId,
        versionId: params.versionId
      });
    }
    const body = await getParameterFileVersionStructure(db, version.id);

    return { status: 200, body };
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
      throw new ApiError("CONFLICT", "Project parameter file has no synced version.", 409, { fileId: params.fileId });
    }
    const summary = await syncFileVersion(db, auth, { fileId: file.id, versionId });

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
      resolution: body.resolution
    });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/config-sets", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
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
        notes: body.notes
      },
      { requestId: request.requestId }
    );

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/projects/:projectId/baselines/:baselineId/compare", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const item = await compareBaseline(db, auth, params.baselineId, {
      objectStore: requireObjectStore(options.objectStore)
    });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/baselines/:baselineId/rollback", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const item = await rollbackToBaseline(db, auth, params.baselineId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/projects/:projectId/baselines/:baselineId/release", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireCanAdmin(auth);
    const params = parseWithSchema(paramsWithBaselineIdSchema, request.params);
    const result = await releaseBaseline(db, auth, params.baselineId, validationDeps(), {
      requestId: request.requestId
    });

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
}
