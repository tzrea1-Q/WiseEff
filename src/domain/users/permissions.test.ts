import { describe, expect, it } from "vitest";
import {
  comparePlatformRoles,
  getPlatformRole,
  migrateLegacyRoleId,
  platformRoles,
  roleHasPermission
} from "./types";

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
});
