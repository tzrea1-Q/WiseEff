import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPermissionsPage } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(search = "") {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();

  const utils = render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />);

  return { ...utils, state, dispatch, onNavigate };
}

describe("UserPermissionsPage", () => {
  it("renders user permissions, role names, and platform users", () => {
    renderPage();
    const capabilities = screen.getByLabelText("Role capabilities");

    expect(screen.getByRole("heading", { name: "User permissions" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Guest" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Committer" })).toBeInTheDocument();
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("ignores unrelated URL search params when filtering users", () => {
    renderPage("?foo=bar");

    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("dispatches ADD_USER from the add user dialog", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.selectOptions(screen.getByLabelText("Initial role"), "user");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user"
    });
  });

  it("keeps the add user dialog open when trimmed name or email is empty", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Add user" })).toBeInTheDocument();
    expect(screen.getByText("Name and email are required.")).toBeInTheDocument();
  });

  it("dispatches role and status changes from the user table", async () => {
    const { dispatch } = renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Role for Liu Min" }), "committer");
    await userEvent.click(within(row).getByRole("button", { name: "Disable Liu Min" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ASSIGN_USER_ROLE",
      userId: "u-liu-min",
      roleId: "committer"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });
  });
});
