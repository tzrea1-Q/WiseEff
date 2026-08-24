import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import type { AuthContext } from "./types";
import { createAgentInvocation, createSystemInvocation, createUserInvocation } from "./trustedInvocation";
import {
  HUMAN_REQUIRED_INVOCATION_CODE,
  requireUserInitiatedInvocation,
  requireUserInitiatedInvocationWithRefusalAudit
} from "./trustedInvocationPolicy";

function auth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [],
    permissions: []
  };
}

describe("trusted invocation policy", () => {
  it("accepts only a trusted user initiator for human-required work", () => {
    expect(() => requireUserInitiatedInvocation(createUserInvocation(auth()))).not.toThrow();
  });

  it.each([
    ["agent", createAgentInvocation(auth(), {
      sessionId: "session-1",
      toolCallId: "tool-call-1",
      approval: { required: true, approvalId: "approval-1" }
    })],
    ["system", createSystemInvocation({ kind: "service", name: "maintenance" })]
  ] as const)("refuses a valid %s initiator with stable 403 evidence", (_initiator, context) => {
    expect(() => requireUserInitiatedInvocation(context)).toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        status: 403,
        details: expect.objectContaining({
          code: HUMAN_REQUIRED_INVOCATION_CODE,
          initiator: context.initiator,
          requireHuman: true
        })
      })
    );
  });

  it("writes trusted refusal evidence before returning a 403", async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      query: async (text: string, values: unknown[] = []) => {
        statements.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    } as unknown as Database;
    const invocation = createAgentInvocation(auth(), {
      sessionId: "session-1",
      toolCallId: "tool-call-1",
      approval: { required: true, approvalId: "approval-1" }
    });

    await expect(
      requireUserInitiatedInvocationWithRefusalAudit(db, {
        invocation,
        projectId: "project-1",
        app: "test",
        kind: "trusted-refusal",
        action: "deny",
        severity: "High",
        targetType: "test",
        targetId: "target-1",
        metadata: {},
        traceId: "request-1"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(expect.arrayContaining(["user-1", "agent"]));
  });
});
