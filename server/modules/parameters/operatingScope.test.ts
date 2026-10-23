import { describe, expect, it } from "vitest";
import { makeTestAuthContext } from "../../testing/authContext";
import { createAgentInvocationFromUser, createUserInvocation, withOperatingOrganization } from "../auth/trustedInvocation";
import { parameterInvocation, parameterOrganizationId, parameterScopeInvocation, withParameterAccess } from "./operatingScope";

const actor = makeTestAuthContext({ userId: "real-platform", organizationId: "home", roles: [{ roleId: "platform-admin", projectId: null }],
  permissions: ["platform:access", "parameter:view", "parameter:edit", "admin:access"] });
const target = { id: "target", name: "Target" };

describe("explicit parameter resource access", () => {
  it("carries a trusted User or approved Agent target while preserving every real Home identity field", () => {
    const user = withOperatingOrganization(createUserInvocation(actor), target);
    const agent = createAgentInvocationFromUser(user, { sessionId: "session", toolCallId: "tool", approval: { required: true, approvalId: "approval" } });
    for (const invocation of [user, agent]) {
      const access = withParameterAccess(actor, invocation);
      expect(access.user).toEqual(actor.user);
      expect(access.organization).toEqual(actor.organization);
      expect(access.roles).toEqual(actor.roles);
      expect(access.permissions).toEqual(actor.permissions);
      expect(Object.isFrozen(access)).toBe(true);
      expect(parameterInvocation(access)).toBe(invocation);
      expect(parameterOrganizationId(access)).toBe("target");
      expect(parameterScopeInvocation(access, invocation, "parameter read")).toBe(invocation);
    }
    expect(parameterOrganizationId(actor)).toBe("home");
    expect(parameterInvocation(actor)).toBeUndefined();
  });

  it("rejects forged provenance, a revoked live platform grant and a conflicting nested resource target", () => {
    const trusted = withOperatingOrganization(createUserInvocation(actor), target);
    expect(() => withParameterAccess(actor, JSON.parse(JSON.stringify(trusted)) as typeof trusted)).toThrow();
    const revoked = { ...actor, roles: [{ roleId: "admin" as const, projectId: null }], permissions: actor.permissions.filter((permission) => permission !== "platform:access") };
    expect(() => withParameterAccess(revoked, trusted)).toThrow();
    const access = withParameterAccess(actor, trusted);
    const other = withOperatingOrganization(createUserInvocation(actor), { id: "other", name: "Other" });
    expect(() => parameterOrganizationId(access, { invocation: other })).toThrow();
    expect(() => parameterScopeInvocation(actor, trusted, "legacy Home-only read")).toThrow();
  });
});
