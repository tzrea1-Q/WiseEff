import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import {
  canAdminParameters,
  canEditCriticalParameters,
  canEditParameters,
  canMergeParameters,
  canReviewParameterStage,
  canReviewParameters,
  canViewParameters
} from "./policy";

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "u-xu-yun",
      organizationId: "org-chargelab",
      name: "Xu Yun",
      email: "xu@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-chargelab", name: "ChargeLab" },
    roles: [{ projectId: "aurora", roleId: "hardware-user" }],
    permissions: ["parameter:view"],
    ...overrides
  };
}

describe("parameter policy", () => {
  it("allows view with parameter view permission", () => {
    expect(canViewParameters(auth({ permissions: ["parameter:view"] }))).toBe(true);
    expect(canViewParameters(auth({ permissions: [] }))).toBe(false);
  });

  it("requires active users and matching permissions for edit and review", () => {
    expect(canEditParameters(auth({ permissions: ["parameter:edit"] }))).toBe(true);
    expect(canReviewParameters(auth({ permissions: ["parameter:review"] }))).toBe(true);
    expect(canEditParameters(auth({ permissions: ["parameter:edit"], user: { ...auth().user, isActive: false } }))).toBe(false);
    expect(canReviewParameters(auth({ permissions: [], user: { ...auth().user, isActive: true } }))).toBe(false);
  });

  it("requires active users and parameter:edit-critical for safety-critical writes", () => {
    expect(canEditCriticalParameters(auth({ permissions: ["parameter:edit-critical"] }))).toBe(true);
    expect(canEditCriticalParameters(auth({ permissions: ["parameter:edit"] }))).toBe(false);
    expect(
      canEditCriticalParameters(
        auth({
          permissions: ["parameter:edit-critical"],
          user: { ...auth().user, isActive: false }
        })
      )
    ).toBe(false);
  });

  it("allows merge for active software users and admins", () => {
    expect(canMergeParameters(auth({ roles: [{ projectId: "aurora", roleId: "software-user" }] }), "aurora")).toBe(true);
    expect(canMergeParameters(auth({ roles: [{ projectId: null, roleId: "admin" }] }), "aurora")).toBe(true);
    expect(canMergeParameters(auth({ roles: [{ projectId: "zephyr", roleId: "software-user" }] }), "aurora")).toBe(false);
    expect(canMergeParameters(auth({ roles: [{ projectId: "aurora", roleId: "hardware-committer" }] }), "aurora")).toBe(false);
    expect(canMergeParameters(auth({ roles: [{ projectId: null, roleId: "admin" }], user: { ...auth().user, isActive: false } }))).toBe(
      false
    );
  });

  it("requires project-scoped stage roles for review", () => {
    expect(
      canReviewParameterStage(
        auth({ roles: [{ projectId: "aurora", roleId: "hardware-committer" }], permissions: [] }),
        "aurora",
        "hardware_review"
      )
    ).toBe(true);
    expect(
      canReviewParameterStage(
        auth({ roles: [{ projectId: "aurora", roleId: "software-committer" }], permissions: [] }),
        "aurora",
        "software_review"
      )
    ).toBe(true);
    expect(
      canReviewParameterStage(
        auth({ roles: [{ projectId: "zephyr", roleId: "hardware-committer" }], permissions: ["parameter:review"] }),
        "aurora",
        "hardware_review"
      )
    ).toBe(false);
    expect(
      canReviewParameterStage(
        auth({ roles: [{ projectId: "aurora", roleId: "hardware-committer" }], permissions: ["parameter:review"] }),
        "aurora",
        "software_review"
      )
    ).toBe(false);
    expect(canReviewParameterStage(auth({ roles: [{ projectId: null, roleId: "admin" }] }), "aurora", "submitted")).toBe(
      true
    );
  });

  it("requires active admin access for parameter administration", () => {
    expect(canAdminParameters(auth({ permissions: ["admin:access"] }))).toBe(true);
    expect(canAdminParameters(auth({ permissions: ["admin:access"], user: { ...auth().user, isActive: false } }))).toBe(false);
    expect(canAdminParameters(auth({ permissions: ["parameter:view"] }))).toBe(false);
  });
});
