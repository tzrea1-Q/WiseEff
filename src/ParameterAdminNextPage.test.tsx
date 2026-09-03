import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterPageActions } from "@/app/routes";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type {
  ParameterSpecDetail,
  ParameterSpecSummary,
  SpecReviewTask
} from "@/domain/parameter-topology/types";
import { fillPasteImportContent } from "./components/ParameterImportWizard/testHelpers";
import { createMockParameterModuleRegistryRepository } from "@/infrastructure/mock/mockParameterModuleRegistryRepository";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import { initialState } from "@/mockData";
import { ParameterAdminNextPage } from "./ParameterAdminNextPage";
import { createTestParameterTopologyRepository, withPortSpies } from "./test/harness";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

const SPEC_PRIMARY_LABEL = "gpio_int";

const SPEC_SUMMARY: ParameterSpecSummary = {
  id: "spec-sc8562-gpio-int",
  organizationId: "org-teaching",
  sourceKind: "dts",
  specificationKey: "dts/sc8562/gpio_int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  lifecycle: "active",
  currentVersionId: "specver-sc8562-gpio-int-3",
  currentVersion: 3,
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  compatiblePatterns: ["vendor,sc8562"],
  attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }]
};

const SPEC_DETAIL: ParameterSpecDetail = {
  ...SPEC_SUMMARY,
  displayName: "SC8562 GPIO interrupt",
  description: "Interrupt GPIO cells",
  schemaDefault: null,
  exampleValue: "<&gpio13 29 0>",
  schemaNamespace: "vendor,sc8562/bindings",
  units: null,
  constraints: { cellsPerGroup: 3 },
  documentation: "gpio_int is a three-cell interrupt specifier.",
  compatiblePatterns: ["vendor,sc8562"],
  policyTarget: null
};

const OPEN_REVIEW_TASK: SpecReviewTask = {
  id: "review-task-gpio-int",
  status: "open",
  parameterSpecId: null,
  propertyKey: "gpio_int",
  driverModule: "unknown-ic",
  evidence: ["compatible unmatched"],
  candidates: [
    {
      id: "spec-sc8562-gpio-int",
      label: "vendor,sc8562 / gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562"
    }
  ],
  ambiguous: true,
  projectCount: 2,
  createdAt: "2026-07-14T10:00:00.000Z"
};

function createRepository(overrides: Partial<ParameterTopologyRepository> = {}) {
  return createTestParameterTopologyRepository({
    listSpecs: vi.fn().mockResolvedValue([SPEC_SUMMARY]),
    getSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [OPEN_REVIEW_TASK], nextCursor: null }),
    ...overrides
  });
}

function createModuleRegistry(overrides: Partial<ParameterModuleRegistryRepository> = {}) {
  return withPortSpies(
    createMockParameterModuleRegistryRepository({
      mappings: [
        {
          id: "map-sc8562",
          moduleId: "mod-sc8562",
          matchKind: "compatible",
          matchValue: "vendor,sc8562",
          priority: 100
        }
      ]
    }),
    overrides
  );
}

function createParameterActions(overrides: Partial<ParameterPageActions> = {}): ParameterPageActions {
  return {
    getParameter: vi.fn().mockResolvedValue(initialState.parameters[0]),
    submitChanges: vi.fn().mockResolvedValue(undefined),
    stashChanges: vi.fn().mockResolvedValue(undefined),
    discardDrafts: vi.fn().mockResolvedValue(undefined),
    withdrawSubmissionRound: vi.fn().mockResolvedValue(undefined),
    reviewChange: vi.fn().mockResolvedValue(undefined),
    createImportPreview: vi.fn().mockResolvedValue({
      id: "api-import-batch",
      projectId: initialState.activeProjectId,
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-05-25T08:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "preview-item-1",
          name: "next_import_limit",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "0 - 5000",
          currentValue: "3200",
          recommendedValue: "3400",
          classification: "added",
          riskFlag: true
        }
      ]
    }),
    applyImportBatch: vi.fn().mockResolvedValue(undefined),
    parseDtsImport: vi.fn().mockResolvedValue({ format: "dts-full", rows: [] }),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderPage(options: {
  path?: string;
  repository?: ParameterTopologyRepository;
  moduleRegistry?: ParameterModuleRegistryRepository;
  onNavigate?: ReturnType<typeof vi.fn>;
  area?: "organization" | "projects";
  parameterActions?: ParameterPageActions;
  dispatch?: ReturnType<typeof vi.fn>;
  runtimeMode?: "mock" | "api";
  parameterFileRepository?: import("@/application/ports/ParameterFileRepository").ParameterFileRepository;
  dtsStructuredRepository?: import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository;
  configurationWorkbenchEnabled?: boolean;
  state?: typeof initialState;
} = {}) {
  const path = options.path ?? "/parameter-admin/specs";
  window.history.replaceState(null, "", path);
  const onNavigate = options.onNavigate ?? vi.fn();
  const repository = options.repository ?? createRepository();
  const moduleRegistry = options.moduleRegistry ?? createModuleRegistry();
  const dispatch = options.dispatch ?? vi.fn();
  const parameterActions = options.parameterActions;
  const area =
    options.area ??
    (path.startsWith("/parameter-admin/projects") ? "projects" : "organization");
  const search = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const pathname = path.includes("?") ? path.slice(0, path.indexOf("?")) : path;

  const page = (nextPath: string) => (
    <ToastProvider>
      <ParameterAdminNextPage
        area={area}
        onNavigate={onNavigate}
        search={nextPath.includes("?") ? nextPath.slice(nextPath.indexOf("?") + 1) : ""}
        pathname={nextPath.includes("?") ? nextPath.slice(0, nextPath.indexOf("?")) : nextPath}
        runtimeMode={options.runtimeMode ?? "mock"}
        parameterTopologyRepository={repository}
        parameterModuleRegistryRepository={moduleRegistry}
        parameterFileRepository={options.parameterFileRepository}
        dtsStructuredRepository={options.dtsStructuredRepository}
        configurationWorkbenchEnabled={options.configurationWorkbenchEnabled}
        projects={(options.state ?? initialState).configDraft.projects}
        parameters={(options.state ?? initialState).parameters}
        activeProjectId={(options.state ?? initialState).activeProjectId}
        dispatch={dispatch}
        parameterActions={parameterActions}
        state={options.state ?? initialState}
      />
    </ToastProvider>
  );

  const { rerender: rerenderPage } = render(page(`${pathname}${search ? `?${search}` : ""}`));

  return {
    onNavigate,
    repository,
    moduleRegistry,
    dispatch,
    parameterActions,
    /** Re-render at a new route, as the app router would on navigation. */
    rerender: (nextPath: string) => {
      window.history.replaceState(null, "", nextPath);
      rerenderPage(page(nextPath));
    }
  };
}

describe("ParameterAdminNextPage · shell", () => {
  it("presents organization and project areas as peer destinations", () => {
    const { onNavigate } = renderPage({ path: "/parameter-admin/specs" });

    const nav = screen.getByRole("navigation", { name: "参数管理后台配置范围" });
    expect(within(nav).getByRole("button", { name: "组织配置" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "项目运营" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(nav).getByRole("button", { name: "项目运营" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects");
  });

  it("opens the project area as its own destination", async () => {
    renderPage({
      path: "/parameter-admin/projects",
      area: "projects",
      state: initialState
    });

    const nav = screen.getByRole("navigation", { name: "参数管理后台配置范围" });
    expect(within(nav).getByRole("button", { name: "项目运营" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数定义库" })).not.toBeInTheDocument();
  });
});

describe("ParameterAdminNextPage · organization sub-routes", () => {
  it("redirects the organization entry to the specs sub-route while preserving query", () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin?q=gpio&lifecycle=active&spec=spec-sc8562-gpio-int"
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "/parameter-admin/specs?q=gpio&lifecycle=active&spec=spec-sc8562-gpio-int"
    );
  });

  it("renders the canonical Catalog page on /parameter-admin/specs", async () => {
    renderPage({ path: "/parameter-admin/specs" });

    const catalog = await screen.findByRole("region", { name: "参数定义目录" });
    expect(catalog).toHaveAttribute("data-catalog-page", "true");
    expect(screen.getByRole("region", { name: "目录列表" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索参数定义" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "模块归属" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数定义库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "定义匹配审核队列" })).not.toBeInTheDocument();
  });

  it("redirects legacy /spec-review to /specs while preserving query", () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin/spec-review?q=gpio&lifecycle=active"
    });

    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs?q=gpio&lifecycle=active");
  });

  it("redirects legacy /identity-mapping to /specs/identity-mapping while preserving query", () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin/identity-mapping?status=open"
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "/parameter-admin/specs/identity-mapping?status=open"
    );
  });

  it("marks the active organization sub-view and navigates between peers", async () => {
    const { onNavigate } = renderPage({ path: "/parameter-admin/modules" });

    const orgNav = await screen.findByRole("navigation", { name: "组织配置子视图" });
    expect(within(orgNav).getByRole("button", { name: /模块管理/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(orgNav).getByRole("button", { name: /参数定义管理/ })).not.toHaveAttribute(
      "aria-current"
    );

    fireEvent.click(within(orgNav).getByRole("button", { name: /参数定义管理/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs");
  });
});

describe("ParameterAdminNextPage · canonical catalog mount", () => {
  it("keeps CatalogPage on the library route and identity mapping on its nested peer", async () => {
    renderPage({ path: "/parameter-admin/specs" });
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toHaveAttribute(
      "data-catalog-page",
      "true"
    );

    cleanup();
    renderPage({ path: "/parameter-admin/specs/identity-mapping" });
    expect(screen.queryByRole("region", { name: "参数定义目录" })).not.toBeInTheDocument();
  });
});

describe("ParameterAdminNextPage · organization module tree and driver mapping", () => {
  it("loads the module registry through the injected module registry port", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    expect(within(panel).getAllByText("充电策略").length).toBeGreaterThan(0);
    expect(within(panel).getByText(/1 条 compatible/)).toBeInTheDocument();
    expect(moduleRegistry.getRegistry).toHaveBeenCalled();
  });

  it("creates, renames, moves, and deletes modules with governance audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });

    fireEvent.click(within(panel).getByRole("button", { name: "新建模块" }));
    const createDialog = screen.getByRole("dialog", { name: "新建模块" });
    fireEvent.change(within(createDialog).getByLabelText("模块名称"), {
      target: { value: "电源路径" }
    });
    fireEvent.change(within(createDialog).getByLabelText("模块展示描述"), {
      target: { value: "路径说明" }
    });
    fireEvent.change(within(createDialog).getByLabelText("适用范围"), {
      target: { value: "组织" }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(moduleRegistry.createModule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "电源路径",
          description: "路径说明",
          scope: "组织",
          kind: "business"
        })
      )
    );
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "修改模块 电源路径" })).toBeInTheDocument()
    );

    fireEvent.click(within(panel).getByRole("button", { name: "修改模块 电源路径" }));
    const editDialog = screen.getByRole("dialog", { name: "电源路径" });
    fireEvent.change(within(editDialog).getByLabelText("模块名称"), {
      target: { value: "电源路径组" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(moduleRegistry.updateModule).toHaveBeenCalledWith(
        "mod-mock-1",
        expect.objectContaining({ name: "电源路径组" })
      )
    );
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "修改模块 电源路径组" })).toBeInTheDocument()
    );

    fireEvent.click(within(panel).getByRole("button", { name: "电源路径组 更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动模块 电源路径组" }));
    const moveDialog = screen.getByRole("dialog", { name: "移动「电源路径组」" });
    fireEvent.click(within(moveDialog).getByRole("button", { name: /根级（无父模块）|目标业务分类/ }));
    fireEvent.click(within(moveDialog).getByRole("button", { name: "充电策略" }));
    fireEvent.click(within(moveDialog).getByRole("button", { name: "确认移动" }));
    await waitFor(() =>
      expect(moduleRegistry.updateModule).toHaveBeenCalledWith("mod-mock-1", {
        parentId: "mod-charging"
      })
    );

    // After move + audit refresh, the overflow menu can remount mid-open under load.
    // Retry open until the delete item is stable, then click it.
    await waitFor(() => {
      const more = within(panel).getByRole("button", { name: "电源路径组 更多操作" });
      expect(more).not.toBeDisabled();
      fireEvent.click(more);
      expect(screen.getByRole("menuitem", { name: "删除模块 电源路径组" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除模块 电源路径组" }));
    // Deletion is irreversible and now requires an impact confirmation first.
    expect(moduleRegistry.deleteModule).not.toHaveBeenCalled();
    const deleteConfirm = await screen.findByRole("dialog", { name: "删除模块「电源路径组」" });
    fireEvent.click(within(deleteConfirm).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(moduleRegistry.deleteModule).toHaveBeenCalledWith("mod-mock-1"));
    await waitFor(() =>
      expect(within(panel).queryByRole("button", { name: "电源路径组 更多操作" })).not.toBeInTheDocument()
    );
  });

  it("keeps the module edit dialog open when the update request is rejected", async () => {
    const moduleRegistry = createModuleRegistry();
    const nextRegistry = await moduleRegistry.getRegistry();
    const updateModule = vi.mocked(moduleRegistry.updateModule);
    updateModule
      .mockReset()
      .mockRejectedValueOnce(new Error('relation "parameter_definitions" does not exist'))
      .mockResolvedValueOnce(nextRegistry);
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    fireEvent.click(within(panel).getByRole("button", { name: "修改模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "SC8562" });
    fireEvent.change(within(editDialog).getByLabelText("模块名称"), {
      target: { value: "SC8562 Updated" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateModule).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "SC8562" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "SC8562" })).getByLabelText("模块名称")).toHaveValue(
      "SC8562 Updated"
    );
    expect(within(screen.getByRole("dialog", { name: "SC8562" })).getByRole("alert")).toHaveTextContent(
      "保存模块失败，请重试。"
    );

    const retryDialog = screen.getByRole("dialog", { name: "SC8562" });
    await waitFor(() => expect(within(retryDialog).getByRole("button", { name: "保存" })).toBeEnabled());
    fireEvent.click(within(retryDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateModule).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "SC8562" })).not.toBeInTheDocument());
  });

  it("keeps the module edit dialog open when driver registration update is rejected", async () => {
    const moduleRegistry = createModuleRegistry({
      updateDriverRegistration: vi.fn().mockRejectedValue(new Error("driver registration unavailable"))
    });
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    fireEvent.click(within(panel).getByRole("button", { name: "修改模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "SC8562" });
    fireEvent.change(within(editDialog).getByLabelText("驱动性质"), {
      target: { value: "logical-service" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(moduleRegistry.updateDriverRegistration).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "SC8562" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "SC8562" })).getByRole("alert")).toHaveTextContent(
      "保存模块失败，请重试。"
    );
  });

  it("removes an inline mapping rule from the module tree with audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    fireEvent.click(within(panel).getByRole("button", { name: "修改模块 SC8562" }));
    const editDialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(editDialog).getByText("compatible:vendor,sc8562")).toBeInTheDocument();

    fireEvent.click(
      within(editDialog).getByRole("button", { name: "移除规则 compatible:vendor,sc8562" })
    );
    const removeConfirm = screen.getByRole("dialog", { name: "移除 compatible 规则" });
    fireEvent.click(within(removeConfirm).getByRole("button", { name: "移除" }));
    await waitFor(() => expect(moduleRegistry.deleteMapping).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(editDialog).queryByText("compatible:vendor,sc8562")).not.toBeInTheDocument()
    );
  });

  it("keeps the module tree primary and opens the unclassified queue via secondary nav", async () => {
    const moduleRegistry = createModuleRegistry();
    const { onNavigate } = renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    expect(within(panel).queryByRole("region", { name: "未登记驱动" })).not.toBeInTheDocument();
    expect(await within(panel).findByText("有未登记的驱动")).toBeInTheDocument();

    const moduleSubnav = within(panel).getByRole("navigation", { name: "模块管理子视图" });
    expect(within(moduleSubnav).getByRole("button", { name: "归属树" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(moduleSubnav).queryByRole("button", { name: "驱动登记" })).not.toBeInTheDocument();
    expect(within(panel).getByText("· 平台级解析覆盖")).toBeInTheDocument();
    fireEvent.click(within(moduleSubnav).getByRole("button", { name: /未登记驱动/ }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/modules/queue");

    fireEvent.click(within(panel).getByRole("button", { name: "全量重算" }));
    await waitFor(() => expect(moduleRegistry.recomputeBindings).toHaveBeenCalled());
    const resultDialog = await screen.findByRole("dialog", { name: "全量重算结果" });
    expect(within(resultDialog).getByText("更新的项目参数")).toBeInTheDocument();
    expect(within(resultDialog).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(resultDialog).getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("dialog", { name: "全量重算结果" })).not.toBeInTheDocument();
  });

  it("renders the unclassified queue on the modules/queue sub-route", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules/queue" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    const compatibleQueue = within(panel).getByRole("region", { name: "未登记驱动" });
    expect(within(compatibleQueue).getByText("vendor,unmapped-ic")).toBeInTheDocument();
    expect(within(panel).queryByRole("tree", { name: "模块归属树" })).not.toBeInTheDocument();
  });

  it("hides the modules sub-nav when discovery is empty", async () => {
    const moduleRegistry = createModuleRegistry({
      getDiscoveryHints: vi.fn(async () => ({
        compatibles: [],
        dismissedCompatibles: [],
        total: 0
      }))
    });
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    expect(within(panel).queryByRole("navigation", { name: "模块管理子视图" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("region", { name: "未登记驱动" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("tree", { name: "模块归属树" })).toBeInTheDocument();
  });

  it("behaves identically when backed by the mock module registry adapter", async () => {
    const moduleRegistry = createMockParameterModuleRegistryRepository();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块归属" });
    expect(within(panel).getAllByText("充电策略").length).toBeGreaterThan(0);

    fireEvent.click(within(panel).getByRole("button", { name: "新建模块" }));
    const createDialog = screen.getByRole("dialog", { name: "新建模块" });
    fireEvent.change(within(createDialog).getByLabelText("模块名称"), {
      target: { value: "Mock 模块" }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建" }));
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "修改模块 Mock 模块" })).toBeInTheDocument()
    );
  });
});

describe("ParameterAdminNextPage · organization bulk import", () => {
  it("opens the import wizard from the organization area", async () => {
    renderPage({ parameterActions: createParameterActions() });

    const importRegion = await screen.findByRole("region", { name: "批量参数导入" });
    fireEvent.click(within(importRegion).getByRole("button", { name: "打开批量参数导入" }));

    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });
    expect(within(dialog).getByLabelText("目标项目")).toHaveValue(initialState.activeProjectId);
    expect(dialog.querySelector('input[type="file"]')).toHaveAttribute(
      "accept",
      ".xlsx,.csv,.json,.dts,.dtsi,.txt"
    );
  });

  it("parses JSON through preview and apply with governance audit", async () => {
    const parameterActions = createParameterActions();
    renderPage({ parameterActions, runtimeMode: "api" });

    fireEvent.click(await screen.findByRole("button", { name: "打开批量参数导入" }));
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });

    fillPasteImportContent(
      dialog,
      JSON.stringify([
        {
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          currentValue: "3200",
          recommendedValue: "3400",
          range: "2500 - 4500",
          unit: "mA",
          risk: "High"
        }
      ])
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await within(dialog).findByRole("region", { name: "解析与校验" });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    await within(dialog).findByRole("region", { name: "逐行核对" });
    fireEvent.click(within(dialog).getByRole("button", { name: "通过" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    await waitFor(() => expect(parameterActions.createImportPreview).toHaveBeenCalled());
    await waitFor(() => expect(within(dialog).getByRole("region", { name: "批次预览" })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认应用" }));

    await waitFor(() =>
      expect(parameterActions.applyImportBatch).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: "api-import-batch" })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "批量参数导入" })).not.toBeInTheDocument()
    );
  });

  it("parses CSV paste into the review step", async () => {
    renderPage({ parameterActions: createParameterActions() });

    fireEvent.click(await screen.findByRole("button", { name: "打开批量参数导入" }));
    const dialog = screen.getByRole("dialog", { name: "批量参数导入" });

    fillPasteImportContent(
      dialog,
      "name,module,currentValue,recommendedValue,range,unit,risk\ncsv_param,Charging Policy,1,2,0 - 10,unit,Low\n"
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    const summary = await within(dialog).findByRole("region", { name: "解析与校验" });
    expect(within(summary).getByText("总行数").nextElementSibling).toHaveTextContent("1");
  });

  it("surfaces clear messages for rejected /include/ and oversized DTS sources", async () => {
    const parseDtsImport = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("DTS /include/ 暂不支持，请提供展开后的文件。"), {
          details: { code: "dts-include-unsupported" }
        })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("DTS import source exceeds the 2097152 byte limit."), {
          details: { maxBytes: 2097152, sizeBytes: 3000000 }
        })
      );
    renderPage({ parameterActions: createParameterActions({ parseDtsImport }) });

    fireEvent.click(await screen.findByRole("button", { name: "打开批量参数导入" }));
    let dialog = screen.getByRole("dialog", { name: "批量参数导入" });

    fillPasteImportContent(dialog, '/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n');
    expect(within(dialog).getByRole("status")).toHaveTextContent("将使用服务端解析");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("/include/");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    // Parse progress exists, so closing now routes through the discard guard.
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "退出批量导入向导？" })).getByRole("button", { name: "丢弃并退出" })
    );
    fireEvent.click(screen.getByRole("button", { name: "打开批量参数导入" }));
    dialog = screen.getByRole("dialog", { name: "批量参数导入" });

    fillPasteImportContent(dialog, `/dts-v1/;\n/ { oversized = <${"1 ".repeat(20)}>; };\n`);
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/2097152 字节|超出/);
  });
});

describe("ParameterAdminNextPage · organization identity mapping governance", () => {
  const OPEN_MAPPING_TASK = {
    id: "map-admin-1",
    projectId: "project-teaching",
    configRevisionId: "revision-teaching-1",
    previousLogicalNodeId: "logical-sc8562-old",
    candidateLogicalNodeIds: ["logical-sc8562", "logical-mt5788"],
    evidence: {
      previousNodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
      evidence: ["unit address matched", "compatible ambiguous"],
      candidates: [
        {
          logicalNodeId: "logical-sc8562",
          nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
          name: "sc8562",
          unitAddress: "6E"
        },
        {
          logicalNodeId: "logical-mt5788",
          nodeLocator: "/amba/i2c@FDF5E000/mt5788@55",
          name: "mt5788",
          unitAddress: "55"
        }
      ],
      risk: "high"
    },
    status: "open" as const,
    createdAt: "2026-07-14T10:00:00.000Z"
  };

  it("loads the identity mapping queue with evidence through the topology port", async () => {
    const listMappingTasks = vi.fn().mockResolvedValue([OPEN_MAPPING_TASK]);
    renderPage({
      repository: createRepository({ listMappingTasks }),
      path: "/parameter-admin/specs/identity-mapping"
    });

    const region = await screen.findByRole("region", { name: "节点对应确认" });
    expect(within(region).getByText("/amba/i2c@FDF5E000/sc8562@6E")).toBeInTheDocument();
    expect(within(region).getByText("unit address matched")).toBeInTheDocument();
    await waitFor(() => expect(listMappingTasks).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(listMappingTasks).toHaveBeenCalledTimes(2);
  });

  it("resolves a mapping task via the lossless candidate identity path with audit", async () => {
    const listMappingTasks = vi.fn().mockResolvedValue([OPEN_MAPPING_TASK]);
    const resolveMapping = vi.fn().mockImplementation(async () => {
      listMappingTasks.mockResolvedValue([]);
    });
    const { onNavigate } = renderPage({
      repository: createRepository({ listMappingTasks, resolveMapping }),
      path: "/parameter-admin/specs/identity-mapping"
    });

    const review = await screen.findByRole("region", { name: "节点对应审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择对应节点" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Same board instance" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认对应" }));

    await waitFor(() =>
      expect(resolveMapping).toHaveBeenCalledWith("map-admin-1", {
        decision: "resolved",
        selectedLogicalNodeId: "logical-sc8562",
        reason: "Same board instance"
      })
    );
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs")
    );
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    renderPage({
      repository: createMockParameterTopologyRepository(),
      path: "/parameter-admin/specs/identity-mapping"
    });

    const review = await screen.findByRole("region", { name: "节点对应审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择对应节点" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Mock continuity" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认对应" }));

    // Resolved tasks move to history (not the empty-queue hint).
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "历史决议" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "确认对应" })).not.toBeInTheDocument();
    expect(screen.getByText("已对应")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "重新对应原因" })).toHaveValue("");
  });
});

describe("ParameterAdminNextPage · project-scoped routes and parameter files", () => {
  it("restores project list controls and rows from q, status, and sort query state", async () => {
    const { onNavigate, rerender } = renderPage({
      path: "/parameter-admin/projects?q=Aurora&status=initialized&sort=name-desc",
      area: "projects"
    });

    const table = await screen.findByRole("table", { name: "项目管理列表" });
    expect(screen.getByRole("searchbox", { name: "搜索项目" })).toHaveValue("Aurora");
    expect(screen.getByRole("button", { name: "筛选状态" })).toHaveTextContent("1");
    expect(within(table).getByRole("columnheader", { name: /项目名称/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );
    expect(within(table).getByText("Aurora 量产平台")).toBeInTheDocument();
    expect(within(table).queryByText("Nebula 高频调试项目")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索项目" }), {
      target: { value: "Nebula" }
    });
    expect(onNavigate).toHaveBeenCalledWith(
      "/parameter-admin/projects?q=Nebula&status=initialized&sort=name-desc"
    );

    rerender("/parameter-admin/projects?q=Nebula&status=initialized&sort=name-asc");
    expect(screen.getByRole("searchbox", { name: "搜索项目" })).toHaveValue("Nebula");
    expect(within(screen.getByRole("table", { name: "项目管理列表" })).getByRole(
      "columnheader",
      { name: /项目名称/ }
    )).toHaveAttribute("aria-sort", "ascending");
  });

  it("opens the Configuration workbench from the project list", async () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin/projects",
      area: "projects"
    });

    expect(await screen.findByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    const firstOpen = screen.getAllByRole("button", { name: /配置工作台/ })[0]!;
    fireEvent.click(firstOpen);

    expect(onNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/parameter-admin\/projects\/[^/]+\/configuration$/)
    );
  });

  it("renders the canonical Configuration workbench through the real mock runtime ports", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;
    renderPage({
      path: `/parameter-admin/projects/${projectId}/configuration`,
      area: "projects"
    });

    expect(await screen.findByRole("region", { name: "项目配置工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "参数后台范围" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /\.dts$/ })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: /成员文件/ })).toBeInTheDocument();
  });

  it("redirects legacy /files deep links to the canonical workbench with file inspector context", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;
    const { onNavigate } = renderPage({
      path: `/parameter-admin/projects/${projectId}/files?file=file-1&node=soc/gpio&q=gpio`,
      area: "projects"
    });

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        `/parameter-admin/projects/${projectId}/configuration?file=file-1&node=soc%2Fgpio&q=gpio&inspector=file`
      )
    );
    expect(screen.queryByRole("navigation", { name: "项目运营视图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("redirects legacy config-sets, structure, and conflicts routes to workbench contexts", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;

    const configSets = renderPage({
      path: `/parameter-admin/projects/${projectId}/config-sets?configSet=cs-default`,
      area: "projects"
    });
    await waitFor(() =>
      expect(configSets.onNavigate).toHaveBeenCalledWith(
        `/parameter-admin/projects/${projectId}/configuration?configSet=cs-default&inspector=config-set`
      )
    );
    cleanup();

    const structure = renderPage({
      path: `/parameter-admin/projects/${projectId}/structure?file=f1&node=board&property=model`,
      area: "projects"
    });
    await waitFor(() =>
      expect(structure.onNavigate).toHaveBeenCalledWith(
        `/parameter-admin/projects/${projectId}/configuration?file=f1&node=board&property=model&sourceMode=working`
      )
    );
    cleanup();

    const conflicts = renderPage({
      path: `/parameter-admin/projects/${projectId}/conflicts`,
      area: "projects"
    });
    await waitFor(() =>
      expect(conflicts.onNavigate).toHaveBeenCalledWith(
        `/parameter-admin/projects/${projectId}/configuration?tasks=conflicts`
      )
    );
  });

  it("keeps the workbench open even when the retired flag prop is false", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;
    const { onNavigate } = renderPage({
      path: `/parameter-admin/projects/${projectId}/configuration`,
      area: "projects",
      configurationWorkbenchEnabled: false
    });

    expect(await screen.findByRole("region", { name: "项目配置工作台" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalledWith(`/parameter-admin/projects/${projectId}/files`);
  });

  it("edits a project from the list", async () => {
    const dispatch = vi.fn();
    renderPage({ path: "/parameter-admin/projects", area: "projects", dispatch });

    const projectName = initialState.configDraft.projects[0]!.name;
    fireEvent.click(screen.getByRole("button", { name: `编辑 ${projectName}` }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑项目详情" });
    fireEvent.change(within(editDialog).getByLabelText("项目名称"), {
      target: { value: `${projectName} Updated` }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
  });

  it("reports an unknown project id as not found instead of titling the page with it", async () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin/projects/does-not-exist-999/configuration",
      area: "projects"
    });

    const notFound = await screen.findByRole("region", { name: "项目不存在" });
    expect(within(notFound).getByText(/does-not-exist-999/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "does-not-exist-999" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "项目配置工作台" })).not.toBeInTheDocument();

    fireEvent.click(within(notFound).getByRole("button", { name: "返回项目清单" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects");
  });
});
