import { describe, expect, it, vi } from "vitest";
import { createActionTools } from "./actionTools";

const insertedId = "cr-1";
const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: insertedId }], rowCount: 1 }) };
const adminContext = {
  auth: { organization: { id: "org1" }, user: { id: "u1" }, roles: [{ roleId: "admin", projectId: null }] },
  requestId: "r1",
  sessionId: "s1",
  projectId: "p1"
} as any;

describe("action.submitParameterChange", () => {
  it("is mutating and approval-gated", () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    expect(tool.kind).toBe("mutating");
    expect(tool.requiresApproval).toBe(true);
  });

  it("submits a parameter change and cites the created record", async () => {
    const tool = createActionTools({ db }).find((t) => t.name === "action.submitParameterChange")!;
    const result = await tool.run(adminContext, {
      projectId: "p1",
      parameterId: "pd1",
      targetValue: "42",
      reason: "charging slow"
    });
    expect(result.citations[0]?.id).toBe(insertedId);
  });
});
