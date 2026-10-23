import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createAgentInvocationFromUser, createSystemInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "./auditedWrite";
import { buildTrustedAuditEventInput, projectTrustedInvocationForAudit } from "./trustedAudit";

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

const audit = {
  app: "parameter-management",
  kind: "trusted-test",
  action: "write",
  severity: "Medium" as const,
  projectId: "project-1",
  targetType: "parameter",
  targetId: "parameter-1",
  metadata: { source: "test" },
  traceId: "request-1"
};

describe("trusted audit seam", () => {
  it("audits an Agent's authorized target while retaining the real Home actor and approval", () => {
    const principal: AuthContext = { ...auth(), roles: [{ roleId: "platform-admin", projectId: null }], permissions: ["platform:access"] };
    const agent = createAgentInvocationFromUser(createUserInvocation(principal, { id: "org-2", name: "Target" }), {
      sessionId: "target-session", toolCallId: "target-tool", approval: { required: true, approvalId: "target-approval" }
    });
    const input = buildTrustedAuditEventInput({ ...audit, invocation: agent,
      metadata: { actorHomeOrganizationId: "spoofed", operatingOrganizationId: "spoofed", initiator: "user" } });
    expect(input).toMatchObject({ organizationId: "org-2", actorUserId: "user-1", actorType: "agent",
      metadata: { initiator: "agent", sessionId: "target-session", toolCallId: "target-tool", approvalId: "target-approval",
        actorHomeOrganizationId: "org-1", operatingOrganizationId: "org-2" } });
    expect(agent.principal.organization.id).toBe("org-1");
    expect(() => buildTrustedAuditEventInput({ ...audit, invocation: agent, organizationId: "org-3" })).toThrow();
  });

  it("projects user and Agent actor identity from the trusted context", () => {
    const user = projectTrustedInvocationForAudit(createUserInvocation(auth()));
    const agent = projectTrustedInvocationForAudit(
      createAgentInvocation(auth(), {
        sessionId: "session-1",
        toolCallId: "tool-call-1",
        approval: { required: true, approvalId: "approval-1" }
      })
    );

    expect(user).toEqual({
      organizationId: "org-1",
      actorUserId: "user-1",
      actorType: "user",
      metadata: { initiator: "user" }
    });
    expect(agent).toEqual({
      organizationId: "org-1",
      actorUserId: "user-1",
      actorType: "agent",
      metadata: {
        initiator: "agent",
        sessionId: "session-1",
        toolCallId: "tool-call-1",
        approvalId: "approval-1"
      }
    });
  });

  it("projects system identity with a null actor user", () => {
    const projection = projectTrustedInvocationForAudit(
      createSystemInvocation({ kind: "service", name: "nightly-maintenance" })
    );

    expect(projection).toEqual({
      organizationId: null,
      actorUserId: null,
      actorType: "system",
      metadata: {
        initiator: "system",
        systemKind: "service",
        systemName: "nightly-maintenance"
      }
    });
  });

  it("builds a trusted audit input without optional actor or context defaults", () => {
    const input = buildTrustedAuditEventInput({
      ...audit,
      invocation: createSystemInvocation({ kind: "job", name: "retention-sweep" })
    });

    expect(input).toMatchObject({
      organizationId: null,
      actorUserId: null,
      actorType: "system",
      traceId: "request-1",
      metadata: {
        source: "test",
        initiator: "system",
        systemKind: "job",
        systemName: "retention-sweep"
      }
    });
  });

  it("writes a system audit through the platform audit path with a null actor user", async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const tx = {
      query: async (text: string, values: unknown[] = []) => {
        statements.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    };

    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      ...audit,
      invocation: createSystemInvocation({ kind: "service", name: "nightly-maintenance" })
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining([null, "system", expect.stringContaining('"systemName":"nightly-maintenance"')])
    );
  });

  it("rejects malformed provenance before the trusted audit writer can issue a query", async () => {
    const statements: string[] = [];
    const tx = {
      query: async (text: string) => {
        statements.push(text);
        return { rows: [], rowCount: 0 };
      }
    };

    await expect(
      writeTrustedAuditEventInTx(asAuditTx(tx), {
        ...audit,
        invocation: { initiator: "system", identity: { kind: "service", name: "forged" } } as never
      })
    ).rejects.toThrow();
    expect(statements).toEqual([]);
  });
});
