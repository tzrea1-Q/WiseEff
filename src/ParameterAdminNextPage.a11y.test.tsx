import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
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
    listBindings: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn(),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

describe("ParameterAdminNextPage · a11y", () => {
  it("Tab 从范围导航到搜索与生命周期筛选控件顺序可达", async () => {
    render(
      <ParameterAdminNextPage
        area="organization"
        onNavigate={() => {}}
        search=""
        pathname="/parameter-admin/specs"
        parameterTopologyRepository={createRepository()}
      />
    );

    await screen.findByRole("region", { name: "参数规格库" });

    const orgTab = screen.getByRole("button", { name: "组织治理" });
    const projectTab = screen.getByRole("button", { name: "项目运营" });
    const search = screen.getByRole("searchbox", { name: "搜索规格" });
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
      <ParameterAdminNextPage
        area="organization"
        onNavigate={() => {}}
        search="lifecycle=draft"
        pathname="/parameter-admin/specs"
        parameterTopologyRepository={createRepository()}
      />
    );

    await screen.findByRole("region", { name: "参数规格库" });
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
      <ParameterAdminNextPage
        area="projects"
        onNavigate={() => {}}
        search=""
        pathname="/parameter-admin/projects"
        parameterTopologyRepository={createRepository()}
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
    );

    expect(screen.getByRole("navigation", { name: "参数管理后台治理范围" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目运营" })).toBeInTheDocument();
  });
});
