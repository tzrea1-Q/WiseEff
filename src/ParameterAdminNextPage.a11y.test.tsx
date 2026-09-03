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
  it("canonical Catalog page exposes list, detail, and timeline regions", async () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="organization"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/specs"
        />
      </ToastProvider>
    );

    const catalog = await screen.findByRole("region", { name: "参数定义目录" });
    expect(catalog).toHaveAttribute("data-catalog-page", "true");
    expect(screen.getByRole("region", { name: "目录列表" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "定义详情" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "定义时间线" })).toBeInTheDocument();
  });

  it("Tab 从范围导航到目录搜索可达", async () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="organization"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/specs"
        />
      </ToastProvider>
    );

    await screen.findByRole("region", { name: "参数定义目录" });

    const orgTab = screen.getByRole("button", { name: "组织配置" });
    const projectTab = screen.getByRole("button", { name: "项目运营" });
    const search = screen.getByRole("searchbox", { name: "搜索参数定义" });

    orgTab.focus();
    expect(document.activeElement).toBe(orgTab);
    projectTab.focus();
    expect(document.activeElement).toBe(projectTab);
    search.focus();
    expect(document.activeElement).toBe(search);
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
