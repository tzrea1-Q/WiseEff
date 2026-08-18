import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { BridgeRpcClient } from "../deviceBridge/rpc";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  getReloadConfigurationAdminView,
  updateOrganisationReloadConfiguration
} from "./configurationService";
import { reloadConfigurationContractBodySchema } from "./configurationSchemas";
import {
  deployReloadRun,
  getReloadResidue,
  getReloadRun,
  getReloadRunArtifact,
  listReloadCandidates,
  listReloadRuns,
  startReloadRun,
  startRestoreBaselineRun
} from "./service";
import { promoteReloadRunToDrafts } from "./promote";
import {
  deployReloadRunBodySchema,
  listReloadRunsQuerySchema,
  projectIdParamsSchema,
  promoteReloadRunToDraftsBodySchema,
  residueQuerySchema,
  restoreBaselineBodySchema,
  runIdParamsSchema,
  startReloadRunBodySchema
} from "./schemas";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for dts-reload routes.");
  }
  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for dts-reload routes.");
  }
  return objectStore;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid dts-reload route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }
  return parsed.data;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

const reloadRunListCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1)
});

function parseReloadRunListCursor(cursor: string | undefined) {
  if (!cursor) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return parseWithSchema(reloadRunListCursorSchema, payload, "Invalid reload run list cursor.");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("VALIDATION_FAILED", "Invalid reload run list cursor.");
  }
}

function encodeReloadRunListCursor(cursor: { createdAt: string; id: string } | null) {
  if (!cursor) {
    return null;
  }
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function registerDtsReloadRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    bridgeRpcClient?: Pick<BridgeRpcClient, "call">;
    bridgeConnectionPool?: Pick<BridgeConnectionPool, "isConnected">;
    bridgeArtifactRoot?: string;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v1/dts-reload/configuration", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const item = await getReloadConfigurationAdminView(db, auth);
    return { status: 200, body: { item } };
  });

  router.put("/api/v1/dts-reload/configuration", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(reloadConfigurationContractBodySchema, request.body);
    const item = await updateOrganisationReloadConfiguration(db, auth, body, {
      requestId: request.requestId
    });
    return { status: 200, body: { item } };
  });

  router.get("/api/v1/dts-reload/projects/:projectId/candidates", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const result = await listReloadCandidates(db, auth, params.projectId);
    return { status: 200, body: result };
  });

  router.get("/api/v1/dts-reload/runs", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listReloadRunsQuerySchema, flattenQuery(request.query));
    const result = await listReloadRuns(db, auth, {
      projectId: query.projectId,
      deviceId: query.deviceId,
      limit: query.limit,
      cursor: parseReloadRunListCursor(query.cursor)
    });
    return {
      status: 200,
      body: {
        items: result.items,
        nextCursor: encodeReloadRunListCursor(result.nextCursor)
      }
    };
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
      {
        projectId: params.projectId,
        targets: body.targets,
        confirmationToken: body.confirmationToken
      },
      { requestId: request.requestId }
    );
    return { status: 201, body: { item } };
  });

  router.post("/api/v1/dts-reload/projects/:projectId/restore-baseline", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectIdParamsSchema, request.params);
    const body = parseWithSchema(restoreBaselineBodySchema, request.body);
    const item = await startRestoreBaselineRun(
      db,
      objectStore,
      auth,
      {
        projectId: params.projectId,
        deviceId: body.deviceId,
        confirmationToken: body.confirmationToken
      },
      { requestId: request.requestId }
    );
    return { status: 201, body: { item } };
  });

  router.get("/api/v1/dts-reload/residue", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(residueQuerySchema, request.query);
    const item = await getReloadResidue(db, auth, query.deviceId);
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/dts-reload/runs/:runId/deploy", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    if (!options.bridgeRpcClient || !options.bridgeConnectionPool) {
      throw new ApiError(
        "INTERNAL_ERROR",
        "Device bridge RPC is not configured; reload deploy requires the local device bridge.",
        { code: "bridge-rpc-unavailable" }
      );
    }
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(runIdParamsSchema, request.params);
    const body = parseWithSchema(deployReloadRunBodySchema, request.body);
    const item = await deployReloadRun(
      db,
      objectStore,
      auth,
      {
        runId: params.runId,
        deviceId: body.deviceId,
        bridgeId: body.bridgeId,
        targetRef: body.targetRef,
        protocol: body.protocol ?? "hdc",
        confirmationTokens: body.confirmationTokens
      },
      {
        bridgeRpcClient: options.bridgeRpcClient,
        bridgeConnectionPool: options.bridgeConnectionPool,
        artifactRoot: options.bridgeArtifactRoot
      },
      { requestId: request.requestId }
    );
    return { status: 200, body: { item } };
  });

  router.post("/api/v1/dts-reload/runs/:runId/promote-to-drafts", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(runIdParamsSchema, request.params);
    const body = parseWithSchema(promoteReloadRunToDraftsBodySchema, request.body);
    const item = await promoteReloadRunToDrafts(
      db,
      auth,
      {
        runId: params.runId,
        bindingIds: body.bindingIds,
        unverifiableAcknowledged: body.unverifiableAcknowledged
      },
      { requestId: request.requestId, objectStore }
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
