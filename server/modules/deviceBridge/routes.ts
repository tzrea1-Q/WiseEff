import { z } from "zod";

import { DEVICE_BRIDGE_RELEASES_PATH } from "@wiseeff/device-command-core/bridgeApiPaths";

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
import { randomUUID } from "node:crypto";

import type { DeviceBridgeRecord } from "./types";
import { createAuditEvent as defaultCreateAuditEvent } from "../audit/repository";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for device bridge routes.");
  }

  return db;
}

function parseWithSchema<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Invalid device bridge route input."): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function requireDebuggingUsePermission(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("debugging:use")) {
    throw new ApiError("FORBIDDEN", "Missing permission: debugging:use.", { permission: "debugging:use" });
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

function resolvePairingService(
  db: Database,
  pairingService: PairingService | undefined,
  createAuditEvent?: typeof defaultCreateAuditEvent
) {
  return pairingService ?? createPairingService({ repo: createDeviceBridgeRepository(db), db, createAuditEvent });
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
    createAuditEvent?: typeof defaultCreateAuditEvent;
  }
) {
  const now = options.now ?? (() => new Date());
  const writeAudit = options.createAuditEvent ?? defaultCreateAuditEvent;

  registerDeviceBridgeToolRoutes(router, {
    loadToolReleaseManifest: options.loadToolReleaseManifest
  });

  router.get(DEVICE_BRIDGE_RELEASES_PATH, async () => {
    if (!options.loadReleaseManifest) {
      throw new ApiError("INTERNAL_ERROR", "Device bridge release manifest loader is required.");
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

    await writeAudit(db, {
      id: randomUUID(),
      organizationId: auth.user.organizationId,
      projectId: null,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "device-bridge",
      kind: "device-bridge-pairing-code-issue",
      action: "create",
      severity: "High",
      targetType: "device-bridge-pairing-code",
      targetId: null,
      metadata: { expiresAt: issued.expiresAt },
      traceId: request.requestId ?? randomUUID()
    });

    return { status: 201, body: issued };
  });

  router.post("/api/v1/device-bridges/pair", async (request) => {
    const db = requireDb(options.db);
    const body = parseWithSchema(pairWithCodeBodySchema, request.body);

    const paired = await resolvePairingService(db, options.pairingService, writeAudit).pairWithCode(body);
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
      throw new ApiError("NOT_FOUND", "Device bridge was not found.", { bridgeId: params.bridgeId });
    }

    await writeAudit(db, {
      id: randomUUID(),
      organizationId: auth.user.organizationId,
      projectId: null,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "device-bridge",
      kind: "device-bridge-rename",
      action: "update",
      severity: "Medium",
      targetType: "device-bridge",
      targetId: updated.id,
      metadata: { platform: updated.platform, arch: updated.arch },
      traceId: request.requestId ?? randomUUID()
    });

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
      throw new ApiError("NOT_FOUND", "Device bridge was not found.", { bridgeId: params.bridgeId });
    }

    await writeAudit(db, {
      id: randomUUID(),
      organizationId: auth.user.organizationId,
      projectId: null,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "device-bridge",
      kind: "device-bridge-revoke",
      action: "revoke",
      severity: "High",
      targetType: "device-bridge",
      targetId: revoked.id,
      metadata: { platform: revoked.platform, arch: revoked.arch, clientVersion: revoked.clientVersion },
      traceId: request.requestId ?? randomUUID()
    });

    return {
      status: 200,
      body: {
        item: toBridgeItem(revoked)
      }
    };
  });
}
