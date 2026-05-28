import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createLogTools } from "./logTools";

describe("agent log tools", () => {
  it("explains root cause with citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "log-1",
            project_id: "aurora",
            status: "failed",
            severity: "high",
            confidence: 0.87,
            conclusion: "Thermal throttling caused charge interruption"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createLogTools({ db }).find((item) => item.name === "log.explainRootCause");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("logs:view");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.summary).toContain("Thermal throttling");
    expect(result?.citations[0]).toEqual(
      expect.objectContaining({ type: "log", id: "log-1", href: "/logs?logId=log-1" })
    );
  });

  it("generates checklist from failed or high-severity logs", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "log-2",
            project_id: "aurora",
            status: "failed",
            severity: "high",
            confidence: 0.76,
            conclusion: "Voltage sag detected during startup"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createLogTools({ db }).find((item) => item.name === "log.generateChecklist");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("logs:view");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.summary).toContain("1");
    expect(result?.data.items).toEqual(expect.arrayContaining([expect.stringContaining("Voltage sag")]));
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "log", id: "log-2" }));
  });
});
