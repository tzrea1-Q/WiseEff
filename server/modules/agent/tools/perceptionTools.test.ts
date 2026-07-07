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

  it("searchParameters returns description and explanation for grounding", async () => {
    const searchDb = {
      query: async <Row,>(_text: string, _values?: unknown[]) =>
        ({
          rows: [
            {
              id: "battery-temp-target",
              name: "battery_temp_target_c",
              description: "电池快充过程中的目标温度区间。",
              explanation: "配合散热策略控制电芯温度。",
              module: "Battery Safety",
              default_range: "30 - 42",
              unit: "°C",
              project_id: "aurora",
              current_value: "38",
              recommended_value: "35",
              risk: "Medium"
            }
          ] as Row[],
          rowCount: 1
        }) as { rows: Row[]; rowCount: number | null }
    };
    const tool = createPerceptionTools({ db: searchDb }).find((t) => t.name === "perception.searchParameters")!;
    const result = await tool.run(adminContext as any, { projectId: "aurora", query: "battery_temp_target_c" });
    const parameter = (result.data as { parameters?: Array<Record<string, unknown>> }).parameters?.[0];
    expect(parameter?.description).toBe("电池快充过程中的目标温度区间。");
    expect(parameter?.explanation).toBe("配合散热策略控制电芯温度。");
    expect(parameter?.recommended_value).toBe("35");
    expect(result.citations[0]?.snippet).toContain("电池快充");
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
