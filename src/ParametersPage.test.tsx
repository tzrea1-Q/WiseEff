import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParametersPage } from "./ParametersPage";
import { TopBarActionsContext } from "./components/layout";
import { initialState } from "./mockData";
import type { ParameterPageActions } from "./app/routes";
import type { ParameterTopologyRepository } from "./application/ports/ParameterTopologyRepository";
import type {
  EffectiveTopologyNode,
  ParameterSpecDetail,
  ProjectParameterBinding,
  SourceTopologyNode
} from "./domain/parameter-topology/types";
import { selectModuleTreeFilter } from "./test/moduleTreeTestHelpers";

beforeEach(() => {
  cleanup();
});

describe("ParametersPage read-only access", () => {
  it("renders guest parameter workspace without edit controls when editing is not allowed", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByText("只读访问")).not.toBeInTheDocument();
    expect(screen.queryByText("需要 User 角色才能编辑、暂存或提交参数变更。")).not.toBeInTheDocument();
    expect(container.querySelector(".edit-row-button")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });

  it("does not expose the Agent insight one-click draft action to Guest", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByRole("button", { name: /草稿/ })).not.toBeInTheDocument();
    expect(screen.queryByText("需要 User 角色才能编辑、暂存或提交参数变更。")).not.toBeInTheDocument();
  });

  it("hides workflow-only topbar actions for Guest", () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    const topbar = container.querySelector(".topbar");
    expect(topbar).not.toBeNull();
    expect(within(topbar as HTMLElement).getByRole("button", { name: "导出 Excel" })).toBeInTheDocument();
    expect(within(topbar as HTMLElement).queryByRole("button", { name: "历史提交" })).not.toBeInTheDocument();
    expect(within(topbar as HTMLElement).queryByRole("button", { name: "AI 巡检" })).not.toBeInTheDocument();
  });

  it("does not retain a log-linked draft created while read-only after editing becomes available", async () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const guestState = { ...initialState, activeRoleId: "guest" };
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={guestState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={`?logId=${initialState.logs[0].id}`}
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByText("只读访问")).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    });
  });

  it("clears existing draft state when editing is revoked while mounted", async () => {
    const dispatch = vi.fn();
    const onNavigate = vi.fn();
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );
    const editButton = container.querySelector<HTMLButtonElement>(".edit-row-button");
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton!);
    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...initialState, activeRoleId: "guest" }}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByText("只读访问")).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".edit-row-button")).not.toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search=""
          canEdit
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions }), [setStableActions]);

  return (
    <TopBarActionsContext.Provider value={contextValue}>
      <header className="topbar">
        <div className="topbar-page-actions" role="toolbar" aria-label="项目参数用户工作台页面操作">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
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
      id: "preview-1",
      projectId: initialState.activeProjectId,
      sourceName: "test.json",
      status: "previewed",
      createdAt: "2026-05-25T08:00:00.000Z",
      summary: { added: 0, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: []
    }),
    applyImportBatch: vi.fn().mockResolvedValue(undefined),
    parseDtsImport: vi.fn().mockResolvedValue({ format: "dts-full", rows: [] }),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const API_SENTINEL_CONFIG_SET_ID = "config-api-boundary-sentinel-7ad0";
const API_SENTINEL_REVISION_ID = "revision-api-boundary-sentinel-7ad0";
const API_SENTINEL_PROPERTY = "sentinel_gpio_interrupt";
const API_SENTINEL_RAW_VALUE = "<&sentinel_gpio 31 7>";

const API_SENTINEL_SOURCE_NODES: SourceTopologyNode[] = [
  {
    id: "source-node-api-boundary-sentinel-7ad0",
    fileVersionId: "file-version-api-boundary-sentinel-7ad0",
    fileName: "api-boundary-sentinel.dtso",
    parentOccurrenceId: null,
    name: "sentinel-device",
    unitAddress: "7A",
    labels: ["sentinel_device"],
    isOverlayRoot: false,
    nodePath: "/sentinel-bus/sentinel-device@7A",
    startLine: 10,
    startColumn: 1,
    endLine: 14,
    endColumn: 1,
    contentHash: "source-hash-api-boundary-sentinel-7ad0",
    sourceOrder: 1,
    properties: [
      {
        id: "source-property-api-boundary-sentinel-7ad0",
        propertyName: API_SENTINEL_PROPERTY,
        startLine: 12,
        startColumn: 3,
        endLine: 12,
        endColumn: 43,
        contentHash: "property-hash-api-boundary-sentinel-7ad0",
        sourceOrder: 1
      }
    ]
  }
];

const API_SENTINEL_EFFECTIVE_NODES: EffectiveTopologyNode[] = [
  {
    id: "effective-node-api-boundary-sentinel-7ad0",
    logicalNodeId: "logical-node-api-boundary-sentinel-7ad0",
    locator: "/sentinel-bus/sentinel-device@7A",
    name: "sentinel-device",
    unitAddress: "7A",
    compatible: "wiseeff,sentinel-device",
    parentLogicalNodeId: null,
    effects: [
      {
        id: "effect-api-boundary-sentinel-7ad0",
        propertyName: API_SENTINEL_PROPERTY,
        effectKind: "set",
        nodeOccurrenceId: "source-node-api-boundary-sentinel-7ad0",
        propertyOccurrenceId: "source-property-api-boundary-sentinel-7ad0",
        sourceOrder: 1
      }
    ]
  }
];

const API_SENTINEL_BINDING: ProjectParameterBinding = {
  id: "binding-api-boundary-sentinel-7ad0",
  parameterSpecId: "spec-api-boundary-sentinel-7ad0",
  parameterSpecVersionId: "spec-version-api-boundary-sentinel-7ad0",
  propertyKey: API_SENTINEL_PROPERTY,
  driverModule: "sentinel-device",
  logicalNodeId: "logical-node-api-boundary-sentinel-7ad0",
  instanceName: "sentinel-device@7A",
  locator: "/sentinel-bus/sentinel-device@7A",
  effectiveValue: {
    kind: "cells",
    bits: 32,
    groups: [
      [
        { kind: "phandle", label: "sentinel_gpio" },
        { kind: "integer", raw: "31", value: "31" },
        { kind: "integer", raw: "7", value: "7" }
      ]
    ]
  },
  rawValue: API_SENTINEL_RAW_VALUE,
  schemaState: "valid",
  policyState: "pass"
};

const API_SENTINEL_SPEC: ParameterSpecDetail = {
  id: API_SENTINEL_BINDING.parameterSpecId,
  organizationId: "org-api-boundary-sentinel-7ad0",
  sourceKind: "dts",
  specificationKey: "sentinel-device/sentinel_gpio_interrupt",
  propertyKey: API_SENTINEL_PROPERTY,
  driverModule: "sentinel-device",
  lifecycle: "active",
  currentVersionId: API_SENTINEL_BINDING.parameterSpecVersionId,
  currentVersion: 1,
  displayName: "Sentinel GPIO interrupt",
  description: "API boundary sentinel only",
  valueShape: { kind: "phandle-list", bits: 32, groups: 1, cellsPerGroup: 3 },
  schemaDefault: null,
  exampleValue: null,
  schemaNamespace: "wiseeff,sentinel-device",
  units: null,
  constraints: { cells: 3 },
  documentation: "API boundary sentinel fixture",
  compatiblePatterns: ["wiseeff,sentinel-device"],
  policyTarget: null
};

function createApiBoundaryRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn<ParameterTopologyRepository["listSpecs"]>().mockResolvedValue([API_SENTINEL_SPEC]),
    getSpec: vi.fn<ParameterTopologyRepository["getSpec"]>().mockResolvedValue(API_SENTINEL_SPEC),
    activateParameterSpec: vi
      .fn<ParameterTopologyRepository["activateParameterSpec"]>()
      .mockResolvedValue(API_SENTINEL_SPEC),
    listSpecReviewTasks: vi
      .fn<ParameterTopologyRepository["listSpecReviewTasks"]>()
      .mockResolvedValue({ items: [], nextCursor: null }),
    resolveSpecReviewTask: vi
      .fn<ParameterTopologyRepository["resolveSpecReviewTask"]>()
      .mockResolvedValue(undefined),
    listBindings: vi
      .fn<ParameterTopologyRepository["listBindings"]>()
      .mockResolvedValue([API_SENTINEL_BINDING]),
    getTopology: vi.fn<ParameterTopologyRepository["getTopology"]>(async (
      projectId,
      configSetId,
      revisionId,
      view
    ) => {
      const resolvedRevisionId = revisionId === "current" ? API_SENTINEL_REVISION_ID : revisionId;
      if (view === "source") {
        return {
          view,
          projectId,
          configSetId,
          revisionId: resolvedRevisionId,
          status: "resolved",
          incompleteBase: false,
          diagnostics: [],
          nodes: API_SENTINEL_SOURCE_NODES
        };
      }
      return {
        view,
        projectId,
        configSetId,
        revisionId: resolvedRevisionId,
        status: "resolved",
        incompleteBase: false,
        diagnostics: [],
        nodes: API_SENTINEL_EFFECTIVE_NODES
      };
    }),
    listMappingTasks: vi
      .fn<ParameterTopologyRepository["listMappingTasks"]>()
      .mockResolvedValue([]),
    resolveMapping: vi
      .fn<ParameterTopologyRepository["resolveMapping"]>()
      .mockResolvedValue(undefined),
    validateRevision: vi
      .fn<ParameterTopologyRepository["validateRevision"]>()
      .mockResolvedValue({
        id: "validation-api-boundary-sentinel-7ad0",
        status: "passed",
        stage: "toolchain"
      }),
    createBindingDraft: vi
      .fn<ParameterTopologyRepository["createBindingDraft"]>()
      .mockResolvedValue({
        draftId: "draft-api-boundary-sentinel-7ad0",
        parameterId: API_SENTINEL_BINDING.id,
        candidateRevisionId: "candidate-api-boundary-sentinel-7ad0",
        rawText: API_SENTINEL_RAW_VALUE,
        action: "set",
        parameterSpecId: API_SENTINEL_BINDING.parameterSpecId,
        projectParameterBindingId: API_SENTINEL_BINDING.id,
        writeTarget: {
          role: "overlay",
          propertyKey: API_SENTINEL_PROPERTY,
          targetRef: "sentinel_device"
        },
        overlayFileId: "overlay-file-api-boundary-sentinel-7ad0",
        overlayFileName: "api-boundary-sentinel.dtso"
      }),
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createParametersPageState(overrides: Partial<typeof initialState> = {}) {
  return {
    ...initialState,
    changeRequests: [],
    ...overrides
  };
}

function renderPage(
  dispatch = vi.fn(),
  onNavigate = vi.fn(),
  parameterActions?: ParameterPageActions,
  state = createParametersPageState()
) {
  const result = render(
    <TopBarActionsHarness>
      <ParametersPage
        state={state}
        dispatch={dispatch}
        onNavigate={onNavigate}
        search=""
        parameterActions={parameterActions}
      />
    </TopBarActionsHarness>
  );

  return { ...result, dispatch, onNavigate };
}

function fillVisibleDraftReasons(baseReason = "参数调整原因") {
  screen.getAllByLabelText(/修改原因/).forEach((input, index) => {
    fireEvent.change(input, {
      target: { value: `${baseReason} ${index + 1}` }
    });
  });
}

describe("ParametersPage parameter detail modal", () => {
  it("opens the detail modal from a row view action without changing the pathname", () => {
    window.history.pushState({}, "", "/parameters");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(window.location.pathname).toBe("/parameters");
    expect(screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" })).toBeInTheDocument();
  });

  it("loads API detail history when opening a parameter detail modal", async () => {
    const detailedParameter = {
      ...initialState.parameters[0],
      history: [
        {
          version: "api-v2",
          value: "3333",
          changedAt: "2026-05-29T00:00:00.000Z",
          changedBy: "API Detail Loader"
        }
      ]
    };
    const getParameter = vi.fn().mockResolvedValue(detailedParameter);
    const parameterActions = createParameterActions() as ParameterPageActions & {
      getParameter: typeof getParameter;
    };
    parameterActions.getParameter = getParameter;
    const { container } = renderPage(vi.fn(), vi.fn(), parameterActions);
    const viewButton = container.querySelector<HTMLButtonElement>(".view-row-button");

    expect(viewButton).not.toBeNull();
    fireEvent.click(viewButton!);

    await waitFor(() => expect(getParameter).toHaveBeenCalledWith(initialState.parameters[0].id));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    await waitFor(() => expect(within(dialog).getByText(/API Detail Loader/)).toBeInTheDocument());
  });

  it("shows the parameter definition and every runtime project", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });

    expect(within(dialog).getByRole("region", { name: "参数定义" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "跨项目对比" })).toBeInTheDocument();
    ["AUR-Prod", "NEB-RD", "ATL-Intl"].forEach((projectCode) => {
      expect(within(dialog).getAllByText(projectCode).length).toBeGreaterThan(0);
    });
  });

  it("updates the focused delta when the comparison target changes", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    expect(within(dialog).getByText("+350 mA (+9.1%)")).toBeInTheDocument();
    expect(within(dialog).getByText("对比 AUR-Prod 与 NEB-RD")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("对比目标项目"), {
      target: { value: "atlas" }
    });

    expect(within(dialog).getByText("-850 mA (-22.1%)")).toBeInTheDocument();
    expect(within(dialog).getByText("对比 AUR-Prod 与 ATL-Intl")).toBeInTheDocument();
  });

  it("adds the viewed parameter to the existing modification draft sheet", () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    fireEvent.click(screen.getByRole("button", { name: "加入修改草稿" }));

    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3200")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("adds the recommended config from the detail modal to the modification draft", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    fireEvent.click(screen.getByRole("button", { name: "使用推荐配置加入草稿" }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByDisplayValue("3200")).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue("使用推荐配置生成草稿")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("adds the selected comparison project value from the detail modal to the modification draft", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });
    fireEvent.change(within(dialog).getByLabelText("对比目标项目"), {
      target: { value: "atlas" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "使用该项目配置加入草稿" }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByDisplayValue("3000")).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue("参考 ATL-Intl 项目当前配置生成草稿")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("reuses an existing draft when viewing the same parameter from the modal", () => {
    const { container } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(screen.getByRole("button", { name: "已在草稿中" })).toBeDisabled();
    expect(container.querySelectorAll(".draft-card")).toHaveLength(1);
    expect(screen.getByDisplayValue("3200")).toBeInTheDocument();
  });

  it("closes the stale detail modal on project switch and cannot add the old project parameter to drafts", () => {
    const { container, rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          effectiveProjectId="aurora"
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    expect(screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" })).toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          effectiveProjectId="nebula"
        />
      </TopBarActionsHarness>
    );

    expect(screen.queryByRole("dialog", { name: "fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入修改草稿" })).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("ignores stale log-linked parameters from another project when seeding drafts", () => {
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search="?logId=log-active&parameter=nebula-fast-charge-current"
          effectiveProjectId="aurora"
          canEdit
        />
      </TopBarActionsHarness>
    );

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
  });

  it("shows initialization-specific disabled reasons when initialization is locked even if canEdit is false", () => {
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          canEdit={false}
          initializationStatus="initialization_pending_review"
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });

    expect(dialog.querySelector(".parameter-detail-disabled-reason")).toHaveTextContent("初始化通过前暂不可提交普通参数变更。");
    expect(screen.getByText("该项目可查看，初始化通过前暂不可提交普通参数变更。")).toBeInTheDocument();
    expect(screen.queryByText("需要 User 角色才能编辑、暂存或提交参数变更。")).not.toBeInTheDocument();
  });

  it("allows read-only users to view details but disables adding to the draft", () => {
    const { container } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...initialState, activeRoleId: "guest" }}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          canEdit={false}
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));
    const dialog = screen.getByRole("dialog", { name: "fast_charge_current_limit_ma" });

    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入修改草稿" })).toBeDisabled();
    expect(dialog.querySelector(".parameter-detail-disabled-reason")).toHaveTextContent("需要 User 角色才能编辑、暂存或提交参数变更。");
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("does not render the standalone topbar comparison action", () => {
    const { container } = renderPage();
    const topbar = container.querySelector(".topbar");

    expect(topbar).not.toBeNull();
    expect(within(topbar as HTMLElement).queryByRole("button", { name: /跨项目对比/ })).not.toBeInTheDocument();
  });
});

describe("ParametersPage (抽出后的模块)", () => {
  it("可以从独立模块引入并渲染工作台根节点", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "项目参数用户工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Agent 参数洞察" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("参数筛选")).not.toBeInTheDocument();
  });

  it("从独立导出模块引入 Excel 导出 helper", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");

    expect(source).toContain("exportProjectParametersAsExcel");
    expect(source).toContain("./application/parameters/exportProjectParametersExcel");
    expect(source).not.toMatch(/function\s+exportProjectParametersAsExcel/);
  });

  it("不从 App 模块导入共享 UI 以避免循环依赖", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");

    expect(source).not.toContain('from "./App"');
  });
});

describe("ParametersPage draft edge cases", () => {
  it("renders the draft editor as a centered modal instead of the sheet shell", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑 fast_charge_current_limit_ma" }));

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(dialog.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(dialog.querySelector(".workbench-sheet")).not.toBeInTheDocument();
  });

  it("moves edited rows into the current-round modified table only after submitting the parameter draft", () => {
    renderPage();

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();

    fireEvent.click(within(searchTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();

    fillVisibleDraftReasons("移动到本轮已修改");
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));

    const modifiedTable = screen.getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();

    fireEvent.click(within(modifiedTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
  });

  it("does not render a dedicated breadcrumb page header", () => {
    renderPage();

    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(document.querySelector(".page-header")).not.toBeInTheDocument();
  });

  it("uses subtle-style topbar actions without a dedicated AI audit primary action", () => {
    const { container } = renderPage();
    const topbar = container.querySelector(".topbar");

    expect(topbar).not.toBeNull();
    ["导出 Excel", "历史提交"].forEach((label) => {
      const action = within(topbar as HTMLElement).getByRole("button", { name: label });
      expect(action).toHaveClass("button", "subtle");
    });
    expect(within(topbar as HTMLElement).queryByRole("button", { name: /跨项目对比/ })).not.toBeInTheDocument();

    const primaryActions = Array.from(topbar!.querySelectorAll<HTMLButtonElement>(".button.primary"));
    expect(primaryActions).toHaveLength(0);
  });

  it("keeps search separate while moving module and importance filters into table headers", () => {
    renderPage();

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    const toolbar = searchTable.querySelector(".parameters-table-toolbar");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" })).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: /^模块/ })).toBeInTheDocument();
    expect(within(toolbar as HTMLElement).queryByRole("button", { name: /重要性/ })).not.toBeInTheDocument();

    selectModuleTreeFilter("Charging Policy", ["Power", "Charging"]);

    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("battery_temp_target_c")).not.toBeInTheDocument();

    const riskHeader = within(searchTable).getByRole("columnheader", { name: /重要性/ });
    fireEvent.click(within(riskHeader).getByRole("button", { name: "筛选重要性" }));
    expect(within(riskHeader).getByRole("group", { name: "重要性筛选" })).toBeInTheDocument();
  });

  it("does not show the old hard-coded timeline inside the draft sheet", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByText("管理员合入")).not.toBeInTheDocument();
  });

  it("navigates to my submissions from the draft sheet footer", () => {
    const onNavigate = vi.fn();
    renderPage(vi.fn(), onNavigate);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    fireEvent.click(screen.getByRole("button", { name: "查看我的提交" }));

    expect(onNavigate).toHaveBeenCalledWith("/parameter-submissions");
  });

  it("uses the draft sheet submit-parameter action to keep the item in the modified table", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    const footer = container.querySelector<HTMLElement>(".parameter-draft-dialog .parameter-detail-dialog__footer");
    expect(footer).not.toBeNull();
    expect(within(searchTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /暂存本轮/ })).not.toBeInTheDocument();
    expect(within(footer!).queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog__body")).toBeInTheDocument();
    expect(container.querySelector(".parameter-draft-dialog__body")).toHaveClass("parameter-draft-dialog__body");

    const submitParameter = within(footer!).getByRole("button", { name: "提交参数" });
    fillVisibleDraftReasons("保留在本轮已修改");
    expect(submitParameter).toBeEnabled();
    fireEvent.click(submitParameter);

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /提交本轮参数/ })).not.toBeInTheDocument();
    const modifiedSection = screen.getByRole("region", { name: "本轮已修改参数区" });
    const modifiedTable = within(modifiedSection).getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(searchTable).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    const modifiedActions = modifiedSection.querySelector<HTMLElement>(".parameters-bottom-actions");
    expect(modifiedActions).toBeInTheDocument();
    expect(within(modifiedActions as HTMLElement).getByRole("button", { name: "提交本轮 (1 项)" })).toBeEnabled();
  });

  it("does not render an editable draft card for a focused unselected row", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getAllByText("charge_voltage_limit_mv")[0]);

    expect(container.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(container.querySelector(".focused-draft-editor")).not.toBeInTheDocument();
  });

  it("keeps preview closed when any selected draft has a blank target value", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    const targetInput = container.querySelector<HTMLTextAreaElement>(".draft-card textarea[aria-label*='目标值']");
    expect(targetInput).not.toBeNull();
    fireEvent.change(targetInput!, { target: { value: "   " } });

    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
    expect(container.querySelector(".submission-dialog")).not.toBeInTheDocument();
  });

  it("keeps drafts out of the modified table when the reason is blank", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "3200" } });
    fireEvent.change(screen.getByLabelText("修改原因"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "提交参数" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));

    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
  });

  it("clears every draft from the sheet header", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    fireEvent.click(screen.getByRole("button", { name: "全部清空" }));

    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
  });

  it("shows drift explanation in each draft card", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(within(sheet).getByText(/Agent 建议/)).toBeInTheDocument();
    expect(within(sheet).getByText(/当前偏差/)).toBeInTheDocument();
  });

  it("warns when target value is outside the configured range", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "99999" } });
    fireEvent.change(screen.getByLabelText("修改原因"), { target: { value: "验证越界风险" } });

    expect(screen.getByText(/超出 2500 - 4500 mA/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    expect(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]).toBeEnabled();
  });

  it("uses a multiline target value editor in the parameter draft sheet", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));

    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    const targetEditor = within(sheet).getByLabelText("目标值");
    const multilineValue = "profile=thermal\nlimit_ma=4200";

    expect(targetEditor.tagName).toBe("TEXTAREA");
    fireEvent.change(targetEditor, { target: { value: multilineValue } });
    expect(targetEditor).toHaveValue(multilineValue);
  });

  it("cleans up selection, drafts, and sheet state after submit", () => {
    const dispatch = vi.fn();
    const { container } = renderPage(dispatch);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    const reasonInput = container.querySelector<HTMLTextAreaElement>(".draft-card textarea[aria-label*='修改原因']");
    expect(reasonInput).not.toBeNull();
    fireEvent.change(reasonInput!, {
      target: { value: "submit cleanup reason" }
    });

    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    const confirmButton = container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary");
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [
        expect.objectContaining({
          parameterId: initialState.parameters[0].id,
          reason: "submit cleanup reason"
        })
      ]
    }));
    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });
});

describe("ParametersPage · 提交契约", () => {
  it("discards persisted stashed drafts when removing an item from the modified table", async () => {
    const restoredParameter = initialState.parameters[0];
    const discardDrafts = vi.fn().mockResolvedValue(undefined);
    const stashedState = createParametersPageState({
      parameterDrafts: [
        {
          id: "api-draft-1",
          projectId: initialState.activeProjectId,
          parameterId: restoredParameter.id,
          targetValue: "3300",
          reason: "刷新后继续提交",
          updatedAt: "2026-06-15T08:00:00.000Z"
        }
      ]
    });

    const { rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={stashedState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          parameterActions={createParameterActions({ discardDrafts })}
        />
      </TopBarActionsHarness>
    );

    const modifiedTable = screen.getByRole("region", { name: "本轮已修改参数表" });
    expect(within(modifiedTable).getByText("已暂存")).toBeInTheDocument();

    fireEvent.click(within(modifiedTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    await waitFor(() => {
      expect(discardDrafts).toHaveBeenCalledWith({
        projectId: initialState.activeProjectId,
        parameterIds: [restoredParameter.id]
      });
    });

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={{ ...stashedState, parameterDrafts: [] }}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          parameterActions={createParameterActions({ discardDrafts })}
        />
      </TopBarActionsHarness>
    );

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    expect(within(searchTable).getByText(restoredParameter.name)).toBeInTheDocument();
    expect(within(searchTable).queryByText("已暂存")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数表" })).not.toBeInTheDocument();
  });

  it("dispatches discard for mock-mode stashed rounds when clearing all drafts", async () => {
    const stashedParameter = initialState.parameters[0];
    const dispatch = vi.fn();
    const stashedState = createParametersPageState({
      parameterSubmissionRounds: [
        {
          id: "PRS-stash-1",
          projectId: initialState.activeProjectId,
          projectName: "Aurora 量产平台",
          submitter: "H. Zhao",
          createdAt: "刚刚",
          status: "已暂存" as const,
          summary: "本轮暂存包含 1 个参数修改。",
          items: [
            {
              requestId: "",
              parameterId: stashedParameter.id,
              name: stashedParameter.name,
              module: stashedParameter.module,
              currentValue: stashedParameter.currentValue,
              targetValue: "3300",
              unit: stashedParameter.unit,
              risk: stashedParameter.risk,
              reason: "暂存修改"
            }
          ]
        },
        ...initialState.parameterSubmissionRounds
      ]
    });

    render(
      <TopBarActionsHarness>
        <ParametersPage state={stashedState} dispatch={dispatch} onNavigate={vi.fn()} search="" />
      </TopBarActionsHarness>
    );

    const searchTable = screen.getByRole("region", { name: "检索参数表" });
    expect(within(searchTable).getByText("已暂存")).toBeInTheDocument();
    fireEvent.click(within(searchTable).getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "全部清空" }));

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: "DISCARD_STASHED_PARAMETER_DRAFTS",
        projectId: initialState.activeProjectId,
        parameterIds: [stashedParameter.id]
      });
    });
  });

  it("restores API-mode stashed drafts into the current-round modified table after refresh", () => {
    const restoredParameter = initialState.parameters[0];
    const restoredState = createParametersPageState({
      parameterDrafts: [
        {
          id: "api-draft-1",
          projectId: initialState.activeProjectId,
          parameterId: restoredParameter.id,
          targetValue: "3300",
          reason: "刷新后继续提交",
          updatedAt: "2026-06-15T08:00:00.000Z"
        }
      ]
    });

    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={restoredState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          parameterActions={createParameterActions()}
        />
      </TopBarActionsHarness>
    );

    const modifiedSection = screen.getByRole("region", { name: "本轮已修改参数区" });
    const modifiedTable = within(modifiedSection).getByRole("region", { name: "本轮已修改参数表" });
    const searchTable = screen.getByRole("region", { name: "检索参数表" });

    expect(within(modifiedTable).getByText(restoredParameter.name)).toBeInTheDocument();
    expect(within(modifiedTable).getByText("3300")).toBeInTheDocument();
    expect(within(searchTable).queryByText(restoredParameter.name)).not.toBeInTheDocument();
    expect(within(modifiedSection).getByRole("button", { name: "暂存本轮 (1 项)" })).toBeEnabled();
    expect(within(modifiedSection).getByRole("button", { name: "提交本轮 (1 项)" })).toBeEnabled();
  });

  it("clears current-round drafts when the signed-in user changes while the page stays mounted", async () => {
    const draftParameter = initialState.parameters[0];
    const softwareUser = initialState.users.find((user) => user.id === "u-liu-min");
    expect(softwareUser).toBeDefined();
    const hardwareUserState = {
      ...initialState,
      currentUserId: "u-zhao-heng",
      activeRoleId: "hardware-user"
    };
    const softwareUserState = {
      ...initialState,
      currentUserId: softwareUser!.id,
      activeRoleId: "software-user",
      parameterDrafts: []
    };
    const { rerender } = render(
      <TopBarActionsHarness>
        <ParametersPage
          state={hardwareUserState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          parameterActions={createParameterActions()}
        />
      </TopBarActionsHarness>
    );

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "hardware user local draft" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    expect(screen.getByRole("region", { name: "本轮已修改参数区" })).toBeInTheDocument();

    rerender(
      <TopBarActionsHarness>
        <ParametersPage
          state={softwareUserState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          parameterActions={createParameterActions()}
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "本轮已修改参数区" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "检索参数表" })).toHaveTextContent(draftParameter.name);
    expect(screen.queryByText("hardware user local draft")).not.toBeInTheDocument();
  });

  it("clicking submit calls parameterActions.submitChanges", async () => {
    const dispatch = vi.fn();
    const parameterActions = createParameterActions();
    const { container } = renderPage(dispatch, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "submit via api action" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    fireEvent.change(within(dialog).getByLabelText("硬件 MDE"), { target: { value: "u-wang-jie" } });
    fireEvent.change(within(dialog).getByLabelText("软件 MDE"), { target: { value: "u-sun-mei" } });
    fireEvent.change(within(dialog).getByLabelText("软件开发"), { target: { value: "u-sun-mei" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary")!);

    await waitFor(() => expect(parameterActions.submitChanges).toHaveBeenCalledWith({
      projectId: initialState.activeProjectId,
      items: [
        expect.objectContaining({
          parameterId: initialState.parameters[0].id,
          reason: "submit via api action"
        })
      ],
      assignees: {
        hardwareCommitterId: "u-wang-jie",
        softwareCommitterId: "u-sun-mei",
        softwareUserId: "u-sun-mei"
      }
    }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_PARAMETER_SUBMISSION_ROUND" }));
  });

  it("clicking stash calls parameterActions.stashChanges", async () => {
    const dispatch = vi.fn();
    const parameterActions = createParameterActions();
    renderPage(dispatch, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "stash via api action" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "暂存本轮 (1 项)" }));

    await waitFor(() => expect(parameterActions.stashChanges).toHaveBeenCalledWith([
      expect.objectContaining({
        parameterId: initialState.parameters[0].id,
        reason: "stash via api action"
      })
    ]));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "STASH_PARAMETER_SUBMISSION_ROUND" }));
  });

  it("submit button shows pending state while the action is unresolved", async () => {
    const deferred = createDeferred<void>();
    const parameterActions = createParameterActions({
      submitChanges: vi.fn().mockReturnValue(deferred.promise)
    });
    const { container } = renderPage(vi.fn(), vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "pending submit reason" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    const confirmButton = container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary");
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveTextContent("提交中");
    });

    deferred.resolve(undefined);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /提交本轮参数/ })).not.toBeInTheDocument());
  });

  it("action rejection displays a notification and keeps drafts visible", async () => {
    const dispatch = vi.fn();
    const parameterActions = createParameterActions({
      submitChanges: vi.fn().mockResolvedValue({ notification: "api submit failed" })
    });
    const { container } = renderPage(dispatch, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "keep this draft" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    fireEvent.click(container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary")!);

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: "api submit failed" }));
    expect(screen.getByRole("dialog", { name: /提交本轮参数/ })).toBeInTheDocument();
    expect(screen.getByText("keep this draft")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本轮已修改参数区" })).toBeInTheDocument();
  });

  it("does not redispatch an action failure notification already emitted by the runtime", async () => {
    const dispatch = vi.fn();
    const parameterActions = createParameterActions({
      submitChanges: vi.fn().mockResolvedValue({ notification: "api submit failed", alreadyNotified: true })
    });
    const { container } = renderPage(dispatch, vi.fn(), parameterActions);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "keep this draft" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getByRole("button", { name: "提交本轮 (1 项)" }));
    fireEvent.click(container.querySelector<HTMLButtonElement>(".dialog-actions .button.primary")!);

    await waitFor(() => expect(parameterActions.submitChanges).toHaveBeenCalledTimes(1));
    expect(dispatch).not.toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: "api submit failed" });
    expect(screen.getByRole("dialog", { name: /提交本轮参数/ })).toBeInTheDocument();
  });

  it("builds preview and submit items from selected draft entries only", () => {
    const source = readFileSync("src/ParametersPage.tsx", "utf8");
    const previewSource = source.match(/const pendingSubmissionItems[\s\S]*?const allSelectedDraftsAreSubmittable[\s\S]*?;/)?.[0] ?? "";
    const submitSource = source.match(/const submitRound[\s\S]*?\r?\n  };\r?\n  const previewItems/)?.[0] ?? "";

    expect(previewSource).toContain("const pendingSubmissionItems");
    expect(submitSource).toContain("const submitRound");
    expect(previewSource).not.toContain("?? parameter.recommendedValue");
    expect(previewSource).not.toContain("?? reason");
    expect(submitSource).not.toContain("?? parameter.recommendedValue");
    expect(submitSource).not.toContain("?? reason");
  });

  it("does not let submission round reducer items fall back to a shared action reason", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");
    const roundReducerSource = appSource.match(/case "ADD_PARAMETER_SUBMISSION_ROUND":[\s\S]*?\n    case "WITHDRAW_PARAMETER_SUBMISSION_ROUND":/)?.[0] ?? "";
    const commandSource = readFileSync("src/domain/parameters/commands.ts", "utf8");
    const pageSource = readFileSync("src/ParametersPage.tsx", "utf8");
    const submitSource = pageSource.match(/const submitRound[\s\S]*?\r?\n  };\r?\n  const previewItems/)?.[0] ?? "";

    expect(roundReducerSource).toContain('case "ADD_PARAMETER_SUBMISSION_ROUND":');
    expect(roundReducerSource).toContain("submitParameterRound");
    expect(commandSource).not.toContain("input.reason");
    expect(submitSource).not.toContain("reason });");
  });

  it("未出现本轮已修改参数时，不显示本轮操作按钮", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /提交本轮/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /暂存本轮/ })).not.toBeInTheDocument();
  });

  it("本轮已修改参数下方显示操作按钮，文案变为『提交本轮 (1 项)』并可点", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "显示本轮操作按钮" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    const modifiedSection = screen.getByRole("region", { name: "本轮已修改参数区" });
    expect(within(modifiedSection).getByRole("region", { name: "本轮已修改参数表" })).toBeInTheDocument();
    const actions = modifiedSection.querySelector<HTMLElement>(".parameters-bottom-actions");

    expect(actions).toBeInTheDocument();
    expect(within(actions as HTMLElement).getByRole("button", { name: "提交本轮 (1 项)" })).toBeEnabled();
    expect(within(actions as HTMLElement).getByRole("button", { name: "暂存本轮 (1 项)" })).toBeEnabled();
  });

  it("不存在『加入本轮』按钮", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /加入本轮/ })).not.toBeInTheDocument();
  });

  it("点击提交 → 弹出预览对话框，数量等于勾选数", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    fillVisibleDraftReasons("提交预览数量");
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (2 项)" })[0]);
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    expect(within(dialog).getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
  });

  it("提交预览保留对话框名称但不显示标题 h2", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "保留对话框名称" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "提交本轮参数" })).not.toBeInTheDocument();
    expect(container.querySelector("#submission-preview-title")).not.toBeInTheDocument();
  });

  it("用代码预览布局展示复杂 DTS 参数的提交 diff", () => {
    const { container } = renderPage();
    const dtsRow = screen.getByText("dts_fast_charge_profile_matrix").closest("tr");
    expect(dtsRow).not.toBeNull();
    const editButton = dtsRow!.querySelector<HTMLButtonElement>(".edit-row-button");
    expect(editButton).not.toBeNull();

    fireEvent.click(editButton!);
    const targetEditor = container.querySelector<HTMLTextAreaElement>(".parameter-draft-code-editor");
    expect(targetEditor).not.toBeNull();
    fireEvent.change(targetEditor!, {
      target: {
        value: `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "12000", "4300", "48", "boost";`
      }
    });
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "验证复杂 DTS diff" }
    });
    const submitDraftButton = container.querySelector<HTMLButtonElement>(
      ".parameter-draft-dialog .parameter-detail-dialog__footer .button.primary"
    );
    expect(submitDraftButton).not.toBeNull();
    fireEvent.click(submitDraftButton!);

    const submitRoundButton = container.querySelector<HTMLButtonElement>(".parameters-bottom-actions .button.primary");
    expect(submitRoundButton).not.toBeNull();
    fireEvent.click(submitRoundButton!);

    const dialog = container.querySelector<HTMLElement>(".submission-dialog");
    expect(dialog).not.toBeNull();
    const complexCard = dialog!.querySelector<HTMLElement>(".submission-diff-card--complex");
    expect(complexCard).not.toBeNull();
    expect(complexCard).toHaveTextContent("dts_fast_charge_profile_matrix");
    expect(complexCard!.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(complexCard!.querySelector(".submission-config-format")).not.toBeInTheDocument();
    expect(complexCard!.querySelector(".submission-preview-code-grid")).not.toBeInTheDocument();

    const diff = complexCard!.querySelector<HTMLElement>(".submission-preview-diff");
    expect(diff).toBeInTheDocument();
    expect(diff).toHaveAttribute("role", "list");
    expect(diff!.querySelectorAll(".submission-preview-diff-row")).toHaveLength(5);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='equal']").length).toBeGreaterThan(0);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='remove']").length).toBeGreaterThan(0);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='add']").length).toBeGreaterThan(0);
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent(
      '"2", "11000", "4200", "46", "burst";'
    );
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent(
      '"2", "12000", "4300", "48", "boost";'
    );
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] .submission-preview-diff-row__marker")).toHaveTextContent("-");
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] .submission-preview-diff-row__marker")).toHaveTextContent("+");

    const styles = readFileSync("src/styles.css", "utf8");
    const codeRule = styles.match(/\.submission-preview-diff\s*\{[^}]*\}/)?.[0] ?? "";
    const rowCodeRule = styles.match(/\.submission-preview-diff-row code\s*\{[^}]*\}/)?.[0] ?? "";
    const removeRowRule = styles.match(/\.submission-preview-diff-row\[data-kind="remove"\]\s*\{[^}]*\}/)?.[0] ?? "";
    const addRowRule = styles.match(/\.submission-preview-diff-row\[data-kind="add"\]\s*\{[^}]*\}/)?.[0] ?? "";
    const lineMetaRule =
      styles.match(/\.submission-preview-diff-row__marker,\s*\.submission-preview-diff-row__line-number\s*\{[^}]*\}/)?.[0] ?? "";
    const genericHeadingRuleIndex = /\.submission-diff-card strong,\s*\.submission-diff-card small\s*\{/.exec(styles)?.index ?? -1;
    const complexHeadingRuleIndex =
      Array.from(styles.matchAll(/\.submission-diff-card--complex strong,\s*\.submission-diff-card--complex small\s*\{/g)).at(-1)?.index ??
      -1;
    expect(codeRule).toMatch(/overflow:\s*auto/);
    expect(codeRule).toContain("background: #ffffff;");
    expect(codeRule).toContain("color: #0f172a;");
    expect(removeRowRule).toContain("background: #fff1f2;");
    expect(addRowRule).toContain("background: #ecfdf5;");
    expect(lineMetaRule).toContain("background: #f8fafc;");
    expect(rowCodeRule).toMatch(/white-space:\s*pre/);
    expect(codeRule).toMatch(/word-break:\s*normal/);
    expect(complexHeadingRuleIndex).toBeGreaterThan(genericHeadingRuleIndex);
  });

  it("提交预览要求选择硬件 MDE、软件 MDE 和软件开发，且软件节点可选同一人", () => {
    const dispatch = vi.fn();
    renderPage(dispatch);
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "验证处理人选择" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    fireEvent.change(within(dialog).getByLabelText("硬件 MDE"), { target: { value: "u-wang-jie" } });
    fireEvent.change(within(dialog).getByLabelText("软件 MDE"), { target: { value: "u-sun-mei" } });
    fireEvent.change(within(dialog).getByLabelText("软件开发"), { target: { value: "u-sun-mei" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认提交" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      assignees: {
        hardwareCommitterId: "u-wang-jie",
        softwareCommitterId: "u-sun-mei",
        softwareUserId: "u-sun-mei"
      }
    }));
  });

  it("提交预览默认选择项目流程角色绑定用户，而不是全局管理员", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "验证默认流程处理人" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });

    expect(within(dialog).getByLabelText("硬件 MDE")).toHaveValue("u-wang-jie");
    expect(within(dialog).getByLabelText("软件 MDE")).toHaveValue("u-sun-mei");
    expect(within(dialog).getByLabelText("软件开发")).toHaveValue("u-liu-min");
  });

  it("提交预览下拉栏隐藏不符合槽位权限的用户", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "验证下拉权限裁剪" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (1 项)" })[0]);

    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });
    const hardwareOptions = within(within(dialog).getByLabelText("硬件 MDE")).getAllByRole("option");
    const softwareCommitterOptions = within(within(dialog).getByLabelText("软件 MDE")).getAllByRole("option");
    const softwareUserOptions = within(within(dialog).getByLabelText("软件开发")).getAllByRole("option");

    expect(hardwareOptions.map((option) => option.textContent)).toEqual(["Wang Jie", "Li Peng"]);
    expect(softwareCommitterOptions.map((option) => option.textContent)).toEqual(["Sun Mei"]);
    expect(softwareUserOptions.map((option) => option.textContent)).toEqual(["Liu Min", "Chen Na", "Sun Mei"]);
  });

  it("聚焦未勾选行后再勾选，不会继承上一行的修改原因", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.change(screen.getByLabelText("修改原因"), {
      target: { value: "第一行的专属原因" }
    });

    fireEvent.click(screen.getByText("charge_voltage_limit_mv"));
    expect(screen.queryByLabelText("修改原因")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    const reasonInputs = screen.getAllByLabelText(/修改原因/);
    const secondReason = reasonInputs.find((el) => (el as HTMLTextAreaElement).value === "");
    expect(secondReason).toBeDefined();
    fireEvent.change(secondReason!, {
      target: { value: "第二行的专属原因" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: "提交本轮 (2 项)" })[0]);
    const dialog = screen.getByRole("dialog", { name: /提交本轮参数/ });

    expect(within(dialog).getByText("第一行的专属原因")).toBeInTheDocument();
    expect(within(dialog).getAllByText("第一行的专属原因")).toHaveLength(1);
    expect(within(dialog).getByText("第二行的专属原因")).toBeInTheDocument();
  });
});

describe("ParametersPage · 布局与 Sheet", () => {
  it("默认未选行时，不渲染草稿 Sheet", () => {
    renderPage();
    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
  });

  it("编辑后打开 Sheet 并展示该参数的草稿卡片", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    const sheet = screen.getByRole("dialog", { name: "修改草稿" });
    expect(sheet).toBeInTheDocument();
    expect(within(sheet).getByText("本轮提交 1 项")).toBeInTheDocument();
  });

  it("点击 Sheet 关闭按钮后 Sheet 消失，再次编辑可重新打开", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(screen.getByText("本轮提交 2 项")).toBeInTheDocument();
  });

  it("再次编辑其他参数时将当前点击的参数置于草稿弹窗首位", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));

    const firstDraftCard = container.querySelector<HTMLElement>(".parameter-draft-card");
    expect(firstDraftCard).toHaveTextContent("charge_voltage_limit_mv");
    expect(firstDraftCard).not.toHaveTextContent("fast_charge_current_limit_ma");
  });

  it("removing the last draft item clears selection and closes the sheet", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除本项" }));

    expect(container.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });

  it("bottom actions stay hidden after closing unsubmitted drafts", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    expect(container.querySelector(".parameters-bottom-actions")).not.toBeInTheDocument();
  });
});

describe("ParametersPage API topology workspace", () => {
  it("combines the mature workbench boundary with semantic DTS rows in API mode", async () => {
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware API" }],
      softwareCommitters: [{ id: "u-sw", name: "Software API" }],
      softwareUsers: [{ id: "u-user", name: "Developer API" }],
    });
    const topologyRepository = createApiBoundaryRepository();
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={createParametersPageState()}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          runtimeMode="api"
          canEdit
          parameterActions={{
            ...createParameterActions(),
            listWorkflowAssignees,
          }}
          topologyRepository={topologyRepository}
          listConfigSets={async () => [{ id: API_SENTINEL_CONFIG_SET_ID, name: "default" }]}
        />
      </TopBarActionsHarness>
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        API_SENTINEL_REVISION_ID
      );
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workspace).getByRole("searchbox", { name: "搜索 DTS 参数" })).toBeInTheDocument();
    expect(within(workspace).getByRole("tree", { name: "生效 DTS 拓扑" })).toBeInTheDocument();
    const semanticRow = await within(workspace).findByRole("row", { name: new RegExp(API_SENTINEL_PROPERTY) });
    expect(within(semanticRow).getByRole("cell", { name: API_SENTINEL_PROPERTY })).toBeInTheDocument();
    expect(within(semanticRow).getByRole("cell", { name: API_SENTINEL_RAW_VALUE })).toBeInTheDocument();
    expect(topologyRepository.getTopology).toHaveBeenCalledWith(
      "aurora",
      API_SENTINEL_CONFIG_SET_ID,
      "current",
      "effective"
    );
    expect(topologyRepository.listBindings).toHaveBeenCalledWith("aurora", API_SENTINEL_REVISION_ID);
    expect(screen.queryByRole("button", { name: "导出 Excel" })).not.toBeInTheDocument();
    expect(screen.queryByText("当前 → 推荐", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("推荐值", { exact: false })).not.toBeInTheDocument();
    expect(listWorkflowAssignees).not.toHaveBeenCalled();
  });

  it("fails closed without fabricated topology when API config sets are empty", async () => {
    const topologyRepository = createApiBoundaryRepository();
    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={createParametersPageState()}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
          runtimeMode="api"
          canEdit
          parameterActions={createParameterActions()}
          topologyRepository={topologyRepository}
          listConfigSets={async () => []}
        />
      </TopBarActionsHarness>
    );

    expect(await screen.findByText(/尚未创建 Config Set/i)).toBeInTheDocument();
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(screen.queryByRole("region", { name: "项目拓扑工作区" })).not.toBeInTheDocument();
    expect(workspace.getAttribute("data-config-set-id") ?? "").toBe("");
    expect(workspace.getAttribute("data-revision-id") ?? "").toBe("");
    expect(topologyRepository.getTopology).not.toHaveBeenCalled();
    expect(topologyRepository.listBindings).not.toHaveBeenCalled();
    expect(workspace.textContent).not.toMatch(/aurora-default-config|aurora-head|sc8562@6E|<&gpio13 29 0>/);
    expect(workspace).not.toHaveTextContent(API_SENTINEL_PROPERTY);
    expect(workspace).not.toHaveTextContent(API_SENTINEL_RAW_VALUE);
    expect(screen.queryByRole("region", { name: "检索参数表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本轮已修改参数区" })).not.toBeInTheDocument();
    expect(screen.queryByText("当前 → 推荐", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("推荐值", { exact: false })).not.toBeInTheDocument();
  });
});
