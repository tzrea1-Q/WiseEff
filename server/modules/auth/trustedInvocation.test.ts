import { describe, expect, it } from "vitest";

import type { AuthContext } from "./types";
import {
  assertTrustedInvocationContext,
  createAgentInvocation,
  createSystemInvocation,
  createUserInvocation,
  trustedAccountableUser,
  trustedExecutionLabel,
  TrustedInvocationContextError
} from "./trustedInvocation";

function auth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view"]
  };
}

describe("trusted invocation context", () => {
  it("constructs a frozen user invocation with the authenticated principal", () => {
    const principal = auth();
    const context = createUserInvocation(principal);

    expect(context).toMatchObject({ initiator: "user", principal });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.principal)).toBe(true);
    expect(assertTrustedInvocationContext(context)).toBe(context);
  });

  it("constructs an Agent invocation with required approval correlation", () => {
    const context = createAgentInvocation(auth(), {
      sessionId: "session-1",
      toolCallId: "tool-call-1",
      approval: { required: true, approvalId: "approval-1" }
    });

    expect(context).toMatchObject({
      initiator: "agent",
      sessionId: "session-1",
      toolCallId: "tool-call-1",
      approvalRequired: true,
      approvalId: "approval-1"
    });
  });

  it("allows an explicitly non-approval Agent invocation without inventing an approval id", () => {
    const context = createAgentInvocation(auth(), {
      sessionId: "session-read",
      toolCallId: "tool-read",
      approval: { required: false }
    });

    expect(context).toMatchObject({
      initiator: "agent",
      approvalRequired: false,
      approvalId: null
    });
  });

  it("constructs a named system invocation without a synthetic principal", () => {
    const context = createSystemInvocation({ kind: "job", name: "nightly-reconciliation" });

    expect(context).toEqual({
      initiator: "system",
      identity: { kind: "job", name: "nightly-reconciliation" }
    });
    expect(context).not.toHaveProperty("principal");
    expect(trustedAccountableUser(context)).toBeNull();
    expect(trustedExecutionLabel(context)).toBe("System job:nightly-reconciliation");
  });

  it("separates an Agent accountable principal from its execution label", () => {
    const context = createAgentInvocation(auth(), {
      sessionId: "session-accountable",
      toolCallId: "tool-accountable",
      approval: { required: false }
    });
    expect(trustedAccountableUser(context)?.id).toBe("user-1");
    expect(trustedExecutionLabel(context)).toBe("Agent tool:tool-accountable (session:session-accountable)");
    expect(trustedExecutionLabel(context)).not.toContain(auth().user.name);
  });

  it("rejects malformed, anonymous, and incomplete provenance", () => {
    expect(() =>
      createAgentInvocation(auth(), {
        sessionId: "session-1",
        toolCallId: "tool-call-1",
        approval: { required: true }
      })
    ).toThrow(TrustedInvocationContextError);

    expect(() => createSystemInvocation({ kind: "service", name: "  " })).toThrow(TrustedInvocationContextError);
    expect(() => createSystemInvocation({ kind: "unknown", name: "worker" })).toThrow(TrustedInvocationContextError);
    expect(() => createUserInvocation({ ...auth(), roles: [{ projectId: null, roleId: "not-a-role" }] } as never)).toThrow(
      TrustedInvocationContextError
    );
    expect(() => createUserInvocation({ ...auth(), permissions: ["not-a-permission"] } as never)).toThrow(
      TrustedInvocationContextError
    );
    expect(() => createUserInvocation({ ...auth(), roles: new Array(1) } as never)).toThrow(
      TrustedInvocationContextError
    );
    expect(() => createUserInvocation({ ...auth(), permissions: new Array(1) } as never)).toThrow(
      TrustedInvocationContextError
    );
    expect(() => assertTrustedInvocationContext({ initiator: "user" })).toThrow(TrustedInvocationContextError);
  });

  it("rejects an invalid authenticated principal before a caller can write domain state", () => {
    const writes: string[] = [];

    expect(() => {
      const context = createUserInvocation({ ...auth(), user: { ...auth().user, organizationId: "other-org" } });
      writes.push(context.initiator);
    }).toThrow(TrustedInvocationContextError);

    expect(writes).toEqual([]);
  });
});
