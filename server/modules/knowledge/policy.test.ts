import { describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { canReadEntry, requireKnowledgeEdit, requireKnowledgeGovern, requireKnowledgeManage, requireKnowledgeView } from "./policy";

function makeAuth(permissions: BackendPermission[], overrides: Partial<AuthContext["user"]> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley",
      title: "Engineer",
      isActive: true,
      ...overrides
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

describe("knowledge policy", () => {
  it("requires the matching permission for view/edit/manage", () => {
    expect(() => requireKnowledgeView(makeAuth(["knowledge:view"]))).not.toThrow();
    expect(() => requireKnowledgeView(makeAuth([]))).toThrow(ApiError);
    expect(() => requireKnowledgeEdit(makeAuth(["knowledge:view"]))).toThrow(ApiError);
    expect(() => requireKnowledgeEdit(makeAuth(["knowledge:view", "knowledge:edit"]))).not.toThrow();
    expect(() => requireKnowledgeManage(makeAuth(["knowledge:edit"]))).toThrow(ApiError);
    expect(() => requireKnowledgeManage(makeAuth(["knowledge:manage"]))).not.toThrow();
  });

  it("rejects inactive users even with permissions", () => {
    expect(() => requireKnowledgeView(makeAuth(["knowledge:view"], { isActive: false }))).toThrow(ApiError);
    expect(() => requireKnowledgeEdit(makeAuth(["knowledge:edit"], { isActive: false }))).toThrow(ApiError);
  });

  it("lets edit govern own entries only while manage governs any entry", () => {
    const own = { createdByUserId: "user-1" };
    const foreign = { createdByUserId: "user-2" };

    expect(() => requireKnowledgeGovern(makeAuth(["knowledge:view", "knowledge:edit"]), own)).not.toThrow();
    expect(() => requireKnowledgeGovern(makeAuth(["knowledge:view", "knowledge:edit"]), foreign)).toThrow(ApiError);
    expect(() => requireKnowledgeGovern(makeAuth(["knowledge:manage"]), foreign)).not.toThrow();
  });

  it("restricts draft reads to the owner and managers", () => {
    const draft = { status: "draft" as const, createdByUserId: "user-2" };
    expect(canReadEntry(makeAuth(["knowledge:view"]), draft)).toBe(false);
    expect(canReadEntry(makeAuth(["knowledge:view", "knowledge:manage"]), draft)).toBe(true);
    expect(canReadEntry(makeAuth(["knowledge:view"]), { ...draft, createdByUserId: "user-1" })).toBe(true);
    expect(canReadEntry(makeAuth(["knowledge:view"]), { status: "published", createdByUserId: "user-2" })).toBe(true);
    expect(canReadEntry(makeAuth([]), { status: "published", createdByUserId: "user-2" })).toBe(false);
  });
});
