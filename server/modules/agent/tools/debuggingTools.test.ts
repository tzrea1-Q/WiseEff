import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createDebuggingTools } from "./debuggingTools";

describe("agent debugging tools", () => {
  it("queries uppercase writable access modes for target value recommendations", async () => {
    let capturedSql = "";
    const db = {
      query: async <Row,>(text: string) => {
        capturedSql = text;
        return {
          rows: [
            {
              id: "debug-param-2",
              project_id: "aurora",
              name: "Precharge voltage",
              current_value: "360",
              target_value: "355",
              status: "pending",
              risk: "High",
              is_writable: true
            } as Row
          ],
          rowCount: 1
        };
      }
    };
    const tool = createDebuggingTools({ db }).find((item) => item.name === "debugging.recommendTargetValues");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(capturedSql).toContain("'WO'");
    expect(capturedSql).toContain("'RW'");
    expect(capturedSql).not.toContain("'rw'");
    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "debugging", id: "debug-param-2" }));
  });

  it("recommends writable pending target values with citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "debug-param-1",
            project_id: "aurora",
            name: "Charge current target",
            current_value: "16",
            target_value: "12",
            status: "pending",
            risk: "high",
            is_writable: true
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createDebuggingTools({ db }).find((item) => item.name === "debugging.recommendTargetValues");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("debugging:view");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "debugging", id: "debug-param-1" }));
  });

  it("prepares rollback plan from latest snapshots with citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "snapshot-1",
            project_id: "aurora",
            parameter_id: "debug-param-1",
            parameter_name: "Charge current target",
            value: "16",
            created_at: "2026-05-28T01:00:00.000Z"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createDebuggingTools({ db }).find((item) => item.name === "debugging.prepareRollback");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("debugging:rollback");
    expect(tool?.requiresApproval).toBe(true);
    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "debugging", id: "snapshot-1" }));
  });
});
