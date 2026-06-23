import { z } from "zod";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { DebugDeviceGateway } from "./gateway";
import type { DebugDeviceGatewayRegistry } from "./gatewayRegistry";
import type { BridgeConnectionPool } from "../deviceBridge/connectionPool";
import type { BridgeRpcClient } from "../deviceBridge/rpc";
import {
  archiveDebugParameterBodySchema,
  createDebugSessionBodySchema,
  debugAdminBindingParamsSchema,
  debugAdminParameterParamsSchema,
  detectTargetsBodySchema,
  listDebuggingAdminParametersQuerySchema,
  listDebuggingParametersQuerySchema,
  patchDebugParameterAdminBodySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
  upsertDebugParameterNodeBindingBodySchema,
  writeDebugParameterAdminBodySchema,
  writeNodeBodySchema
} from "./schemas";
import { createDebuggingService } from "./service";

const listDebuggingDevicesQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional()
});

const paramsWithSessionIdSchema = z.object({
  sessionId: z.string().trim().min(1)
});

const paramsWithSnapshotIdSchema = z.object({
  snapshotId: z.string().trim().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for debugging routes.", 500);
  }

  return db;
}

function requireDebugGatewayAccess(debugGateway: DebugDeviceGateway | undefined, debugGatewayRegistry: DebugDeviceGatewayRegistry | undefined) {
  if (!debugGateway && !debugGatewayRegistry) {
    throw new ApiError("INTERNAL_ERROR", "Debug device gateway is required for debugging routes.", 500);
  }
}

function parseWithSchema<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Invalid debugging route input."): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function normalizeArray<T>(value: T | T[] | undefined) {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value];
}

function serviceFrom(options: {
  db?: Database;
  debugGateway?: DebugDeviceGateway;
  debugGatewayRegistry?: DebugDeviceGatewayRegistry;
  debugGatewayMode?: "simulator" | "hdc" | "adb" | "multi" | string;
  metrics?: Pick<MetricsRegistry, "recordDeviceGatewayOperation">;
  tracing?: Pick<TracingBoundary, "withSpan">;
  bridgeConnectionPool?: Pick<BridgeConnectionPool, "isConnected">;
  bridgeRpcClient?: Pick<BridgeRpcClient, "call">;
}) {
  const db = requireDb(options.db);
  requireDebugGatewayAccess(options.debugGateway, options.debugGatewayRegistry);
  return {
    db,
    service: createDebuggingService({
      db,
      gateway: options.debugGateway,
      gatewayRegistry: options.debugGatewayRegistry,
      gatewayMode: options.debugGatewayMode,
      metrics: options.metrics,
      tracing: options.tracing,
      ...(options.bridgeConnectionPool ? { bridgeConnectionPool: options.bridgeConnectionPool } : {}),
      ...(options.bridgeRpcClient ? { bridgeRpcClient: options.bridgeRpcClient } : {})
    })
  };
}

function writeResponse(result: unknown) {
  if (typeof result === "object" && result !== null && "operation" in result) {
    return result;
  }

  return { operation: result };
}

function requireDebugWritePermission(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("debugging:write")) {
    throw new ApiError("FORBIDDEN", "Missing permission: debugging:write.", 403, { permission: "debugging:write" });
  }
}

export function registerDebuggingRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    debugGateway?: DebugDeviceGateway;
    debugGatewayRegistry?: DebugDeviceGatewayRegistry;
    debugGatewayMode?: "simulator" | "hdc" | "adb" | "multi" | string;
    metrics?: Pick<MetricsRegistry, "recordDeviceGatewayOperation">;
    tracing?: Pick<TracingBoundary, "withSpan">;
    bridgeConnectionPool?: Pick<BridgeConnectionPool, "isConnected">;
    bridgeRpcClient?: Pick<BridgeRpcClient, "call">;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v1/debugging/devices", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listDebuggingDevicesQuerySchema, request.query);
    const items = await service.listDevices(auth, query);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/debugging/targets/detect", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(detectTargetsBodySchema, request.body);
    const items = await service.detectTargets(auth, body, { requestId: request.requestId });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/debugging/parameters", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listDebuggingParametersQuerySchema, request.query);
    const items = await service.listParameters(auth, {
      ...query,
      risk: normalizeArray(query.risk)
    });

    return { status: 200, body: { items } };
  });

  router.get("/api/v1/debugging/admin/parameters", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listDebuggingAdminParametersQuerySchema, request.query);
    const items = await service.listAdminParameters(auth, {
      ...query,
      risk: normalizeArray(query.risk)
    });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/debugging/admin/parameters", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(writeDebugParameterAdminBodySchema, request.body);
    const item = await service.createAdminParameter(auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/debugging/admin/parameters/:parameterId", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(debugAdminParameterParamsSchema, request.params);
    const body = parseWithSchema(patchDebugParameterAdminBodySchema, request.body);
    const item = await service.updateAdminParameter(auth, { parameterId: params.parameterId, ...body }, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/debugging/admin/parameters/:parameterId/archive", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(debugAdminParameterParamsSchema, request.params);
    const body = parseWithSchema(archiveDebugParameterBodySchema, request.body ?? {});
    const item = await service.archiveAdminParameter(
      auth,
      { parameterId: params.parameterId, reason: body.reason },
      { requestId: request.requestId }
    );

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/debugging/admin/parameters/:parameterId/restore", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(debugAdminParameterParamsSchema, request.params);
    const item = await service.restoreAdminParameter(auth, { parameterId: params.parameterId }, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  const upsertAdminBinding = async (request: RouteRequest) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(debugAdminBindingParamsSchema, request.params);
    const body = parseWithSchema(upsertDebugParameterNodeBindingBodySchema, request.body);
    const item = await service.upsertAdminParameterBinding(
      auth,
      { parameterId: params.parameterId, protocol: params.protocol, ...body },
      { requestId: request.requestId }
    );

    return { status: 200, body: { item } };
  };

  router.put("/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol", upsertAdminBinding);
  router.patch("/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol", upsertAdminBinding);

  router.post("/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(debugAdminBindingParamsSchema, request.params);
    const item = await service.archiveAdminParameterBinding(
      auth,
      { parameterId: params.parameterId, protocol: params.protocol },
      { requestId: request.requestId }
    );

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/debugging/sessions", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createDebugSessionBodySchema, request.body);
    const item = await service.createSession(auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/debugging/sessions/:sessionId", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionIdSchema, request.params);
    const item = await service.getSession(auth, { sessionId: params.sessionId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/debugging/sessions/:sessionId/events", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionIdSchema, request.params);
    const items = await service.listSessionEvents(auth, { sessionId: params.sessionId });

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/debugging/nodes/read", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(readNodeBodySchema, request.body);
    const operation = await service.readNode(auth, body, { requestId: request.requestId });

    return { status: 200, body: { operation } };
  });

  router.post("/api/v1/debugging/nodes/write", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    requireDebugWritePermission(auth);
    const body = parseWithSchema(writeNodeBodySchema, request.body);
    const result = await service.writeNode(
      auth,
      {
        sessionId: body.sessionId,
        parameterId: body.parameterId,
        value: body.value,
        confirmationToken: body.confirmationToken,
        approvalId: body.approvalId
      },
      { requestId: request.requestId }
    );

    return { status: 200, body: writeResponse(result) };
  });

  router.post("/api/v1/debugging/snapshots/:snapshotId/rollback", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSnapshotIdSchema, request.params);
    const body = parseWithSchema(rollbackSnapshotBodySchema, request.body);
    const result = await service.rollbackSnapshot(
      auth,
      {
        snapshotId: params.snapshotId,
        confirmationToken: body.confirmationToken
      },
      { requestId: request.requestId }
    );

    return { status: 200, body: result };
  });
}
