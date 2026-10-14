import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectReviewRolesPanel } from "./ProjectReviewRolesPanel";
import { createPrototypeState } from "@/mockData";
import type { UserAccount } from "@/domain/users/types";
import type { ProjectWorkflowRoleBindingsDto } from "@/infrastructure/http/userGovernanceClient";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockUsers: UserAccount[] = [
  {
    id: "u-1",
    name: "User One",
    username: "user.one",
    email: "user1@example.com",
    title: "HW Engineer",
    roleId: "hardware-user",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    lastActive: "today"
  },
  {
    id: "u-2",
    name: "User Two",
    username: "user.two",
    email: "user2@example.com",
    title: "SW Engineer",
    roleId: "software-user",
    isActive: false,
    createdAt: "2026-01-01T00:00:00Z",
    lastActive: "yesterday"
  }
];

const mockBindings: ProjectWorkflowRoleBindingsDto = {
  projectId: "aurora",
  ready: false,
  missingRoles: ["software-committer", "software-user"],
  bindings: [
    {
      userId: "u-1",
      name: "User One",
      username: "user.one",
      email: "user1@example.com",
      title: "HW Engineer",
      isActive: true,
      roles: ["hardware-committer"]
    }
  ]
};

function createMockClient(overrides: Partial<any> = {}) {
  return {
    listUsers: vi.fn(async () => mockUsers),
    getProjectWorkflowRoleBindings: vi.fn(async () => mockBindings),
    updateProjectWorkflowRoleBindings: vi.fn(async () => ({
      item: { projectId: "aurora", userId: "u-1", roles: ["hardware-committer", "software-committer"] }
    })),
    ...overrides
  };
}

describe("ProjectReviewRolesPanel", () => {
  it("preserves the deep-linked member search and confirmed-save locator contract", async () => {
    const client = createMockClient({
      getProjectWorkflowRoleBindings: vi.fn().mockResolvedValueOnce({ ...mockBindings, bindings: [] })
        .mockResolvedValue({ ...mockBindings, missingRoles: ["software-committer", "software-user"] }),
      updateProjectWorkflowRoleBindings: vi.fn(async () => ({
        item: { projectId: "aurora", userId: "u-1", roles: ["hardware-committer"] }
      }))
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    const search = await screen.findByRole("searchbox", { name: "搜索成员" });
    expect(search).toBeVisible();
    expect(screen.getByRole("heading", { name: "aurora 项目审核角色配置" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("审核职责未就绪");
    expect(screen.getByText("硬件 MDE 池")).toBeVisible();
    await userEvent.type(search, "User One");
    expect(screen.queryByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User One 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(screen.getByRole("dialog", { name: "确认更新项目审核角色" })).toBeVisible();
    expect(client.updateProjectWorkflowRoleBindings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByText("1 人就绪")).toBeVisible();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledWith("aurora", "u-1", {
      roles: ["hardware-committer"], expectedRoles: []
    });
    await userEvent.clear(search);
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).toBeVisible();
  });

  it("keeps the unsaved leave guard active while refreshing a conflict", async () => {
    let finishRefresh!: (bindings: ProjectWorkflowRoleBindingsDto) => void;
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      getProjectWorkflowRoleBindings: vi.fn().mockResolvedValueOnce(mockBindings)
        .mockImplementation(() => new Promise<ProjectWorkflowRoleBindingsDto>((resolve) => { finishRefresh = resolve; })),
      updateProjectWorkflowRoleBindings: vi.fn().mockRejectedValue({ details: { code: "role-bindings-stale" } })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(client.getProjectWorkflowRoleBindings).toHaveBeenCalledTimes(2));
    expect(requestSettingsLeave()).toBe(false);
    finishRefresh(mockBindings);
    await screen.findByRole("alert", { name: "保存错误摘要" });
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).toBeChecked();
  });

  it("shows readiness from saved members even when a later member fails to save", async () => {
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      updateProjectWorkflowRoleBindings: vi.fn()
        .mockResolvedValueOnce({ item: { projectId: "aurora", userId: "u-1", roles: ["hardware-committer", "software-committer"] } })
        .mockRejectedValue(new Error("网络中断"))
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await screen.findByRole("alert", { name: "保存错误摘要" });
    expect(screen.getByRole("status")).toHaveTextContent("审核职责已就绪");
    expect(screen.queryByText("审核职责未就绪")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "审核职责候选池" })).getAllByText("1 人就绪")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(screen.getByRole("checkbox", { name: "为 User One 配置 软件 MDE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).not.toBeChecked();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(2);
  });

  it("reports a failed conflict refresh honestly and keeps every unsaved edit", async () => {
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      getProjectWorkflowRoleBindings: vi.fn().mockResolvedValueOnce(mockBindings).mockRejectedValue(new Error("读取失败")),
      updateProjectWorkflowRoleBindings: vi.fn().mockRejectedValue({ details: { code: "role-bindings-stale" } })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    const summary = await screen.findByRole("alert", { name: "保存错误摘要" });
    expect(summary).toHaveTextContent(/更新冲突.*User One/);
    expect(summary).toHaveTextContent("刷新失败");
    expect(summary).toHaveTextContent("读取失败");
    expect(summary).not.toHaveTextContent("已刷新最新数据");
    expect(screen.getByRole("checkbox", { name: "为 User One 配置 软件 MDE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(1);
  });

  it("adopts refreshed roles for unchanged members instead of creating stale pending writes", async () => {
    const peerBinding = { ...mockBindings.bindings[0], userId: "u-2", name: "User Two", roles: ["software-user"] as const };
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      getProjectWorkflowRoleBindings: vi.fn()
        .mockResolvedValueOnce({ ...mockBindings, bindings: [...mockBindings.bindings, peerBinding] })
        .mockResolvedValue({ ...mockBindings, ready: true, missingRoles: [], bindings: [
          ...mockBindings.bindings, { ...peerBinding, roles: ["software-committer"] }
        ] }),
      updateProjectWorkflowRoleBindings: vi.fn().mockRejectedValue({ details: { code: "role-bindings-stale" } })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await screen.findByRole("alert", { name: "保存错误摘要" });
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 软件 MDE" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 软件开发" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "保存", exact: true })).not.toBeInTheDocument();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(1);
  });

  it("keeps other members' pending edits when a stale member is refreshed", async () => {
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      updateProjectWorkflowRoleBindings: vi.fn().mockRejectedValue({ details: { code: "role-bindings-stale" } })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await screen.findByRole("alert", { name: "保存错误摘要" });
    expect(screen.getByRole("checkbox", { name: "为 User One 配置 软件 MDE" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" })).toBeChecked();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(1);
  });

  it("allows withdrawing a pending grant after its member becomes inactive without discarding other drafts", async () => {
    const thirdUser = { ...mockUsers[0], id: "u-3", name: "User Three", username: "user.three" };
    const client = createMockClient({
      listUsers: vi.fn()
        .mockResolvedValueOnce([...mockUsers.map((user) => ({ ...user, isActive: true })), thirdUser])
        .mockResolvedValue([...mockUsers, thirdUser]),
      updateProjectWorkflowRoleBindings: vi.fn().mockRejectedValue({ details: { code: "role-bindings-stale" } })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Three 配置 软件开发" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await screen.findByRole("alert", { name: "保存错误摘要" });
    const pendingGrant = screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" });
    expect(pendingGrant).toBeChecked();
    expect(pendingGrant).toBeEnabled();
    await userEvent.click(pendingGrant);
    expect(pendingGrant).not.toBeChecked();
    expect(pendingGrant).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "为 User Three 配置 软件开发" })).toBeChecked();
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(1);
  });

  it("confirms all changed members and retries only remaining writes after a partial failure", async () => {
    let savedBindings = mockBindings.bindings;
    let failSecondMember = true;
    const client = createMockClient({
      listUsers: vi.fn(async () => mockUsers.map((user) => ({ ...user, isActive: true }))),
      getProjectWorkflowRoleBindings: vi.fn(async () => ({ ...mockBindings, bindings: savedBindings })),
      updateProjectWorkflowRoleBindings: vi.fn(async (_projectId: string, userId: string, input: { roles: any[] }) => {
        if (userId === "u-2" && failSecondMember) { failSecondMember = false; throw new Error("网络中断"); }
        const user = mockUsers.find((item) => item.id === userId)!;
        savedBindings = [...savedBindings.filter((item) => item.userId !== userId), { userId, name: user.name,
          username: user.username, email: user.email, title: user.title, isActive: true, roles: input.roles }];
        return { item: { projectId: "aurora", userId, roles: input.roles } };
      })
    });
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "为 User Two 配置 硬件 MDE" }));
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    const confirmation = screen.getByRole("dialog");
    expect(within(confirmation).getByText("User One")).toBeInTheDocument();
    expect(within(confirmation).getByText("User Two")).toBeInTheDocument();
    await userEvent.click(within(confirmation).getByRole("button", { name: "确认保存" }));
    expect(await screen.findByRole("alert", { name: "保存错误摘要" })).toHaveTextContent("网络中断");
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenNthCalledWith(1, "aurora", "u-1", {
      roles: ["hardware-committer", "software-committer"], expectedRoles: ["hardware-committer"]
    });
    await userEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(within(screen.getByRole("dialog")).queryByText("User One")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存", exact: true })).not.toBeInTheDocument());
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenNthCalledWith(3, "aurora", "u-2", { roles: ["hardware-committer"], expectedRoles: [] });
    expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledTimes(3);
  });

  it("discards all matrix edits without updating project roles", async () => {
    const client = createMockClient();
    render(<ProjectReviewRolesPanel projectId="aurora" onBack={vi.fn()} userGovernanceClient={client as any} />);
    const role = await screen.findByRole("checkbox", { name: "为 User One 配置 软件 MDE" });
    await userEvent.click(role);
    await userEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(role).not.toBeChecked();
    expect(client.updateProjectWorkflowRoleBindings).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("renders candidate pool status and missing roles warning", async () => {
    const client = createMockClient();
    const state = createPrototypeState();
    const onBack = vi.fn();

    render(
      <ProjectReviewRolesPanel
        projectId="aurora"
        onBack={onBack}
        state={state}
        userGovernanceClient={client as any}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("aurora 项目审核角色配置")).toBeInTheDocument();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("审核职责未就绪");
    expect(screen.getByRole("alert")).toHaveTextContent("当前项目缺失以下审核角色");

    // Check candidate pool cards
    const pools = screen.getByRole("group", { name: "审核职责候选池" });
    expect(within(pools).getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("硬件 MDE 池")).toBeInTheDocument();
    expect(screen.getByText("1 人就绪")).toBeInTheDocument();
    expect(screen.getByText("软件 MDE 池")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "组织成员职责授权" })).toBeInTheDocument();
  });

  it("disables new role checkboxes for inactive users", async () => {
    const client = createMockClient();
    const state = createPrototypeState();
    const onBack = vi.fn();

    render(
      <ProjectReviewRolesPanel
        projectId="aurora"
        onBack={onBack}
        state={state}
        userGovernanceClient={client as any}
      />
    );

    const table = await screen.findByRole("table");
    const user2Row = within(table).getByText("User Two").closest("tr")!;
    expect(within(user2Row).getByText("已停用")).toBeInTheDocument();

    // Inactive user has no roles, so all checkboxes must be disabled
    const checkboxes = within(user2Row).getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).toBeDisabled();
    }
  });

  it("modifies roles, confirms change with before/after diff, and updates through client", async () => {
    const client = createMockClient();
    const state = createPrototypeState();
    const onBack = vi.fn();

    render(
      <ProjectReviewRolesPanel
        projectId="aurora"
        onBack={onBack}
        state={state}
        userGovernanceClient={client as any}
      />
    );

    const table = await screen.findByRole("table");
    const user1Row = within(table).getByText("User One").closest("tr")!;
    const swCheckbox = within(user1Row).getByRole("checkbox", { name: "为 User One 配置 软件 MDE" });
    expect(swCheckbox).not.toBeChecked();

    // Check software committer role
    await userEvent.click(swCheckbox);
    expect(swCheckbox).toBeChecked();

    // Save button enabled
    const saveButton = screen.getByRole("button", { name: "保存" });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    // Confirm dialog appears with diff
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/变更前：/)).toBeInTheDocument();
    expect(within(dialog).getByText(/变更后：/)).toBeInTheDocument();

    // Confirm save
    await userEvent.click(within(dialog).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      expect(client.updateProjectWorkflowRoleBindings).toHaveBeenCalledWith("aurora", "u-1", {
        roles: expect.arrayContaining(["hardware-committer", "software-committer"]),
        expectedRoles: ["hardware-committer"]
      });
    });
  });

  it("handles 409 role-bindings-stale conflict by showing error and refreshing data", async () => {
    const errorWithStale = {
      details: { code: "role-bindings-stale" },
      message: "Project workflow roles are stale."
    };
    const client = createMockClient({
      updateProjectWorkflowRoleBindings: vi.fn(async () => {
        throw errorWithStale;
      })
    });
    const state = createPrototypeState();
    const onBack = vi.fn();

    render(
      <ProjectReviewRolesPanel
        projectId="aurora"
        onBack={onBack}
        state={state}
        userGovernanceClient={client as any}
      />
    );

    const table = await screen.findByRole("table");
    const user1Row = within(table).getByText("User One").closest("tr")!;
    const swCheckbox = within(user1Row).getByRole("checkbox", { name: "为 User One 配置 软件 MDE" });
    await userEvent.click(swCheckbox);

    const saveButton = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveButton);

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "保存错误摘要" })).toHaveTextContent(/更新冲突：User One 的角色已被其他管理员修改/);
    });

    // Verify it re-fetched bindings to refresh state
    expect(client.getProjectWorkflowRoleBindings).toHaveBeenCalledTimes(2);
  });
});
