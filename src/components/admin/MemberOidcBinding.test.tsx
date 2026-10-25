import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createPrototypeState } from "@/mockData";
import { createTestUserGovernanceActions } from "@/test/harness";
import { MemberDetailsDialog } from "./MemberDetailsDialog";
import { MemberOidcIdentityPanel } from "./MemberOidcIdentityPanel";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

afterEach(cleanup);
it("shows an honest pending target, retains refresh errors and displays only verified login evidence as success", async () => {
  const base = createPrototypeState().users[0]!;
  const user = { ...base, oidcIdentity: { issuer: "https://identity.example", subject: "external-member" },
    oidcTransfer: { targetOrganizationId: "target-org", pendingSince: "2026-10-23T01:00:00Z", verifiedAt: null, status: "pending" as const } };
  const verified = { ...user, oidcTransfer: { ...user.oidcTransfer, status: "verified" as const, verifiedAt: "2026-10-23T02:00:00Z" } };
  const listUsers = vi.fn().mockRejectedValueOnce(new Error("同步状态暂不可用")).mockResolvedValue([verified]);
  const onUpdated = vi.fn();
  const props = { issuer: user.oidcIdentity.issuer, actions: { ...createTestUserGovernanceActions(), listUsers }, onUpdated };
  const view = render(<MemberOidcIdentityPanel user={user} {...props} />);
  expect(screen.getByRole("status", { name: "外部身份同步结果" })).toHaveTextContent("等待身份系统同步");
  expect(screen.getByRole("status", { name: "外部身份同步结果" })).toHaveTextContent("target-org");
  await userEvent.click(screen.getByRole("button", { name: "刷新同步结果" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("同步状态暂不可用");
  expect(onUpdated).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "刷新同步结果" }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(verified));
  view.rerender(<MemberOidcIdentityPanel user={verified} {...props} />);
  expect(screen.getByRole("status", { name: "外部身份同步结果" })).toHaveTextContent("已验证目标组织登录");
  expect(screen.getByRole("status", { name: "外部身份同步结果" }).querySelector("time")).toHaveAttribute("dateTime", "2026-10-23T02:00:00Z");
});
it("edits an existing member's explicit identity with its previous binding, retaining failed input for retry", async () => {
  const state = createPrototypeState(), user = { ...state.users.find((member) => member.id === "u-liu-min")!, oidcIdentity: { issuer: "https://identity.example", subject: "previous-subject" } };
  const setOidcIdentity = vi.fn().mockRejectedValueOnce(new Error("绑定发生冲突，请核对 Subject。")).mockResolvedValue({ ...user, oidcIdentity: { issuer: "https://identity.example", subject: "updated-subject" } });
  const onUpdated = vi.fn();
  render(<MemberDetailsDialog user={user} state={state} actions={{ ...createTestUserGovernanceActions(), setOidcIdentity }} oidcIssuer="https://identity.example"
    roleEditor={<span>组织角色</span>} roleLabel={(role) => role} onUpdated={onUpdated} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("tab", { name: "访问权限" }));
  const form = screen.getByRole("form", { name: "OIDC 身份绑定" });
  expect(within(form).queryByRole("textbox", { name: /邮箱/ })).not.toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Subject"), { target: { value: "updated-subject" } });
  await userEvent.click(within(form).getByRole("button", { name: "保存身份绑定" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("绑定发生冲突");
  expect(within(form).getByLabelText("Subject")).toHaveValue("updated-subject");
  await userEvent.click(within(form).getByRole("button", { name: "保存身份绑定" }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  expect(setOidcIdentity).toHaveBeenLastCalledWith(user.id, { issuer: "https://identity.example", subject: "updated-subject", ...(user.email ? { email: user.email } : {}), expectedIdentity: user.oidcIdentity });
  expect(within(form).getByText(/已绑定/)).toBeVisible();
});

it("shows why an organization administrator cannot redirect a platform administrator identity", async () => {
  const base = createPrototypeState(), state = { ...base,users: base.users.map((user) => user.id === base.currentUserId ? { ...user,roleId: "admin" as const,roles: [{ projectId: null,roleId: "admin" as const }] } : user) };
  const user = { ...base.users.find((member) => member.id !== base.currentUserId)!,roleId: "platform-admin" as const,roles: [{ projectId: null,roleId: "platform-admin" as const }] };
  render(<MemberDetailsDialog user={user} state={state} actions={{ ...createTestUserGovernanceActions(),setOidcIdentity: vi.fn() }} oidcIssuer="https://identity.example"
    roleEditor={<span>组织角色</span>} roleLabel={(role) => role} onUpdated={vi.fn()} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("tab", { name: "访问权限" }));
  const form = screen.getByRole("form",{ name: "OIDC 身份绑定" });
  expect(within(form).getByLabelText("Subject")).toBeDisabled();
  expect(within(form).getByText("只有平台超级管理员可以修改此账号的身份绑定。")).toBeVisible();
});

it("reloads a conflicting binding while preserving the draft and uses the latest binding on retry", async () => {
  const base = createPrototypeState().users[0], issuer = "https://identity.example";
  const user = { ...base, oidcIdentity: { issuer, subject: "original" } };
  const changed = { ...user, oidcIdentity: { issuer, subject: "changed-elsewhere" } };
  const setOidcIdentity = vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "OIDC binding changed; refresh the member before retrying.", {}, "fixture"))
    .mockResolvedValue({ ...user, oidcIdentity: { issuer, subject: "draft-subject" } });
  const actions = { ...createTestUserGovernanceActions(), setOidcIdentity, listUsers: vi.fn(async () => [changed]) };
  render(<MemberOidcIdentityPanel user={user} issuer={issuer} actions={actions} onUpdated={vi.fn()} />);
  await userEvent.clear(screen.getByLabelText("Subject")); await userEvent.type(screen.getByLabelText("Subject"), "draft-subject");
  await userEvent.click(screen.getByRole("button", { name: "保存身份绑定" }));
  await userEvent.click(await screen.findByRole("button", { name: "重新加载当前绑定" }));
  expect(await screen.findByRole("status")).toHaveTextContent("未保存输入已保留");
  expect(screen.getByLabelText("Subject")).toHaveValue("draft-subject");
  expect(screen.getByText("已绑定：changed-elsewhere")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "保存身份绑定" }));
  expect(setOidcIdentity).toHaveBeenLastCalledWith(user.id, expect.objectContaining({ subject: "draft-subject", expectedIdentity: changed.oidcIdentity }));
});
