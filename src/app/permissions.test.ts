import { describe, expect, it } from "vitest";
import {
  canAccessPage,
  canPerform,
  getAccessibleFallbackPath,
  getDisabledReason,
  getRequiredRoleForAction,
  getRequiredRoleForPage
} from "./permissions";

describe("app permission policy", () => {
  it("allows Guest to view parameter pages and blocks operational pages", () => {
    expect(canAccessPage("guest", "parameter-home")).toBe(true);
    expect(canAccessPage("guest", "parameters")).toBe(true);
    expect(canAccessPage("guest", "parameter-comparison")).toBe(true);
    expect(canAccessPage("guest", "logs")).toBe(false);
    expect(canAccessPage("guest", "debugging")).toBe(false);
    expect(canAccessPage("guest", "parameter-review")).toBe(false);
  });

  it("allows hardware and software User roles to operate but not review or administer", () => {
    for (const roleId of ["hardware-user", "software-user"]) {
      expect(canAccessPage(roleId, "logs")).toBe(true);
      expect(canAccessPage(roleId, "debugging")).toBe(true);
      expect(canAccessPage(roleId, "node-debugging")).toBe(true);
      expect(canAccessPage(roleId, "parameter-review")).toBe(false);
      expect(canAccessPage(roleId, "parameter-admin")).toBe(false);
    }
  });

  it("allows hardware and software Committer roles to review but not access admin backends", () => {
    for (const roleId of ["hardware-committer", "software-committer"]) {
      expect(canAccessPage(roleId, "parameter-review")).toBe(true);
      expect(canAccessPage(roleId, "log-admin")).toBe(false);
      expect(canAccessPage(roleId, "user-permissions")).toBe(false);
    }
  });

  it("allows Admin to access all admin and user management pages", () => {
    expect(canAccessPage("admin", "parameter-admin")).toBe(true);
    expect(canAccessPage("admin", "debugging-admin")).toBe(true);
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("admin", "user-permissions")).toBe(true);
  });

  it("checks key action permissions", () => {
    expect(canPerform("guest", "parameter.edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter.edit")).toBe(true);
    expect(canPerform("software-user", "parameter.edit")).toBe(true);
    expect(canPerform("hardware-user", "parameter.review")).toBe(false);
    expect(canPerform("software-user", "parameter.review")).toBe(false);
    expect(canPerform("hardware-committer", "parameter.review")).toBe(true);
    expect(canPerform("software-committer", "parameter.review")).toBe(true);
    expect(canPerform("admin", "parameter.review")).toBe(true);
    expect(canPerform("admin", "users.manage")).toBe(true);
  });

  it("returns required roles and safe fallback routes", () => {
    expect(getRequiredRoleForPage("log-admin")).toBe("admin");
    expect(getRequiredRoleForAction("parameter.review")).toBe("hardware-committer");
    expect(getAccessibleFallbackPath("guest")).toBe("/parameter-home");
    expect(getAccessibleFallbackPath("admin")).toBe("/parameter-home");
    expect(getDisabledReason("guest", "parameter.edit")).toBe("Requires Hardware User role");
  });
});
