import { describe, expect, it } from "vitest";
import {
  agentContextSchema,
  approveAgentApprovalBodySchema,
  createAgentSessionBodySchema,
  rejectAgentApprovalBodySchema,
  runAgentToolCallBodySchema,
  sendAgentMessageBodySchema
} from "./schemas";

describe("agent schemas", () => {
  it("accepts scoped session context", () => {
    const parsed = createAgentSessionBodySchema.parse({
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    expect(parsed.context.projectId).toBe("aurora");
  });

  it("rejects blank messages", () => {
    const parsed = sendAgentMessageBodySchema.safeParse({ message: "   " });

    expect(parsed.success).toBe(false);
  });

  it("normalizes optional tool payload", () => {
    const parsed = runAgentToolCallBodySchema.parse({});

    expect(parsed.payload).toEqual({});
  });

  it("accepts approval and rejection bodies", () => {
    expect(approveAgentApprovalBodySchema.parse({ expectedToolCallStatus: "pending_approval" }).expectedToolCallStatus).toBe("pending_approval");
    expect(rejectAgentApprovalBodySchema.parse({ reason: "Needs clearer evidence" }).reason).toBe("Needs clearer evidence");
  });

  it("requires a valid page key in context", () => {
    const parsed = agentContextSchema.safeParse({ path: "/parameters", pageKey: "" });

    expect(parsed.success).toBe(false);
  });
});
