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
import { createAgentInvocation, createAgentInvocationFromUser, createUserInvocation, withOperatingOrganization } from "../../auth/trustedInvocation";
import { withAgentInvocation } from "../scope";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPerceptionTools } from "./perceptionTools";
import { createDatabase } from "../../../shared/database/client";
import { getContextQuery } from "../../../../src/workbenchContextQuery";

const fakeDb = createDatabase({ query: async () => ({ rows: [], rowCount: 0 }) });

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

  it("rejects an Agent invocation for a different target before reading organization tools", async () => {
    const auth = makeTestAuthContext({ organizationId: "home-a", userId: "platform-a", roles: [{ roleId: "platform-admin", projectId: null }] });
    const user = withOperatingOrganization(createUserInvocation(auth), { id: "target-b", name: "Target B" });
    const context = { auth: withAgentInvocation(auth, user), invocation: createAgentInvocation(auth, { sessionId: "session-b", toolCallId: "call-b", approval: { required: false } }),
      requestId: "request-b", sessionId: "session-b", toolCallId: "call-b" };
    const registry = createAgentToolRegistry({ db: fakeDb });
    await expect(registry.run("perception.getRecentLogConclusions", context, {})).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
  });
});

describe("createPerceptionTools", () => {
  it("retains the authorized target in parameter citations without changing the actor's Home", async () => {
    const auth = makeTestAuthContext({ organizationId: "home-a", userId: "platform-a", roles: [{ roleId: "platform-admin", projectId: null }] });
    const user = withOperatingOrganization(createUserInvocation(auth), { id: "target-b", name: "Target B" });
    const invocation = createAgentInvocationFromUser(user, { sessionId: "session-b", toolCallId: "call-b", approval: { required: false } });
    mockedReadProjectProtectedParameters.mockResolvedValue([{
      propertyKey: "temperature", revision: { content: { displayName: "温度", description: { kind: "absent" }, documentation: { kind: "absent" },
        unit: { kind: "absent" }, schemaDefault: { kind: "absent" } } },
      pin: { projectId: "project-b", bindingId: "binding-b", definitionId: "def-b", revisionId: "revision-b", payload: { value: "25" } }
    }]);
    const tool = createPerceptionTools({ db: testRoot }).find((entry) => entry.name === "perception.searchParameters")!;
    const result = await tool.run({ auth: withAgentInvocation(auth, user), invocation, requestId: "request-b", sessionId: "session-b", toolCallId: "call-b", projectId: "project-b" }, {});
    expect(result.citations[0].href).toBe("/parameters?project=project-b&bindingId=binding-b&organizationId=target-b");
    expect(invocation.principal.organization.id).toBe("home-a");
  });
  it("links canonical search citations to their protected project scope and binding", async () => {
    mockedReadProjectProtectedParameters.mockResolvedValue([{
      propertyKey: "temperature", revision: { content: { displayName: "温度", description: { kind: "absent" }, documentation: { kind: "absent" }, unit: { kind: "absent" }, schemaDefault: { kind: "absent" } } },
      pin: { bindingId: "binding/&", projectId: "project/&", payload: { value: 35 } }
    }]);
    const tool = createPerceptionTools({ db: testRoot }).find((item) => item.name === "perception.searchParameters")!;
    const result = await tool.run(readOnlyContext as any, { projectId: "p1" });
    expect(result.citations[0]).toMatchObject({ id: "binding/&", href: "/parameters?project=project%2F%26&bindingId=binding%2F%26" });
  });
  it("resolves a cross-project search citation through the real context query consumer", async () => {
    const citedProjectId = "project-B/&?=+# 空间";
    const citedBindingId = "binding-B/&?=+# 空间";
    mockedReadProjectProtectedParameters.mockResolvedValue([{
      propertyKey: "temperature", revision: { content: { displayName: "温度", description: { kind: "absent" }, documentation: { kind: "absent" }, unit: { kind: "absent" }, schemaDefault: { kind: "absent" } } },
      pin: { bindingId: citedBindingId, projectId: citedProjectId, payload: { value: 35 } }
    }]);
    const tool = createPerceptionTools({ db: testRoot }).find((item) => item.name === "perception.searchParameters")!;
    const result = await tool.run(readOnlyContext as any, { projectId: readOnlyContext.projectId });
    const contextQuery = getContextQuery(new URL(result.citations[0].href!, "https://wiseeff.test").search);

    expect(citedProjectId).not.toBe(readOnlyContext.projectId);
    expect(contextQuery.projectId).toBe(citedProjectId);
    expect(contextQuery.bindingId).toBe(citedBindingId);
  });
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

  it.each([
    ["rules-fallback", "provider-unavailable", "降级分析 · 规则回退", "AI 分析服务不可用，本结论由规则引擎回退生成"],
    ["rules-fallback", "token-budget-exhausted", "降级分析 · 规则回退", "预算内未能得到有效接地结论，本结论由规则引擎回退生成"],
    ["rules-fallback", null, "降级分析 · 规则回退", "本结论由规则引擎回退生成"],
    ["agent", "token-budget-exhausted", "降级分析 · 提前收敛", "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"],
    ["agent", "provider-unavailable", "降级分析 · 提前收敛", "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"],
    ["agent", null, null, null],
    [null, null, null, null]
  ] as const)("returns provenance and summarizes the primary conclusion for %s / %s", async (
    analysisSource, degradedReason, label, reason
  ) => {
    const primary = {
      id: "log-primary",
      status: "complete",
      severity: "Critical",
      conclusion: "thermal throttling detected",
      analysis_source: analysisSource,
      degraded_reason: degradedReason
    };
    const secondary = {
      ...primary,
      id: "log-secondary",
      analysis_source: "rules-fallback",
      degraded_reason: "provider-unavailable"
    };
    let capturedSql = "";
    const logDb = {
      query: async <Row,>(text: string) => {
        capturedSql = text;
        return { rows: [primary, secondary] as Row[], rowCount: 2 };
      }
    };
    const tool = createPerceptionTools({ db: logDb }).find((item) => item.name === "perception.getRecentLogConclusions")!;
    const result = await tool.run(adminContext as any, {});

    expect(result.data).toEqual({ logs: [primary, secondary] });
    expect(result.summary).toContain(primary.conclusion);
    if (label) {
      expect(result.summary).toContain(label);
      expect(result.summary).toContain(reason);
    } else {
      expect(result.summary).toBe("Most recent log conclusion: thermal throttling detected");
    }
    expect(capturedSql).toContain("report.analysis_source");
    expect(capturedSql).toContain("report.degraded_reason");
    expect(result.citations.map((citation) => citation.id)).toEqual(["log-primary", "log-secondary"]);
  });
});

describe("perception authz boundary", () => {
  it("rejects perception for a project the user cannot access", async () => {
    const registry = createAgentToolRegistry({ db: fakeDb });
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
