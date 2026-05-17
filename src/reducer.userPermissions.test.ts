import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { createPrototypeState } from "./mockData";

describe("shared user permission reducer actions", () => {
  it("adds a platform user with title and role", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user"
    });

    expect(next.users).toHaveLength(state.users.length + 1);
    expect(next.users.at(-1)).toMatchObject({
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user",
      isActive: true
    });
    expect(next.auditEvents[0].kind).toBe("user-add");
  });

  it("blocks duplicate or invalid email addresses", () => {
    const state = createPrototypeState();

    expect(
      appReducer(state, {
        type: "ADD_USER",
        name: "Duplicate",
        email: state.users[0].email,
        title: "Duplicate",
        roleId: "user"
      })
    ).toBe(state);

    expect(
      appReducer(state, {
        type: "ADD_USER",
        name: "Invalid",
        email: "invalid-email",
        title: "Invalid",
        roleId: "user"
      })
    ).toBe(state);
  });

  it("prevents the current Admin from disabling themselves", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "TOGGLE_USER_ACTIVE",
      userId: state.currentUserId,
      isActive: false
    });

    expect(next).toBe(state);
  });

  it("prevents the current Admin from downgrading themselves", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "committer"
    });

    expect(next).toBe(state);
  });

  it("prevents removing the final active Admin", () => {
    const base = createPrototypeState();
    const state = {
      ...base,
      users: base.users.map((user) =>
        user.id === base.currentUserId
          ? user
          : { ...user, roleId: user.roleId === "admin" ? "user" : user.roleId }
      )
    };

    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "committer"
    });

    expect(next).toBe(state);
  });
});
