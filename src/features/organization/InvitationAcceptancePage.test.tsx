import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { InvitationAcceptancePage } from "./InvitationAcceptancePage";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });
it("shows the fixed organization and roles, removes the secret from the URL and accepts without a second approval", async () => {
  window.history.replaceState({}, "", "/invite#one-time-token-12345678901234567890");
  const fetchMock = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(String(url).endsWith("preview")
    ? { item: { organizationName: "Target organization", roles: ["software-user"], teams: [{ id: "team", name: "研发团队" }], projects: [{ projectId: "project", name: "电源项目", roles: ["software-committer"] }], status: "pending", expiresAt: "2027-01-01" } }
    : { userId: "invited-user", organizationId: "target" })));
  vi.stubGlobal("fetch", fetchMock);
  render(<InvitationAcceptancePage />);
  expect(await screen.findByText("Target organization", { exact: true })).toBeVisible();
  expect(window.location.hash).toBe("");
  expect(screen.getByText("研发团队", { exact: true })).toBeVisible();
  expect(screen.getByText(/电源项目.*软件MDE/)).toBeVisible();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("姓名", { exact: true }), "New member");
  await user.type(screen.getByLabelText("用户名", { exact: true }), "new-member");
  await user.type(screen.getByLabelText("设置密码", { exact: true }), "member-password");
  await user.click(screen.getByRole("button", { name: "接受邀请并创建账号" }));
  expect(await screen.findByText("账号已创建，可直接登录。", { exact: true })).toBeVisible();
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ token: "one-time-token-12345678901234567890", username: "new-member" });
});

it("reads a replacement fragment in the same tab and removes it before showing the new offer", async () => {
  window.history.replaceState({}, "", "/invite#original-token-12345678901234567890");
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const { token } = JSON.parse(String(init?.body)) as { token: string };
    return new Response(JSON.stringify({ item: { organizationName: token.startsWith("replacement") ? "Replacement organization" : "Original organization", roles: ["software-user"], teams: [], projects: [], status: "pending", expiresAt: "2027-01-01" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<InvitationAcceptancePage />);
  expect(await screen.findByText("Original organization", { exact: true })).toBeVisible();
  window.location.hash = "replacement-token-12345678901234567890";
  expect(await screen.findByText("Replacement organization", { exact: true })).toBeVisible();
  expect(window.location.hash).toBe("");
  expect(screen.queryByText("Original organization", { exact: true })).not.toBeInTheDocument();
});
