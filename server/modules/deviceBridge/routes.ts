import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createPairingService, type PairingService } from "./pairingService";
import { createDeviceBridgeRepository } from "./repository";
import type { BridgeReleaseManifest } from "./releaseManifest";
import type { BridgeToolReleaseManifest } from "./toolReleaseManifest";
import { registerDeviceBridgeToolRoutes } from "./toolRoutes";
import { bridgeIdParamsSchema, pairWithCodeBodySchema, renameBridgeBodySchema } from "./schemas";
import type { DeviceBridgeRecord } from "./types";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for device bridge routes.", 500);
  }

  return db;
}

function parseWithSchema<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Invalid device bridge route input."): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function requireDebuggingUsePermission(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("debugging:use")) {
    throw new ApiError("FORBIDDEN", "Missing permission: debugging:use.", 403, { permission: "debugging:use" });
  }
}

function toBridgeItem(record: DeviceBridgeRecord) {
  return {
    id: record.id,
    machineLabel: record.machineLabel,
    platform: record.platform,
    arch: record.arch,
    clientVersion: record.clientVersion,
    capabilities: record.capabilities,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    revokedAt: record.revokedAt
  };
}

function resolvePairingService(db: Database, pairingService?: PairingService) {
  return pairingService ?? createPairingService({ repo: createDeviceBridgeRepository(db) });
}

export function registerDeviceBridgeRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
    pairingService?: PairingService;
    loadReleaseManifest?: () => Promise<BridgeReleaseManifest>;
    loadToolReleaseManifest?: () => Promise<BridgeToolReleaseManifest>;
    now?: () => Date;
  }
) {
  const now = options.now ?? (() => new Date());

  registerDeviceBridgeToolRoutes(router, {
    loadToolReleaseManifest: options.loadToolReleaseManifest
  });

  router.get("/api/v1/device-bridges/releases", async () => {
    if (!options.loadReleaseManifest) {
      throw new ApiError("INTERNAL_ERROR", "Device bridge release manifest loader is required.", 500);
    }

    const manifest = await options.loadReleaseManifest();
    return { status: 200, body: manifest };
  });

  router.post("/api/v1/device-bridges/pairing-codes", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireDebuggingUsePermission(auth);

    const issued = await resolvePairingService(db, options.pairingService).issuePairingCode({
      userId: auth.user.id,
      organizationId: auth.user.organizationId
    });

    return { status: 201, body: issued };
  });

  router.post("/api/v1/device-bridges/pair", async (request) => {
    const db = requireDb(options.db);
    const body = parseWithSchema(pairWithCodeBodySchema, request.body);

    const paired = await resolvePairingService(db, options.pairingService).pairWithCode(body);
    return { status: 201, body: paired };
  });

  router.get("/api/v1/device-bridges/mine", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireDebuggingUsePermission(auth);

    const repo = createDeviceBridgeRepository(db);
    const items = await repo.listBridgesForUser({
      userId: auth.user.id,
      organizationId: auth.user.organizationId
    });

    return {
      status: 200,
      body: {
        items: items.map(toBridgeItem)
      }
    };
  });

  router.patch("/api/v1/device-bridges/:bridgeId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireDebuggingUsePermission(auth);
    const params = parseWithSchema(bridgeIdParamsSchema, request.params);
    const body = parseWithSchema(renameBridgeBodySchema, request.body);

    const repo = createDeviceBridgeRepository(db);
    const updated = await repo.updateBridgeMachineLabel({
      bridgeId: params.bridgeId,
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      machineLabel: body.machineLabel
    });

    if (!updated) {
      throw new ApiError("NOT_FOUND", "Device bridge was not found.", 404, { bridgeId: params.bridgeId });
    }

    return {
      status: 200,
      body: {
        item: toBridgeItem(updated)
      }
    };
  });

  router.post("/api/v1/device-bridges/:bridgeId/revoke", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    requireDebuggingUsePermission(auth);
    const params = parseWithSchema(bridgeIdParamsSchema, request.params);

    const repo = createDeviceBridgeRepository(db);
    const revoked = await repo.revokeBridge({
      bridgeId: params.bridgeId,
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      revokedAt: now()
    });

    if (!revoked) {
      throw new ApiError("NOT_FOUND", "Device bridge was not found.", 404, { bridgeId: params.bridgeId });
    }

    return {
      status: 200,
      body: {
        item: toBridgeItem(revoked)
      }
    };
  });
}
