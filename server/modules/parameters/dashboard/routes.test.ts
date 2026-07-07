import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../auth/types";
import type { Database } from "../../../shared/database/client";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import { requestJson } from "../../../test/testClient";
import { registerParameterDashboardRoutes } from "./routes";
import * as service from "./service";

vi.mock("./service", () => ({
  getDashboardSummary: vi.fn(),
  getDashboardHotspots: vi.fn()
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
    permissions: ["parameter:view", "parameter:edit"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerParameterDashboardRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

describe("parameter dashboard routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/parameters/dashboard/summary returns item envelope for viewer", async () => {
    const summary = {
      window: "30d",
      windowLabel: "近 30 天",
      projectId: null,
      kpis: {
        totalParameters: 1,
        managedProjects: 1,
        changeFrequency: 1,
        activeContributors: 1,
        highRiskParameters: 1
      },
      trend: [],
      riskBuckets: [],
      workbenchSignals: {
        reviewQueue: 0,
        myDrafts: 0,
        returnedChanges: 0,
        waitingMerge: 0,
        unappliedImportBatches: 0,
        inactiveAccounts: 0
      }
    };
    vi.mocked(service.getDashboardSummary).mockResolvedValue(summary as never);

    const response = await requestJson<{ item: typeof summary }>(
      makeServer({ db: makeDb() }),
      "/api/v1/parameters/dashboard/summary?window=30d"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: summary });
  });

  it("GET /api/v1/parameters/dashboard/hotspots returns items envelope for viewer", async () => {
    vi.mocked(service.getDashboardHotspots).mockResolvedValue([]);

    const response = await requestJson<{ items: unknown[] }>(
      makeServer({ db: makeDb() }),
      "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it("rejects callers without parameter:view", async () => {
    const response = await requestJson<{ error: { code: string; message: string } }>(
      makeServer({ db: makeDb(), auth: makeAuth({ permissions: ["parameter:edit"] }) }),
      "/api/v1/parameters/dashboard/summary"
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Parameter view permission is required."
    });
    expect(service.getDashboardSummary).not.toHaveBeenCalled();
  });
});
