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
  removeDeviceReloadConfiguration,
  updateOrganisationReloadConfiguration,
  upsertDeviceReloadConfiguration
} from "./configurationService";
import { deviceIdParamsSchema, reloadConfigurationContractBodySchema } from "./configurationSchemas";
import {
  deployReloadRun,
  getReloadRun,
  getReloadRunArtifact,
  listReloadCandidates,
  startReloadRun
} from "./service";
import {
  deployReloadRunBodySchema,
  projectIdParamsSchema,
  runIdParamsSchema,
  startReloadRunBodySchema
} from "./schemas";

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

  router.put("/api/v1/dts-reload/configuration/devices/:deviceId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(deviceIdParamsSchema, request.params);
    const body = parseWithSchema(reloadConfigurationContractBodySchema, request.body);
    const item = await upsertDeviceReloadConfiguration(db, auth, params.deviceId, body, {
      requestId: request.requestId
    });
    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/dts-reload/configuration/devices/:deviceId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(deviceIdParamsSchema, request.params);
    const item = await removeDeviceReloadConfiguration(db, auth, params.deviceId, {
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

  router.post("/api/v1/dts-reload/runs/:runId/deploy", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    if (!options.bridgeRpcClient || !options.bridgeConnectionPool) {
      throw new ApiError(
        "INTERNAL_ERROR",
        "Device bridge RPC is not configured; reload deploy requires the local device bridge.",
        500,
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
