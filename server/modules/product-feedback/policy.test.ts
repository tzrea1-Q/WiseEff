import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { requireProductFeedbackAdmin, requireProductFeedbackSubmit } from "./policy";

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: [],
    ...overrides
  };
}

describe("product feedback policy", () => {
  it("allows active users to submit and rejects inactive users", () => {
    expect(() => requireProductFeedbackSubmit(auth())).not.toThrow();

    expect(() =>
      requireProductFeedbackSubmit(
        auth({
          user: {
            ...auth().user,
            isActive: false
          }
        })
      )
    ).toThrow(new ApiError("FORBIDDEN", "Forbidden.", 403, { reason: "inactive" }));
  });

  it("requires active admin access for admin operations", () => {
    expect(() => requireProductFeedbackAdmin(auth({ permissions: ["admin:access"] }))).not.toThrow();

    expect(() => requireProductFeedbackAdmin(auth())).toThrow(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" })
    );
    expect(() =>
      requireProductFeedbackAdmin(
        auth({
          permissions: ["admin:access"],
          user: {
            ...auth().user,
            isActive: false
          }
        })
      )
    ).toThrow(new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" }));
  });
});
