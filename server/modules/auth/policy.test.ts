import { describe, expect, it } from "vitest";
import { canPerform, compareRoles, permissionsForRoles } from "./policy";

describe("auth policy", () => {
  it("orders roles by operational authority", () => {
    expect(compareRoles("guest", "hardware-user")).toBeLessThan(0);
    expect(compareRoles("software-user", "hardware-user")).toBe(0);
    expect(compareRoles("hardware-committer", "software-user")).toBeGreaterThan(0);
    expect(compareRoles("admin", "software-committer")).toBeGreaterThan(0);
  });

  it("checks action permissions", () => {
    expect(canPerform("guest", "parameter:edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter:edit")).toBe(true);
    expect(canPerform("software-user", "debugging:use")).toBe(true);
    expect(canPerform("software-user", "parameter:review")).toBe(false);
    expect(canPerform("hardware-committer", "parameter:review")).toBe(true);
    expect(canPerform("admin", "users:manage")).toBe(true);
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
});
