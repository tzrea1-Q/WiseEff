import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createAuditTools } from "./auditTools";

describe("agent audit tools", () => {
  it("summarizes recent audit events with citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "audit-1",
            project_id: "aurora",
            event_type: "parameter.change.submitted",
            actor_user_id: "u-xu-yun",
            created_at: "2026-05-28T01:00:00.000Z"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createAuditTools({ db }).find((item) => item.name === "audit.summarizeRecentEvents");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("admin:access");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.summary).toContain("1");
    expect(result?.data.eventKindCounts).toEqual({ "parameter.change.submitted": 1 });
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "audit", id: "audit-1" }));
  });
});
