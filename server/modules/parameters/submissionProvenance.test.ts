import { describe, expect, it, vi } from "vitest";

import { makeTestAuthContext } from "../../testing/authContext";
import { TRUSTED_INVOCATION_CONTEXT_ERROR_CODE } from "../auth/trustedInvocation";
import { submitParameterChanges } from "./service";

const auth = makeTestAuthContext({
  userId: "user-provenance",
  organizationId: "org-provenance",
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["parameter:edit", "parameter:edit-critical"]
});

const input = {
  projectId: "project-provenance",
  items: [{ parameterId: "parameter-provenance", targetValue: "<1>", reason: "verify provenance" }]
};

describe("parameter submission trusted provenance", () => {
  it.each([
    ["missing", undefined],
    ["malformed", { requestId: "request-provenance", invocation: { initiator: "user" } }]
  ])("rejects %s context before opening a transaction", async (_label, context) => {
    const db = {
      query: vi.fn(),
      transaction: vi.fn()
    };

    await expect(
      Reflect.apply(submitParameterChanges, undefined, [db, auth, input, context])
    ).rejects.toMatchObject({ code: TRUSTED_INVOCATION_CONTEXT_ERROR_CODE });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});
