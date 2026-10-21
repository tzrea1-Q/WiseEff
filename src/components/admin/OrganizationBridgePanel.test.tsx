import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { OrganizationBridgePanel } from "./OrganizationBridgePanel";

const bridge = { id: "br-member", ownerUserId: "member", ownerName: "离职成员", machineLabel: "MEMBER-PC", platform: "windows" as const, arch: "amd64", clientVersion: "0.1.1", createdAt: "2026-10-20T00:00:00Z", lastSeenAt: "2026-10-20T01:00:00Z", revokedAt: null, online: true };

it("retries directory loading into its empty state", async () => {
  const actions = { list: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]), revoke: vi.fn() };
  render(<OrganizationBridgePanel enabled actions={actions} />);
  await screen.findByRole("alert"); await userEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("本组织尚无设备代理")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "撤销配对" })).not.toBeInTheDocument();
});

it("confirms a member's bridge, preserves the reason after failure and shows the durable revocation", async () => {
  const actions = { list: vi.fn().mockResolvedValue([bridge]), revoke: vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ ...bridge, revokedAt: "2026-10-20T02:00:00Z", online: false }) };
  render(<OrganizationBridgePanel enabled actions={actions} />);
  expect(await screen.findByText("离职成员")).toBeInTheDocument();
  expect(screen.getByText("在线", { exact: true })).toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "撤销配对" }); trigger.focus(); await userEvent.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", { name: "撤销设备代理配对？" });
  expect(dialog).toHaveTextContent("MEMBER-PC"); expect(dialog).toHaveTextContent("离职成员");
  const reason = within(dialog).getByRole("textbox", { name: "撤销原因" }); await userEvent.type(reason, "成员离职");
  await userEvent.click(within(dialog).getByRole("button", { name: "撤销配对" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("重试"); expect(reason).toHaveValue("成员离职");
  await userEvent.click(within(dialog).getByRole("button", { name: "撤销配对" }));
  expect(await screen.findByText("已撤销", { exact: true })).toBeInTheDocument();
  expect(actions.revoke).toHaveBeenLastCalledWith("br-member", "成员离职");
  expect(screen.queryByRole("button", { name: "撤销配对" })).not.toBeInTheDocument();
});
