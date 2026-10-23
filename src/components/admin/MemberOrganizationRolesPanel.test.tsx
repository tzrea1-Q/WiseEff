import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlatformRoleId, UserAccount } from "@/domain/users/types";
import { MemberOrganizationRolesPanel } from "./MemberOrganizationRolesPanel";

const account: UserAccount = { id: "self", name: "管理员", title: "", roleId: "admin", isActive: true, createdAt: "", lastActive: "" };
const options = (["admin", "platform-admin", "software-user"] as PlatformRoleId[]).map((id) => ({ id, label: id, description: id }));

describe("own organization roles", () => {
  it("allows self succession and leaves the effective administrator check to the server", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (roles: PlatformRoleId[]) => ({ ...account, roles: roles.map((roleId) => ({ projectId: null, roleId })) }));
    render(<MemberOrganizationRolesPanel user={account} isSelf options={options} onSave={onSave} onReload={async () => account} />);
    const admin = screen.getByRole("checkbox", { name: "admin" });
    expect(admin).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "software-user" }));
    await user.click(admin);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认调整" }));
    expect(onSave).toHaveBeenCalledWith(["software-user"], ["admin"]);
    expect(await screen.findByRole("status")).toHaveTextContent("组织角色已保存");
  });

  it("leaves other members' administrator roles editable", () => {
    render(<MemberOrganizationRolesPanel user={account} options={options} onSave={vi.fn()} onReload={async () => account} />);
    expect(screen.getByRole("checkbox", { name: "admin" })).toBeEnabled();
  });
});
