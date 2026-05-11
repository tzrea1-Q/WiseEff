import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LogAdminUser } from "@/mockData";
import { AccessControlPanel } from "./AccessControlPanel";

const users: LogAdminUser[] = [
  {
    id: "js",
    name: "Jane Smith",
    title: "Lead Architect",
    role: "Admin",
    avatarInitials: "JS",
    avatarTone: "blue",
    lastActive: "刚刚",
    lastActiveIso: new Date().toISOString()
  },
  {
    id: "mk",
    name: "Mike Kruger",
    title: "Ops Engineer",
    role: "Editor",
    avatarInitials: "MK",
    avatarTone: "teal",
    lastActive: "2 小时前",
    lastActiveIso: new Date().toISOString()
  },
  {
    id: "al",
    name: "Ana Lin",
    title: "Analyst",
    role: "Viewer",
    avatarInitials: "AL",
    avatarTone: "violet",
    lastActive: "昨天",
    lastActiveIso: new Date().toISOString()
  }
];

describe("AccessControlPanel", () => {
  const baseHandlers = {
    onRoleChange: vi.fn(),
    onAddClick: vi.fn(),
    onRemove: vi.fn()
  };

  it("renders all users with name and title", () => {
    render(<AccessControlPanel users={users} canManage {...baseHandlers} />);

    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Lead Architect")).toBeInTheDocument();
    expect(screen.getByText("Mike Kruger")).toBeInTheDocument();
    expect(screen.getByText("Ana Lin")).toBeInTheDocument();
  });

  it("renders role badges", () => {
    render(<AccessControlPanel users={users} canManage {...baseHandlers} />);

    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Editor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Viewer").length).toBeGreaterThan(0);
  });

  it("triggers onAddClick when + button clicked (canManage=true)", async () => {
    const onAddClick = vi.fn();
    render(<AccessControlPanel users={users} canManage onAddClick={onAddClick} onRoleChange={vi.fn()} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /添加/ }));

    expect(onAddClick).toHaveBeenCalledOnce();
  });

  it("disables 添加 button when canManage=false", () => {
    render(<AccessControlPanel users={users} canManage={false} {...baseHandlers} />);

    expect(screen.getByRole("button", { name: /添加/ })).toBeDisabled();
  });

  it("role select triggers onRoleChange (canManage=true)", async () => {
    const onRoleChange = vi.fn();
    render(<AccessControlPanel users={users} canManage onAddClick={vi.fn()} onRoleChange={onRoleChange} onRemove={vi.fn()} />);
    const row = screen.getByText("Mike Kruger").closest("li")!;
    const select = within(row).getByRole("combobox");

    await userEvent.selectOptions(select, "Admin");

    expect(onRoleChange).toHaveBeenCalledWith("mk", "Admin");
  });

  it("role select is disabled when canManage=false", () => {
    render(<AccessControlPanel users={users} canManage={false} {...baseHandlers} />);
    const row = screen.getByText("Mike Kruger").closest("li")!;

    expect(within(row).getByRole("combobox")).toBeDisabled();
  });

  it("renders role legend by default", () => {
    render(<AccessControlPanel users={users} canManage {...baseHandlers} />);

    expect(screen.getByText(/全部管理权限|Admin：/)).toBeInTheDocument();
  });

  it("hides role legend when showRoleLegend=false", () => {
    render(<AccessControlPanel users={users} canManage showRoleLegend={false} {...baseHandlers} />);

    expect(screen.queryByText(/全部管理权限|Admin：/)).not.toBeInTheDocument();
  });

  it("remove button triggers onRemove via row menu", async () => {
    const onRemove = vi.fn();
    render(<AccessControlPanel users={users} canManage onAddClick={vi.fn()} onRoleChange={vi.fn()} onRemove={onRemove} />);
    const row = screen.getByText("Mike Kruger").closest("li")!;
    const removeBtn = within(row).getByRole("button", { name: /移除/ });

    await userEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledWith("mk");
  });
});
