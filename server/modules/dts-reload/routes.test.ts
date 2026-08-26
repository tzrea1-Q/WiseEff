import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationContext } from "../auth/trustedInvocation";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerDtsReloadRoutes } from "./routes";
import { closeTestRefusalAuditSink, testRefusalAuditSink } from "./testRefusalSink";
import * as configurationService from "./configurationService";
import * as promoteService from "./promote";
import * as reloadService from "./service";

vi.mock("./configurationService", () => ({
  getReloadConfigurationAdminView: vi.fn(async () => undefined),
  updateOrganisationReloadConfiguration: vi.fn(async () => undefined)
}));

vi.mock("./service", () => ({
  deployReloadRun: vi.fn(async () => undefined),
  getReloadResidue: vi.fn(async () => undefined),
  getReloadRun: vi.fn(async () => undefined),
  getReloadRunArtifact: vi.fn(async () => undefined),
  listReloadCandidates: vi.fn(async () => undefined),
  listReloadRuns: vi.fn(async () => ({ items: [], nextCursor: null })),
  startReloadRun: vi.fn(async () => undefined),
  startRestoreBaselineRun: vi.fn(async () => undefined)
}));

vi.mock("./promote", () => ({
  promoteReloadRunToDrafts: vi.fn(async () => undefined)
}));

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["debugging:admin", "debugging:dts-reload", "parameter:edit"]
  };
}

function makeDb(): Database {
  return { query: vi.fn(), transaction: vi.fn() };
}

function makeObjectStore(): ObjectStore {
  return { put: vi.fn(), get: vi.fn() };
}

function makeServer(db: Database, objectStore: ObjectStore, auth: AuthContext) {
  const router = createRouter();
  registerDtsReloadRoutes(router, {
    db,
    objectStore,
    bridgeRpcClient: { call: vi.fn() },
    bridgeConnectionPool: { isConnected: vi.fn() },
    refusalAuditSink: testRefusalAuditSink,
    getCurrentAuthContext: () => auth
  });
  return createHttpServer(router);
}

describe("DTS reload routes trusted provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs a server-owned user invocation and ignores client actorType spoofing", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const auth = makeAuth();

    const response = await requestJson<{ item?: unknown }>(
      makeServer(db, objectStore, auth),
      "/api/v1/dts-reload/configuration?actorType=user",
      {
        method: "PUT",
        body: JSON.stringify({
          destinationDirectory: "/oem/firmware/",
          destinationFilename: "power.dtbo",
          triggerNodePath: "/sys/kernel/debug/power/trigger",
          triggerPayload: "1",
          kernelLogCommand: "dmesg",
          actorType: "agent"
        }),
        headers: { actorType: "system" }
      }
    );

    expect(response.status).toBe(200);
    expect(configurationService.updateOrganisationReloadConfiguration).toHaveBeenCalledWith(
      db,
      auth,
      {
        destinationDirectory: "/oem/firmware/",
        destinationFilename: "power.dtbo",
        triggerNodePath: "/sys/kernel/debug/power/trigger",
        triggerPayload: "1",
        kernelLogCommand: "dmesg"
      },
      expect.objectContaining({
        requestId: "test-request",
        invocation: expect.objectContaining({
          initiator: "user",
          principal: expect.objectContaining({
            user: expect.objectContaining({ id: "user-1" }),
            organization: expect.objectContaining({ id: "org-1" })
          })
        })
      })
    );

    const call = vi.mocked(configurationService.updateOrganisationReloadConfiguration).mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const context = call[3];
    expect(() => assertTrustedInvocationContext(context.invocation)).not.toThrow();
    expect(context.invocation.initiator).toBe("user");
    expect(context.refusalSink).toBe(testRefusalAuditSink);
  });

  it("constructs user provenance for start-run and strips the client actor field", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const auth = makeAuth();

    const response = await requestJson(
      makeServer(db, objectStore, auth),
      "/api/v1/dts-reload/projects/project-1/runs",
      {
        method: "POST",
        body: JSON.stringify({
          targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
          actorType: "system"
        }),
        headers: { actorType: "agent" }
      }
    );

    expect(response.status).toBe(201);
    const call = vi.mocked(reloadService.startReloadRun).mock.calls[0];
    expect(call?.[3]).toEqual({
      projectId: "project-1",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });
    expect(call?.[4].invocation.initiator).toBe("user");
    expect(() => assertTrustedInvocationContext(call?.[4].invocation)).not.toThrow();
    expect(call?.[4].refusalSink).toBe(testRefusalAuditSink);
  });

  it("constructs user provenance for restore-baseline", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const auth = makeAuth();

    const response = await requestJson(
      makeServer(db, objectStore, auth),
      "/api/v1/dts-reload/projects/project-1/restore-baseline",
      {
        method: "POST",
        body: JSON.stringify({ deviceId: "bridge:lab-1", actorType: "agent" }),
        headers: { actorType: "system" }
      }
    );

    expect(response.status).toBe(201);
    const call = vi.mocked(reloadService.startRestoreBaselineRun).mock.calls[0];
    expect(call?.[3]).toEqual({ projectId: "project-1", deviceId: "bridge:lab-1" });
    expect(call?.[4].invocation.initiator).toBe("user");
    expect(() => assertTrustedInvocationContext(call?.[4].invocation)).not.toThrow();
    expect(call?.[4].refusalSink).toBe(testRefusalAuditSink);
  });

  it("constructs user provenance for deploy before any device dependency is used", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const auth = makeAuth();

    const response = await requestJson(
      makeServer(db, objectStore, auth),
      "/api/v1/dts-reload/runs/run-1/deploy",
      {
        method: "POST",
        body: JSON.stringify({
          deviceId: "bridge:lab-1",
          bridgeId: "br-1",
          targetRef: "target-1",
          confirmationTokens: ["confirm-dts-reload"],
          actorType: "system"
        }),
        headers: { actorType: "agent" }
      }
    );

    expect(response.status).toBe(200);
    const call = vi.mocked(reloadService.deployReloadRun).mock.calls[0];
    expect(call?.[3]).toEqual({
      runId: "run-1",
      deviceId: "bridge:lab-1",
      bridgeId: "br-1",
      targetRef: "target-1",
      protocol: "hdc",
      confirmationTokens: ["confirm-dts-reload"]
    });
    expect(call?.[5].invocation.initiator).toBe("user");
    expect(() => assertTrustedInvocationContext(call?.[5].invocation)).not.toThrow();
    expect(call?.[5].refusalSink).toBe(testRefusalAuditSink);
  });

  it("constructs user provenance for promote-to-drafts", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const auth = makeAuth();

    const response = await requestJson(
      makeServer(db, objectStore, auth),
      "/api/v1/dts-reload/runs/run-1/promote-to-drafts",
      {
        method: "POST",
        body: JSON.stringify({ bindingIds: ["binding-1"], actorType: "agent" }),
        headers: { actorType: "system" }
      }
    );

    expect(response.status).toBe(201);
    const call = vi.mocked(promoteService.promoteReloadRunToDrafts).mock.calls[0];
    expect(call?.[2]).toEqual({ runId: "run-1", bindingIds: ["binding-1"] });
    expect(call?.[3].invocation.initiator).toBe("user");
    expect(() => assertTrustedInvocationContext(call?.[3].invocation)).not.toThrow();
    expect(call?.[3].refusalSink).toBe(testRefusalAuditSink);
  });
});

afterAll(async () => closeTestRefusalAuditSink());
