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

  it("renders the spec library with an embedded review queue on /parameter-admin/specs", async () => {
    renderPage({ path: "/parameter-admin/specs" });

    expect(await screen.findByRole("region", { name: "参数定义库" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "定义匹配审核队列" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "模块归属" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "节点对应确认" })).not.toBeInTheDocument();
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

describe("ParameterAdminNextPage · organization spec governance", () => {
  it("loads the spec library through the injected topology port", async () => {
    const repository = createRepository();
    renderPage({ repository });

    const library = await screen.findByRole("region", { name: "参数定义库" });
    expect(within(library).getByText("gpio_int")).toBeInTheDocument();
    expect(repository.listSpecs).toHaveBeenCalled();
    expect(repository.listSpecReviewTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", limit: 50 })
    );
  });

  it("keeps filters and selection in the URL", async () => {
    const repository = createRepository();
    renderPage({ repository });

    await screen.findByRole("region", { name: "参数定义库" });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索参数定义" }), {
      target: { value: "gpio" }
    });
    const lifecycleTrigger = screen.getByRole("button", { name: "筛选审核状态" });
    fireEvent.click(lifecycleTrigger);
    fireEvent.click(screen.getByRole("checkbox", { name: "active" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "参数定义库" })).getByRole("button", {
        name: "编辑 gpio_int"
      })
    );

    await waitFor(() => {
      const params = new URL(window.location.href).searchParams;
      expect(params.get("q")).toBe("gpio");
      expect(params.get("lifecycle")).toBe("active");
      expect(params.get("spec")).toBe("spec-sc8562-gpio-int");
    });
  });

  it("opens spec detail with schema provenance", async () => {
    const repository = createRepository();
    renderPage({
      repository,
      path: "/parameter-admin/specs?spec=spec-sc8562-gpio-int"
    });

    const detail = await screen.findByRole("dialog", { name: new RegExp(SPEC_PRIMARY_LABEL) });
    expect(within(detail).getByRole("heading", { name: SPEC_PRIMARY_LABEL })).toBeInTheDocument();
    expect(within(detail).getByLabelText("属性键")).toHaveValue("gpio_int");
    expect(within(detail).getByLabelText("展示名")).toHaveValue("SC8562 GPIO interrupt");
    expect((within(detail).getByLabelText("参数说明") as HTMLTextAreaElement).value).toMatch(
      /three-cell interrupt/
    );
    expect(within(detail).getByText("参数定义库 · 可编辑")).toBeInTheDocument();
    expect(repository.getSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int", { view: "governance" });
    expect(screen.queryByRole("status", { name: "治理审计" })).not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get("spec")).toBeNull();
    });
  });

  it("deprecates a spec and shows concise success feedback", async () => {
    const deprecateParameterSpec = vi
      .fn()
      .mockResolvedValue({ ...SPEC_DETAIL, lifecycle: "deprecated" });
    const repository = createRepository({ deprecateParameterSpec });
    renderPage({
      repository,
      path: "/parameter-admin/specs?spec=spec-sc8562-gpio-int"
    });

    const detail = await screen.findByRole("dialog", { name: new RegExp(SPEC_PRIMARY_LABEL) });
    fireEvent.click(within(detail).getByRole("button", { name: "废弃" }));
    const lifecycleDialog = await screen.findByRole("dialog", { name: "废弃参数定义" });
    fireEvent.change(within(lifecycleDialog).getByLabelText("废弃原因"), {
      target: { value: "由平台定义接管" }
    });
    fireEvent.click(within(lifecycleDialog).getByRole("button", { name: "确认废弃" }));

    await waitFor(() =>
      expect(deprecateParameterSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int", {
        reason: "由平台定义接管"
      })
    );
    expect(
      (await screen.findAllByRole("status")).some((el) => el.textContent?.includes("已废弃"))
    ).toBe(true);
  });

  it("restores a deprecated spec and shows concise success feedback", async () => {
    const deprecatedDetail = { ...SPEC_DETAIL, lifecycle: "deprecated" as const };
    const restoreParameterSpec = vi.fn().mockResolvedValue({ ...SPEC_DETAIL, lifecycle: "active" });
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue([{ ...SPEC_SUMMARY, lifecycle: "deprecated" }]),
      getSpec: vi.fn().mockResolvedValue(deprecatedDetail),
      restoreParameterSpec
    });
    renderPage({
      repository,
      path: "/parameter-admin/specs?spec=spec-sc8562-gpio-int"
    });

    const detail = await screen.findByRole("dialog", { name: new RegExp(SPEC_PRIMARY_LABEL) });
    fireEvent.click(within(detail).getByRole("button", { name: "恢复" }));
    const lifecycleDialog = await screen.findByRole("dialog", { name: "恢复参数定义" });
    fireEvent.change(within(lifecycleDialog).getByLabelText("恢复原因"), {
      target: { value: "重新纳入治理" }
    });
    fireEvent.click(within(lifecycleDialog).getByRole("button", { name: "确认恢复" }));

    await waitFor(() =>
      expect(restoreParameterSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int", {
        reason: "重新纳入治理"
      })
    );
    expect(
      (await screen.findAllByRole("status")).some((el) => el.textContent?.includes("已恢复"))
    ).toBe(true);
  });

  it("resolves a spec review task and surfaces a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const queue = await screen.findByRole("region", { name: "定义匹配审核队列" });
    expect(within(queue).getByText("gpio_int")).toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));
    const dialog = screen.getByRole("dialog", { name: "gpio_int" });
    expect(within(dialog).getByLabelText("匹配依据")).toHaveValue("compatible unmatched");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "选择参数定义" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
      target: { value: "Matched SC8562" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "批准" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "resolved",
        parameterSpecId: "spec-sc8562-gpio-int",
        reason: "Matched SC8562"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待确认的自动匹配。")).toBeInTheDocument());

  });

  it("dismisses a spec review task with a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const queue = await screen.findByRole("region", { name: "定义匹配审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));
    const dialog = screen.getByRole("dialog", { name: "gpio_int" });
    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
      target: { value: "Not actionable" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "驳回" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "dismissed",
        reason: "Not actionable"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待确认的自动匹配。")).toBeInTheDocument());
  });

  it("creates a draft spec from an unmatched review task with audit", async () => {
    const unmatched: SpecReviewTask = {
      ...OPEN_REVIEW_TASK,
      id: "review-task-mystery",
      propertyKey: "mystery_prop",
      driverModule: null,
      candidates: [],
      ambiguous: false,
      evidence: ["no schema match"]
    };
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [unmatched], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const queue = await screen.findByRole("region", { name: "定义匹配审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 mystery_prop" }));
    const dialog = screen.getByRole("dialog", { name: "mystery_prop" });
    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
      target: { value: "Need manual draft" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建草稿定义" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-mystery", {
        decision: "resolved",
        createSpec: true,
        reason: "Need manual draft"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待确认的自动匹配。")).toBeInTheDocument());
  });

  it("pages the review queue through the topology port cursor via 下一页 and opens one adjudication dialog at a time", async () => {
    const pageOne = {
      items: [OPEN_REVIEW_TASK],
      nextCursor: "cursor-page-2"
    };
    const pageTwo = {
      items: [
        {
          ...OPEN_REVIEW_TASK,
          id: "review-task-status",
          propertyKey: "status",
          evidence: ["status unmatched"]
        }
      ],
      nextCursor: null
    };
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo);
    const repository = createRepository({ listSpecReviewTasks });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const queue = await screen.findByRole("region", { name: "定义匹配审核队列" });
    expect(listSpecReviewTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", limit: 50 })
    );
    expect(within(queue).getByText("gpio_int")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(queue).queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));
    expect(screen.getByRole("dialog", { name: "gpio_int" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择参数定义" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Default page size 50 with 1 loaded row → still one local page; 下一页 fetches cursor.
    fireEvent.change(within(queue).getByLabelText("每页条数"), { target: { value: "20" } });
    fireEvent.click(within(queue).getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(listSpecReviewTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: "open", limit: 50, cursor: "cursor-page-2" })
      )
    );
    expect(await within(queue).findByText("status")).toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "编辑 status" }));
    expect(screen.getByRole("dialog", { name: "status" })).toBeInTheDocument();
    expect(within(queue).getByRole("button", { name: "编辑 gpio_int" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "选择参数定义" })).toHaveLength(1);
  });

  it("pages the spec library client-side and hides structural properties by default", async () => {
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue(
        Array.from({ length: 60 }, (_, index) => ({
          ...SPEC_SUMMARY,
          id: `spec-${index}`,
          propertyKey: index === 0 ? "#address-cells" : `prop_${index}`,
          specificationKey: `dts/sc8562/prop_${index}`
        }))
      )
    });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const library = await screen.findByRole("region", { name: "参数定义库" });
    expect(within(library).queryByText("#address-cells")).not.toBeInTheDocument();
    expect(within(library).getByText(/59 \/ 59/)).toBeInTheDocument();
    expect(within(library).getAllByRole("button", { name: /编辑 prop_/ })).toHaveLength(50);

    fireEvent.click(within(library).getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(within(library).getByText(/第 2/)).toBeInTheDocument();
    });
  });

  it("shows observed taxonomy under 所属模块 column", async () => {
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue([
        {
          ...SPEC_SUMMARY,
          id: "spec-mapped",
          propertyKey: "gpio_int",
          driverModule: "sc8562",
          compatiblePatterns: ["vendor,sc8562"],
          attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }]
        },
        {
          ...SPEC_SUMMARY,
          id: "spec-unmapped",
          propertyKey: "other_prop",
          driverModule: "unknown-ic",
          compatiblePatterns: null,
          attributionModules: [],
          valueShape: { kind: "strings" }
        }
      ])
    });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const library = await screen.findByRole("region", { name: "参数定义库" });
    const table = within(library).getByRole("table");
    expect(within(library).getByRole("columnheader", { name: "所属模块" })).toBeInTheDocument();
    expect(within(table).getByText("充电策略")).toBeInTheDocument();
    expect(within(table).getByText("unknown-ic（未实测）")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "驱动模块" })).not.toBeInTheDocument();
    expect(within(table).queryByText("（预测）")).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "compatible" })).not.toBeInTheDocument();
    expect(within(table).getByText("cells")).toBeInTheDocument();
    expect(within(table).getByText("strings")).toBeInTheDocument();
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();
    renderPage({ repository, path: "/parameter-admin/specs" });

    const library = await screen.findByRole("region", { name: "参数定义库" });
    expect(within(library).getAllByText("gpio_int").length).toBeGreaterThan(0);
    expect(within(library).getAllByRole("button", { name: "编辑 gpio_int" }).length).toBeGreaterThan(0);

    cleanup();
    renderPage({ repository, path: "/parameter-admin/specs" });

    const queue = await screen.findByRole("region", { name: "定义匹配审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));
    const dialog = screen.getByRole("dialog", { name: "gpio_int" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "选择参数定义" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
      target: { value: "Mock approve" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "批准" }));

    await waitFor(() => expect(within(queue).getByText("没有待确认的自动匹配。")).toBeInTheDocument());
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
