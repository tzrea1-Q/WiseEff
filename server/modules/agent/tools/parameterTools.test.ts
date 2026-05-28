import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createParameterTools } from "./parameterTools";

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function expectProjectScopedOrphanJoin(sql: string) {
  const normalized = normalizeSql(sql);

  expect(normalized).toContain(
    "left join project_parameter_values ppv on ppv.parameter_definition_id = pd.id and ppv.organization_id = pd.organization_id and ($2::text is null or ppv.project_id = $2)"
  );
  expect(normalized).toContain("where pd.organization_id = $1");
  expect(normalized).not.toContain("or ppv.project_id is null");
}

describe("agent parameter tools", () => {
  it("scopes scan orphan project filtering in the left join", async () => {
    let capturedSql = "";
    const db = {
      query: async <Row,>(text: string) => {
        capturedSql = text;
        return { rows: [] as Row[], rowCount: 0 };
      }
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.scanOrphans");

    await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expectProjectScopedOrphanJoin(capturedSql);
  });

  it("scans orphan parameters with citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "param-orphan-1",
            project_id: null,
            name: "Legacy threshold",
            risk: "Medium",
            last_value_at: null,
            usage_count: "0"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.scanOrphans");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("admin:access");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "param-orphan-1" }));
  });

  it("drafts cleanup plan with approval metadata and citations", async () => {
    const db = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "param-cleanup-1",
            project_id: "aurora",
            name: "Unused fast path",
            risk: "Low",
            last_value_at: null,
            usage_count: "0"
          } as Row
        ],
        rowCount: 1
      })
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.draftCleanupPlan");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(tool?.permission).toBe("admin:access");
    expect(tool?.requiresApproval).toBe(true);
    expect(result?.summary).toContain("1");
    expect(result?.summary).toContain("No parameters were deleted");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "param-cleanup-1" }));
  });

  it("scopes cleanup plan project filtering in the left join", async () => {
    let capturedSql = "";
    const db = {
      query: async <Row,>(text: string) => {
        capturedSql = text;
        return { rows: [] as Row[], rowCount: 0 };
      }
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.draftCleanupPlan");

    await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expectProjectScopedOrphanJoin(capturedSql);
  });

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
    expect(tool?.permission).toBe("parameter:review");
    expect(tool?.requiresApproval).toBe(false);
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "change-1" }));
  });

  it("classifies submit change draft as approval required", () => {
    const tool = createParameterTools({ db: { query: async () => ({ rows: [], rowCount: 0 }) } }).find(
      (item) => item.name === "parameter.submitChangeDraft"
    );

    expect(tool?.requiresApproval).toBe(true);
    expect(tool?.permission).toBe("parameter:edit");
  });

  it("prepares submit change draft with summary and citation without writing to the database", async () => {
    let queryCount = 0;
    const db = {
      query: async () => {
        queryCount += 1;
        return { rows: [], rowCount: 0 };
      }
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.submitChangeDraft");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      {
        projectId: "aurora",
        parameterId: "p-fast-charge",
        proposedValue: "18A",
        reason: "Stage for reviewer approval"
      }
    );

    expect(tool?.permission).toBe("parameter:edit");
    expect(tool?.requiresApproval).toBe(true);
    expect(result?.summary).toContain("Prepared");
    expect(result?.summary).toContain("No draft row was created");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "p-fast-charge" }));
    expect(queryCount).toBe(0);
  });
});
