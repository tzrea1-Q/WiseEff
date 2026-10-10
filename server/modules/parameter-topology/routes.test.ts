import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { testRefusalAuditSink } from "../audit/testRefusalSink";
import { registerParameterSpecRoutes } from "../parameter-specs/routes";
import { registerParameterTopologyRoutes } from "./routes";
import * as specService from "../parameter-specs/service";
import * as topologyService from "./service";

vi.mock("../parameter-specs/service", () => ({
  listParameterSpecs: vi.fn(),
  listSpecReviewTasks: vi.fn()
}));

vi.mock("./service", () => ({
  getTopology: vi.fn(),
  listConfigRevisions: vi.fn(),
  listIdentityMappingTasks: vi.fn(),
  validateConfigRevision: vi.fn(),
  createNodeEnablementDraft: vi.fn()
}));


function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Engineer",
      organizationName: "ChargeLab",
      roles: [{ projectId: "project-1", roleId: "hardware-user" }],
      permissions: ["parameter:view"]
    }),
    ...overrides
  };
}

function makeAdminAuth(): AuthContext {
  return makeAuth({
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  });
}

function makeEditorAuth(): AuthContext {
  return makeAuth({
    roles: [{ projectId: "project-1", roleId: "hardware-user" }],
    permissions: ["parameter:view", "parameter:edit"]
  });
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  const deps = {
    db: options.db,
    refusalAuditSink: testRefusalAuditSink,
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  };
  registerParameterSpecRoutes(router, deps);
  registerParameterTopologyRoutes(router, deps);
  return createHttpServer(router);
}

describe("parameter semantic v2 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v2/parameter-spec-review-tasks/:taskId/resolve is retired for viewers", async () => {
    const response = await requestJson(makeServer({ db: makeDb(), auth: makeAuth() }), "/api/v2/parameter-spec-review-tasks/task-1/resolve", {
      method: "POST",
      body: JSON.stringify({ decision: "resolved", parameterSpecId: "spec-1", reason: "Matched linux schema" })
    });
    expect(response.status).toBe(410);
    expect(response.body.error.details).toMatchObject({ reason: "legacy-surface-retired", successor: "/parameter-admin/specs?review=open" });
    expect(response.headers.get("link")).toBe('</parameter-admin/specs?review=open>; rel="successor-version"');
  });

  it("GET /api/v2/parameter-spec-review-tasks requires parameter admin", async () => {
    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAuth() }),
      "/api/v2/parameter-spec-review-tasks?status=open"
    );
    expect(response.status).toBe(403);
    expect(specService.listSpecReviewTasks).not.toHaveBeenCalled();
  });

  it("GET /api/v2/parameter-spec-review-tasks lists open tasks for admins", async () => {
    vi.mocked(specService.listSpecReviewTasks).mockResolvedValue({
      items: [
        {
          id: "task-1",
          status: "open",
          propertyKey: "gpio_int",
          driverModule: "vendor,sc8562",
          evidence: ["ambiguous"],
          candidates: [{ id: "pspec:a", label: "a / gpio_int" }],
          ambiguous: false,
          projectCount: 1,
          createdAt: "2026-07-16T01:00:00.000Z"
        }
      ],
      nextCursor: null
    });

    const response = await requestJson<{ items: unknown[]; historicalItems: Array<{ id: string; historicalOnly: boolean; needsCanonicalDecision: boolean }>; nextCursor: string | null }>(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/parameter-spec-review-tasks?status=open&limit=25"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.historicalItems[0]).toMatchObject({ id: "task-1", historicalOnly: true, needsCanonicalDecision: true });
    expect(specService.listSpecReviewTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      expect.objectContaining({ status: "open", limit: 25 })
    );
  });

  it("POST /api/v2/parameter-spec-review-tasks/:taskId/resolve is retired for admins", async () => {
    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/parameter-spec-review-tasks/task-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ decision: "resolved", parameterSpecId: "spec-1", reason: "Matched linux schema" })
      }
    );

    expect(response.status).toBe(410);
    expect(response.body.error.details).toMatchObject({ reason: "legacy-surface-retired", successor: "/parameter-admin/specs?review=open" });
    expect(response.headers.get("link")).toBe('</parameter-admin/specs?review=open>; rel="successor-version"');
  });

  it("POST retired resolve never creates a spec or confirms a mismatch", async () => {
    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/parameter-spec-review-tasks/task-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({
          decision: "resolved",
          createSpec: true,
          reason: "Created manual spec",
          confirmPropertyMismatch: true
        })
      }
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("link")).toBe('</parameter-admin/specs?review=open>; rel="successor-version"');
  });

  it("POST retired resolve takes precedence over legacy body validation", async () => {
    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/parameter-spec-review-tasks/task-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ decision: "resolved", reason: "missing spec id" })
      }
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("link")).toBe('</parameter-admin/specs?review=open>; rel="successor-version"');
  });

  it("GET topology lets viewers read source and effective views", async () => {
    vi.mocked(topologyService.getTopology).mockResolvedValue({
      view: "effective",
      revisionId: "rev-1",
      configSetId: "cs-1",
      projectId: "project-1",
      nodes: []
    });

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/config-sets/cs-1/revisions/rev-1/topology?view=effective"
    );

    expect(response.status).toBe(200);
    expect(topologyService.getTopology).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      expect.objectContaining({
        projectId: "project-1",
        configSetId: "cs-1",
        revisionId: "rev-1",
        view: "effective"
      })
    );
  });

  it("GET config-set revisions lists real revision ids for viewers", async () => {
    vi.mocked(topologyService.listConfigRevisions).mockResolvedValue({
      items: [
        {
          id: "rev-2",
          organizationId: "org-1",
          projectId: "project-1",
          configSetId: "cs-1",
          revisionNumber: 2,
          status: "resolved",
          manifestState: "complete",
          createdAt: "2026-08-17T10:00:00.000Z"
        }
      ]
    });

    const response = await requestJson<{ items: Array<{ id: string; revisionNumber: number }> }>(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/config-sets/cs-1/revisions"
    );

    expect(response.status).toBe(200);
    expect(response.body?.items[0]).toMatchObject({ id: "rev-2", revisionNumber: 2 });
    expect(response.body?.items[0]).not.toHaveProperty("initiatorSessionId");
    expect(response.body?.items[0]).not.toHaveProperty("initiatorToolCallId");
    expect(response.body?.items[0]).not.toHaveProperty("initiatorApprovalId");
    expect(response.body?.items[0]).not.toHaveProperty("initiatorSystemName");
    expect(topologyService.listConfigRevisions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization: { id: "org-1", name: "ChargeLab" } }),
      { projectId: "project-1", configSetId: "cs-1" }
    );
  });

  it("GET config-set revisions requires parameter view permission", async () => {
    const response = await requestJson(
      makeServer({
        db: makeDb(),
        auth: makeAuth({ permissions: [] })
      }),
      "/api/v2/projects/project-1/config-sets/cs-1/revisions"
    );
    expect(response.status).toBe(403);
    expect(topologyService.listConfigRevisions).not.toHaveBeenCalled();
  });

  it("GET /api/v2/identity-mapping-tasks lets viewers list open tasks", async () => {
    vi.mocked(topologyService.listIdentityMappingTasks).mockResolvedValue({
      items: [
        {
          id: "map-1",
          projectId: "project-1",
          configRevisionId: "rev-1",
          status: "open",
          candidateLogicalNodeIds: ["ln-a", "ln-b"]
        }
      ]
    });

    const response = await requestJson(makeServer({ db: makeDb() }), "/api/v2/identity-mapping-tasks?projectId=project-1");
    expect(response.status).toBe(200);
  });

  it("POST /api/v2/identity-mapping-tasks/:taskId/resolve is retired for viewers", async () => {
    const db = makeDb();
    const response = await requestJson(makeServer({ db, auth: makeAuth() }), "/api/v2/identity-mapping-tasks/map-1/resolve", {
      method: "POST",
      body: JSON.stringify({ decision: "resolved", selectedLogicalNodeId: "ln-a", reason: "Same board instance" })
    });
    expect(response.status).toBe(410);
    expect(response.body.error.details).toMatchObject({ reason: "legacy-surface-retired", successor: "/parameter-admin/specs?review=open" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("POST /api/v2/identity-mapping-tasks/:taskId/resolve is retired for admins", async () => {
    const db = makeDb();
    const response = await requestJson(
      makeServer({ db, auth: makeAdminAuth() }),
      "/api/v2/identity-mapping-tasks/map-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({ decision: "resolved", selectedLogicalNodeId: "ln-a", reason: "Same board instance" })
      }
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("link")).toBe('</parameter-admin/specs?review=open>; rel="successor-version"');
    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("POST /api/v2/identity-mapping-tasks/:taskId/reopen preserves completed history", async () => {
    const db = makeDb();
    const response = await requestJson(
      makeServer({ db, auth: makeAdminAuth() }),
      "/api/v2/identity-mapping-tasks/map-1/reopen",
      {
        method: "POST",
        body: JSON.stringify({ reason: "Review new continuity evidence" })
      }
    );

    expect(response.status).toBe(410);
    expect(response.body.error.details).toMatchObject({ reason: "legacy-surface-retired", successor: "/parameter-admin/specs?review=open" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("POST /api/v2/projects/:projectId/config-revisions/:revisionId/validate requires admin", async () => {
    const viewer = await requestJson(
      makeServer({ db: makeDb(), auth: makeAuth() }),
      "/api/v2/projects/project-1/config-revisions/rev-1/validate",
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(viewer.status).toBe(403);

    vi.mocked(topologyService.validateConfigRevision).mockResolvedValue({
      id: "run-1",
      status: "passed",
      stage: "toolchain",
      artifactHashes: { effectiveDtb: "abc" }
    });

    const admin = await requestJson(
      makeServer({ db: makeDb(), auth: makeAdminAuth() }),
      "/api/v2/projects/project-1/config-revisions/rev-1/validate",
      { method: "POST", body: JSON.stringify({}) }
    );
    expect(admin.status).toBe(200);
    expect(topologyService.validateConfigRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      expect.objectContaining({ projectId: "project-1", revisionId: "rev-1" }),
      expect.objectContaining({ requestId: "test-request" }),
      expect.objectContaining({ objectStore: undefined })
    );
  });

  it("POST /api/v2/projects/:projectId/node-enablement-drafts creates enablement draft for editors", async () => {
    vi.mocked(topologyService.createNodeEnablementDraft).mockResolvedValue({
      draftId: "draft-en-1",
      candidateRevisionId: "rev-candidate",
      workingCandidateRevisionId: "rev-candidate",
      rebasedDraftIds: [],
      rawText: '"disabled"',
      action: "set",
      logicalNodeId: "node-1",
      target: "force-disabled",
      previousRaw: null,
      writeTarget: { role: "overlay", propertyKey: "status", targetRef: "charging_core" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts"
    });

    const response = await requestJson(
      makeServer({ db: makeDb(), auth: makeEditorAuth() }),
      "/api/v2/projects/project-1/node-enablement-drafts?actorType=agent&initiator=system",
      {
        method: "POST",
        headers: { "x-wiseeff-actor-type": "agent" },
        body: JSON.stringify({
          logicalNodeId: "node-1",
          baseRevisionId: "rev-1",
          target: "force-disabled",
          reason: "Board power rail offline",
          actorType: "agent",
          provenance: { initiator: "system" }
        })
      }
    );

    expect(response.status).toBe(201);
    expect(response.body?.item).toMatchObject({
      draftId: "draft-en-1",
      logicalNodeId: "node-1",
      rawText: '"disabled"',
      target: "force-disabled"
    });
    expect(topologyService.createNodeEnablementDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permissions: expect.arrayContaining(["parameter:edit"]) }),
      expect.objectContaining({
        projectId: "project-1",
        logicalNodeId: "node-1",
        baseRevisionId: "rev-1",
        target: "force-disabled",
        reason: "Board power rail offline"
      }),
      expect.objectContaining({ objectStore: undefined }),
      expect.objectContaining({
        invocation: expect.objectContaining({ initiator: "user" }),
        requestId: expect.any(String),
        refusalSink: testRefusalAuditSink
      })
    );
  });

  it("property-key prepare stays retired despite client actor spoofing", async () => {
    const db = makeDb();
    const response = await requestJson(
      makeServer({ db, auth: makeAdminAuth() }),
      "/api/v2/parameter-specs/spec-1/property-key-cutover/prepare?actorType=agent",
      {
        method: "POST",
        headers: { "x-wiseeff-initiator": "system" },
        body: JSON.stringify({ reason: "prepare", actorType: "agent", provenance: { initiator: "system" } })
      }
    );
    expect(response.status).toBe(410);
    expect(response.body.error.details).toEqual({
      reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false
    });
    expect(response.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
    expect(db.query).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
