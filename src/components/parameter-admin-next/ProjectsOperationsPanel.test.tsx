import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import { ParameterAdminNextPage } from "@/ParameterAdminNextPage";
import { createTestParameterTopologyRepository } from "@/test/harness";
import { createMockParameterModuleRegistryRepository } from "@/infrastructure/mock/mockParameterModuleRegistryRepository";
import * as adminClient from "@/infrastructure/http/parameterAdminClient";

vi.mock("@/components/project-configuration-workbench/ProjectConfigurationWorkbench", () => ({
  ProjectConfigurationWorkbench: () => <p>配置内容已加载</p>
}));
vi.mock("./ProjectReviewRolesPanel", () => ({
  ProjectReviewRolesPanel: ({ projectName, onBack }: { projectName: string; onBack: () => void }) => <>
    <h2>{projectName} 项目审核角色配置</h2><button onClick={onBack}>返回项目列表</button>
  </>
}));
vi.mock("./useRefreshParameterAdminRecentAudits", () => ({ useRefreshParameterAdminRecentAudits: () => vi.fn().mockResolvedValue(undefined) }));

afterEach(() => vi.restoreAllMocks());
const item = { id: "aurora", name: "Aurora 旗舰项目", code: "AUR", status: "initialized", initializationStatus: "initialized",
  moduleCount: 0, parameterCount: 0, openConflictCount: 0, releasedBaselineCount: 0, updatedAt: "2026-10-15T00:00:00Z" };

function setup(path: string, listProjects = vi.fn().mockResolvedValue([item]), updateProject = vi.fn().mockResolvedValue(item)) {
  vi.spyOn(adminClient, "createParameterAdminClient").mockReturnValue({ listProjects, updateProject } as unknown as adminClient.ParameterAdminClient);
  const onNavigate = vi.fn();
  const url = new URL(path, "http://localhost");
  render(<ParameterAdminNextPage area="projects" pathname={url.pathname} search={url.search}
    onNavigate={onNavigate} runtimeMode="api" state={initialState} dispatch={vi.fn()}
    parameterTopologyRepository={createTestParameterTopologyRepository()}
    parameterModuleRegistryRepository={createMockParameterModuleRegistryRepository()} />);
  return { onNavigate };
}

describe("project operations recovery and navigation", () => {
  it.each([["initialized", "归档", "确认归档", "archived"], ["archived", "恢复项目", "恢复项目", "initialized"]])("confirms %s project lifecycle changes through the existing status API", async (status, label, confirmLabel, nextStatus) => {
    const updateProject = vi.fn().mockResolvedValue({ ...item, status: nextStatus });
    setup(`/parameter-admin/projects${status === "archived" ? "?status=archived" : ""}`, vi.fn().mockResolvedValue([{ ...item, status }]), updateProject);
    await screen.findByText(item.name);
    await userEvent.click(screen.getByRole("button", { name: `${item.name}操作：更多` }));
    await userEvent.click(screen.getByRole("menuitem", { name: `${label} ${item.name}` }));
    expect(updateProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("规范历史");
    fireEvent.click(screen.getByRole("button", { name: confirmLabel, exact: true }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith(item.id, { status: nextStatus }));
  });
  it("offers a retry on API failure without falsely reporting a missing project", async () => {
    const listProjects = vi.fn().mockRejectedValueOnce(new Error("Connection unavailable")).mockResolvedValueOnce([item]);
    setup("/parameter-admin/projects/aurora/configuration", listProjects);
    await screen.findByText("项目列表加载失败，请稍后重试。");
    expect(screen.queryByRole("heading", { name: "找不到这个项目" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试项目列表" }));
    await screen.findByText("配置内容已加载");
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("carries the filtered list URL into project navigation", async () => {
    const returnTo = "/parameter-admin/projects?q=Aurora&sort=updated-desc&page=2";
    const { onNavigate } = setup(returnTo);
    await screen.findByText(item.name);
    await userEvent.click(screen.getByRole("button", { name: `配置工作台 ${item.name}` }));
    expect(onNavigate).toHaveBeenCalledWith(`/parameter-admin/projects/aurora/configuration?returnTo=${encodeURIComponent(returnTo)}`);
  });

  it("shows the project name in review roles and returns to the originating list", async () => {
    const returnTo = "/parameter-admin/projects?q=Aurora&page=2";
    const { onNavigate } = setup(`/parameter-admin/projects/aurora/review-roles?returnTo=${encodeURIComponent(returnTo)}`);
    await screen.findByRole("heading", { name: `${item.name} 项目审核角色配置` });
    fireEvent.click(screen.getByRole("button", { name: "返回项目列表" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(returnTo));
  });
});
