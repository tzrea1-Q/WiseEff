import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createPrototypeState } from "@/mockData";
import { createTestUserGovernanceActions } from "@/test/harness";
import { MemberDetailsDialog } from "./MemberDetailsDialog";

afterEach(cleanup);
it("edits an existing member's explicit identity with its previous binding, retaining failed input for retry", async () => {
  const state = createPrototypeState(), user = { ...state.users.find((member) => member.id === "u-liu-min")!, oidcIdentity: { issuer: "https://identity.example", subject: "previous-subject" } };
  const setOidcIdentity = vi.fn().mockRejectedValueOnce(new Error("绑定发生冲突，请核对 Subject。")).mockResolvedValue({ ...user, oidcIdentity: { issuer: "https://identity.example", subject: "updated-subject" } });
  const onUpdated = vi.fn();
  render(<MemberDetailsDialog user={user} state={state} actions={{ ...createTestUserGovernanceActions(), setOidcIdentity }} oidcIssuer="https://identity.example"
    roleEditor={<span>组织角色</span>} roleLabel={(role) => role} onUpdated={onUpdated} onClose={vi.fn()} />);
  const form = screen.getByRole("form", { name: "OIDC 身份绑定" });
  fireEvent.change(within(form).getByLabelText("Subject"), { target: { value: "updated-subject" } });
  await userEvent.click(within(form).getByRole("button", { name: "保存" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("绑定发生冲突");
  expect(within(form).getByLabelText("Subject")).toHaveValue("updated-subject");
  await userEvent.click(within(form).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  expect(setOidcIdentity).toHaveBeenLastCalledWith(user.id, { issuer: "https://identity.example", subject: "updated-subject", ...(user.email ? { email: user.email } : {}), expectedIdentity: user.oidcIdentity });
  expect(within(form).getByText(/已绑定/)).toBeVisible();
});

it("shows why an organization administrator cannot redirect a platform administrator identity", () => {
  const base = createPrototypeState(), state = { ...base,users: base.users.map((user) => user.id === base.currentUserId ? { ...user,roleId: "admin" as const,roles: [{ projectId: null,roleId: "admin" as const }] } : user) };
  const user = { ...base.users.find((member) => member.id !== base.currentUserId)!,roleId: "platform-admin" as const,roles: [{ projectId: null,roleId: "platform-admin" as const }] };
  render(<MemberDetailsDialog user={user} state={state} actions={{ ...createTestUserGovernanceActions(),setOidcIdentity: vi.fn() }} oidcIssuer="https://identity.example"
    roleEditor={<span>组织角色</span>} roleLabel={(role) => role} onUpdated={vi.fn()} onClose={vi.fn()} />);
  const form = screen.getByRole("form",{ name: "OIDC 身份绑定" });
  expect(within(form).getByLabelText("Subject")).toBeDisabled();
  expect(within(form).getByText("只有平台超级管理员可以修改此账号的身份绑定。")).toBeVisible();
});
