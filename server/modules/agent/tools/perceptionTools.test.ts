import { describe, expect, it, vi } from "vitest";

const testRoot = vi.hoisted(() => ({ query: vi.fn() }));
const mockedReadProjectProtectedParameters = vi.hoisted(() => vi.fn());
const mockedListCanonicalValueChangesForAuth = vi.hoisted(() => vi.fn());

vi.mock("../../../shared/database/client", async () => {
  const actual = await vi.importActual<typeof import("../../../shared/database/client")>(
    "../../../shared/database/client"
  );
  return {
    ...actual,
    isRootDatabase: (value: unknown) => value === testRoot,
    getRootPostgresPool: (value: unknown) => (value === testRoot ? testRoot : undefined)
  };
});

vi.mock("../../parameter-bindings/adapters", () => ({
  readProjectProtectedParameters: mockedReadProjectProtectedParameters
}));

vi.mock("../../parameter-bindings/drafts", () => ({
  listCanonicalValueChangesForAuth: mockedListCanonicalValueChangesForAuth
}));

import { createAgentToolRegistry } from "../toolRegistry";
import { createAgentInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPerceptionTools } from "./perceptionTools";

const fakeDb = { query: async () => ({ rows: [], rowCount: 0 }) };

const overviewRow = { project_id: "p1", parameter_count: 12, open_change_requests: 3 };
const db = {
  query: async <Row,>(_text: string, _values?: unknown[]) =>
    ({ rows: [overviewRow] as Row[], rowCount: 1 }) as { rows: Row[]; rowCount: number | null }
};
const adminContext = {
  auth: {
    organization: { id: "org1" },
    user: { id: "u1", isActive: true },
    permissions: ["parameter:view", "logs:view", "debugging:view"],
    roles: [{ roleId: "admin", projectId: null }]
  },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as const;

const readOnlyAuth = makeTestAuthContext({
  organizationId: "org1",
  userId: "u1",
  roles: [{ roleId: "hardware-user", projectId: "p1" }],
  permissions: ["parameter:view"]
});
const readOnlyInvocation = createAgentInvocation(readOnlyAuth, {
  sessionId: "s1",
  toolCallId: "overview-call",
  approval: { required: false }
});
const readOnlyContext = {
  auth: readOnlyAuth,
  invocation: readOnlyInvocation,
  requestId: "r-overview",
  sessionId: "s1",
  toolCallId: "overview-call",
  projectId: "p1"
};

describe("perception tools registration", () => {
  it("registers read-only perception tools", () => {
    const registry = createAgentToolRegistry({ db: fakeDb });
    const overview = registry.get("perception.getProjectOverview");
    expect(overview?.kind).toBe("read");
    expect(overview?.requiresApproval).toBe(false);
  });
});

describe("createPerceptionTools", () => {
  it("are all read-only", () => {
    for (const tool of createPerceptionTools({ db })) {
      expect(tool.kind).toBe("read");
      expect(tool.requiresApproval).toBe(false);
    }
  });

  it("getProjectOverview refuses an untrusted caller rather than reporting a synthetic zero", async () => {
    const tool = createPerceptionTools({ db }).find((t) => t.name === "perception.getProjectOverview")!;
    await expect(tool.run(adminContext as any, { projectId: "p1" })).rejects.toMatchObject({
      code: "INVALID_TRUSTED_INVOCATION_CONTEXT"
    });
  });

  it("searchParameters refuses latest-version Catalog fallback without an exact pin", async () => {
    const captured: string[] = [];
    const searchDb = {
      query: async <Row,>(text: string, _values?: unknown[]) => {
        captured.push(text);
        return { rows: [] as Row[], rowCount: 0 };
      }
    };
    const tool = createPerceptionTools({ db: searchDb }).find((t) => t.name === "perception.searchParameters")!;
    await expect(tool.run(adminContext as any, { projectId: "aurora", query: "battery_temp_target_c" })).rejects.toMatchObject({
      code: "INVALID_TRUSTED_INVOCATION_CONTEXT"
    });
    expect(captured.join("\n")).not.toMatch(/order by psv2\.version desc/i);
  });

  it("does not execute latest-version Catalog SQL for project overview", async () => {
    const captured: string[] = [];
    const overviewDb = {
      query: async <Row,>(text: string, _values?: unknown[]) => {
        captured.push(text);
        return { rows: [] as Row[], rowCount: 0 };
      }
    };
    const tool = createPerceptionTools({ db: overviewDb }).find((t) => t.name === "perception.getProjectOverview")!;
    await expect(tool.run(adminContext as any, { projectId: "p1" })).rejects.toMatchObject({
      code: "INVALID_TRUSTED_INVOCATION_CONTEXT"
    });
    expect(captured).toEqual([]);
  });

  it("counts pending canonical requests through the scoped read owner without write permission or legacy SQL", async () => {
    mockedReadProjectProtectedParameters.mockResolvedValue([]);
    mockedListCanonicalValueChangesForAuth.mockResolvedValue([{ id: "canonical-request-1" }]);
    testRoot.query.mockClear();

    const tool = createPerceptionTools({ db: testRoot }).find((t) => t.name === "perception.getProjectOverview")!;
    const result = await tool.run(readOnlyContext as any, { projectId: "p1" });

    expect(result.data).toMatchObject({
      project_id: "p1",
      parameter_count: 0,
      open_change_requests: 1,
      pin_status: "canonical-pin"
    });
    expect(result.summary).toContain("1 open change requests");
    expect(mockedListCanonicalValueChangesForAuth).toHaveBeenCalledWith(testRoot, readOnlyAuth, {
      projectId: "p1",
      status: "pending"
    });
    expect(testRoot.query).not.toHaveBeenCalled();
  });

  it("requires a project before a global overview can read canonical requests", async () => {
    testRoot.query.mockClear();
    mockedReadProjectProtectedParameters.mockClear();
    const auth = makeTestAuthContext({
      organizationId: "org1",
      userId: "global-admin",
      roles: [{ roleId: "admin", projectId: null }],
      permissions: ["parameter:view"]
    });
    const invocation = createAgentInvocation(auth, {
      sessionId: "s-global",
      toolCallId: "overview-global-call",
      approval: { required: false }
    });
    const context = {
      auth,
      invocation,
      requestId: "r-global-overview",
      sessionId: "s-global",
      toolCallId: "overview-global-call",
      projectId: undefined
    };
    const tool = createPerceptionTools({ db: testRoot }).find((t) => t.name === "perception.getProjectOverview")!;

    await expect(tool.run(context as any, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(testRoot.query).not.toHaveBeenCalled();
    expect(mockedReadProjectProtectedParameters).toHaveBeenCalledWith(testRoot, {
      invocation,
      projectId: undefined
    });
  });

  it("getNodeSnapshot queries by organization only", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] = [];
    const nodeDb = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        capturedSql = text;
        capturedValues = values ?? [];
        return {
          rows: [
            {
              id: "dp-1",
              name: "battery_temp",
              current_value: "38",
              target_value: "35",
              node_path: "battery/temp",
              protocol: "adb"
            }
          ] as Row[],
          rowCount: 1
        };
      }
    };
    const tool = createPerceptionTools({ db: nodeDb }).find((t) => t.name === "perception.getNodeSnapshot")!;
    const result = await tool.run(adminContext as any, { projectId: "p1" });
    expect(capturedSql).not.toContain("project_id");
    expect(capturedValues).toEqual(["org1"]);
    expect((result.data as { nodes?: unknown[] }).nodes).toHaveLength(1);
  });

  it("getRecentLogConclusions queries by organization only", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] = [];
    const logDb = {
      query: async <Row,>(text: string, values?: unknown[]) => {
        capturedSql = text;
        capturedValues = values ?? [];
        return {
          rows: [
            {
              id: "log-1",
              status: "Failed",
              severity: "high",
              conclusion: "thermal throttling detected"
            }
          ] as Row[],
          rowCount: 1
        };
      }
    };
    const tool = createPerceptionTools({ db: logDb }).find((t) => t.name === "perception.getRecentLogConclusions")!;
    const result = await tool.run(adminContext as any, {});
    expect(capturedSql).not.toContain("project_id");
    expect(capturedValues).toEqual(["org1"]);
    expect(result.summary).toContain("thermal throttling detected");
    expect(result.citations[0]?.type).toBe("log");
  });
});

describe("perception authz boundary", () => {
  it("rejects perception for a project the user cannot access", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const context = {
      auth: {
        organization: { id: "org1" },
        user: { id: "u2", isActive: true },
        permissions: ["parameter:view"],
        roles: [{ roleId: "viewer", projectId: "other" }]
      },
      requestId: "r2",
      sessionId: "s2"
    } as any;
    await expect(registry.run("perception.getProjectOverview", context, { projectId: "p1" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });
});
