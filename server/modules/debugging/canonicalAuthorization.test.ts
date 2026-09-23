import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import {
  canViewCanonicalDebugProject,
  isCanonicalDebugHistoryVisible,
  pinFromOperation,
  projectCanonicalDebugPinForHttp,
  redactCanonicalDebugRecord,
  type CanonicalDebugPin
} from "./canonicalProtectedReference";

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Reviewer",
      title: "Reviewer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ roleId: "software-user", projectId: "project-a" }],
    permissions: ["parameter:view", "debugging:view"],
    ...overrides
  };
}

const pin: CanonicalDebugPin = {
  protectedReferenceKind: "canonical-pin",
  bindingId: "binding-a",
  projectId: "project-a",
  definitionId: "definition-a",
  effectiveRevisionId: "revision-a",
  currentValueId: "value-a",
  sourcePinId: "source-pin-a",
  configRevisionId: "config-revision-a",
  sourcePin: { sourcePinId: "source-pin-a" } as never
};

describe("canonical debugging authorization and HTTP projection", () => {
  it("keeps canonical history project-scoped while allowing organization admins", () => {
    expect(canViewCanonicalDebugProject(auth(), "project-a")).toBe(true);
    expect(canViewCanonicalDebugProject(auth(), "project-b")).toBe(false);
    expect(isCanonicalDebugHistoryVisible(auth(), pin)).toBe(true);
    expect(isCanonicalDebugHistoryVisible(auth(), { ...pin, projectId: "project-b" })).toBe(false);
    expect(isCanonicalDebugHistoryVisible(auth(), { protectedReferenceKind: "typed-block", protectedReferenceReason: "legacy-binding-id" })).toBe(true);
    expect(
      canViewCanonicalDebugProject(
        auth({ roles: [{ roleId: "admin", projectId: null }] }),
        "project-b"
      )
    ).toBe(true);
  });

  it("redacts a same-tenant foreign-project record to a typed block", () => {
    const record = {
      id: "operation-a",
      canonicalBindingId: "binding-a",
      canonicalProjectId: "project-b",
      canonicalBinding: { projectId: "project-b", bindingId: "binding-a" },
      ...pin,
      canonicalPin: pin,
      sourcePin: pin.sourcePin
    };

    const redacted = redactCanonicalDebugRecord(record, "project-scope");

    expect(redacted).toMatchObject({
      id: "operation-a",
      protectedReferenceKind: "typed-block",
      protectedReferenceReason: "project-scope"
    });
    expect(redacted).not.toHaveProperty("canonicalBindingId");
    expect(redacted).not.toHaveProperty("canonicalProjectId");
    expect(redacted).not.toHaveProperty("canonicalBinding");
    expect(redacted).not.toHaveProperty("bindingId");
    expect(redacted).not.toHaveProperty("projectId");
    expect(redacted).not.toHaveProperty("canonicalPin");
    expect(redacted).not.toHaveProperty("sourcePin");
  });

  it("projects only flat canonical IDs to HTTP", () => {
    expect(projectCanonicalDebugPinForHttp(pin)).toEqual({
      protectedReferenceKind: "canonical-pin",
      bindingId: "binding-a",
      projectId: "project-a",
      definitionId: "definition-a",
      effectiveRevisionId: "revision-a",
      currentValueId: "value-a",
      sourcePinId: "source-pin-a",
      configRevisionId: "config-revision-a"
    });
  });

  it("does not expose a canonical operation with a missing or mismatched historical pin", () => {
    for (const canonicalPin of [undefined, { ...pin, projectId: "project-b" }, { ...pin, bindingId: "binding-b" }]) {
      const result = pinFromOperation({ canonicalBindingId: "binding-a", canonicalProjectId: "project-a", canonicalPin });
      expect(result.protectedReferenceKind).toBe("typed-block");
      expect(isCanonicalDebugHistoryVisible(auth(), result)).toBe(false);
    }
    expect(pinFromOperation({ canonicalBindingId: "binding-a", canonicalProjectId: "project-a", canonicalPin: pin })).toEqual(pin);
  });
});
