import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
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

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin-next");
});

const SPEC_SUMMARY: ParameterSpecSummary = {
  id: "spec-sc8562-gpio-int",
  organizationId: "org-teaching",
  sourceKind: "dts",
  specificationKey: "dts/sc8562/gpio_int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  lifecycle: "active",
  currentVersionId: "specver-sc8562-gpio-int-3",
  currentVersion: 3
};

const SPEC_DETAIL: ParameterSpecDetail = {
  ...SPEC_SUMMARY,
  displayName: "SC8562 GPIO interrupt",
  description: "Interrupt GPIO cells",
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
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

const SEED_REGISTRY: ParameterModuleRegistry = {
  modules: [
    { id: "mod-charging", name: "充电策略", parentId: null, sortOrder: 0, importance: "high" },
    { id: "mod-battery", name: "电池安全", parentId: "mod-charging", sortOrder: 1, importance: "medium" }
  ],
  mappings: [
    {
      id: "map-sc8562",
      moduleId: "mod-charging",
      matchKind: "driver",
      matchValue: "sc8562",
      priority: 100
    }
  ]
};

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn().mockResolvedValue([SPEC_SUMMARY]),
    getSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [OPEN_REVIEW_TASK], nextCursor: null }),
    resolveSpecReviewTask: vi.fn().mockResolvedValue(undefined),
    activateParameterSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
    listBindings: vi.fn().mockResolvedValue([]),
    listBindingHistory: vi.fn().mockResolvedValue([]),
    listBindingCompare: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn(),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

function createModuleRegistry(
  overrides: Partial<ParameterModuleRegistryRepository> = {}
): ParameterModuleRegistryRepository {
  let registry: ParameterModuleRegistry = {
    modules: SEED_REGISTRY.modules.map((module) => ({ ...module })),
    mappings: SEED_REGISTRY.mappings.map((mapping) => ({ ...mapping }))
  };
  let moduleSeq = 0;
  let mappingSeq = 0;

  const base: ParameterModuleRegistryRepository = {
    getRegistry: vi.fn(async () => ({
      modules: registry.modules.map((module) => ({ ...module })),
      mappings: registry.mappings.map((mapping) => ({ ...mapping }))
    })),
    getDiscoveryHints: vi.fn(async () => ({
      compatibles: [{ compatible: "vendor,unmapped-ic", bindingCount: 2 }]
    })),
    createModule: vi.fn(async (input) => {
      moduleSeq += 1;
      registry = {
        ...registry,
        modules: [
          ...registry.modules,
          {
            id: `mod-new-${moduleSeq}`,
            name: input.name,
            parentId: input.parentId ?? null,
            sortOrder: input.sortOrder ?? registry.modules.length,
            importance: input.importance ?? "medium"
          }
        ]
      };
      return {
        modules: registry.modules.map((module) => ({ ...module })),
        mappings: registry.mappings.map((mapping) => ({ ...mapping }))
      };
    }),
    updateModule: vi.fn(async (moduleId, input) => {
      registry = {
        ...registry,
        modules: registry.modules.map((module) =>
          module.id === moduleId
            ? {
                ...module,
                name: input.name ?? module.name,
                parentId: input.parentId === undefined ? module.parentId : input.parentId,
                sortOrder: input.sortOrder ?? module.sortOrder,
                importance: input.importance ?? module.importance
              }
            : module
        )
      };
      return {
        modules: registry.modules.map((module) => ({ ...module })),
        mappings: registry.mappings.map((mapping) => ({ ...mapping }))
      };
    }),
    deleteModule: vi.fn(async (moduleId) => {
      registry = {
        modules: registry.modules.filter((module) => module.id !== moduleId),
        mappings: registry.mappings.filter((mapping) => mapping.moduleId !== moduleId)
      };
      return {
        modules: registry.modules.map((module) => ({ ...module })),
        mappings: registry.mappings.map((mapping) => ({ ...mapping }))
      };
    }),
    createMapping: vi.fn(async (input) => {
      mappingSeq += 1;
      registry = {
        ...registry,
        mappings: [
          ...registry.mappings,
          {
            id: `map-new-${mappingSeq}`,
            moduleId: input.moduleId,
            matchKind: input.matchKind,
            matchValue: input.matchValue,
            priority: input.priority ?? 0
          }
        ]
      };
      return {
        modules: registry.modules.map((module) => ({ ...module })),
        mappings: registry.mappings.map((mapping) => ({ ...mapping }))
      };
    }),
    deleteMapping: vi.fn(async (mappingId) => {
      registry = {
        ...registry,
        mappings: registry.mappings.filter((mapping) => mapping.id !== mappingId)
      };
      return {
        modules: registry.modules.map((module) => ({ ...module })),
        mappings: registry.mappings.map((mapping) => ({ ...mapping }))
      };
    }),
    recomputeBindings: vi.fn(async () => ({ updated: 3, conflicts: [] }))
  };

  return { ...base, ...overrides };
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
} = {}) {
  const path = options.path ?? "/parameter-admin-next";
  window.history.replaceState(null, "", path);
  const onNavigate = options.onNavigate ?? vi.fn();
  const repository = options.repository ?? createRepository();
  const moduleRegistry = options.moduleRegistry ?? createModuleRegistry();
  const dispatch = options.dispatch ?? vi.fn();
  const parameterActions = options.parameterActions;
  const area =
    options.area ??
    (path.startsWith("/parameter-admin-next/projects") ? "projects" : "organization");
  const search = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";

  render(
    <ParameterAdminNextPage
      area={area}
      onNavigate={onNavigate}
      search={search}
      runtimeMode={options.runtimeMode ?? "mock"}
      parameterTopologyRepository={repository}
      parameterModuleRegistryRepository={moduleRegistry}
      projects={initialState.configDraft.projects}
      parameters={initialState.parameters}
      activeProjectId={initialState.activeProjectId}
      dispatch={dispatch}
      parameterActions={parameterActions}
    />
  );

  return { onNavigate, repository, moduleRegistry, dispatch, parameterActions };
}

describe("ParameterAdminNextPage · shell", () => {
  it("presents organization and project areas as peer destinations", () => {
    const { onNavigate } = renderPage();

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "组织治理" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "项目运营" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(nav).getByRole("button", { name: "项目运营" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin-next/projects");
  });

  it("opens the project area as its own destination", async () => {
    renderPage({ path: "/parameter-admin-next/projects", area: "projects" });

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "项目运营" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByText(/项目参数文件与配置集将在后续任务交付/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数规格库" })).not.toBeInTheDocument();
  });
});

describe("ParameterAdminNextPage · organization spec governance", () => {
  it("loads the spec library through the injected topology port", async () => {
    const repository = createRepository();
    renderPage({ repository });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).getByText("gpio_int")).toBeInTheDocument();
    expect(repository.listSpecs).toHaveBeenCalled();
    expect(repository.listSpecReviewTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" })
    );
  });

  it("keeps filters, sort, and selection in the URL", async () => {
    const repository = createRepository();
    renderPage({ repository });

    await screen.findByRole("region", { name: "参数规格库" });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索规格" }), {
      target: { value: "gpio" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "生命周期" }), {
      target: { value: "active" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "排序" }), {
      target: { value: "propertyKey-desc" }
    });
    fireEvent.click(screen.getByRole("button", { name: "查看 gpio_int" }));

    await waitFor(() => {
      const params = new URL(window.location.href).searchParams;
      expect(params.get("q")).toBe("gpio");
      expect(params.get("lifecycle")).toBe("active");
      expect(params.get("sort")).toBe("propertyKey-desc");
      expect(params.get("spec")).toBe("spec-sc8562-gpio-int");
    });
  });

  it("opens spec detail with schema provenance", async () => {
    const repository = createRepository();
    renderPage({
      repository,
      path: "/parameter-admin-next?spec=spec-sc8562-gpio-int"
    });

    const detail = await screen.findByRole("region", { name: "规格详情" });
    expect(within(detail).getByText("gpio_int")).toBeInTheDocument();
    const history = within(detail).getByRole("region", { name: "Schema 历史" });
    expect(within(history).getByText(/v3 · vendor,sc8562\/bindings/)).toBeInTheDocument();
    expect(repository.getSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int");
  });

  it("resolves a spec review task and surfaces a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    expect(within(queue).getByText("compatible unmatched")).toBeInTheDocument();

    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Matched SC8562" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "批准" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "resolved",
        parameterSpecId: "spec-sc8562-gpio-int",
        reason: "Matched SC8562"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());

    const audit = screen.getByRole("status", { name: "治理审计" });
    expect(audit).toHaveTextContent(/spec-review-resolved/);
    expect(audit).toHaveTextContent(/Matched SC8562/);
  });

  it("dismisses a spec review task with a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Not actionable" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "驳回" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-gpio-int", {
        decision: "dismissed",
        reason: "Not actionable"
      })
    );
    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-dismissed/);
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

    renderPage({ repository });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Need manual draft" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "创建草稿规格" }));

    await waitFor(() =>
      expect(resolveSpecReviewTask).toHaveBeenCalledWith("review-task-mystery", {
        decision: "resolved",
        createSpec: true,
        reason: "Need manual draft"
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-create-spec/)
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/草稿规格「mystery_prop」已创建/);
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();
    renderPage({ repository });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).getAllByText("gpio_int").length).toBeGreaterThan(0);
    expect(within(library).getAllByRole("button", { name: "查看 gpio_int" }).length).toBeGreaterThan(0);

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "spec-sc8562-gpio-int" }
    });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Mock approve" }
    });
    fireEvent.click(within(queue).getByRole("button", { name: "批准" }));

    await waitFor(() => expect(within(queue).getByText("没有待审核的推理规格。")).toBeInTheDocument());
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/spec-review-resolved/);
  });
});

describe("ParameterAdminNextPage · organization module tree and driver mapping", () => {
  it("loads the module registry through the injected module registry port", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });
    expect(within(panel).getAllByText("充电策略").length).toBeGreaterThan(0);
    expect(within(panel).getByText("driver:sc8562")).toBeInTheDocument();
    expect(moduleRegistry.getRegistry).toHaveBeenCalled();
  });

  it("creates, renames, moves, and deletes modules with governance audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });

    fireEvent.change(within(panel).getByRole("textbox", { name: "模块名称" }), {
      target: { value: "电源路径" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "创建模块" }));

    await waitFor(() => expect(moduleRegistry.createModule).toHaveBeenCalledWith(
      expect.objectContaining({ name: "电源路径" })
    ));
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "重命名模块 电源路径" })).toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-created/);

    fireEvent.click(within(panel).getByRole("button", { name: "重命名模块 电源路径" }));
    fireEvent.change(within(panel).getByRole("textbox", { name: "新模块名称" }), {
      target: { value: "电源路径组" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "确认重命名" }));

    await waitFor(() =>
      expect(moduleRegistry.updateModule).toHaveBeenCalledWith(
        "mod-new-1",
        expect.objectContaining({ name: "电源路径组" })
      )
    );
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "重命名模块 电源路径组" })).toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-renamed/);

    fireEvent.change(within(panel).getByRole("combobox", { name: "移动模块 电源路径组" }), {
      target: { value: "mod-charging" }
    });
    await waitFor(() =>
      expect(moduleRegistry.updateModule).toHaveBeenCalledWith("mod-new-1", {
        parentId: "mod-charging"
      })
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-moved/);

    fireEvent.click(within(panel).getByRole("button", { name: "删除模块 电源路径组" }));
    await waitFor(() => expect(moduleRegistry.deleteModule).toHaveBeenCalledWith("mod-new-1"));
    await waitFor(() =>
      expect(within(panel).queryByRole("button", { name: "删除模块 电源路径组" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-deleted/);
  });

  it("creates and removes driver, compatible, and instance mappings with audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });

    fireEvent.change(within(panel).getByRole("combobox", { name: "目标模块" }), {
      target: { value: "mod-charging" }
    });
    fireEvent.change(within(panel).getByRole("combobox", { name: "匹配类型" }), {
      target: { value: "compatible" }
    });
    fireEvent.change(within(panel).getByRole("textbox", { name: "匹配值" }), {
      target: { value: "vendor,mt5788" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "添加映射" }));

    await waitFor(() =>
      expect(moduleRegistry.createMapping).toHaveBeenCalledWith({
        moduleId: "mod-charging",
        matchKind: "compatible",
        matchValue: "vendor,mt5788"
      })
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-mapping-created/);

    fireEvent.change(within(panel).getByRole("combobox", { name: "匹配类型" }), {
      target: { value: "instance" }
    });
    fireEvent.change(within(panel).getByRole("textbox", { name: "匹配值" }), {
      target: { value: "sc8562@6E" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "添加映射" }));

    await waitFor(() =>
      expect(moduleRegistry.createMapping).toHaveBeenCalledWith({
        moduleId: "mod-charging",
        matchKind: "instance",
        matchValue: "sc8562@6E"
      })
    );

    fireEvent.click(within(panel).getByRole("button", { name: "删除映射 compatible:vendor,mt5788" }));
    await waitFor(() => expect(moduleRegistry.deleteMapping).toHaveBeenCalled());
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-mapping-deleted/);
  });

  it("surfaces unmapped drivers as a queue and shows recompute outcome", async () => {
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue([
        SPEC_SUMMARY,
        { ...SPEC_SUMMARY, id: "spec-mt5788-gpio-int", driverModule: "mt5788", propertyKey: "gpio_int" }
      ])
    });
    const moduleRegistry = createModuleRegistry();
    renderPage({ repository, moduleRegistry });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });
    const driverQueue = within(panel).getByRole("region", { name: "模块发现队列（driver）" });
    expect(within(driverQueue).getByText("mt5788")).toBeInTheDocument();
    expect(within(driverQueue).queryByText("sc8562")).not.toBeInTheDocument();

    const compatibleQueue = within(panel).getByRole("region", { name: "模块发现队列（compatible）" });
    expect(within(compatibleQueue).getByText("vendor,unmapped-ic")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "重算模块归属" }));
    await waitFor(() => expect(moduleRegistry.recomputeBindings).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(panel).getByText(/已重算模块归属，更新 3 个参数绑定/)).toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(
      /module-bindings-recomputed/
    );
  });

  it("behaves identically when backed by the mock module registry adapter", async () => {
    const moduleRegistry = createMockParameterModuleRegistryRepository();
    renderPage({ moduleRegistry });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });
    expect(within(panel).getAllByText("充电策略").length).toBeGreaterThan(0);

    fireEvent.change(within(panel).getByRole("textbox", { name: "模块名称" }), {
      target: { value: "Mock 模块" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "创建模块" }));
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "重命名模块 Mock 模块" })).toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-created/);
  });
});

describe("ParameterAdminNextPage · organization bulk import", () => {
  it("opens the import wizard from the organization area", async () => {
    renderPage({ parameterActions: createParameterActions() });

    const importRegion = await screen.findByRole("region", { name: "批量参数导入" });
    fireEvent.click(within(importRegion).getByRole("button", { name: "打开批量参数导入" }));

    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });
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
    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });

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
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/import-batch-applied/)
    );
  });

  it("parses CSV paste into the review step", async () => {
    renderPage({ parameterActions: createParameterActions() });

    fireEvent.click(await screen.findByRole("button", { name: "打开批量参数导入" }));
    const dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });

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
    let dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });

    fillPasteImportContent(dialog, '/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n');
    expect(within(dialog).getByRole("status")).toHaveTextContent("将使用服务端解析");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("/include/");

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "打开批量参数导入" }));
    dialog = screen.getByRole("dialog", { name: "批量参数导入向导" });

    fillPasteImportContent(dialog, `/dts-v1/;\n/ { oversized = <${"1 ".repeat(20)}>; };\n`);
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/2097152 byte limit|exceeds/i);
  });
});
