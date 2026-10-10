import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { ParameterAdminNextPage } from "./ParameterAdminNextPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listBindings: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    createNodeEnablementDraft: vi.fn(),
    listNodeEnablementDrafts: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

describe("ParameterAdminNextPage · a11y", () => {

  it("项目运营目的地有可访问的区域标题", () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="projects"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/projects"
          parameterTopologyRepository={createRepository()}
          dispatch={() => undefined}
          state={
            {
              configDraft: { projects: [{ id: "aurora", name: "Aurora", code: "AUR" }] },
              parameters: [],
              activeProjectId: "aurora",
              activeRoleId: "admin",
              projectInitializationStatuses: { aurora: "initialized" }
            } as never
          }
        />
      </ToastProvider>
    );

    expect(screen.getByRole("navigation", { name: "参数管理后台配置范围" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
  });
});
