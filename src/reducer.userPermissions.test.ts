import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { createPrototypeState } from "./mockData";

describe("shared user permission reducer actions", () => {
  it("adds a platform user with title and role", () => {
    const state = { ...createPrototypeState(), activeRoleId: "guest" };
    const next = appReducer(state, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user"
    });

    expect(next.users).toHaveLength(state.users.length + 1);
    expect(next.users.at(-1)).toMatchObject({
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user",
      isActive: true
    });
    expect(next.auditEvents[0].kind).toBe("user-add");
  });

  it("lets the current Admin account manage users while the active persona is Guest", () => {
    const state = { ...createPrototypeState(), activeRoleId: "guest" };
    const next = appReducer(state, {
      type: "ADD_USER",
      name: "Admin Principal",
      email: "admin-principal@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user"
    });

    expect(next.users).toHaveLength(state.users.length + 1);
    expect(next.users.at(-1)?.email).toBe("admin-principal@chargelab.cn");
  });

  it("blocks a current Guest account even when the active persona is Admin", () => {
    const state = { ...createPrototypeState(), currentUserId: "u-zhao-heng", activeRoleId: "admin" };
    const next = appReducer(state, {
      type: "ADD_USER",
      name: "Guest Principal",
      email: "guest-principal@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user"
    });

    expect(next).toBe(state);
  });

  it("blocks duplicate or invalid email addresses", () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    const existingEmail = state.users[0].email;
    expect(existingEmail).toBeDefined();

    expect(
      appReducer(state, {
        type: "ADD_USER",
        name: "Duplicate",
        email: existingEmail!,
        title: "Duplicate",
        roleId: "hardware-user"
      })
    ).toBe(state);

    expect(
      appReducer(state, {
        type: "ADD_USER",
        name: "Invalid",
        email: "invalid-email",
        title: "Invalid",
        roleId: "hardware-user"
      })
    ).toBe(state);
  });

  it("prevents the current Admin from disabling themselves", () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    const next = appReducer(state, {
      type: "TOGGLE_USER_ACTIVE",
      userId: state.currentUserId,
      isActive: false
    });

    expect(next).toBe(state);
  });

  it("prevents the current Admin from downgrading themselves", () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "hardware-committer"
    });

    expect(next).toBe(state);
  });

  it("prevents removing the final active Admin", () => {
    const base = createPrototypeState();
    const state = {
      ...base,
      activeRoleId: "admin",
      users: base.users.map((user) =>
        user.id === base.currentUserId
          ? user
          : { ...user, roleId: user.roleId === "admin" ? "hardware-user" : user.roleId }
      )
    };

    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "hardware-committer"
    });

    expect(next).toBe(state);
  });

  it("prevents a current Guest account from assigning user roles", () => {
    const state = { ...createPrototypeState(), currentUserId: "u-zhao-heng", activeRoleId: "admin" };
    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: "u-zhao-heng",
      roleId: "hardware-committer"
    });

    expect(next).toBe(state);
  });

  it("prevents a current Guest account from toggling active users", () => {
    const state = { ...createPrototypeState(), currentUserId: "u-zhao-heng", activeRoleId: "admin" };
    const next = appReducer(state, {
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });

    expect(next).toBe(state);
  });
});
