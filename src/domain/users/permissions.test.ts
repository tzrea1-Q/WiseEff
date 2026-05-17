import { describe, expect, it } from "vitest";
import {
  comparePlatformRoles,
  getPlatformRole,
  migrateLegacyRoleId,
  platformRoles,
  roleHasPermission
} from "./types";
import type { RoleCapability } from "./types";

type IsReadonlyArray<T> = T extends readonly unknown[] ? (T extends unknown[] ? false : true) : false;

describe("platform user roles", () => {
  it("defines the four approved platform roles in privilege order", () => {
    expect(platformRoles.map((role) => role.id)).toEqual(["guest", "user", "committer", "admin"]);
  });

  it("maps legacy prototype roles into platform roles", () => {
    expect(migrateLegacyRoleId("hardware")).toBe("guest");
    expect(migrateLegacyRoleId("project")).toBe("user");
    expect(migrateLegacyRoleId("parameter-admin")).toBe("committer");
    expect(migrateLegacyRoleId("admin")).toBe("admin");
    expect(migrateLegacyRoleId("unknown-role")).toBe("guest");
    expect(migrateLegacyRoleId("")).toBe("guest");
  });

  it("keeps Guest read-only and Admin fully privileged", () => {
    expect(roleHasPermission("guest", "parameter:view")).toBe(true);
    expect(roleHasPermission("guest", "parameter:edit")).toBe(false);
    expect(roleHasPermission("admin", "users:manage")).toBe(true);
    expect(roleHasPermission("admin", "admin:access")).toBe(true);
  });

  it("orders roles by increasing privilege", () => {
    expect(comparePlatformRoles("guest", "user")).toBeLessThan(0);
    expect(comparePlatformRoles("committer", "user")).toBeGreaterThan(0);
    expect(comparePlatformRoles("admin", "admin")).toBe(0);
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
