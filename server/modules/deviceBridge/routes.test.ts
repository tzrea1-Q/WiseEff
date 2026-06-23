import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { PairingService } from "./pairingService";
import type { BridgeReleaseManifest } from "./releaseManifest";
import * as repository from "./repository";
import { registerDeviceBridgeRoutes } from "./routes";

vi.mock("./repository", () => ({
  createDeviceBridgeRepository: vi.fn()
}));

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "aurora", roleId: "software-user" }],
    permissions: ["debugging:use"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function bridgeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "br-1",
    organizationId: "org-1",
    userId: "user-1",
    machineLabel: "WIN-PC",
    platform: "windows" as const,
    arch: "amd64",
    clientVersion: null,
    capabilities: {},
    createdAt: "2026-06-23T00:00:00.000Z",
    lastSeenAt: null,
    revokedAt: null,
    ...overrides
  };
}

function makePairingService(overrides: Partial<PairingService> = {}): PairingService {
  return {
    issuePairingCode: vi.fn().mockResolvedValue({ code: "123456", expiresAt: "2026-06-23T00:05:00.000Z" }),
    pairWithCode: vi.fn().mockResolvedValue({
      bridgeId: "br-1",
      bridgeToken: "wb_test_token",
      tokenExpiresAt: "2026-09-21T00:00:00.000Z"
    }),
    ...overrides
  };
}

function makeServer(options: {
  db?: Database;
  auth?: AuthContext;
  pairingService?: PairingService;
  loadReleaseManifest?: () => Promise<BridgeReleaseManifest>;
  now?: () => Date;
} = {}) {
  const router = createRouter();
  registerDeviceBridgeRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth(),
    pairingService: options.pairingService,
    loadReleaseManifest:
      options.loadReleaseManifest ??
      (async () => ({
        recommendedVersion: "0.1.0",
        minCompatibleVersion: "0.1.0",
        items: [
          {
            platform: "windows" as const,
            arch: "amd64",
            version: "0.1.0",
            downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
          }
        ]
      })),
    now: options.now
  });
  return createHttpServer(router);
}

describe("device bridge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/device-bridges/releases returns the manifest without auth", async () => {
    const response = await requestJson<{
      recommendedVersion: string;
      items: Array<{ platform: string; downloadUrl: string }>;
    }>(makeServer(), "/api/v1/device-bridges/releases");

    expect(response.status).toBe(200);
    expect(response.body.recommendedVersion).toBe("0.1.0");
    expect(response.body.items[0]?.downloadUrl).toBe(
      "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
    );
  });

  it("POST /api/v1/device-bridges/pairing-codes requires debugging:use", async () => {
    const pairingService = makePairingService();
    const forbidden = await requestJson(
      makeServer({ db: makeDb(), auth: makeAuth({ permissions: [] }), pairingService }),
      "/api/v1/device-bridges/pairing-codes",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(forbidden.status).toBe(403);
    expect(pairingService.issuePairingCode).not.toHaveBeenCalled();
  });

  it("POST /api/v1/device-bridges/pairing-codes issues a pairing code", async () => {
    const pairingService = makePairingService();
    const response = await requestJson<{ code: string; expiresAt: string }>(
      makeServer({ db: makeDb(), pairingService }),
      "/api/v1/device-bridges/pairing-codes",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(201);
    expect(response.body.code).toBe("123456");
    expect(pairingService.issuePairingCode).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1"
    });
  });

  it("POST /api/v1/device-bridges/pair exchanges a pairing code without user auth", async () => {
    const pairingService = makePairingService();
    const response = await requestJson<{ bridgeId: string; bridgeToken: string }>(
      makeServer({ db: makeDb(), pairingService }),
      "/api/v1/device-bridges/pair",
      {
        method: "POST",
        body: JSON.stringify({
          code: "123456",
          machineLabel: "WIN-PC",
          platform: "windows",
          arch: "amd64"
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body.bridgeToken).toBe("wb_test_token");
    expect(pairingService.pairWithCode).toHaveBeenCalledWith({
      code: "123456",
      machineLabel: "WIN-PC",
      platform: "windows",
      arch: "amd64"
    });
  });

  it("GET /api/v1/device-bridges/mine returns the authenticated user's bridges", async () => {
    const repo = {
      listBridgesForUser: vi.fn().mockResolvedValue([bridgeRecord()])
    };
    vi.mocked(repository.createDeviceBridgeRepository).mockReturnValue(repo as never);

    const response = await requestJson<{ items: Array<{ id: string; machineLabel: string }> }>(
      makeServer({ db: makeDb() }),
      "/api/v1/device-bridges/mine"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ id: "br-1", machineLabel: "WIN-PC" })
    ]);
    expect(repo.listBridgesForUser).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1"
    });
  });

  it("POST /api/v1/device-bridges/:bridgeId/revoke revokes the bridge", async () => {
    const revokedAt = new Date("2026-06-23T01:00:00.000Z");
    const repo = {
      revokeBridge: vi.fn().mockResolvedValue(bridgeRecord({ revokedAt: revokedAt.toISOString() }))
    };
    vi.mocked(repository.createDeviceBridgeRepository).mockReturnValue(repo as never);

    const response = await requestJson<{ item: { id: string; revokedAt: string | null } }>(
      makeServer({ db: makeDb(), now: () => revokedAt }),
      "/api/v1/device-bridges/br-1/revoke",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(200);
    expect(response.body.item.revokedAt).toBe(revokedAt.toISOString());
    expect(repo.revokeBridge).toHaveBeenCalledWith({
      bridgeId: "br-1",
      userId: "user-1",
      organizationId: "org-1",
      revokedAt
    });
  });

  it("POST /api/v1/device-bridges/:bridgeId/revoke returns 404 when the bridge is missing", async () => {
    const repo = {
      revokeBridge: vi.fn().mockResolvedValue(null)
    };
    vi.mocked(repository.createDeviceBridgeRepository).mockReturnValue(repo as never);

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v1/device-bridges/br-missing/revoke",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(404);
  });
});
