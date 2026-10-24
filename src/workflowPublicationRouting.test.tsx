import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@/features/agent/XiaozeProvider", () => ({ XiaozeProvider: ({ children }: { children: ReactNode }) => <>{children}</>, XiaozeProactiveInsights: () => null }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: vi.fn() }));
import App from "./App";
import { PageRouter } from "./app/routes";
import { getPageByPath } from "./appConfig";
import { initialState } from "./mockData";
import type { WorkflowPublicationState } from "@/domain/workflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";

const publication: WorkflowPublicationState = { workflows: { "parameter-management": true, debugging: true, "log-analysis": false, knowledge: false }, version: 1 };
function client(): WorkflowPublicationClient {
  return { getPublication: vi.fn().mockResolvedValue(publication), getAdministration: vi.fn().mockResolvedValue({ ...publication, updatedAt: null, updatedBy: null }), updatePublication: vi.fn() };
}
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("workflow publication routing", () => {
  it("hides unpublished discovery and blocks a direct workflow URL", async () => {
    window.history.replaceState(null, "", "/knowledge");
    render(<App initialAppState={{ ...initialState, activeRoleId: "hardware-user" }} runtimeMode="mock" workflowPublicationClient={client()} />);
    expect(await screen.findByRole("heading", { name: "暂未开放" })).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "主导航侧边栏" });
    expect(within(sidebar).queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "智能分析" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(await screen.findByRole("main", { name: "雷泽首页" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "正在读取开放状态…" })).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "日志分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
  });

  it.each(["admin", "platform-admin"])("lets %s preview unpublished workflows with management restricted to superadmin", async (roleId) => {
    window.history.replaceState(null, "", "/parameter-home");
    render(<App initialAppState={{ ...initialState, activeRoleId: roleId }} runtimeMode="mock" workflowPublicationClient={client()} />);
    const sidebar = screen.getByRole("complementary", { name: "主导航侧边栏" });
    expect(within(sidebar).getByRole("link", { name: "知识库" })).toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "工作流发布" }) !== null).toBe(roleId === "platform-admin");
    fireEvent.click(within(sidebar).getByRole("link", { name: "知识库" }));
    expect(await screen.findByText("管理员预览 · 此工作流尚未向用户开放")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "暂未开放" })).not.toBeInTheDocument();
  });

  it("blocks ordinary users on load failure and allows retry without flashing workflow entries", async () => {
    const api = client();
    vi.mocked(api.getPublication).mockRejectedValueOnce(new Error("offline"));
    window.history.replaceState(null, "", "/knowledge");
    render(<App initialAppState={{ ...initialState, activeRoleId: "hardware-user" }} runtimeMode="mock" workflowPublicationClient={api} />);
    expect(screen.queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "暂时无法读取开放状态" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(await screen.findByRole("heading", { name: "暂未开放" })).toBeInTheDocument();
  });

  it("applies publication to the permitted log-skill child-route exception", () => {
    render(<PageRouter page={getPageByPath("/log-admin/skills/skill-1")} state={{ ...initialState, activeRoleId: "hardware-user" }}
      dispatch={vi.fn()} onNavigate={vi.fn()} onFeedback={vi.fn()} search="" DebuggingAdminPage={() => null}
      sessionPermissions={["logs:view"]} publication={{ status: "ready", publication, retry: vi.fn() }} visibleWorkflows={["parameter-management", "debugging"]} />);
    expect(screen.getByRole("heading", { name: "暂未开放" })).toBeInTheDocument();
  });

  it("does not allow a project-scoped platform role to manage global publication", () => {
    render(<PageRouter page={getPageByPath("/workflow-publication")} state={{ ...initialState, activeRoleId: "platform-admin" }}
      dispatch={vi.fn()} onNavigate={vi.fn()} onFeedback={vi.fn()} search="" DebuggingAdminPage={() => null}
      sessionRoles={[{ roleId: "platform-admin", projectId: "project-1" }]} />);
    expect(screen.getByRole("heading", { name: "无权访问该页面" })).toBeInTheDocument();
  });
});
