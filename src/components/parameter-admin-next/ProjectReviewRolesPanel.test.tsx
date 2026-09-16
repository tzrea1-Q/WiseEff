import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectReviewRolesPanel } from "./ProjectReviewRolesPanel";
import { createPrototypeState } from "@/mockData";
import type { UserAccount } from "@/domain/users/types";
import type { ProjectWorkflowRoleBindingsDto } from "@/infrastructure/http/userGovernanceClient";

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
    expect(screen.getByText("硬件 MDE 池")).toBeInTheDocument();
    expect(screen.getByText("1 人就绪")).toBeInTheDocument();
    expect(screen.getByText("软件 MDE 池")).toBeInTheDocument();
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
    const saveButton = within(user1Row).getByRole("button", { name: "保存修改" });
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

    const saveButton = within(user1Row).getByRole("button", { name: "保存修改" });
    await userEvent.click(saveButton);

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      expect(screen.getByText(/更新冲突：User One 的角色已被其他管理员修改/)).toBeInTheDocument();
    });

    // Verify it re-fetched bindings to refresh state
    expect(client.getProjectWorkflowRoleBindings).toHaveBeenCalledTimes(2);
  });
});
