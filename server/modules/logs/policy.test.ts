import { describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { requireLogAnalyze, requireLogArchive, requireLogFeedback, requireLogUpload, requireLogView } from "./policy";

function authContext(permissions: BackendPermission[], isActive = true): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Test User",
      email: "test@example.com",
      title: "Engineer",
      isActive
    },
    organization: {
      id: "org-1",
      name: "ChargeLab"
    },
    roles: [],
    permissions
  };
}

function expectForbidden(action: () => void, permission: BackendPermission) {
  expect(action).toThrow(ApiError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      details: { permission }
    });
  }
}

describe("log policy", () => {
  it("allows log view permission even when the user is inactive", () => {
    expect(() => requireLogView(authContext(["logs:view"], false))).not.toThrow();
  });

  it("requires active users for upload, analyze, archive, and feedback", () => {
    expectForbidden(() => requireLogUpload(authContext(["logs:upload"], false)), "logs:upload");
    expectForbidden(() => requireLogAnalyze(authContext(["logs:analyze"], false)), "logs:analyze");
    expectForbidden(() => requireLogArchive(authContext(["logs:archive"], false)), "logs:archive");
    expectForbidden(() => requireLogFeedback(authContext(["logs:feedback"], false)), "logs:feedback");
  });

  it("rejects log upload when permission is missing", () => {
    expectForbidden(() => requireLogUpload(authContext(["logs:view"])), "logs:upload");
  });

  it("requires archive permission for log archive actions", () => {
    expectForbidden(() => requireLogArchive(authContext(["logs:upload"])), "logs:archive");
    expect(() => requireLogArchive(authContext(["logs:archive"]))).not.toThrow();
  });
});
