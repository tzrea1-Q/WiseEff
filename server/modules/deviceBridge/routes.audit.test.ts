import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { CreateAuditEventInput } from "../audit/types";
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
    clientVersion: "1.2.3",
    capabilities: {},
    createdAt: "2026-06-23T00:00:00.000Z",
    lastSeenAt: null,
    revokedAt: null,
    ...overrides
  };
}

function makeServer(options: {
  repo: Record<string, unknown>;
  pairingService?: Record<string, unknown>;
  auth?: AuthContext;
  now?: () => Date;
}) {
  const router = createRouter();
  vi.mocked(repository.createDeviceBridgeRepository).mockReturnValue(options.repo as never);
  const events: CreateAuditEventInput[] = [];
  const createAuditEvent = vi.fn(async (_db: unknown, input: CreateAuditEventInput) => {
    events.push(input);
  });

  registerDeviceBridgeRoutes(router, {
    db: makeDb(),
    getCurrentAuthContext: () => options.auth ?? makeAuth(),
    pairingService: options.pairingService as never,
    now: options.now,
    createAuditEvent: createAuditEvent as never
  });

  return { server: createHttpServer(router), events };
}

describe("device bridge revoke audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a High-severity audit event when a bridge is revoked", async () => {
    const revokedAt = new Date("2026-06-23T01:00:00.000Z");
    const repo = {
      revokeBridge: vi.fn().mockResolvedValue(bridgeRecord({ revokedAt: revokedAt.toISOString() }))
    };
    const { server, events } = makeServer({ repo, now: () => revokedAt });

    const response = await requestJson(server, "/api/v1/device-bridges/br-1/revoke", {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      app: "device-bridge",
      kind: "device-bridge-revoke",
      action: "revoke",
      severity: "High",
      targetType: "device-bridge",
      targetId: "br-1",
      actorUserId: "user-1",
      organizationId: "org-1"
    });
    expect(JSON.stringify(events[0].metadata)).not.toContain("WIN-PC");
  });

  it("does not write an audit event when the bridge is missing (404)", async () => {
    const repo = { revokeBridge: vi.fn().mockResolvedValue(null) };
    const { server, events } = makeServer({ repo });

    const response = await requestJson(server, "/api/v1/device-bridges/br-missing/revoke", {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(404);
    expect(events).toHaveLength(0);
  });

  it("does not write an audit event when debugging:use is missing (403)", async () => {
    const repo = { revokeBridge: vi.fn() };
    const { server, events } = makeServer({ repo, auth: makeAuth({ permissions: [] }) });

    const response = await requestJson(server, "/api/v1/device-bridges/br-1/revoke", {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(403);
    expect(events).toHaveLength(0);
    expect(repo.revokeBridge).not.toHaveBeenCalled();
  });
});

describe("device bridge pairing-code audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a High-severity audit event when a pairing code is issued (never leaking the code)", async () => {
    const pairingService = {
      issuePairingCode: vi.fn().mockResolvedValue({ code: "123456", expiresAt: "2026-06-23T00:05:00.000Z" })
    };
    const { server, events } = makeServer({ repo: {}, pairingService });

    const response = await requestJson(server, "/api/v1/device-bridges/pairing-codes", {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      app: "device-bridge",
      kind: "device-bridge-pairing-code-issue",
      action: "create",
      severity: "High",
      targetType: "device-bridge-pairing-code",
      actorUserId: "user-1",
      organizationId: "org-1"
    });
    expect(JSON.stringify(events[0].metadata)).not.toContain("123456");
  });

  it("does not write an audit event when debugging:use is missing (403)", async () => {
    const pairingService = { issuePairingCode: vi.fn() };
    const { server, events } = makeServer({ repo: {}, pairingService, auth: makeAuth({ permissions: [] }) });

    const response = await requestJson(server, "/api/v1/device-bridges/pairing-codes", {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(response.status).toBe(403);
    expect(events).toHaveLength(0);
    expect(pairingService.issuePairingCode).not.toHaveBeenCalled();
  });
});

describe("device bridge rename audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a Medium-severity audit event when a bridge is renamed", async () => {
    const repo = {
      updateBridgeMachineLabel: vi.fn().mockResolvedValue(bridgeRecord({ machineLabel: "LAB-PC-02" }))
    };
    const { server, events } = makeServer({ repo });

    const response = await requestJson(server, "/api/v1/device-bridges/br-1", {
      method: "PATCH",
      body: JSON.stringify({ machineLabel: "LAB-PC-02" })
    });

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      app: "device-bridge",
      kind: "device-bridge-rename",
      action: "update",
      severity: "Medium",
      targetType: "device-bridge",
      targetId: "br-1",
      actorUserId: "user-1",
      organizationId: "org-1"
    });
    expect(JSON.stringify(events[0].metadata)).not.toContain("LAB-PC-02");
  });

  it("does not write an audit event when the bridge is missing (404)", async () => {
    const repo = { updateBridgeMachineLabel: vi.fn().mockResolvedValue(null) };
    const { server, events } = makeServer({ repo });

    const response = await requestJson(server, "/api/v1/device-bridges/br-missing", {
      method: "PATCH",
      body: JSON.stringify({ machineLabel: "LAB-PC-02" })
    });

    expect(response.status).toBe(404);
    expect(events).toHaveLength(0);
  });
});
