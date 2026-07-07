import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import {
  requireDebugAdmin,
  requireDebugRead,
  requireDebugRollback,
  requireDebugView,
  requireDebugWrite
} from "./policy";

const baseAuth: AuthContext = {
  user: {
    id: "u-1",
    organizationId: "org-1",
    name: "User",
    email: "user@example.com",
    title: "Engineer",
    isActive: true
  },
  organization: { id: "org-1", name: "Org" },
  roles: [{ projectId: "aurora", roleId: "hardware-user" }],
  permissions: ["parameter:view", "debugging:view", "debugging:read"]
};

describe("debugging policy", () => {
  it("allows view and read permissions", () => {
    expect(() => requireDebugView(baseAuth)).not.toThrow();
    expect(() => requireDebugRead(baseAuth)).not.toThrow();
  });

  it("blocks writes without debugging:write", () => {
    expect(() => requireDebugWrite(baseAuth)).toThrow(/Missing permission: debugging:write\./);
  });

  it("blocks rollback without debugging:rollback", () => {
    expect(() => requireDebugRollback(baseAuth)).toThrow(/Missing permission: debugging:rollback\./);
  });

  it("blocks admin without debugging:admin", () => {
    expect(() => requireDebugAdmin(baseAuth)).toThrow(/Missing permission: debugging:admin\./);
  });

  it("blocks inactive users", () => {
    expect(() =>
      requireDebugRead({
        ...baseAuth,
        user: { ...baseAuth.user, isActive: false }
      })
    ).toThrow(/Missing permission: debugging:read\./);
  });
});
