import { describe, expect, it } from "vitest";

import type { AuthContext } from "./types";
import {
  assertTrustedInvocationContext,
  createAgentInvocation,
  createSystemInvocation,
  createUserInvocation,
  trustedAccountableUser,
  trustedDomainAttributionFromRow,
  trustedPublicExecutionLabel,
  assertTrustedMutationInvocation,
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
  });

  it("projects public execution labels without internal correlation", () => {
    const agent = createAgentInvocation(auth(), {
      sessionId: "public-session",
      toolCallId: "public-tool",
      approval: { required: true, approvalId: "public-approval" }
    });
    const system = createSystemInvocation({ kind: "service", name: "private-service-name" });
    expect(trustedPublicExecutionLabel(createUserInvocation(auth()))).toBe("Riley Chen");
    expect(trustedPublicExecutionLabel(agent)).toBe("WiseEff Agent");
    expect(trustedPublicExecutionLabel(system)).toBe("WiseEff System service");
    expect(trustedPublicExecutionLabel(agent)).not.toContain("public-session");
    expect(trustedPublicExecutionLabel(system)).not.toContain("private-service-name");
  });

  it("uses the shared SQL-row projection for durable attribution", () => {
    const systemAttribution = trustedDomainAttributionFromRow(
      {
        initiator_type: "system",
        initiator_system_kind: "job",
        initiator_system_name: "private-job",
        initiator_session_id: null,
        initiator_tool_call_id: null,
        initiator_approval_id: null
      },
      "unrelated-user"
    );
    expect(systemAttribution).toEqual({
      userId: null,
      principalDeleted: false,
      initiatorType: "system",
      systemKind: "job",
      systemName: "private-job",
      sessionId: null,
      toolCallId: null,
      approvalId: null
    });
  });

  it("requires approval correlation at trusted mutation boundaries", () => {
    const readOnlyAgent = createAgentInvocation(auth(), {
      sessionId: "read-session",
      toolCallId: "read-tool",
      approval: { required: false }
    });
    expect(() => assertTrustedMutationInvocation(readOnlyAgent, "parameter write")).toThrow(
      TrustedInvocationContextError
    );
  });

  it("keeps a deleted Agent principal identity-free when the live user FK is gone", () => {
    expect(
      trustedDomainAttributionFromRow(
        {
          initiator_type: "agent",
          initiator_principal_deleted: true,
          initiator_session_id: "session-1",
          initiator_tool_call_id: "tool-1",
          initiator_approval_id: "approval-1",
          initiator_system_kind: null,
          initiator_system_name: null
        },
        null
      )
      ).toMatchObject({ userId: null, initiatorType: "agent", principalDeleted: true });
    expect(
      trustedDomainAttributionFromRow(
        {
          initiator_type: "agent",
          initiator_principal_deleted: true,
          initiator_session_id: "session-1",
          initiator_tool_call_id: "tool-1",
          initiator_approval_id: "approval-1"
        },
        "deleted-user-1"
      ).userId
    ).toBeNull();
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
