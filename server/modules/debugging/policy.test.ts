import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import {
  canAccessDebugProject,
  requireDebugAdmin,
  requireDebugProjectAccess,
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

  it("allows project access for an org-wide admin role", () => {
    const auth = {
      ...baseAuth,
      roles: [{ projectId: null, roleId: "admin" as const }]
    };

    expect(canAccessDebugProject(auth, "other-project")).toBe(true);
    expect(() => requireDebugProjectAccess(auth, "other-project")).not.toThrow();
  });

  it("allows project access for an organization-wide user role", () => {
    const auth = {
      ...baseAuth,
      roles: [{ projectId: null, roleId: "software-user" as const }]
    };

    expect(canAccessDebugProject(auth, "aurora")).toBe(true);
    expect(() => requireDebugProjectAccess(auth, "aurora")).not.toThrow();
  });

  it("allows project access for a role on the same project", () => {
    expect(canAccessDebugProject(baseAuth, "aurora")).toBe(true);
    expect(() => requireDebugProjectAccess(baseAuth, "aurora")).not.toThrow();
  });

  it("denies project access for a role on a different project", () => {
    expect(canAccessDebugProject(baseAuth, "zephyr")).toBe(false);
    expect(() => requireDebugProjectAccess(baseAuth, "zephyr")).toThrow(/Debug project access is required\./);
  });
});
