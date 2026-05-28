import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createParameterTools } from "./parameterTools";

describe("agent parameter tools", () => {
  it("summarizes review queue with citations", async () => {
    const db = {
      query: async <Row,>(text: string) => ({
        rows: text.includes("parameter_change_requests")
          ? [
              {
                id: "change-1",
                project_id: "aurora",
                parameter_id: "p-fast-charge",
                parameter_name: "Fast charge current",
                status: "submitted",
                risk: "High"
              } as Row
            ]
          : [],
        rowCount: 1
      })
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.summarizeReviewQueue");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "change-1" }));
  });

  it("classifies submit change draft as approval required", () => {
    const tool = createParameterTools({ db: { query: async () => ({ rows: [], rowCount: 0 }) } }).find(
      (item) => item.name === "parameter.submitChangeDraft"
    );

    expect(tool?.requiresApproval).toBe(true);
    expect(tool?.permission).toBe("parameter:edit");
  });
});
