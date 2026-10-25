import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountTransferDialog } from "./AccountTransferDialog";

it("requires an impact preview, retains a failed confirmation, and refreshes before retrying", async () => {
  const item = { user: { id: "member", name: "工程师", username: "engineer", isActive: true }, source: { id: "source", name: "源组织" }, target: { id: "target", name: "目标组织" },
    version: "a".repeat(64), supported: true, unavailableReason: null, platformAdministrator: false, oidcIdentity: null, roles: [{ roleId: "software-user", projectId: null }], teams: [], projectMemberships: [], personalAccess: { sessions: 2, pairings: 1, pairingCodes: 0 }, retainedWork: { project: 3, knowledge: 1, feedback: 0 } };
  const client = { listTargets: vi.fn(async () => [{ id: "target", name: "目标组织" }]), preview: vi.fn(async () => item), transfer: vi.fn().mockRejectedValueOnce(new Error("账号已变化")).mockResolvedValue({}) };
  const onTransferred = vi.fn();
  render(<AccountTransferDialog user={{ id: "member", name: "工程师" }} client={client} onClose={vi.fn()} onTransferred={onTransferred} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "目标组织" })).toBeEnabled());
  await userEvent.click(screen.getByRole("combobox", { name: "目标组织" }));
  await userEvent.click(screen.getByRole("option", { name: "目标组织（target）" }));
  expect(screen.queryByRole("button", { name: "确认调动" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "预览影响" }));
  expect(await screen.findByText("项目草稿与待办：3" )).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "确认调动" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("账号已变化");
  expect(screen.queryByRole("button", { name: "确认调动" })).not.toBeInTheDocument();
  expect(client.transfer).toHaveBeenCalledWith("member", { targetOrganizationId: "target", targetRoles: ["guest"], expectedVersion: item.version });
  fireEvent.click(screen.getByRole("button", { name: "预览影响" }));
  expect(await screen.findByRole("button", { name: "确认调动" })).toBeEnabled();
  expect(client.preview).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("button", { name: "确认调动" }));
  expect(onTransferred).toHaveBeenCalledWith(item.target);
});
