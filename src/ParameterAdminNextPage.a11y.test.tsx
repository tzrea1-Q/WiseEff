import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    listSpecs: vi.fn().mockResolvedValue([
      {
        id: "spec-sc8562-gpio-int",
        organizationId: "org-teaching",
        sourceKind: "dts",
        specificationKey: "dts/sc8562/gpio_int",
        propertyKey: "gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersionId: "specver-1",
        currentVersion: 1
      }
    ]),
    getSpec: vi.fn().mockResolvedValue({
      id: "spec-sc8562-gpio-int",
      organizationId: "org-teaching",
      sourceKind: "dts",
      specificationKey: "dts/sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "specver-1",
      currentVersion: 1,
      displayName: "gpio_int",
      description: null,
      valueShape: { kind: "cells" },
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "vendor,sc8562/bindings",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: ["vendor,sc8562"],
      policyTarget: null
    }),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    resolveSpecReviewTask: vi.fn(),
    activateParameterSpec: vi.fn(),
    updateParameterSpec: vi.fn(),
    deprecateParameterSpec: vi.fn(),
    restoreParameterSpec: vi.fn(),
    listBindings: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn(),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

describe("ParameterAdminNextPage · a11y", () => {
  it("在参数定义管理中复用模块导航，并按选中子树筛选定义", async () => {
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue([
        {
          id: "spec-sc8562-gpio-int",
          organizationId: "org-teaching",
          sourceKind: "dts",
          specificationKey: "dts/sc8562/gpio_int",
          propertyKey: "gpio_int",
          driverModule: "sc8562",
          lifecycle: "active",
          currentVersionId: "specver-1",
          currentVersion: 1,
          valueShape: { kind: "cells" },
          compatiblePatterns: ["vendor,sc8562"],
          attributionModules: [
            {
              id: "module-charge",
              name: "超长充电协议参数定义模块",
              kind: "driver-group",
              path: ["Power", "Charging", "超长充电协议参数定义模块"]
            }
          ]
        },
        {
          id: "spec-thermal-status",
          organizationId: "org-teaching",
          sourceKind: "dts",
          specificationKey: "dts/thermal/status",
          propertyKey: "thermal_status",
          driverModule: "thermal",
          lifecycle: "active",
          currentVersionId: "specver-2",
          currentVersion: 1,
          valueShape: { kind: "strings" },
          compatiblePatterns: ["vendor,thermal"],
          attributionModules: [
            {
              id: "module-thermal",
              name: "Thermal",
              kind: "driver-group",
              path: ["Power", "Thermal"]
            }
          ]
        }
      ])
    });

    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="organization"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/specs"
          parameterTopologyRepository={repository}
        />
      </ToastProvider>
    );

    const moduleTree = await screen.findByRole("tree", { name: "参数定义模块树" });
    expect(within(moduleTree).getByRole("treeitem", { name: /Power.*2 个定义/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(moduleTree).getByRole("treeitem", { name: /Power.*2 个定义/ })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
    });
    const libraryTable = screen.getByRole("table", { name: "参数定义库列表" });
    expect(within(libraryTable).getByText("gpio_int")).toBeInTheDocument();
    expect(within(libraryTable).getByText("thermal_status")).toBeInTheDocument();

    fireEvent.click(within(moduleTree).getByRole("treeitem", { name: /Charging.*1 个定义/ }));
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get("moduleNode")).toContain("Charging");
      expect(within(libraryTable).getByText("gpio_int")).toBeInTheDocument();
      expect(within(libraryTable).queryByText("thermal_status")).not.toBeInTheDocument();
    });

    fireEvent.click(within(moduleTree).getByRole("treeitem", { name: /Charging.*1 个定义/ }));
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.has("moduleNode")).toBe(false);
      expect(within(libraryTable).getByText("thermal_status")).toBeInTheDocument();
    });
  });

  it("Tab 从范围导航到搜索与生命周期筛选控件顺序可达", async () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="organization"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/specs"
          parameterTopologyRepository={createRepository()}
        />
      </ToastProvider>
    );

    await screen.findByRole("region", { name: "参数定义库" });

    const orgTab = screen.getByRole("button", { name: "组织配置" });
    const projectTab = screen.getByRole("button", { name: "项目运营" });
    const search = screen.getByRole("searchbox", { name: "搜索参数定义" });
    const lifecycle = screen.getByRole("button", { name: "筛选审核状态" });

    orgTab.focus();
    expect(document.activeElement).toBe(orgTab);
    projectTab.focus();
    expect(document.activeElement).toBe(projectTab);
    search.focus();
    expect(document.activeElement).toBe(search);
    lifecycle.focus();
    expect(document.activeElement).toBe(lifecycle);
  });

  it("审核状态筛选可通过列筛选菜单选择并反映到 URL", async () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="organization"
          onNavigate={() => {}}
          search="lifecycle=draft"
          pathname="/parameter-admin/specs"
          parameterTopologyRepository={createRepository()}
        />
      </ToastProvider>
    );

    await screen.findByRole("region", { name: "参数定义库" });
    const trigger = screen.getByRole("button", { name: "筛选审核状态" });
    expect(trigger).toHaveClass("active");
    expect(trigger).toHaveTextContent("1");

    fireEvent.click(trigger);
    const menu = screen.getByRole("group", { name: "审核状态筛选" });
    fireEvent.click(within(menu).getByRole("checkbox", { name: "draft" }));
    fireEvent.click(within(menu).getByRole("checkbox", { name: "active" }));
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get("lifecycle")).toBe("active");
    });
  });

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
