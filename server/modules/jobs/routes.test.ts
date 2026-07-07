import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import * as repository from "./repository";
import { registerJobRoutes } from "./routes";
import type { LogAnalysisJobSnapshotDto } from "./types";

vi.mock("./repository", () => ({
  getJobSnapshot: vi.fn()
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
    permissions: ["logs:view"],
    ...overrides
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function jobSnapshot(overrides: Partial<LogAnalysisJobSnapshotDto> = {}): LogAnalysisJobSnapshotDto {
  return {
    id: "job-1",
    kind: "log-analysis" as const,
    organizationId: "org-1",
    logId: "log-1",
    runId: "run-1",
    status: "queued" as const,
    progress: 0,
    currentStage: "parse" as const,
    error: null,
    updatedAt: "2026-05-25T02:00:00.000Z",
    ...overrides
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerJobRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

async function requestText(path: string, options: { db?: Database; auth?: AuthContext } = {}) {
  const server = makeServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { "X-Request-Id": "test-request" }
    });
    return { status: response.status, text: await response.text(), headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/v1/jobs/:jobId returns snapshot", async () => {
    const db = makeDb();
    const snapshot = jobSnapshot();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(snapshot);

    const response = await requestJson<{ item: typeof snapshot }>(makeServer({ db }), "/api/v1/jobs/job-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: snapshot });
    expect(repository.getJobSnapshot).toHaveBeenCalledWith(db, "job-1");
  });

  it("missing job returns NOT_FOUND", async () => {
    const db = makeDb();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(null);

    const response = await requestJson<{ error: { code: string } }>(makeServer({ db }), "/api/v1/jobs/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("cross-org job snapshot returns NOT_FOUND", async () => {
    const db = makeDb();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(jobSnapshot({ organizationId: "org-other" }));

    const response = await requestJson<{ error: { code: string } }>(makeServer({ db }), "/api/v1/jobs/job-1");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/v1/jobs/:jobId/events emits at least one SSE job event", async () => {
    const db = makeDb();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(jobSnapshot({ status: "complete", progress: 100, currentStage: "report" }));

    const response = await requestText("/api/v1/jobs/job-1/events", { db });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.text).toContain("event: job");
    expect(response.text).toContain('"id":"job-1"');
  });

  it("cross-org job SSE returns NOT_FOUND before opening the stream", async () => {
    const db = makeDb();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(jobSnapshot({ organizationId: "org-other" }));

    const response = await requestText("/api/v1/jobs/job-1/events", { db });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.text).toContain('"code":"NOT_FOUND"');
    expect(response.text).not.toContain("event: error");
  });

  it("missing job SSE returns NOT_FOUND before opening the stream", async () => {
    const db = makeDb();
    vi.mocked(repository.getJobSnapshot).mockResolvedValue(null);

    const response = await requestText("/api/v1/jobs/missing/events", { db });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.text).toContain('"code":"NOT_FOUND"');
    expect(response.text).not.toContain("event: error");
  });
});
