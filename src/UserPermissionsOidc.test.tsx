import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UserPermissionsPage, type UserGovernanceActions } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";

afterEach(cleanup);
it("uses configured OIDC provisioning without local passwords, preserving subject and display input after failure", async () => {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const createUser = vi.fn().mockRejectedValueOnce(new Error("Subject is already bound; choose the existing member.")).mockResolvedValue(undefined);
  const actions = { listUsers: async () => state.users, createUser, updateOrganizationRoles: vi.fn(), setUserActive: vi.fn(), deleteUser: vi.fn(),
    getAuthenticationConfig: async () => ({ provider: "oidc", oidcIssuer: "https://controlled-id.example/members", selfRegisterEnabled: false,hasLocalAdmin: true,evaluationOrganizationName: null }) } satisfies UserGovernanceActions;
  render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" userGovernanceActions={actions} userDirectoryStatus="ready" />);
  await userEvent.click(await screen.findByRole("button", { name: "添加用户" }));
  const dialog = screen.getByRole("dialog", { name: "添加用户" });
  expect(within(dialog).queryByLabelText("初始密码")).toBeNull();
  expect(within(dialog).queryByLabelText("用户名")).toBeNull();
  expect(within(dialog).getByLabelText("Issuer")).toHaveValue("https://controlled-id.example/members");
  fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "OIDC member" } });
  fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "external-subject" } });
  await userEvent.click(within(dialog).getByRole("button", { name: "创建用户" }));
  expect(await within(dialog).findByRole("alert")).toBeVisible();
  expect(within(dialog).getByLabelText("Subject")).toHaveValue("external-subject");
  await userEvent.click(within(dialog).getByRole("button", { name: "创建用户" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加用户" })).toBeNull());
  expect(createUser).toHaveBeenLastCalledWith({ authentication: "oidc", issuer: "https://controlled-id.example/members", subject: "external-subject", name: "OIDC member", title: "", roleId: "hardware-user" });
});
