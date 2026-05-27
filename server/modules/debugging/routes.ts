import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { DebugDeviceGateway } from "./gateway";
import {
  createDebugSessionBodySchema,
  detectTargetsBodySchema,
  listDebuggingParametersQuerySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
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

function requireDebugGateway(debugGateway: DebugDeviceGateway | undefined) {
  if (!debugGateway) {
    throw new ApiError("INTERNAL_ERROR", "Debug device gateway is required for debugging routes.", 500);
  }

  return debugGateway;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid debugging route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function normalizeArray<T>(value: T | T[] | undefined) {
  return value === undefined ? undefined : Array.isArray(value) ? value : [value];
}

function serviceFrom(options: { db?: Database; debugGateway?: DebugDeviceGateway }) {
  const db = requireDb(options.db);
  const gateway = requireDebugGateway(options.debugGateway);
  return { db, gateway, service: createDebuggingService({ db, gateway }) };
}

function writeResponse(result: unknown) {
  if (typeof result === "object" && result !== null && "operation" in result) {
    return result;
  }

  return { operation: result };
}

export function registerDebuggingRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    debugGateway?: DebugDeviceGateway;
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
    const items = await service.detectTargets(auth, body);

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

  router.post("/api/v1/debugging/sessions", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createDebugSessionBodySchema, request.body);
    const item = await service.createSession(auth, body);

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
    const operation = await service.readNode(auth, body);

    return { status: 200, body: { operation } };
  });

  router.post("/api/v1/debugging/nodes/write", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(writeNodeBodySchema, request.body);
    const result = await service.writeNode(auth, {
      sessionId: body.sessionId,
      parameterId: body.parameterId,
      value: body.value,
      confirmationToken: body.confirmationToken,
      approvalId: body.approvalId
    });

    return { status: 200, body: writeResponse(result) };
  });

  router.post("/api/v1/debugging/snapshots/:snapshotId/rollback", async (request) => {
    const { service } = serviceFrom(options);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSnapshotIdSchema, request.params);
    const body = parseWithSchema(
      rollbackSnapshotBodySchema.extend({ sessionId: z.string().trim().min(1) }),
      request.body
    );
    const result = await service.rollbackSnapshot(auth, {
      sessionId: body.sessionId,
      snapshotId: params.snapshotId,
      confirmationToken: body.confirmationToken
    });

    return { status: 200, body: result };
  });
}
