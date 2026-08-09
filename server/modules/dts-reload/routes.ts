import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  getReloadRun,
  getReloadRunArtifact,
  listReloadCandidates,
  startReloadRun
} from "./service";
import { projectIdParamsSchema, runIdParamsSchema, startReloadRunBodySchema } from "./schemas";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for dts-reload routes.", 500);
  }
  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for dts-reload routes.", 500);
  }
  return objectStore;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid dts-reload route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function registerDtsReloadRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v1/dts-reload/projects/:projectId/candidates", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const result = await listReloadCandidates(db, auth, params.projectId);
    return { status: 200, body: result };
  });

  router.post("/api/v1/dts-reload/projects/:projectId/runs", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const body = parseWithSchema(startReloadRunBodySchema, request.body);
    const item = await startReloadRun(
      db,
      objectStore,
      auth,
      { projectId: params.projectId, bindingId: body.bindingId, debugValue: body.debugValue },
      { requestId: request.requestId }
    );
    return { status: 201, body: { item } };
  });

  router.get("/api/v1/dts-reload/runs/:runId", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(runIdParamsSchema, request.params);
    const item = await getReloadRun(db, objectStore, auth, params.runId);
    return { status: 200, body: { item } };
  });

  router.get("/api/v1/dts-reload/runs/:runId/artifact", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(runIdParamsSchema, request.params);
    const artifact = await getReloadRunArtifact(db, objectStore, auth, params.runId);
    return {
      status: 200,
      bytes: artifact.bytes,
      contentType: artifact.contentType,
      fileName: artifact.fileName
    };
  });
}
