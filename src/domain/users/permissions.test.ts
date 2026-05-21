import { describe, expect, it } from "vitest";
import {
  comparePlatformRoles,
  getPlatformRole,
  getRolesByDiscipline,
  migrateLegacyRoleId,
  platformRoles,
  roleHasPermission
} from "./types";
import type { RoleCapability } from "./types";

type IsReadonlyArray<T> = T extends readonly unknown[] ? (T extends unknown[] ? false : true) : false;

describe("platform user roles", () => {
  it("defines split User and Committer roles in privilege order", () => {
    expect(platformRoles.map((role) => role.id)).toEqual([
      "guest",
      "hardware-user",
      "software-user",
      "hardware-committer",
      "software-committer",
      "admin"
    ]);
  });

  it("maps legacy prototype roles into platform roles", () => {
    expect(migrateLegacyRoleId("hardware")).toBe("hardware-user");
    expect(migrateLegacyRoleId("project")).toBe("software-user");
    expect(migrateLegacyRoleId("user")).toBe("hardware-user");
    expect(migrateLegacyRoleId("committer")).toBe("hardware-committer");
    expect(migrateLegacyRoleId("parameter-admin")).toBe("software-committer");
    expect(migrateLegacyRoleId("admin")).toBe("admin");
    expect(migrateLegacyRoleId("unknown-role")).toBe("guest");
    expect(migrateLegacyRoleId("")).toBe("guest");
  });

  it("keeps Guest read-only and Admin fully privileged", () => {
    expect(roleHasPermission("guest", "parameter:view")).toBe(true);
    expect(roleHasPermission("guest", "parameter:edit")).toBe(false);
    expect(roleHasPermission("hardware-user", "parameter:edit")).toBe(true);
    expect(roleHasPermission("software-user", "parameter:edit")).toBe(true);
    expect(roleHasPermission("hardware-user", "parameter:review")).toBe(false);
    expect(roleHasPermission("software-user", "parameter:review")).toBe(false);
    expect(roleHasPermission("hardware-committer", "parameter:edit")).toBe(true);
    expect(roleHasPermission("software-committer", "parameter:edit")).toBe(true);
    expect(roleHasPermission("hardware-committer", "parameter:review")).toBe(true);
    expect(roleHasPermission("software-committer", "parameter:review")).toBe(true);
    expect(roleHasPermission("admin", "users:manage")).toBe(true);
    expect(roleHasPermission("admin", "admin:access")).toBe(true);
  });

  it("orders roles by increasing privilege", () => {
    expect(comparePlatformRoles("guest", "hardware-user")).toBeLessThan(0);
    expect(comparePlatformRoles("software-user", "hardware-user")).toBe(0);
    expect(comparePlatformRoles("hardware-committer", "software-user")).toBeGreaterThan(0);
    expect(comparePlatformRoles("software-committer", "hardware-committer")).toBe(0);
    expect(comparePlatformRoles("admin", "admin")).toBe(0);
  });

  it("groups active workflow roles by hardware and software discipline", () => {
    expect(getRolesByDiscipline("hardware").map((role) => role.id)).toEqual([
      "hardware-user",
      "hardware-committer"
    ]);
    expect(getRolesByDiscipline("software").map((role) => role.id)).toEqual([
      "software-user",
      "software-committer"
    ]);
  });

  it("returns Guest for unknown role lookups", () => {
    expect(getPlatformRole("not-a-role").id).toBe("guest");
  });

  it("keeps legacy RoleCapability exports available for compatibility", () => {
    const capability: RoleCapability = "manage-permissions";

    expect(capability).toBe("manage-permissions");
  });

  it("exposes readonly role and permission policy definitions", () => {
    const rolesAreReadonly: IsReadonlyArray<typeof platformRoles> = true;
    const permissionsAreReadonly: IsReadonlyArray<(typeof platformRoles)[number]["permissions"]> = true;

    expect(rolesAreReadonly).toBe(true);
    expect(permissionsAreReadonly).toBe(true);
  });
});
