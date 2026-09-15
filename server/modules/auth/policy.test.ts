import { describe, expect, it } from "vitest";
import { makeTestAuthContext } from "../../testing/authContext";
import { requireDebugRollback, requireDebugWrite } from "../debugging/policy";
import { baselinePlatformRoles } from "./baselineCatalog";
import { canPerform, compareRoles, permissionsForRoles } from "./policy";
import { BACKEND_PERMISSIONS, BACKEND_ROLE_IDS } from "./types";

describe("auth policy", () => {
  it("orders roles by operational authority", () => {
    expect(compareRoles("guest", "hardware-user")).toBeLessThan(0);
    expect(compareRoles("software-user", "hardware-user")).toBe(0);
    expect(compareRoles("hardware-committer", "software-user")).toBeGreaterThan(0);
    expect(compareRoles("admin", "software-committer")).toBeGreaterThan(0);
    expect(compareRoles("platform-admin", "admin")).toBeGreaterThan(0);
  });

  it("checks action permissions", () => {
    expect(canPerform("guest", "parameter:edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter:edit")).toBe(true);
    expect(canPerform("software-user", "debugging:use")).toBe(true);
    expect(permissionsForRoles(["software-user"])).toEqual(expect.arrayContaining(permissionsForRoles(["hardware-user"])));
    expect(permissionsForRoles(["hardware-committer"])).toEqual(expect.arrayContaining(permissionsForRoles(["hardware-user"])));
    expect(permissionsForRoles(["software-committer"])).toEqual(expect.arrayContaining(permissionsForRoles(["hardware-user"])));
    expect(canPerform("software-user", "parameter:review")).toBe(false);
    expect(canPerform("hardware-committer", "parameter:review")).toBe(true);
    expect(canPerform("admin", "users:manage")).toBe(true);
    expect(canPerform("platform-admin", "platform:access")).toBe(true);
    expect(canPerform("platform-admin", "platform:schema-promote")).toBe(true);
    expect(canPerform("admin", "platform:access")).toBe(false);
    expect(canPerform("admin", "parameter:edit-critical")).toBe(true);
    expect(canPerform("hardware-committer", "parameter:edit-critical")).toBe(true);
    expect(canPerform("software-committer", "parameter:edit-critical")).toBe(true);
    expect(canPerform("hardware-user", "parameter:edit-critical")).toBe(false);
  });

  it("grants M2 log permissions by role", () => {
    expect(permissionsForRoles(["guest"])).toEqual(expect.arrayContaining(["parameter:view", "logs:view"]));
    expect(permissionsForRoles(["hardware-user"])).toEqual(
      expect.arrayContaining(["logs:view", "logs:upload", "logs:feedback"])
    );
    expect(permissionsForRoles(["software-user"])).toEqual(
      expect.arrayContaining(["logs:view", "logs:upload", "logs:feedback"])
    );
    expect(permissionsForRoles(["hardware-committer"])).toEqual(
      expect.arrayContaining(["logs:view", "logs:upload", "logs:feedback"])
    );
    expect(permissionsForRoles(["software-committer"])).toEqual(
      expect.arrayContaining(["logs:view", "logs:upload", "logs:feedback"])
    );
    expect(permissionsForRoles(["admin"])).toEqual(
      expect.arrayContaining(["logs:view", "logs:upload", "logs:feedback", "logs:analyze", "logs:archive"])
    );
  });

  it("grants debugging permissions by role", () => {
    expect(permissionsForRoles(["guest"])).not.toEqual(expect.arrayContaining(["debugging:view", "debugging:read"]));
    expect(permissionsForRoles(["hardware-user"])).toEqual(
      expect.arrayContaining(["debugging:view", "debugging:read"])
    );
    expect(permissionsForRoles(["software-user"])).toEqual(
      expect.arrayContaining(["debugging:view", "debugging:read"])
    );
    expect(permissionsForRoles(["hardware-committer"])).toEqual(
      expect.arrayContaining(["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"])
    );
    expect(permissionsForRoles(["software-committer"])).toEqual(
      expect.arrayContaining(["debugging:view", "debugging:read", "debugging:write", "debugging:rollback"])
    );
    expect(permissionsForRoles(["admin"])).toEqual(
      expect.arrayContaining([
        "debugging:view",
        "debugging:read",
        "debugging:write",
        "debugging:rollback",
        "debugging:admin"
      ])
    );
  });

  it("limits analyze and archive permissions to admin", () => {
    expect(canPerform("guest", "logs:view")).toBe(true);
    expect(canPerform("guest", "logs:upload")).toBe(false);
    expect(canPerform("hardware-user", "logs:upload")).toBe(true);
    expect(canPerform("hardware-user", "logs:feedback")).toBe(true);
    expect(canPerform("hardware-user", "logs:analyze")).toBe(false);
    expect(canPerform("software-committer", "logs:archive")).toBe(false);
    expect(canPerform("admin", "logs:analyze")).toBe(true);
    expect(canPerform("admin", "logs:archive")).toBe(true);
  });

  it.each(["hardware-user", "software-user"] as const)("allows %s node writes and rollback without extra privileges", (roleId) => {
    const auth = makeTestAuthContext({ roleId });
    expect(() => requireDebugWrite(auth)).not.toThrow();
    expect(() => requireDebugRollback(auth)).not.toThrow();
    expect(auth.permissions.filter((permission) => permission.startsWith("debugging:"))).toEqual([
      "debugging:use", "debugging:view", "debugging:read", "debugging:write", "debugging:rollback"
    ]);
    expect(baselinePlatformRoles.find(([id]) => id === roleId)?.[3]).toEqual(auth.permissions);
    for (const permission of ["parameter:edit-critical", "parameter:review", "admin:access", "users:manage"] as const) {
      expect(auth.permissions).not.toContain(permission);
    }
    const inactiveAuth = { ...auth, user: { ...auth.user, isActive: false } };
    expect(() => requireDebugWrite(inactiveAuth)).toThrow(/Missing permission: debugging:write/);
    expect(() => requireDebugRollback(inactiveAuth)).toThrow(/Missing permission: debugging:rollback/);
  });

  it("keeps guest node writes and rollback forbidden", () => {
    const auth = makeTestAuthContext({ roleId: "guest" });
    expect(() => requireDebugWrite(auth)).toThrow(/Missing permission: debugging:write/);
    expect(() => requireDebugRollback(auth)).toThrow(/Missing permission: debugging:rollback/);
  });

  it("grants catalog publication capabilities on Org Admin only", () => {
    const catalogPermissions = ["catalog:author", "catalog:publish", "catalog:review-high-risk"] as const;
    expect(BACKEND_PERMISSIONS).toEqual(expect.arrayContaining([...catalogPermissions]));
    expect(permissionsForRoles(["admin"])).toEqual(expect.arrayContaining([...catalogPermissions]));
    for (const permission of catalogPermissions) {
      expect(canPerform("admin", permission)).toBe(true);
      expect(canPerform("platform-admin", permission)).toBe(false);
    }
    for (const roleId of BACKEND_ROLE_IDS.filter((id) => id !== "admin")) {
      const granted = permissionsForRoles([roleId]);
      expect(granted).not.toEqual(expect.arrayContaining([...catalogPermissions]));
      for (const permission of catalogPermissions) {
        expect(canPerform(roleId, permission)).toBe(false);
      }
    }
  });
});
