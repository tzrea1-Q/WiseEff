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
  it("admits a current project editor only to that project's configuration, keeping administration restricted", () => {
    const scope={path:"/parameter-admin/projects/project-a/configuration",runtimeMode:"api",permissions:["parameter:view","parameter:edit"],
      projectMemberships:[{projectId:"project-a",roles:["hardware-user"]}]};
    expect(canAccessPage("hardware-user","parameter-admin",scope)).toBe(true);
    expect(canAccessPage("hardware-user","parameter-admin",{...scope,permissions:["parameter:view"]})).toBe(true);
    expect(canAccessPage("guest","parameter-admin",{...scope,path:"/parameter-admin/projects/project-b/configuration",permissions:["parameter:view"],projectMemberships:[],roles:[{projectId:null}]})).toBe(true);
    expect(canAccessPage("guest","parameter-admin",{...scope,path:"/parameter-admin/sources",permissions:["parameter:view"],projectMemberships:[]})).toBe(true);
    for(const changed of [{...scope,path:"/parameter-admin"},{...scope,path:"/parameter-admin/projects/project-b/configuration"},
      {...scope,permissions:[]},{...scope,projectMemberships:[]},{...scope,runtimeMode:"mock"}]) {
      expect(canAccessPage("hardware-user","parameter-admin",changed)).toBe(false);
    }
  });
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
      expect(canAccessPage(roleId, "parameter-admin")).toBe(false);
    }

    expect(canAccessPage("hardware-user", "parameter-review")).toBe(false);
    expect(canAccessPage("software-user", "parameter-review")).toBe(true);
  });

  it("allows hardware and software Committer roles to review but not access admin backends", () => {
    for (const roleId of ["hardware-committer", "software-committer"]) {
      expect(canAccessPage(roleId, "parameter-review")).toBe(true);
      expect(canAccessPage(roleId, "log-admin")).toBe(false);
      expect(canAccessPage(roleId, "user-permissions")).toBe(true);
      expect(canPerform(roleId, "users.manage")).toBe(false);
    }
  });

  it("allows platform-admin to access admin pages", () => {
    expect(canAccessPage("platform-admin", "parameter-admin")).toBe(true);
    expect(canAccessPage("platform-admin", "user-permissions")).toBe(true);
  });

  it("allows Admin to access all admin and user management pages", () => {
    expect(canAccessPage("admin", "parameter-admin")).toBe(true);
    expect(canAccessPage("admin", "debugging-admin")).toBe(true);
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("admin", "user-permissions")).toBe(true);
    expect(canAccessPage("admin", "audit")).toBe(true);
    expect(canAccessPage("hardware-user", "audit")).toBe(false);
  });

  it("checks key action permissions", () => {
    expect(canPerform("guest", "parameter.edit")).toBe(false);
    expect(canPerform("hardware-user", "parameter.edit")).toBe(true);
    expect(canPerform("software-user", "parameter.edit")).toBe(true);
    expect(canPerform("hardware-user", "parameter.review")).toBe(false);
    expect(canPerform("software-user", "parameter.review")).toBe(false);
    expect(canPerform("software-user", "parameter.merge")).toBe(true);
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
    expect(getDisabledReason("guest", "parameter.edit")).toBe("需要硬件开发角色");
  });
});
