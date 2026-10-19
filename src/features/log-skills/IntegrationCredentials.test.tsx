import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationCredentials } from "./IntegrationCredentials";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import type { IntegrationCredential } from "./types";
import { formatAbsolute } from "@/domain/format/formatDateTime";

afterEach(cleanup);
const skill = mockSkillWorkspace("skill-charging")!;
const credential: IntegrationCredential = { id: "credential-1", organizationId: "org-1", name: "Factory", skillId: skill.id, skillName: skill.name,
  status: "active", createdBy: "user-1", createdAt: "2026-10-19T12:00:00Z", rotatedAt: null, revokedAt: null, lastUsedAt: null };
function setup(items: IntegrationCredential[] = [], options: { canEdit?: boolean; apiMode?: boolean } = {}) {
  const repository = { listIntegrationCredentials: vi.fn().mockResolvedValue(items),
    issueIntegrationCredential: vi.fn().mockResolvedValue({ item: credential, token: "wie_credential-1_one-time-secret" }),
    rotateIntegrationCredential: vi.fn().mockResolvedValue({ item: { ...credential, rotatedAt: "2026-10-19T13:00:00Z" }, token: "wie_credential-1_rotated-secret" }),
    revokeIntegrationCredential: vi.fn().mockResolvedValue({ ...credential, status: "revoked", revokedAt: "2026-10-19T13:00:00Z" }) };
  const onBusyChange = vi.fn();
  render(<IntegrationCredentials skill={skill} repository={repository} apiMode canEdit disabled={false} onBusyChange={onBusyChange} {...options} />);
  return { repository, onBusyChange, user: userEvent.setup() };
}
async function acknowledge(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: "我已安全保存密钥" }));
  await user.click(screen.getByRole("button", { name: "完成" }));
}

describe("integration credentials", () => {
  it("fits four fluid columns, keeps active credentials first and puts binding/creation metadata under the name", async () => {
    const older = { ...credential, id: "older", name: "Older active", createdAt: "2026-10-18T12:00:00Z" };
    const revoked = { ...credential, id: "revoked", name: "Revoked newest", status: "revoked" as const, createdAt: "2026-10-20T12:00:00Z" };
    const newest = { ...credential, name: "A long factory integration credential name", skillId: null, skillName: null, lastUsedAt: credential.createdAt };
    setup([revoked, older, newest, { ...credential, id: "foreign-skill", name: "Other skill", skillId: "other-skill" }]);
    const table = await screen.findByRole("table", { name: "集成凭据列表" });
    expect(table).toHaveClass("table-fixed");
    expect(table.closest(".data-table-scroll--fluid")).not.toBeNull();
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["名称", "状态", "最近使用", "操作"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].querySelector("[title]")?.textContent))
      .toEqual([newest.name, older.name, revoked.name]);
    expect(within(rows[0]).getByTitle(newest.name)).toHaveClass("truncate");
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("未绑定 · 创建于");
    expect(within(rows[0]).getAllByTitle(formatAbsolute(newest.createdAt))[0]).toHaveTextContent("创建于");
    expect(within(rows[0]).getAllByTitle(formatAbsolute(newest.createdAt))[0]).toHaveClass("whitespace-nowrap");
    expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent(`绑定：${skill.name} · 创建于`);
    expect(within(rows[1]).getByText("尚未使用")).toBeVisible();
    expect(within(rows[0]).getByText("有效")).toHaveAttribute("data-slot", "badge");
    expect(within(rows[2]).getByText("已撤销")).toHaveAttribute("data-slot", "badge");
    expect(within(rows[2]).queryByRole("group", { name: `凭据 ${revoked.name}` })).not.toBeInTheDocument();
    expect(within(rows[2]).getAllByRole("cell")[3]).toHaveTextContent("—");
    expect(screen.getByRole("heading", { name: "集成凭据" }).parentElement)
      .toContainElement(screen.getByRole("button", { name: "签发凭据" }));
  });

  it("issues bound by default, requires acknowledgement for every dismiss path and clears the one-time secret", async () => {
    const { user, repository, onBusyChange } = setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(await screen.findByRole("button", { name: "签发凭据" }));
    const dialog = screen.getByRole("dialog", { name: "签发集成凭据" });
    expect(within(dialog).getByRole("checkbox", { name: "绑定到当前技能" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "绑定到当前技能" }).closest("label")).toHaveClass("skill-credential-checkbox");
    expect(within(dialog).getByRole("button", { name: "签发" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("凭据名称"), "Factory");
    await user.click(within(dialog).getByRole("button", { name: "签发" }));
    expect(repository.issueIntegrationCredential).toHaveBeenCalledWith({ name: "Factory", skillId: skill.id });
    const reveal = await screen.findByRole("dialog", { name: "保存集成凭据" });
    expect(reveal).toHaveTextContent("密钥仅显示一次");
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Escape}");
    expect(reveal).toBeVisible();
    await user.click(screen.getByRole("button", { name: "复制密钥" }));
    expect(copy).toHaveBeenCalledWith("wie_credential-1_one-time-secret");
    expect(screen.getByRole("textbox", { name: "集成凭据" }).parentElement).toContainElement(screen.getByRole("button", { name: "复制密钥" }));
    expect(screen.getByRole("status")).toHaveClass("text-xs", "text-muted-foreground");
    expect(screen.getByRole("checkbox", { name: "我已安全保存密钥" }).closest("label")).toHaveClass("skill-credential-checkbox");
    await acknowledge(user);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("wie_credential-1_one-time-secret")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "集成凭据列表" })).toHaveTextContent("Factory");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    copy.mockRestore();
  });

  it("rotates only after confirmation, reveals a fresh secret, and revokes after confirmation", async () => {
    const { user, repository } = setup([credential]);
    await screen.findByText("Factory");
    await user.click(screen.getByRole("button", { name: "凭据 Factory：更多" }));
    await user.click(screen.getByRole("menuitem", { name: "轮换" }));
    expect(repository.rotateIntegrationCredential).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "轮换集成凭据" })).toHaveTextContent("旧密钥立即失效");
    await user.click(screen.getByRole("button", { name: "确认轮换" }));
    expect(await screen.findByDisplayValue("wie_credential-1_rotated-secret")).toBeVisible();
    expect(repository.rotateIntegrationCredential).toHaveBeenCalledWith(credential.id);
    await acknowledge(user);
    await user.click(screen.getByRole("button", { name: "凭据 Factory：更多" }));
    await user.click(screen.getByRole("menuitem", { name: "撤销" }));
    expect(repository.revokeIntegrationCredential).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(screen.getByRole("table")).toHaveTextContent("已撤销"));
    expect(repository.revokeIntegrationCredential).toHaveBeenCalledWith(credential.id);
    expect(screen.queryByRole("button", { name: "凭据 Factory：更多" })).not.toBeInTheDocument();
  });

  it("supports unbound credentials and retry after a failed issue without losing form data", async () => {
    const { user, repository } = setup();
    repository.issueIntegrationCredential.mockRejectedValueOnce(new Error("unavailable"));
    await user.click(await screen.findByRole("button", { name: "签发凭据" }));
    await user.type(screen.getByLabelText("凭据名称"), "Unbound");
    await user.click(screen.getByRole("checkbox", { name: "绑定到当前技能" }));
    await user.click(screen.getByRole("button", { name: "签发" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败");
    expect(screen.getByLabelText("凭据名称")).toHaveValue("Unbound");
    await user.click(screen.getByRole("button", { name: "签发" }));
    expect(repository.issueIntegrationCredential).toHaveBeenLastCalledWith({ name: "Unbound", skillId: null });
    expect(await screen.findByRole("dialog", { name: "保存集成凭据" })).toBeVisible();
  });

  it("does not request credential metadata without administrator access", () => {
    const { repository } = setup([], { canEdit: false });
    expect(repository.listIntegrationCredentials).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "签发凭据" })).not.toBeInTheDocument();
  });
});
