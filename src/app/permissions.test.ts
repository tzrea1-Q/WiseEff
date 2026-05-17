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

  it("allows User to operate but not review or administer", () => {
    expect(canAccessPage("user", "logs")).toBe(true);
    expect(canAccessPage("user", "debugging")).toBe(true);
    expect(canAccessPage("user", "node-debugging")).toBe(true);
    expect(canAccessPage("user", "parameter-review")).toBe(false);
    expect(canAccessPage("user", "parameter-admin")).toBe(false);
  });

  it("allows Committer to review but not access admin backends", () => {
    expect(canAccessPage("committer", "parameter-review")).toBe(true);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("committer", "user-permissions")).toBe(false);
  });

  it("allows Admin to access all admin and user management pages", () => {
    expect(canAccessPage("admin", "parameter-admin")).toBe(true);
    expect(canAccessPage("admin", "debugging-admin")).toBe(true);
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("admin", "user-permissions")).toBe(true);
  });

  it("checks key action permissions", () => {
    expect(canPerform("guest", "parameter.edit")).toBe(false);
    expect(canPerform("user", "parameter.edit")).toBe(true);
    expect(canPerform("user", "parameter.review")).toBe(false);
    expect(canPerform("committer", "parameter.review")).toBe(true);
    expect(canPerform("admin", "users.manage")).toBe(true);
  });

  it("returns required roles and safe fallback routes", () => {
    expect(getRequiredRoleForPage("log-admin")).toBe("admin");
    expect(getRequiredRoleForAction("parameter.review")).toBe("committer");
    expect(getAccessibleFallbackPath("guest")).toBe("/parameter-home");
    expect(getAccessibleFallbackPath("admin")).toBe("/parameter-home");
    expect(getDisabledReason("guest", "parameter.edit")).toBe("Requires User role");
  });
});
