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
  window.history.replaceState(null, "", "/parameter-admin");
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
  currentVersion: 3,
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  compatiblePatterns: ["vendor,sc8562"]
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
    updateParameterSpec: vi.fn().mockResolvedValue(SPEC_DETAIL),
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
  parameterFileRepository?: import("@/application/ports/ParameterFileRepository").ParameterFileRepository;
  dtsStructuredRepository?: import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository;
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

  render(
    <ParameterAdminNextPage
      area={area}
      onNavigate={onNavigate}
      search={search}
      pathname={pathname}
      runtimeMode={options.runtimeMode ?? "mock"}
      parameterTopologyRepository={repository}
      parameterModuleRegistryRepository={moduleRegistry}
      parameterFileRepository={options.parameterFileRepository}
      dtsStructuredRepository={options.dtsStructuredRepository}
      projects={(options.state ?? initialState).configDraft.projects}
      parameters={(options.state ?? initialState).parameters}
      activeProjectId={(options.state ?? initialState).activeProjectId}
      dispatch={dispatch}
      parameterActions={parameterActions}
      state={options.state ?? initialState}
    />
  );

  return { onNavigate, repository, moduleRegistry, dispatch, parameterActions };
}

describe("ParameterAdminNextPage · shell", () => {
  it("presents organization and project areas as peer destinations", () => {
    const { onNavigate } = renderPage({ path: "/parameter-admin/specs" });

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "组织治理" })).toHaveAttribute("aria-current", "page");
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

    const nav = screen.getByRole("navigation", { name: "参数管理后台治理范围" });
    expect(within(nav).getByRole("button", { name: "项目运营" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数规格库" })).not.toBeInTheDocument();
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

  it("renders only the spec library on /parameter-admin/specs", async () => {
    renderPage({ path: "/parameter-admin/specs" });

    expect(await screen.findByRole("region", { name: "参数规格库" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "规格审核队列" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "模块映射管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "身份映射治理" })).not.toBeInTheDocument();
  });

  it("renders only the spec review queue on /parameter-admin/spec-review", async () => {
    renderPage({ path: "/parameter-admin/spec-review" });

    expect(await screen.findByRole("region", { name: "规格审核队列" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数规格库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "模块映射管理" })).not.toBeInTheDocument();
  });

  it("marks the active organization sub-view and navigates between peers", async () => {
    const { onNavigate } = renderPage({ path: "/parameter-admin/modules" });

    const orgNav = await screen.findByRole("navigation", { name: "组织治理子视图" });
    expect(within(orgNav).getByRole("button", { name: "模块映射" })).toHaveAttribute("aria-current", "page");
    expect(within(orgNav).getByRole("button", { name: "规格库" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(orgNav).getByRole("button", { name: "规格审核" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/spec-review");
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
      expect.objectContaining({ status: "open", limit: 20 })
    );
  });

  it("keeps filters and selection in the URL", async () => {
    const repository = createRepository();
    renderPage({ repository });

    await screen.findByRole("region", { name: "参数规格库" });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索规格" }), {
      target: { value: "gpio" }
    });
    const lifecycleTrigger = screen.getByRole("button", { name: "筛选审核状态" });
    fireEvent.click(lifecycleTrigger);
    fireEvent.click(screen.getByRole("checkbox", { name: "active" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 gpio_int" }));

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

    const detail = await screen.findByRole("dialog", { name: /规格详情 gpio_int/ });
    expect(within(detail).getByRole("heading", { name: "gpio_int" })).toBeInTheDocument();
    expect(within(detail).getByLabelText("属性键")).toHaveValue("gpio_int");
    expect(within(detail).getByLabelText("展示名")).toHaveValue("SC8562 GPIO interrupt");
    expect(within(detail).getByLabelText("compatible")).toHaveValue("vendor,sc8562");
    expect((within(detail).getByLabelText("规格说明") as HTMLTextAreaElement).value).toMatch(
      /three-cell interrupt/
    );
    expect((within(detail).getByLabelText("Schema 历史") as HTMLTextAreaElement).value).toMatch(
      /v3 · vendor,sc8562\/bindings/
    );
    expect(within(detail).getByText("参数规格库 · 可编辑")).toBeInTheDocument();
    expect(repository.getSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int");

    fireEvent.click(within(detail).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get("spec")).toBeNull();
    });
  });

  it("resolves a spec review task and surfaces a governance audit record", async () => {
    const listSpecReviewTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [OPEN_REVIEW_TASK], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const resolveSpecReviewTask = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository({ listSpecReviewTasks, resolveSpecReviewTask });

    renderPage({ repository, path: "/parameter-admin/spec-review" });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    expect(within(queue).getByText("gpio_int")).toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
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

    renderPage({ repository, path: "/parameter-admin/spec-review" });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
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

    renderPage({ repository, path: "/parameter-admin/spec-review" });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "展开 mystery_prop" }));
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

  it("pages the review queue through the topology port cursor and expands one task at a time", async () => {
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

    renderPage({ repository, path: "/parameter-admin/spec-review" });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    expect(listSpecReviewTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", limit: 20 })
    );
    expect(within(queue).getByText("gpio_int")).toBeInTheDocument();
    expect(within(queue).queryByRole("combobox", { name: "选择 Schema" })).not.toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
    expect(within(queue).getByRole("combobox", { name: "选择 Schema" })).toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "加载更多" }));
    await waitFor(() =>
      expect(listSpecReviewTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: "open", limit: 20, cursor: "cursor-page-2" })
      )
    );
    expect(await within(queue).findByText("status")).toBeInTheDocument();

    fireEvent.click(within(queue).getByRole("button", { name: "展开 status" }));
    expect(within(queue).queryByRole("button", { name: "展开 gpio_int" })).toBeInTheDocument();
    expect(within(queue).queryByRole("combobox", { name: "选择 Schema" })).toBeInTheDocument();
    expect(within(queue).getAllByRole("combobox", { name: "选择 Schema" })).toHaveLength(1);
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

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).queryByText("#address-cells")).not.toBeInTheDocument();
    expect(within(library).getByText(/59 \/ 59/)).toBeInTheDocument();
    expect(within(library).getAllByRole("button", { name: /编辑 prop_/ })).toHaveLength(50);

    fireEvent.click(within(library).getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(within(library).getByText(/第 2/)).toBeInTheDocument();
    });
  });

  it("shows driver modules under 所属模块 column", async () => {
    const repository = createRepository({
      listSpecs: vi.fn().mockResolvedValue([
        {
          ...SPEC_SUMMARY,
          id: "spec-mapped",
          propertyKey: "gpio_int",
          driverModule: "sc8562",
          compatiblePatterns: ["vendor,sc8562"]
        },
        {
          ...SPEC_SUMMARY,
          id: "spec-unmapped",
          propertyKey: "other_prop",
          driverModule: "unknown-ic",
          compatiblePatterns: null,
          valueShape: { kind: "strings" }
        }
      ])
    });

    renderPage({ repository, path: "/parameter-admin/specs" });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    const table = within(library).getByRole("table");
    expect(within(library).getByRole("columnheader", { name: "所属模块" })).toBeInTheDocument();
    expect(within(table).getByText("sc8562")).toBeInTheDocument();
    expect(within(table).getByText("unknown-ic")).toBeInTheDocument();
    expect(within(table).queryByText("充电策略")).not.toBeInTheDocument();
    expect(within(table).queryByText("未映射")).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "compatible" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "驱动模块" })).not.toBeInTheDocument();
    expect(within(table).getByText("cells")).toBeInTheDocument();
    expect(within(table).getByText("strings")).toBeInTheDocument();
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();
    renderPage({ repository, path: "/parameter-admin/specs" });

    const library = await screen.findByRole("region", { name: "参数规格库" });
    expect(within(library).getAllByText("gpio_int").length).toBeGreaterThan(0);
    expect(within(library).getAllByRole("button", { name: "编辑 gpio_int" }).length).toBeGreaterThan(0);

    cleanup();
    renderPage({ repository, path: "/parameter-admin/spec-review" });

    const queue = await screen.findByRole("region", { name: "规格审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
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
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

    const panel = await screen.findByRole("region", { name: "模块映射管理" });
    expect(within(panel).getAllByText("充电策略").length).toBeGreaterThan(0);
    expect(within(panel).getByText("driver:sc8562")).toBeInTheDocument();
    expect(moduleRegistry.getRegistry).toHaveBeenCalled();
  });

  it("creates, renames, moves, and deletes modules with governance audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

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

    fireEvent.click(within(panel).getByRole("button", { name: "移动模块 电源路径组" }));
    fireEvent.click(within(panel).getByRole("button", { name: "根级（无父模块）" }));
    fireEvent.click(within(panel).getByRole("button", { name: "充电策略" }));
    fireEvent.click(within(panel).getByRole("button", { name: "确认移动" }));
    await waitFor(() =>
      expect(moduleRegistry.updateModule).toHaveBeenCalledWith("mod-new-1", {
        parentId: "mod-charging"
      })
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-moved/);

    fireEvent.click(within(panel).getByRole("button", { name: "展开 充电策略 子模块" }));
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "删除模块 电源路径组" })).toBeInTheDocument()
    );
    fireEvent.click(within(panel).getByRole("button", { name: "删除模块 电源路径组" }));
    await waitFor(() => expect(moduleRegistry.deleteModule).toHaveBeenCalledWith("mod-new-1"));
    await waitFor(() =>
      expect(within(panel).queryByRole("button", { name: "删除模块 电源路径组" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/module-deleted/);
  });

  it("creates and removes driver, compatible, and instance mappings with audit", async () => {
    const moduleRegistry = createModuleRegistry();
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

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
    renderPage({ repository, moduleRegistry, path: "/parameter-admin/modules" });

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
    renderPage({ moduleRegistry, path: "/parameter-admin/modules" });

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
      path: "/parameter-admin/identity-mapping"
    });

    const region = await screen.findByRole("region", { name: "身份映射治理" });
    expect(within(region).getByText("/amba/i2c@FDF5E000/sc8562@6E")).toBeInTheDocument();
    expect(within(region).getByText("unit address matched")).toBeInTheDocument();
    expect(listMappingTasks).toHaveBeenCalled();
  });

  it("resolves a mapping task via the lossless candidate identity path with audit", async () => {
    const listMappingTasks = vi
      .fn()
      .mockResolvedValueOnce([OPEN_MAPPING_TASK])
      .mockResolvedValueOnce([]);
    const resolveMapping = vi.fn().mockResolvedValue(undefined);
    renderPage({
      repository: createRepository({ listMappingTasks, resolveMapping }),
      path: "/parameter-admin/identity-mapping"
    });

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Same board instance" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));

    await waitFor(() =>
      expect(resolveMapping).toHaveBeenCalledWith("map-admin-1", {
        decision: "resolved",
        selectedLogicalNodeId: "logical-sc8562",
        reason: "Same board instance"
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/identity-mapping-resolved/)
    );
    await waitFor(() =>
      expect(screen.getByText("当前没有待处理的身份映射任务。")).toBeInTheDocument()
    );
  });

  it("behaves identically when backed by the mock topology adapter", async () => {
    renderPage({
      repository: createMockParameterTopologyRepository(),
      path: "/parameter-admin/identity-mapping"
    });

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Mock continuity" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/identity-mapping-resolved/)
    );
  });
});

describe("ParameterAdminNextPage · project-scoped routes and parameter files", () => {
  it("lists projects and opens the files view by route", async () => {
    const { onNavigate } = renderPage({
      path: "/parameter-admin/projects",
      area: "projects"
    });

    expect(await screen.findByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    const firstManage = screen.getAllByRole("button", { name: /管理文件/ })[0]!;
    fireEvent.click(firstManage);

    expect(onNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/parameter-admin\/projects\/[^/]+\/files$/)
    );
  });

  it("preserves the selected project file view from the URL without re-selection", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;
    const listFiles = vi.fn().mockResolvedValue([
      {
        id: "file-1",
        projectId,
        fileName: "board.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "v1",
        currentVersionNumber: 2,
        updatedAt: "2026-07-14T10:00:00.000Z"
      }
    ]);

    renderPage({
      path: `/parameter-admin/projects/${projectId}/files`,
      area: "projects",
      parameterFileRepository: {
        listFiles,
        uploadFile: vi.fn(),
        uploadVersion: vi.fn(),
        listVersions: vi.fn().mockResolvedValue([]),
        downloadVersion: vi.fn(),
        syncFile: vi.fn(),
        listConflicts: vi.fn().mockResolvedValue([]),
        resolveConflict: vi.fn()
      },
      dtsStructuredRepository: {
        listConfigSets: vi.fn().mockResolvedValue([]),
        createConfigSet: vi.fn(),
        addConfigSetFile: vi.fn(),
        removeConfigSetFile: vi.fn(),
        listBaselines: vi.fn().mockResolvedValue([]),
        createBaseline: vi.fn(),
        compareBaseline: vi.fn(),
        rollbackBaseline: vi.fn(),
        releaseBaseline: vi.fn(),
        exportConfigSet: vi.fn(),
        getStructure: vi.fn(),
        search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        submitStructuredEdits: vi.fn()
      }
    });

    const filesRegion = await screen.findByRole("region", { name: "项目参数文件" });
    expect(within(filesRegion).getByText(new RegExp(initialState.configDraft.projects[0]!.name))).toBeInTheDocument();
    expect(await screen.findByText("board.dts")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DTS 结构化检索" })).toBeInTheDocument();
    expect(listFiles).toHaveBeenCalledWith(projectId);
  });

  it("uploads a file, lists versions, and triggers manual sync producing a file-sync draft", async () => {
    const projectId = initialState.configDraft.projects[0]!.id;
    const uploadFile = vi.fn().mockResolvedValue({
      item: {
        id: "file-new",
        projectId,
        fileName: "new-board.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "v-new",
        currentVersionNumber: 1,
        updatedAt: "2026-07-14T10:00:00.000Z"
      },
      version: {
        id: "v-new",
        fileId: "file-new",
        versionNumber: 1,
        checksum: "xyz",
        sizeBytes: 8,
        parsedIndex: {},
        origin: "upload",
        createdAt: "2026-07-14T10:00:00.000Z"
      }
    });
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: "file-new",
          projectId,
          fileName: "new-board.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "v-new",
          currentVersionNumber: 1,
          updatedAt: "2026-07-14T10:00:00.000Z"
        }
      ]);
    const listVersions = vi.fn().mockResolvedValue([
      {
        id: "v-new",
        fileId: "file-new",
        versionNumber: 1,
        checksum: "xyz",
        sizeBytes: 8,
        parsedIndex: {},
        origin: "upload",
        createdAt: "2026-07-14T10:00:00.000Z"
      }
    ]);
    const syncFile = vi.fn().mockResolvedValue({ draftsCreated: 1, unchanged: 0, unmatched: 0, skipped: false });

    renderPage({
      path: `/parameter-admin/projects/${projectId}/files`,
      area: "projects",
      parameterFileRepository: {
        listFiles,
        uploadFile,
        uploadVersion: vi.fn(),
        listVersions,
        downloadVersion: vi.fn(),
        syncFile,
        listConflicts: vi.fn().mockResolvedValue([]),
        resolveConflict: vi.fn()
      },
      dtsStructuredRepository: {
        listConfigSets: vi.fn().mockResolvedValue([]),
        createConfigSet: vi.fn(),
        addConfigSetFile: vi.fn(),
        removeConfigSetFile: vi.fn(),
        listBaselines: vi.fn().mockResolvedValue([]),
        createBaseline: vi.fn(),
        compareBaseline: vi.fn(),
        rollbackBaseline: vi.fn(),
        releaseBaseline: vi.fn(),
        exportConfigSet: vi.fn(),
        getStructure: vi.fn(),
        search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        submitStructuredEdits: vi.fn()
      }
    });

    await screen.findByRole("region", { name: "项目参数文件" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["/dts-v1/;"], "new-board.dts", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("new-board.dts")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "查看版本" }));
    await waitFor(() => expect(listVersions).toHaveBeenCalled());
    expect(await screen.findByText(/版本 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "手动同步" }));
    await waitFor(() => expect(syncFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/已创建 1 条草稿/)).toBeInTheDocument());
  });

  it("edits a project with governance audit", async () => {
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
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/project-updated/);
  });
});

describe("ParameterAdminNextPage · project config sets, baselines, and validation", () => {
  const projectId = () => initialState.configDraft.projects[0]!.id;
  const projectName = () => initialState.configDraft.projects[0]!.name;

  function createDtsRepo(
    overrides: Partial<import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository> = {}
  ): import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository {
    return {
      listConfigSets: vi.fn().mockResolvedValue([
        {
          id: "cs-default",
          organizationId: "org-1",
          projectId: projectId(),
          name: "board-default",
          createdAt: "2026-07-14T08:00:00.000Z",
          updatedAt: "2026-07-14T08:00:00.000Z"
        }
      ]),
      createConfigSet: vi.fn(),
      addConfigSetFile: vi.fn().mockImplementation(async (_pid, configSetId, input) => ({
        configSetId,
        fileId: input.fileId,
        role: input.role,
        sortOrder: input.sortOrder ?? 0
      })),
      removeConfigSetFile: vi.fn().mockResolvedValue(undefined),
      listBaselines: vi.fn().mockResolvedValue([
        {
          id: "bl-1",
          organizationId: "org-1",
          configSetId: "cs-default",
          name: "v1-draft",
          status: "draft",
          createdAt: "2026-07-14T09:00:00.000Z"
        },
        {
          id: "bl-released",
          organizationId: "org-1",
          configSetId: "cs-default",
          name: "v0-released",
          status: "released",
          createdAt: "2026-07-14T08:30:00.000Z"
        }
      ]),
      createBaseline: vi.fn(),
      compareBaseline: vi.fn().mockResolvedValue({
        baselineId: "bl-1",
        members: [
          {
            fileId: "file-1",
            fileName: "board.dts",
            status: "version_changed",
            structuralDiff: [
              {
                kind: "prop_changed",
                nodePath: "demo",
                prop: "value",
                before: "<1>",
                after: "<2>"
              }
            ]
          }
        ]
      }),
      rollbackBaseline: vi.fn().mockResolvedValue({ baselineId: "bl-released", restored: 2 }),
      releaseBaseline: vi.fn().mockResolvedValue({
        item: {
          id: "bl-1",
          organizationId: "org-1",
          configSetId: "cs-default",
          name: "v1-draft",
          status: "released",
          createdAt: "2026-07-14T09:00:00.000Z"
        },
        gate: {
          ok: true,
          mode: "block",
          requiresConfirmation: false,
          diagnostics: [],
          compiler: "dtc"
        }
      }),
      exportConfigSet: vi.fn().mockResolvedValue({
        manifest: {
          configSetId: "cs-default",
          name: "board-default",
          projectId: projectId(),
          exportedAt: "2026-07-14T10:00:00.000Z",
          members: []
        },
        files: [{ name: "board.dts", format: "dts", content: "/dts-v1/;\n" }]
      }),
      getStructure: vi.fn(),
      search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      submitStructuredEdits: vi.fn(),
      ...overrides
    };
  }

  function createFileRepo(
    overrides: Partial<import("@/application/ports/ParameterFileRepository").ParameterFileRepository> = {}
  ): import("@/application/ports/ParameterFileRepository").ParameterFileRepository {
    return {
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-1",
          projectId: projectId(),
          fileName: "board.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "v1",
          currentVersionNumber: 1,
          updatedAt: "2026-07-14T10:00:00.000Z"
        }
      ]),
      uploadFile: vi.fn(),
      uploadVersion: vi.fn(),
      listVersions: vi.fn().mockResolvedValue([]),
      downloadVersion: vi.fn(),
      syncFile: vi.fn(),
      listConflicts: vi.fn().mockResolvedValue([]),
      resolveConflict: vi.fn(),
      ...overrides
    };
  }

  it("opens config sets by URL and keeps the project after reload-style remount", async () => {
    const dts = createDtsRepo();
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      dtsStructuredRepository: dts,
      parameterFileRepository: createFileRepo()
    });

    const region = await screen.findByRole("region", { name: "项目配置集与基线" });
    expect(within(region).getByText(new RegExp(projectName()))).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "配置集 / 基线" })).toBeInTheDocument();
    expect(dts.listConfigSets).toHaveBeenCalledWith(projectId());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("adjusts config-set membership and shows the default config set", async () => {
    const dts = createDtsRepo();
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      dtsStructuredRepository: dts,
      parameterFileRepository: createFileRepo()
    });

    await screen.findByRole("region", { name: "配置集 / 基线" });
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(screen.getByText("board-default")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "board.dts" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("成员文件"), { target: { value: "file-1" } });
    fireEvent.change(screen.getByLabelText("成员角色"), { target: { value: "overlay" } });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

    await waitFor(() =>
      expect(dts.addConfigSetFile).toHaveBeenCalledWith(projectId(), "cs-default", {
        fileId: "file-1",
        role: "overlay"
      })
    );
    const memberList = screen.getByRole("list", { name: "配置集成员" });
    expect(await within(memberList).findByText("board.dts")).toBeInTheDocument();
  });

  it("validates a config revision and shows structured toolchain diagnostics", async () => {
    const validateRevision = vi.fn().mockResolvedValue({
      id: "run-fail",
      status: "failed",
      stage: "toolchain",
      diagnostics: [
        { severity: "error", code: "dtc-error", message: "overlay overlap at node /soc/gpio" },
        { severity: "warning", message: "unused label power" }
      ]
    });
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      repository: createRepository({ validateRevision }),
      dtsStructuredRepository: createDtsRepo(),
      parameterFileRepository: createFileRepo()
    });

    await screen.findByRole("region", { name: "配置集 / 基线" });
    fireEvent.click(screen.getByRole("button", { name: "校验修订" }));

    await waitFor(() => expect(validateRevision).toHaveBeenCalled());
    const gate = await screen.findByRole("status", { name: "校验门禁结果" });
    expect(within(gate).getByText(/overlay overlap at node \/soc\/gpio/)).toBeInTheDocument();
    expect(within(gate).getByText(/unused label power/)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/revision-validated/);
  });

  it("compare, rollback, and release each produce governance audit records", async () => {
    const dts = createDtsRepo();
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      dtsStructuredRepository: dts,
      parameterFileRepository: createFileRepo()
    });

    await screen.findByText("v1-draft");

    fireEvent.click(screen.getByRole("button", { name: "对比 v1-draft" }));
    await waitFor(() => expect(dts.compareBaseline).toHaveBeenCalledWith(projectId(), "bl-1"));
    expect(await screen.findByRole("status", { name: "治理审计" })).toHaveTextContent(/baseline-compared/);

    fireEvent.click(screen.getByRole("button", { name: "回滚 v0-released" }));
    await waitFor(() => expect(dts.rollbackBaseline).toHaveBeenCalledWith(projectId(), "bl-released"));
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/baseline-rolled-back/);

    fireEvent.click(screen.getByRole("button", { name: "发布 v1-draft" }));
    await waitFor(() => expect(dts.releaseBaseline).toHaveBeenCalledWith(projectId(), "bl-1"));
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/baseline-released/);
  });

  it("exports the selected config set", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const dts = createDtsRepo();

    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      dtsStructuredRepository: dts,
      parameterFileRepository: createFileRepo()
    });

    await screen.findByRole("region", { name: "配置集 / 基线" });
    fireEvent.click(screen.getByRole("button", { name: "导出配置集" }));

    await waitFor(() => expect(dts.exportConfigSet).toHaveBeenCalledWith(projectId(), "cs-default"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/config-set-exported/);
  });

  it("behaves identically when backed by the mock dts and topology adapters", async () => {
    const { createMockDtsStructuredRepository } = await import(
      "@/infrastructure/mock/mockDtsStructuredRepository"
    );
    const { createMockParameterFileRepository } = await import(
      "@/infrastructure/mock/mockParameterFileRepository"
    );
    const { createMockParameterTopologyRepository } = await import(
      "@/infrastructure/mock/mockParameterTopologyRepository"
    );

    renderPage({
      path: `/parameter-admin/projects/${projectId()}/config-sets`,
      area: "projects",
      repository: createMockParameterTopologyRepository(),
      dtsStructuredRepository: createMockDtsStructuredRepository({ projectId: projectId() }),
      parameterFileRepository: createMockParameterFileRepository()
    });

    const panel = await screen.findByRole("region", { name: "配置集 / 基线" });
    fireEvent.change(within(panel).getByLabelText("配置集名称"), { target: { value: "mock-board" } });
    fireEvent.click(within(panel).getByRole("button", { name: "创建配置集" }));
    expect(await within(panel).findByText("mock-board")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "校验修订" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/revision-validated/)
    );
  });
});

describe("ParameterAdminNextPage · project structure and conflict adjudication", () => {
  const projectId = () => initialState.configDraft.projects[0]!.id;
  const projectName = () => initialState.configDraft.projects[0]!.name;

  function createDtsRepo(
    overrides: Partial<import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository> = {}
  ): import("@/application/ports/DtsStructuredRepository").DtsStructuredRepository {
    return {
      listConfigSets: vi.fn().mockResolvedValue([]),
      createConfigSet: vi.fn(),
      addConfigSetFile: vi.fn(),
      removeConfigSetFile: vi.fn(),
      listBaselines: vi.fn().mockResolvedValue([]),
      createBaseline: vi.fn(),
      compareBaseline: vi.fn(),
      rollbackBaseline: vi.fn(),
      releaseBaseline: vi.fn(),
      exportConfigSet: vi.fn(),
      getStructure: vi.fn().mockResolvedValue({
        nodes: [
          {
            nodePath: "soc/gpio",
            name: "gpio",
            labels: ["gpio_ctrl"],
            properties: [
              {
                name: "gpio_int",
                valueType: "u32-array",
                rawText: "<1 2 3>",
                normalizedValue: "1 2 3"
              }
            ],
            phandleRefs: []
          }
        ]
      }),
      search: vi.fn().mockResolvedValue({ hits: [] }),
      submitStructuredEdits: vi.fn(),
      ...overrides
    };
  }

  function createFileRepo(
    overrides: Partial<import("@/application/ports/ParameterFileRepository").ParameterFileRepository> = {}
  ): import("@/application/ports/ParameterFileRepository").ParameterFileRepository {
    return {
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-dts-1",
          projectId: projectId(),
          fileName: "board.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "ver-dts-1",
          currentVersionNumber: 1,
          updatedAt: "2026-07-14T10:00:00.000Z"
        }
      ]),
      uploadFile: vi.fn(),
      uploadVersion: vi.fn(),
      listVersions: vi.fn().mockResolvedValue([]),
      downloadVersion: vi.fn(),
      syncFile: vi.fn(),
      listConflicts: vi.fn().mockResolvedValue([]),
      resolveConflict: vi.fn(),
      ...overrides
    };
  }

  it("browses the source DTS structure by project route", async () => {
    const dts = createDtsRepo();
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/structure`,
      area: "projects",
      dtsStructuredRepository: dts,
      parameterFileRepository: createFileRepo()
    });

    const region = await screen.findByRole("region", { name: "项目源结构" });
    expect(within(region).getByText(new RegExp(projectName()))).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "结构浏览" })).toBeInTheDocument();
    await waitFor(() =>
      expect(dts.getStructure).toHaveBeenCalledWith(projectId(), "file-dts-1", "ver-dts-1")
    );
    expect(await screen.findByRole("treeitem", { name: /gpio/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a clear empty state when the project has no structured DTS file", async () => {
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/structure`,
      area: "projects",
      dtsStructuredRepository: createDtsRepo(),
      parameterFileRepository: createFileRepo({ listFiles: vi.fn().mockResolvedValue([]) })
    });

    expect(await screen.findByText(/当前项目没有可浏览的结构化 DTS 文件/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "结构浏览" })).not.toBeInTheDocument();
  });

  it("lists conflicts with both values and provenance, and resolves with audit", async () => {
    const resolveConflict = vi.fn().mockResolvedValue({
      id: "conflict-1",
      organizationId: "org-1",
      projectId: projectId(),
      projectParameterValueId: "value-1",
      parameterDefinitionId: "def-limit",
      parameterName: "fast_charge_current_limit_ma",
      parameterModule: "Charging Policy",
      fileVersionId: "version-1",
      fileDraftId: "file-draft-1",
      uiDraftId: "ui-draft-1",
      fileValue: "3200",
      uiDraftValue: "3400",
      status: "resolved_file",
      createdAt: "2026-07-11T11:00:00.000Z"
    });
    const listConflicts = vi
      .fn()
      .mockResolvedValue([
        {
          id: "conflict-1",
          organizationId: "org-1",
          projectId: projectId(),
          projectParameterValueId: "value-1",
          parameterDefinitionId: "def-limit",
          parameterName: "fast_charge_current_limit_ma",
          parameterModule: "Charging Policy",
          fileVersionId: "version-1",
          fileDraftId: "file-draft-1",
          uiDraftId: "ui-draft-1",
          fileValue: "3200",
          uiDraftValue: "3400",
          status: "open",
          createdAt: "2026-07-11T11:00:00.000Z"
        }
      ]);

    renderPage({
      path: `/parameter-admin/projects/${projectId()}/conflicts`,
      area: "projects",
      parameterFileRepository: createFileRepo({ listConflicts, resolveConflict }),
      dtsStructuredRepository: createDtsRepo()
    });

    const region = await screen.findByRole("region", { name: "项目文件冲突" });
    expect(within(region).getByText(new RegExp(projectName()))).toBeInTheDocument();
    expect(await screen.findByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();
    expect(screen.getByText("3200")).toBeInTheDocument();
    expect(screen.getByText("3400")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保留文件值" }));
    await waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith(projectId(), "conflict-1", "file")
    );
    expect(screen.getByRole("status", { name: "治理审计" })).toHaveTextContent(/file-conflict-resolved/);
  });

  it("shows a clear empty state when there are no open conflicts", async () => {
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/conflicts`,
      area: "projects",
      parameterFileRepository: createFileRepo({ listConflicts: vi.fn().mockResolvedValue([]) }),
      dtsStructuredRepository: createDtsRepo()
    });

    expect(await screen.findByText("当前项目没有待处理冲突。")).toBeInTheDocument();
  });

  it("behaves identically with mock file and dts adapters for structure and conflicts", async () => {
    const { createMockDtsStructuredRepository } = await import(
      "@/infrastructure/mock/mockDtsStructuredRepository"
    );
    const { createMockParameterFileRepository } = await import(
      "@/infrastructure/mock/mockParameterFileRepository"
    );

    renderPage({
      path: `/parameter-admin/projects/${projectId()}/structure`,
      area: "projects",
      dtsStructuredRepository: createMockDtsStructuredRepository({ projectId: projectId() }),
      parameterFileRepository: createMockParameterFileRepository()
    });

    expect(await screen.findByRole("region", { name: "结构浏览" })).toBeInTheDocument();

    cleanup();
    renderPage({
      path: `/parameter-admin/projects/${projectId()}/conflicts`,
      area: "projects",
      dtsStructuredRepository: createMockDtsStructuredRepository({ projectId: projectId() }),
      parameterFileRepository: createMockParameterFileRepository()
    });
    expect(await screen.findByRole("region", { name: "参数文件冲突处理" })).toBeInTheDocument();
  });
});
