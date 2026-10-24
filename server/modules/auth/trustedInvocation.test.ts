import { describe, expect, it } from "vitest";

import type { AuthContext } from "./types";
import {
  assertTrustedInvocationContext,
  assertTrustedInvocationMatchesAuth,
  assertTrustedInvocationMatchesScope,
  createAgentInvocation,
  createAgentInvocationFromUser,
  createSystemInvocation,
  createIntegrationInvocation,
  createUserInvocation,
  withOperatingOrganization,
  trustedAccountableUser,
  trustedDomainAttributionFromRow,
  trustedPublicExecutionLabel,
  assertTrustedMutationInvocation,
  TrustedInvocationContextError,
  type AgentInvocationInput,
  type SystemInvocationInput
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
  it("derives a frozen operating Organization while retaining caller provenance, authority and Home organization", () => {
    const principal = { ...auth(), roles: [{ roleId: "platform-admin" as const, projectId: null }], permissions: ["platform:access" as const] };
    const caller = createUserInvocation(principal), target = { id: "org-2", name: "Target" };
    const scoped = withOperatingOrganization(caller, target);
    target.name = "Changed externally";
    expect(scoped.principal).toBe(caller.principal);
    expect(scoped.principal.organization.id).toBe("org-1");
    expect(scoped.operatingOrganization).toEqual({ id: "org-2", name: "Target" });
    expect(Object.isFrozen(scoped)).toBe(true);
    expect(Object.isFrozen(scoped.operatingOrganization)).toBe(true);
    expect(caller.operatingOrganization).toBeUndefined();
    expect(assertTrustedInvocationContext(scoped)).toBe(scoped);
    expect(() => withOperatingOrganization(createUserInvocation(auth()), target)).toThrow(TrustedInvocationContextError);
    expect(() => withOperatingOrganization({ ...caller } as never, target)).toThrow(TrustedInvocationContextError);
    expect(() => withOperatingOrganization(createAgentInvocation(principal, { sessionId: "session", toolCallId: "call", approval: { required: false } }) as never, target)).toThrow(TrustedInvocationContextError);
  });
  it("does not let a scoped audit invocation claim to describe a legacy Home-organization write", () => {
    const principal = { ...auth(), roles: [{ roleId: "platform-admin" as const, projectId: null }], permissions: ["platform:access" as const] };
    const invocation = createUserInvocation(principal, { id: "org-2", name: "Target" });
    expect(() => assertTrustedInvocationMatchesAuth(principal, invocation, "Legacy home write")).toThrow(TrustedInvocationContextError);
  });

  it("matches an explicitly authorized resource organization without changing the real Home actor", () => {
    const principal: AuthContext = { ...auth(), roles: [{ roleId: "platform-admin", projectId: null }], permissions: ["platform:access"] };
    const invocation = withOperatingOrganization(createUserInvocation(principal), { id: "org-2", name: "Target" });
    expect(assertTrustedInvocationMatchesScope(principal, invocation, "org-2", "Scoped knowledge write")).toBe(invocation);
    expect(invocation.principal.user.organizationId).toBe("org-1");
    expect(() => assertTrustedInvocationMatchesAuth(principal, invocation, "Legacy home write")).toThrow(TrustedInvocationContextError);
    for (const organizationId of ["org-1", "org-3"]) {
      expect(() => assertTrustedInvocationMatchesScope(principal, invocation, organizationId, "Wrong resource")).toThrow(TrustedInvocationContextError);
    }
    for (const current of [auth(), { ...principal, user: { ...principal.user, id: "another-user" } },
      { ...principal, user: { ...principal.user, isActive: false } },
      { ...principal, organization: { id: "org-2", name: "Target" }, user: { ...principal.user, organizationId: "org-2" } }]) {
      expect(() => assertTrustedInvocationMatchesScope(current, invocation, "org-2", "Changed actor")).toThrow(TrustedInvocationContextError);
    }
    const home = createUserInvocation(auth());
    expect(assertTrustedInvocationMatchesScope(auth(), home, "org-1", "Home resource")).toBe(home);
    expect(() => assertTrustedInvocationMatchesScope(auth(), home, "org-2", "Foreign ordinary user")).toThrow(TrustedInvocationContextError);
    for (const untrusted of [{ ...invocation }, createSystemInvocation({ kind: "job", name: "indexer" }),
      createIntegrationInvocation("credential", "org-2")]) {
      expect(() => assertTrustedInvocationMatchesScope(principal, untrusted, "org-2", "No human scope")).toThrow(TrustedInvocationContextError);
    }
  });

  it("derives a frozen Agent target only from trusted User provenance and retains strict Home defaults", () => {
    const principal: AuthContext = { ...auth(), roles: [{ roleId: "platform-admin", projectId: null }], permissions: ["platform:access"] };
    const caller = withOperatingOrganization(createUserInvocation(principal), { id: "org-2", name: "Target" });
    const input: AgentInvocationInput = { sessionId: "scope-session", toolCallId: "scope-tool", approval: { required: true, approvalId: "scope-approval" } };
    const agent = createAgentInvocationFromUser(caller, input);
    expect(agent).toMatchObject({ initiator: "agent", principal: { user: { id: "user-1", organizationId: "org-1" }, organization: { id: "org-1" } },
      operatingOrganization: { id: "org-2", name: "Target" }, sessionId: "scope-session", toolCallId: "scope-tool", approvalId: "scope-approval" });
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent.principal.user)).toBe(true);
    expect(Object.isFrozen(agent.operatingOrganization)).toBe(true);
    expect(assertTrustedInvocationContext(agent)).toBe(agent);
    expect(assertTrustedInvocationMatchesScope(principal, agent, "org-2", "Agent resource")).toBe(agent);
    expect(() => assertTrustedInvocationMatchesAuth(principal, agent, "Legacy home write")).toThrow(TrustedInvocationContextError);
    expect(() => assertTrustedInvocationMatchesScope(principal, agent, "org-1", "Wrong Agent resource")).toThrow(TrustedInvocationContextError);
    expect(() => assertTrustedInvocationMatchesScope(auth(), agent, "org-2", "Revoked platform authority")).toThrow(TrustedInvocationContextError);
    const home = createAgentInvocationFromUser(createUserInvocation(auth()), input);
    expect(home.operatingOrganization).toBeUndefined();
    expect(assertTrustedInvocationMatchesAuth(auth(), home, "Legacy home write")).toBe(home);
    const forgedInput = { ...input, operatingOrganization: { id: "org-3", name: "Client target" } };
    expect(createAgentInvocationFromUser(caller, forgedInput).operatingOrganization?.id).toBe("org-2");
    expect(createAgentInvocationFromUser(createUserInvocation(auth()), forgedInput).operatingOrganization).toBeUndefined();
    const read = createAgentInvocationFromUser(caller, { ...input, approval: { required: false } });
    expect(() => assertTrustedMutationInvocation(read, "Scoped write without approval")).toThrow(TrustedInvocationContextError);
    for (const source of [{ ...caller }, auth(), agent, createSystemInvocation({ kind: "service", name: "system" }), createIntegrationInvocation("machine", "org-2")]) {
      expect(() => createAgentInvocationFromUser(source as never, input)).toThrow(TrustedInvocationContextError);
    }
  });

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
      } as unknown as AgentInvocationInput)
    ).toThrow(TrustedInvocationContextError);

    expect(() => createSystemInvocation({ kind: "service", name: "  " })).toThrow(TrustedInvocationContextError);
    expect(() => createSystemInvocation({ kind: "unknown", name: "worker" } as unknown as SystemInvocationInput)).toThrow(TrustedInvocationContextError);
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
