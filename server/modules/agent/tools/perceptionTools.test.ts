import { describe, expect, it } from "vitest";
import { createAgentToolRegistry } from "../toolRegistry";
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

  it("getProjectOverview returns a grounded summary with citations", async () => {
    const tool = createPerceptionTools({ db }).find((t) => t.name === "perception.getProjectOverview")!;
    const result = await tool.run(adminContext as any, { projectId: "p1" });
    expect(result.summary).toContain("p1");
    expect(result.citations[0]?.type).toBe("parameter");
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
