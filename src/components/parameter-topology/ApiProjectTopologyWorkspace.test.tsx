import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import {
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./topologyTeachingFixtures";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import { driverFallbackModuleId } from "@/domain/parameter-topology/moduleRegistry";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { ApiProjectTopologyWorkspace as ProductionApiProjectTopologyWorkspace } from "./ApiProjectTopologyWorkspace";
import {
  createTestModuleRegistryRepository,
  createTestParameterFileRepository,
  createTestParameterRepository,
  createTestParameterTopologyRepository
} from "@/test/harness";

const httpTestSeams = vi.hoisted(() => {
  const moduleRegistryRepository = {
    getRegistry: vi.fn().mockResolvedValue({ modules: [], mappings: [] })
  };
  const parameterFileRepository = {
    listFiles: vi.fn().mockResolvedValue([]),
    downloadVersion: vi.fn().mockResolvedValue({
      contentType: "text/plain",
      fileName: "unused.dts",
      bytes: new Uint8Array()
    })
  };
  const parameterRepository = {
    listDrafts: vi.fn().mockResolvedValue([]),
    deleteDraft: vi.fn().mockResolvedValue(undefined)
  };
  const createHttpParameterModuleRegistryRepository = vi.fn(() => moduleRegistryRepository);
  const createHttpParameterRepository = vi.fn(() => parameterRepository);
  const resolveParameterFileRepository = vi.fn(() => parameterFileRepository);
  const fetchCalls: string[] = [];
  const fetchSentinel = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    fetchCalls.push(url);
    return Promise.reject(
      new Error(`Unexpected fetch in ApiProjectTopologyWorkspace.test.tsx: ${url}`)
    );
  });

  return {
    moduleRegistryRepository,
    parameterFileRepository,
    parameterRepository,
    createHttpParameterModuleRegistryRepository,
    createHttpParameterRepository,
    resolveParameterFileRepository,
    fetchCalls,
    fetchSentinel
  };
});

vi.mock("@/infrastructure/http/parameterModuleRegistryClient", () => ({
  createHttpParameterModuleRegistryRepository: httpTestSeams.createHttpParameterModuleRegistryRepository
}));

vi.mock("@/infrastructure/http/parameterClient", () => ({
  createHttpParameterRepository: httpTestSeams.createHttpParameterRepository
}));

vi.mock("@/application/parameters/parameterFileRuntime", () => ({
  resolveParameterFileRepository: httpTestSeams.resolveParameterFileRepository
}));

type WorkspaceProps = ComponentProps<typeof ProductionApiProjectTopologyWorkspace>;
type TestWorkspaceProps = WorkspaceProps & { useRuntimeDefaultsForTest?: boolean };

/**
 * Default test entry: every render owns fresh production mock adapters.
 * The one runtime-construction sentinel opts out so it can assert the imported
 * API factories without allowing the rest of the suite to share their state.
 */
function ApiProjectTopologyWorkspace({
  useRuntimeDefaultsForTest = false,
  ...props
}: TestWorkspaceProps) {
  if (useRuntimeDefaultsForTest) {
    return <ProductionApiProjectTopologyWorkspace {...props} />;
  }
  return <ApiProjectTopologyWorkspaceWithFreshPorts {...props} />;
}

function ApiProjectTopologyWorkspaceWithFreshPorts(props: WorkspaceProps) {
  const [moduleRegistryRepository] = useState(() =>
    createTestModuleRegistryRepository({
      getRegistry: vi.fn().mockResolvedValue({ modules: [], mappings: [] })
    })
  );
  const [parameterFileRepository] = useState(() => createTestParameterFileRepository());
  const [parameterRepository] = useState(() =>
    createTestParameterRepository({
      listDrafts: vi.fn().mockResolvedValue([]),
      deleteDraft: vi.fn().mockResolvedValue(undefined)
    })
  );

  return (
    <ProductionApiProjectTopologyWorkspace
      moduleRegistryRepository={moduleRegistryRepository}
      parameterFileRepository={parameterFileRepository}
      listDrafts={parameterRepository.listDrafts}
      deleteDraft={parameterRepository.deleteDraft}
      {...props}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return createTestParameterTopologyRepository({
    getSpec: vi.fn().mockResolvedValue({
      id: "spec-sc8562-gpio-int",
      organizationId: "org-chargelab",
      sourceKind: "vendor",
      specificationKey: "sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "spec-version-1",
      currentVersion: 1,
      displayName: "gpio_int",
      description: "Interrupt GPIO",
      valueShape: null,
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: null,
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null
    }),
    listBindings: vi.fn().mockResolvedValue(TOPOLOGY_TEACHING_BINDINGS),
    getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
      if (view === "source") {
        return {
          view: "source" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: "dcs-default-aurora",
          projectId: "aurora",
          status: "resolved",
          incompleteBase: false,
          diagnostics: [],
          nodes: TOPOLOGY_TEACHING_SOURCE_NODES
        };
      }
      return {
        view: "effective" as const,
        revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
        configSetId: "dcs-default-aurora",
        projectId: "aurora",
        status: "resolved",
        incompleteBase: false,
        diagnostics: [],
        nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
      };
    }),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    createBindingDraft: vi.fn().mockResolvedValue({
      draftId: "draft-1",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "rev-candidate-2",
      rawText: "<&gpio13 29 0>",
      action: "set",
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts"
    }),
    ...overrides
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}


async function createGpioDraftFromWorkbench(
  workspace: HTMLElement,
  fireEvent: typeof import("@testing-library/react").fireEvent,
  input: { reason: string; rawValue?: string; action?: "delete"; editButtonName?: RegExp }
) {
  const editName = input.editButtonName ?? /编辑 gpio_int（未分类 · sc8562/;
  // Tree selection updates the workbench list asynchronously; wait for the
  // target row before opening the draft dialog.
  const editButton = await within(workspace).findByRole("button", { name: editName });
  fireEvent.click(editButton);
  const draftDialog = await screen.findByRole("dialog", { name: "修改草稿" });
  if (input.action === "delete") {
    fireEvent.click(within(draftDialog).getByRole("button", { name: "删除属性" }));
  } else if (input.rawValue !== undefined) {
    fireEvent.change(within(draftDialog).getByRole("textbox", { name: "目标值" }), {
      target: { value: input.rawValue }
    });
  }
  fireEvent.change(within(draftDialog).getByRole("textbox", { name: "修改原因" }), {
    target: { value: input.reason }
  });
  fireEvent.click(within(draftDialog).getByRole("button", { name: "校验并加入本轮" }));
  return draftDialog;
}

describe("ApiProjectTopologyWorkspace", () => {
  const protectedJsonBinding = (projectId = "aurora", id = "json-current") => ({
    ...TOPOLOGY_TEACHING_BINDINGS[0],
    id,
    projectId,
    definitionId: "shared-definition",
    currentValueId: `${projectId}-${id}-current-value`,
    effectiveRevisionId: `${projectId}-json-source-revision`,
    propertyKey: `${projectId}_json_current`,
    locator: "/camera/tuning",
    effectiveValue: { kind: "json" as const, value: { exposure: 321 } },
    rawValue: '{"exposure":321}',
    displayName: null,
    description: null,
    documentation: null
  });

  const protectedRepository = (
    listProtectedProjectBindings: NonNullable<ParameterCatalogRepository["listProtectedProjectBindings"]>
  ) => ({ listProtectedProjectBindings } as ParameterCatalogRepository);

  it.each(["no config set", "no semantic revision"])("opens the exact protected JSON current value read-only with %s", async (absence) => {
    const binding = protectedJsonBinding();
    const repository = createRepository({
      getTopology: vi.fn().mockRejectedValue(new WiseEffApiError("NOT_FOUND", "no semantic revision", {}, "test"))
    });
    const sibling = { ...binding, id: "same-definition-other-binding", currentValueId: "other-current-value",
      propertyKey: "other_json_current", rawValue: '{"exposure":999}',
      effectiveValue: { kind: "json" as const, value: { exposure: 999 } } };
    const listProtectedProjectBindings = vi.fn().mockResolvedValue({ items: [sibling, binding] });
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id} canEdit
      topologyRepository={repository}
      listConfigSets={vi.fn().mockResolvedValue(absence === "no config set" ? [] : [{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(listProtectedProjectBindings)} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/321/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(binding.locator)).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "当前取值" })).toHaveTextContent(binding.rawValue);
    expect(within(dialog).queryByText(sibling.rawValue)).not.toBeInTheDocument();
    expect(repository.getTopology).toHaveBeenCalledTimes(absence === "no config set" ? 0 : 1);
    expect(within(dialog).queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
    expect(listProtectedProjectBindings).toHaveBeenCalledWith("aurora");
    expect(repository.createBindingDraft).not.toHaveBeenCalled();
  });

  it("discovers an independent JSON source revision alongside ready DTS without inheriting DTS editing", async () => {
    const binding = protectedJsonBinding();
    const repository = createRepository();
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id} canEdit
      topologyRepository={repository} listConfigSets={vi.fn().mockResolvedValue([{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(vi.fn().mockResolvedValue({ items: [binding] }))} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/321/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
    expect(repository.listBindings).toHaveBeenCalledWith("aurora", "rev-real-1");
    expect(repository.createBindingDraft).not.toHaveBeenCalled();
  });

  it.each([true, false])("retains same-revision protected JSON editing only with the existing canEdit=%s prerequisite", async (canEdit) => {
    const binding = protectedJsonBinding();
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id} canEdit={canEdit}
      topologyRepository={createRepository({ listBindings: vi.fn().mockResolvedValue([binding]) })}
      listConfigSets={vi.fn().mockResolvedValue([{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(vi.fn().mockResolvedValue({ items: [binding] }))} />);
    const dialog = await screen.findByRole("dialog");
    if (canEdit) expect(within(dialog).getByRole("button", { name: "编辑此参数" })).toBeInTheDocument();
    else expect(within(dialog).queryByRole("button", { name: "编辑此参数" })).not.toBeInTheDocument();
  });

  it("preserves eligible JSON editing beside a distinct independent JSON source", async () => {
    const eligible = protectedJsonBinding("aurora", "eligible-json");
    const independent = { ...protectedJsonBinding("aurora", "independent-json"), propertyKey: "independent_json" };
    const props = { projectId: "aurora", canEdit: true,
      topologyRepository: createRepository({ listBindings: vi.fn().mockResolvedValue([eligible]) }),
      listConfigSets: vi.fn().mockResolvedValue([{ id: "config", name: "default" }]),
      canonicalRepository: protectedRepository(vi.fn().mockResolvedValue({ items: [eligible, independent] })) };
    const rendered = render(<ApiProjectTopologyWorkspace {...props} requestedBindingId={eligible.id} />);
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "编辑此参数" })).toBeInTheDocument());
    rendered.rerender(<ApiProjectTopologyWorkspace {...props} requestedBindingId={independent.id} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(independent.propertyKey);
    expect(within(dialog).queryByRole("button", { name: "编辑此参数" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(props.topologyRepository.createBindingDraft).not.toHaveBeenCalled();
  });

  it("keeps the same protected JSON Binding read-only when its currentValue differs from the semantic row", async () => {
    const binding = protectedJsonBinding();
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id} canEdit
      topologyRepository={createRepository({ listBindings: vi.fn().mockResolvedValue([{ ...binding, currentValueId: "older-current-value" }]) })}
      listConfigSets={vi.fn().mockResolvedValue([{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(vi.fn().mockResolvedValue({ items: [binding] }))} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "编辑此参数" })).not.toBeInTheDocument();
  });

  it("keeps protected JSON failure visible even when the revision-filtered topology contains a JSON row", async () => {
    const binding = protectedJsonBinding();
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id}
      topologyRepository={createRepository({ listBindings: vi.fn().mockResolvedValue([binding]) })}
      listConfigSets={vi.fn().mockResolvedValue([{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(vi.fn().mockRejectedValue(new WiseEffApiError("FORBIDDEN", "denied", {}, "test")))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("没有权限执行该操作。");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens distinct exact Bindings across projects sharing the same Definition", async () => {
    const a = protectedJsonBinding("aurora", "binding-a");
    const b = { ...protectedJsonBinding("nebula", "binding-b"), rawValue: '{"exposure":654}',
      effectiveValue: { kind: "json" as const, value: { exposure: 654 } } };
    const read = vi.fn(async (projectId: string) => ({ items: projectId === "aurora" ? [a] : [b] }));
    const props = { topologyRepository: createRepository(), listConfigSets: vi.fn().mockResolvedValue([]),
      canonicalRepository: protectedRepository(read) };
    const rendered = render(<ApiProjectTopologyWorkspace {...props} projectId="aurora" requestedBindingId={a.id} />);
    expect(await screen.findByRole("dialog")).toHaveTextContent(a.propertyKey);
    rendered.rerender(<ApiProjectTopologyWorkspace {...props} projectId="nebula" requestedBindingId={b.id} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(b.propertyKey);
    expect(within(dialog).getByRole("region", { name: "当前取值" })).toHaveTextContent(b.rawValue);
    expect(dialog).not.toHaveTextContent(a.propertyKey);
    expect(read.mock.calls).toEqual([["aurora"], ["nebula"]]);
  });

  it.each(["missing", "wrong project", "archived"])("reports an unavailable exact requested JSON Binding for %s", async (reason) => {
    const binding = protectedJsonBinding();
    const items = reason === "archived" ? [] : [reason === "wrong project" ? { ...binding, projectId: "other" } : binding];
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={reason === "missing" ? "other-binding" : binding.id}
      topologyRepository={createRepository()} listConfigSets={vi.fn().mockResolvedValue([])}
      canonicalRepository={protectedRepository(vi.fn().mockResolvedValue({ items }))} />);
    expect(await screen.findByText("关联参数在当前项目中不可用。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not substitute a same-Definition Binding for a stale deep link alongside ready DTS", async () => {
    const sibling = protectedJsonBinding("aurora", "current-sibling-binding");
    const repository = createRepository();
    const listProtectedProjectBindings = vi.fn().mockResolvedValue({ items: [sibling] });
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId="stale-binding"
      topologyRepository={repository}
      listConfigSets={vi.fn().mockResolvedValue([{ id: "config", name: "default" }])}
      canonicalRepository={protectedRepository(listProtectedProjectBindings)} />);

    expect(await screen.findByText("关联参数在当前项目中不可用。")).toBeInTheDocument();
    await waitFor(() => expect(repository.listBindings).toHaveBeenCalledWith("aurora", "rev-real-1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: /JSON 参数/ }));
    expect(await screen.findByRole("table", { name: "JSON 参数列表" })).toHaveTextContent(sibling.propertyKey);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repository.getSpec).not.toHaveBeenCalled();
    expect(repository.createBindingDraft).not.toHaveBeenCalled();
    expect(listProtectedProjectBindings).toHaveBeenCalledWith("aurora");
  });

  it("reports a missing protected Binding port instead of masking it as DTS empty", async () => {
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId="json-current"
      topologyRepository={createRepository()} listConfigSets={vi.fn().mockResolvedValue([])} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("当前未配置受保护项目 JSON 绑定读取能力");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "transient"])("keeps protected JSON %s failure visible and retries read-only", async (code) => {
    const binding = protectedJsonBinding();
    const error = code === "transient" ? new TypeError("Failed to fetch")
      : new WiseEffApiError(code, "protected read failed", {}, "test");
    const messages: Record<string, string> = {
      FORBIDDEN: "没有权限执行该操作。", NOT_FOUND: "请求的内容不存在或已被移除。",
      CONFLICT: "操作与当前状态冲突，请刷新后重试。", transient: "网络连接失败，请稍后重试。"
    };
    const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ items: [binding] });
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId={binding.id}
      topologyRepository={createRepository()} listConfigSets={vi.fn().mockResolvedValue([])}
      canonicalRepository={protectedRepository(read)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(messages[code]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "failure"])("hides old project details immediately and ignores stale protected JSON %s", async (completion) => {
    const a = protectedJsonBinding("aurora", "binding-a");
    const b = protectedJsonBinding("nebula", "binding-b");
    const stale = createDeferred<{ items: typeof a[] }>();
    const next = createDeferred<{ items: typeof a[] }>();
    const read = vi.fn().mockResolvedValueOnce({ items: [a] }).mockReturnValueOnce(stale.promise).mockReturnValueOnce(next.promise);
    const canonicalRepository = protectedRepository(read);
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([]);
    const props = { topologyRepository: repository, listConfigSets, canonicalRepository };
    const rendered = render(<ApiProjectTopologyWorkspace {...props} projectId="aurora" requestedBindingId={a.id} />);
    expect(await screen.findByRole("dialog")).toHaveTextContent(a.propertyKey);
    rendered.rerender(<ApiProjectTopologyWorkspace {...props} projectId="nebula" requestedBindingId={b.id} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledWith("nebula"));
    rendered.rerender(<ApiProjectTopologyWorkspace {...props} projectId="aurora" requestedBindingId={a.id} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    next.resolve({ items: [a] });
    expect(await screen.findByRole("dialog")).toHaveTextContent(a.propertyKey);
    if (completion === "success") stale.resolve({ items: [b] });
    else stale.reject(new Error("stale-nebula-error"));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(a.propertyKey));
    expect(screen.queryByText("stale-nebula-error")).not.toBeInTheDocument();
    expect(screen.queryByText(b.propertyKey)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    httpTestSeams.fetchCalls.length = 0;
    httpTestSeams.fetchSentinel.mockClear();
    httpTestSeams.createHttpParameterModuleRegistryRepository.mockClear();
    httpTestSeams.createHttpParameterRepository.mockClear();
    httpTestSeams.resolveParameterFileRepository.mockClear();
    vi.stubGlobal("fetch", httpTestSeams.fetchSentinel);
  });

  it("does not call fetch when rendering the default workspace seam", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        useRuntimeDefaultsForTest
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });

    expect(httpTestSeams.fetchSentinel).not.toHaveBeenCalled();
    expect(httpTestSeams.fetchCalls).toEqual([]);
    expect(httpTestSeams.createHttpParameterModuleRegistryRepository).toHaveBeenCalled();
    // Issue #849 B5: this component no longer constructs a draft client at all. The
    // canonical pending-draft source is injected by ParametersPage, so the legacy
    // `parameter-drafts` read cannot reappear as an implicit fallback here.
    expect(httpTestSeams.createHttpParameterRepository).not.toHaveBeenCalled();
    expect(httpTestSeams.resolveParameterFileRepository).toHaveBeenCalledWith("api");
  });

  it("loads real config set and current revision — never teaching ids", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(workspace).toHaveAttribute("data-revision-id", "rev-real-1");
    expect(workspace.getAttribute("data-config-set-id")).not.toMatch(/-default-config$/);
    expect(workspace.getAttribute("data-revision-id")).not.toMatch(/-head$/);

    expect(listConfigSets).toHaveBeenCalledWith("aurora");
    expect(repository.getTopology).toHaveBeenCalledWith("aurora", "dcs-default-aurora", "current", "effective");
    expect(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
  });

  it("opens the requested Binding in the loaded project without a legacy parameter id", async () => {
    render(<ApiProjectTopologyWorkspace projectId="aurora" requestedBindingId="binding-sc8562-gpio-int"
      topologyRepository={createRepository()}
      listConfigSets={vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }])} />);

    await waitFor(() => expect(document.querySelector('[data-binding-id="binding-sc8562-gpio-int"]'))
      .toHaveAttribute("aria-selected", "true"));
  });

  it("hides toolchain compile diagnostics but keeps product governance errors", async () => {
    const repository = createRepository({
      getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
        const diagnostics =
          view === "effective"
            ? [
                {
                  code: "ranges_format",
                  message: "aurora-board.dts:525.9-30: Warning (ranges_format): empty ranges",
                  severity: "warning" as const
                },
                {
                  code: "TOPOLOGY_NOT_READY",
                  message: "拓扑尚未就绪，无法提交编辑。"
                }
              ]
            : [];
        if (view === "source") {
          return {
            view: "source" as const,
            revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
            configSetId: _configSetId,
            projectId: _projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          };
        }
        return {
          view: "effective" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: _configSetId,
          projectId: _projectId,
          status: "resolved",
          incompleteBase: false,
          diagnostics,
          nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
        };
      })
    });
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("region", { name: "DTS 参数工作台" });
    expect(screen.queryByText(/ranges_format/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/empty ranges/i)).not.toBeInTheDocument();
    expect(screen.getByText("拓扑尚未就绪，无法提交编辑。")).toBeVisible();
    expect(screen.getByRole("region", { name: "编译诊断" })).toBeVisible();
  });

  it("collapses dangling-reference diagnostics into one expandable summary", async () => {
    const repository = createRepository({
      getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
        const diagnostics =
          view === "effective"
            ? [
                {
                  code: "dangling-reference",
                  severity: "warning" as const,
                  message:
                    'Overlay target "&amba" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
                },
                {
                  code: "dangling-reference",
                  severity: "warning" as const,
                  message:
                    'Overlay target "&charging_core" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
                }
              ]
            : [];
        if (view === "source") {
          return {
            view: "source" as const,
            revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
            configSetId: _configSetId,
            projectId: _projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          };
        }
        return {
          view: "effective" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: _configSetId,
          projectId: _projectId,
          status: "resolved",
          incompleteBase: false,
          diagnostics,
          nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
        };
      })
    });
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("region", { name: "DTS 参数工作台" });
    const footer = screen.getByRole("region", { name: "解析提示" });
    expect(
      within(footer).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    ).toBeVisible();
    expect(screen.queryByText(/Overlay target "&amba"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[warning\]/)).not.toBeInTheDocument();

    fireEvent.click(
      within(footer).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    );
    expect(within(footer).getByText("&amba")).toBeVisible();
    expect(within(footer).getByText("&charging_core")).toBeVisible();
  });

  it("rehydrates a separate node enablement tray after reload without emptying current parameters", async () => {
    const persisted = {
      id: "draft-node-enablement", projectId: "aurora", parameterId: "logical-sc8562",
      editSubjectKind: "node-enablement" as const, logicalNodeId: "logical-sc8562",
      nodeLabel: "sc8562@6E", candidateConfigRevisionId: "rev-node-candidate",
      targetValue: '"disabled"', currentValue: '"okay"', action: "set" as const,
      reason: "Persisted structural disable", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const overrides = { listNodeEnablementDrafts: vi.fn().mockResolvedValue([persisted]) };
    const repository = createRepository(overrides);
    const canonicalDrafts = vi.fn().mockResolvedValue([]);
    const workspace = (
      <ApiProjectTopologyWorkspace
        projectId="aurora" canEdit topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={canonicalDrafts}
      />
    );
    for (const reload of [false, true]) {
      const rendered = render(workspace);
      const tray = await screen.findByRole("region", { name: "参数修改提交" });
      expect(within(tray).getByText("Persisted structural disable")).toBeVisible();
      expect(within(tray).getByText("节点启用")).toBeVisible();
      expect(within(tray).getByText("sc8562@6E")).toBeVisible();
      expect(within(tray).getByText(/^本轮 1 项$/)).toBeVisible();
      expect(await screen.findByRole("row", { name: /gpio_int.*sc8562|sc8562.*gpio_int/ })).toBeVisible();
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("data-revision-id", "rev-node-candidate");
      expect(screen.queryByText("该项目尚无已绑定的语义参数。")).not.toBeInTheDocument();
      if (!reload) rendered.unmount();
    }
  });

  it("does not select another config set's structural candidate when reloading the default workbench", async () => {
    const repository = createRepository();
    const getTopology = repository.getTopology;
    repository.getTopology = vi.fn(async (...input) => {
      if (input[2] === "rev-other-config-set") {
        throw new WiseEffApiError({ code: "NOT_FOUND", message: "Revision belongs to another config set" });
      }
      return getTopology(...input);
    });
    repository.listNodeEnablementDrafts = vi.fn().mockResolvedValue([{
      id: "other-set-node-draft", projectId: "aurora", editSubjectKind: "node-enablement",
      logicalNodeId: "logical-other-config-set", candidateConfigRevisionId: "rev-other-config-set",
      targetValue: '"disabled"', reason: "Other config set", updatedAt: "2026-10-09T08:00:00.000Z"
    }]);
    render(<ApiProjectTopologyWorkspace projectId="aurora" canEdit topologyRepository={repository}
      listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }, { id: "dcs-other", name: "other" }]}
      listDrafts={vi.fn().mockResolvedValue([])}
    />);
    await act(async () => {});
    expect(await screen.findByRole("row", { name: /gpio_int.*sc8562|sc8562.*gpio_int/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("data-revision-id", "rev-real-1");
    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
  });

  it.each(["value", "enablement"])("hydrates before a stalled %s read finishes and merges its later drafts", async (stalledOwner) => {
    const enablement = {
      id: "node-delayed", projectId: "aurora", editSubjectKind: "node-enablement" as const,
      logicalNodeId: "logical-sc8562", candidateConfigRevisionId: "rev-persisted",
      targetValue: '"disabled"', reason: "Independent node hydration", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const value = {
      id: "value-delayed", projectId: "aurora", projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-persisted", targetValue: "<&gpio13 30 0>",
      reason: "Independent value hydration", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const delayed = createDeferred<Array<typeof enablement | typeof value>>();
    const repository = createRepository({ listNodeEnablementDrafts: vi.fn().mockReturnValue(
      stalledOwner === "enablement" ? delayed.promise : Promise.resolve([enablement])
    ) });
    render(<ApiProjectTopologyWorkspace projectId="aurora" canEdit topologyRepository={repository}
      listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      listDrafts={vi.fn().mockReturnValue(stalledOwner === "value" ? delayed.promise : Promise.resolve([value]))}
    />);
    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(stalledOwner === "value" ? enablement.reason : value.reason)).toBeVisible();
    expect(within(tray).getByText(/^本轮 1 项$/)).toBeVisible();
    await act(async () => { delayed.resolve(stalledOwner === "value" ? [value] : [enablement]); });
    expect(within(tray).getByText(enablement.reason)).toBeVisible();
    expect(within(tray).getByText(value.reason)).toBeVisible();
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
  });

  it.each(["enablement", "binding"])("discards a delayed structural snapshot after a local %s mutation rebases its drafts", async (mutation) => {
    const persisted = {
      id: "node-before-mutation", projectId: "aurora", editSubjectKind: "node-enablement" as const,
      logicalNodeId: "logical-mt5788", candidateConfigRevisionId: "rev-before-mutation",
      targetValue: '"disabled"', reason: "Old structural snapshot", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const delayed = createDeferred<Array<typeof persisted>>();
    const repository = createRepository({
      listNodeEnablementDrafts: vi.fn().mockReturnValueOnce(delayed.promise).mockResolvedValue([
        { ...persisted, candidateConfigRevisionId: "rev-after-mutation", reason: "Rebased structural draft" }
      ]),
      createNodeEnablementDraft: vi.fn().mockResolvedValue({
        draftId: "node-local", logicalNodeId: "logical-sc8562", candidateRevisionId: "rev-after-mutation",
        workingCandidateRevisionId: "rev-after-mutation", rebasedDraftIds: [persisted.id],
        rawText: '"disabled"', previousRaw: '"okay"', action: "set", target: "force-disabled",
        writeTarget: { role: "overlay", propertyKey: "status", targetRef: "sc8562" },
        overlayFileId: "overlay", overlayFileName: "overlay.dts"
      }),
      createBindingDraft: vi.fn().mockResolvedValue({
        draftId: "binding-local", projectParameterBindingId: "binding-sc8562-gpio-int",
        parameterSpecId: "spec-sc8562-gpio-int", candidateRevisionId: "rev-after-mutation",
        workingCandidateRevisionId: "rev-after-mutation", rebasedDraftIds: [persisted.id],
        rawText: "<&gpio13 30 0>", action: "set",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "overlay", overlayFileName: "overlay.dts"
      })
    });
    render(<ApiProjectTopologyWorkspace projectId="aurora" canEdit topologyRepository={repository}
      listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      listDrafts={vi.fn().mockResolvedValue([])}
    />);
    fireEvent.click(await screen.findByRole("treeitem", { name: /未分类 · sc8562/ }));
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    if (mutation === "binding") {
      await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Local structural edit", rawValue: "<&gpio13 30 0>" });
    } else {
      fireEvent.click(await within(workspace).findByRole("button", { name: /节点启用：.*sc8562/ }));
      const dialog = await screen.findByRole("dialog", { name: "节点启用状态" });
      fireEvent.click(within(dialog).getByRole("radio", { name: "禁用" }));
      fireEvent.change(within(dialog).getByRole("textbox", { name: "修改原因" }), { target: { value: "Local structural edit" } });
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "我确认要禁用此节点" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "校验并加入本轮" }));
    }
    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText("Local structural edit")).toBeVisible();
    await act(async () => { delayed.resolve([persisted]); });
    expect(await within(tray).findByText("Rebased structural draft")).toBeVisible();
    expect(within(tray).getByText("Local structural edit")).toBeVisible();
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
    expect(within(tray).queryByText("Old structural snapshot")).not.toBeInTheDocument();
    expect(within(tray).queryByText(/本轮草稿不在同一工作版本/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("data-revision-id", "rev-after-mutation");
  });

  it.each(["value", "enablement"])("keeps the other owner's persisted tray when the %s draft read fails", async (failedOwner) => {
    const enablement = {
      id: "node-draft", projectId: "aurora", editSubjectKind: "node-enablement" as const,
      logicalNodeId: "logical-sc8562", candidateConfigRevisionId: "rev-persisted",
      targetValue: '"disabled"', reason: "Retained node draft", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const value = {
      id: "value-draft", projectId: "aurora", projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-persisted", targetValue: "<&gpio13 30 0>",
      reason: "Retained value draft", updatedAt: "2026-10-09T08:00:00.000Z"
    };
    const repository = createRepository({
      listNodeEnablementDrafts: failedOwner === "enablement"
        ? vi.fn().mockRejectedValue(new Error("Structural draft read unavailable"))
        : vi.fn().mockResolvedValue([enablement])
    });
    render(<ApiProjectTopologyWorkspace projectId="aurora" canEdit topologyRepository={repository}
      listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      listDrafts={failedOwner === "value"
        ? vi.fn().mockRejectedValue(new Error("Canonical draft read unavailable"))
        : vi.fn().mockResolvedValue([value])}
    />);
    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(failedOwner === "value" ? "Retained node draft" : "Retained value draft")).toBeVisible();
    expect(within(tray).getByText(/^本轮 1 项$/)).toBeVisible();
    expect(await screen.findByRole("row", { name: /gpio_int.*sc8562|sc8562.*gpio_int/ })).toBeVisible();
  });

  it("hydrates binding drafts from listDrafts after reload and shows shared working tip tray", async () => {
    const sharedTip = "rev-shared-tip";
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "draft-gpio",
        projectId: "aurora",
        parameterId: "binding-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        candidateConfigRevisionId: sharedTip,
        targetValue: "<&gpio13 30 0>",
        action: "set" as const,
        reason: "Hydrated gpio draft",
        updatedAt: "2026-07-23T02:00:00.000Z"
      },
      {
        id: "draft-mt5788",
        projectId: "aurora",
        parameterId: "binding-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        candidateConfigRevisionId: sharedTip,
        targetValue: "<&gpio6 16 0>",
        action: "set" as const,
        reason: "Hydrated mt5788 draft",
        updatedAt: "2026-07-23T02:01:00.000Z"
      }
    ]);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    await waitFor(() => expect(listDrafts).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        sharedTip
      )
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
    expect(within(tray).getByText("Hydrated gpio draft")).toBeVisible();
    expect(within(tray).getByText("Hydrated mt5788 draft")).toBeVisible();
  });

  it("does not hydrate preferredRevision when reload drafts have mixed working tips", async () => {
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "draft-gpio",
        projectId: "aurora",
        parameterId: "binding-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        candidateConfigRevisionId: "rev-tip-a",
        targetValue: "<&gpio13 30 0>",
        action: "set" as const,
        reason: "Hydrated gpio draft",
        updatedAt: "2026-07-23T02:00:00.000Z"
      },
      {
        id: "draft-mt5788",
        projectId: "aurora",
        parameterId: "binding-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        candidateConfigRevisionId: "rev-tip-b",
        targetValue: "<&gpio6 16 0>",
        action: "set" as const,
        reason: "Hydrated mt5788 draft",
        updatedAt: "2026-07-23T02:01:00.000Z"
      }
    ]);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    await waitFor(() => expect(listDrafts).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      )
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByRole("alert")).toHaveTextContent(/不在同一工作版本上.*无法一起提交/);
    expect(within(tray).getByText("提交 2 / 2 项")).toBeVisible();
    expect(within(tray).queryByText(/^本轮 2 项$/)).not.toBeInTheDocument();
  });

  it("shows empty state when no config set exists", async () => {
    const repository = createRepository();
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={async () => []}
      />
    );

    expect(
      await screen.findByText(/尚未上传项目 DTS/i)
    ).toBeVisible();
    expect(repository.getTopology).not.toHaveBeenCalled();
  });

  it("shows empty state when current revision is missing (404)", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createRepository({
      getTopology: vi.fn().mockRejectedValue(new WiseEffApiError("NOT_FOUND", "missing", {}, "req"))
    });

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "cs-1", name: "default" }]}
      />
    );

    expect(
      await screen.findByText(/尚未生成语义配置修订/i)
    ).toBeVisible();
  });

  it("calls createBindingDraft then reloads with candidate revision", async () => {
    const repository = createRepository();
    const { act, fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create a typed binding draft" });

    await waitFor(() => {
      expect(repository.createBindingDraft).toHaveBeenCalledWith(
        "aurora",
        "binding-sc8562-gpio-int",
        expect.objectContaining({
          baseRevisionId: "rev-real-1",
          reason: "Create a typed binding draft"
        })
      );
    });

    await waitFor(() => {
      expect(repository.getTopology).toHaveBeenCalledWith(
        "aurora",
        "dcs-default-aurora",
        "rev-candidate-2",
        "effective"
      );
    });
  });

  it("creates a canonical delete draft without a target value", async () => {
    const createBindingDraft = vi.fn().mockResolvedValue({
      draftId: "canonical-delete-draft",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "rev-candidate-2",
      rawText: "",
      action: "delete",
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "canonical-project-value-draft", propertyKey: "gpio_int" },
      overlayFileId: "",
      overlayFileName: ""
    });
    const repository = createRepository({ createBindingDraft });

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      action: "delete",
      reason: "移除过时属性"
    });

    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledWith(
      "aurora",
      "binding-sc8562-gpio-int",
      expect.objectContaining({
        baseRevisionId: "rev-real-1",
        action: "delete",
        reason: "移除过时属性"
      })
    ));
    const [, , body] = createBindingDraft.mock.calls[0];
    expect(body).not.toHaveProperty("targetValue");
    expect(body).not.toHaveProperty("sourceTarget");
  });

  it("shows a newly created canonical pending draft immediately without a page reload", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const createBindingDraft = vi.fn().mockResolvedValue({
      draftId: "canonical-pending-draft",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "rev-real-1",
      workingCandidateRevisionId: "rev-real-1",
      rawText: "<2000>",
      action: "set",
      parameterSpecId: "pdef_acme_power_iin_max",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "canonical-project-value-draft", propertyKey: "iin_max" },
      overlayFileId: "",
      overlayFileName: ""
    });
    const repository = createRepository({ createBindingDraft });

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Save published value" });

    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^本轮 1 项$/)).toBeVisible();
    expect(within(screen.getByRole("region", { name: "参数修改提交" })).getByText("Save published value")).toBeVisible();
  });

  it("forwards the selected canonical software reviewer to the catalog submitter", async () => {
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "canonical-forwarded-draft",
        projectId: "aurora",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        candidateConfigRevisionId: "rev-real-1",
        targetValue: "<2000>",
        action: "set" as const,
        reason: "Forward reviewer selection",
        updatedAt: "2026-07-23T02:00:00.000Z",
        baseRevisionId: "rev-real-1",
        sourcePinId: "source-pin-849",
        candidateId: "candidate-849"
      }
    ]);
    const submitProjectValueDraft = vi.fn().mockResolvedValue({});
    const canonicalRepository = {
      getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release-849" } }),
      submitProjectValueDraft
    } as unknown as ParameterCatalogRepository;
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        canonicalRepository={canonicalRepository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: []
        })}
      />
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const softwareReviewer = await within(tray).findByRole("combobox", { name: "软件 MDE" });
    fireEvent.change(softwareReviewer, {
      target: { value: "u-sw" }
    });
    fireEvent.click(within(tray).getByRole("button", { name: /提交审核（1 项）/ }));

    await waitFor(() => {
      expect(submitProjectValueDraft).toHaveBeenCalledWith(
        "aurora",
        "canonical-forwarded-draft",
        { assignedToUserId: "u-sw" },
        {
          catalogReleaseId: "release-849",
          idempotencyKey: expect.any(String)
        }
      );
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument());
  });

  it("drops the previous project's candidate revision and draft before loading the next project", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const getTopology = vi.fn(async (projectId: string, configSetId: string, revisionId: string, view: "source" | "effective") => {
      if (projectId === "nebula" && revisionId === "rev-candidate-2") {
        throw new WiseEffApiError("NOT_FOUND", "foreign candidate revision", {}, "req-project-switch");
      }
      const resolvedRevisionId = revisionId === "current" ? `rev-${projectId}-current` : revisionId;
      return view === "source"
        ? {
            view: "source" as const,
            revisionId: resolvedRevisionId,
            configSetId,
            projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          }
        : {
            view: "effective" as const,
            revisionId: resolvedRevisionId,
            configSetId,
            projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
          };
    });
    const repository = createRepository({ getTopology });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const auroraWorkspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(auroraWorkspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(auroraWorkspace, fireEvent, { reason: "Create Aurora candidate before switching projects" });

    await screen.findByRole("region", { name: "参数修改提交" });
    await waitFor(() => {
      expect(getTopology).toHaveBeenCalledWith(
        "aurora",
        "dcs-default-aurora",
        "rev-candidate-2",
        "effective"
      );
    });

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(getTopology).toHaveBeenCalledWith(
        "nebula",
        "dcs-default-nebula",
        "current",
        "effective"
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-nebula-current"
      );
    });
    expect(getTopology).not.toHaveBeenCalledWith(
      "nebula",
      "dcs-default-nebula",
      "rev-candidate-2",
      "effective"
    );
  });

  it("ignores an Aurora draft response that resolves after switching to Nebula", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    let resolveDraft!: (value: Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>) => void;
    const draftPromise = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((resolve) => {
      resolveDraft = resolve;
    });
    const createBindingDraft = vi.fn(() => draftPromise);
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Aurora request must not leak" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledWith(
      "aurora",
      "binding-sc8562-gpio-int",
      expect.any(Object)
    ));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });

    await act(async () => {
      resolveDraft({
        draftId: "draft-aurora-late",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-late",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    expect(listWorkflowAssignees).not.toHaveBeenCalled();
    expect(repository.getTopology).not.toHaveBeenCalledWith(
      "nebula",
      "dcs-default-nebula",
      "rev-aurora-late",
      "effective"
    );
  });

  it("ignores a stale Aurora draft after switching Aurora to Nebula and back to Aurora", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const draftRequest = createDeferred<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>();
    const createBindingDraft = vi.fn()
      .mockImplementationOnce(() => draftRequest.promise)
      .mockResolvedValueOnce({
        draftId: "draft-aurora-current",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-current",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Stale Aurora draft must not return after switching back" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledWith(
      "aurora",
      "binding-sc8562-gpio-int",
      expect.any(Object)
    ));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    const auroraTopologyCalls = vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "aurora").length;

    await act(async () => {
      draftRequest.resolve({
        draftId: "draft-aurora-stale",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-stale",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
      await draftRequest.promise;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "aurora").length).toBe(auroraTopologyCalls);
    expect(repository.getTopology).not.toHaveBeenCalledWith(
      "aurora",
      "dcs-default-aurora",
      "rev-aurora-stale",
      "effective"
    );

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Current Aurora draft after stale response settled"
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数修改提交" })).toBeVisible());
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-aurora-current"
      )
    );
  });

  it("drops a stale Aurora draft error after switching back and releases only its draft lock", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const draftRequest = createDeferred<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>();
    const createBindingDraft = vi.fn()
      .mockImplementationOnce(() => draftRequest.promise)
      .mockResolvedValueOnce({
        draftId: "draft-aurora-current",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-current",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Stale Aurora error must not block current Aurora" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });

    await act(async () => {
      draftRequest.reject(new Error("Stale Aurora draft failed"));
      await draftRequest.promise.catch(() => undefined);
    });

    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(screen.queryByText("Stale Aurora draft failed")).not.toBeInTheDocument();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Current Aurora draft after stale error settled"
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数修改提交" })).toBeVisible());
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-aurora-current"
      )
    );
  });

  it("aligns same-project pending drafts to the shared working tip after create", async () => {
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-gpio",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-gpio",
        workingCandidateRevisionId: "working-tip-1",
        rebasedDraftIds: [],
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockResolvedValueOnce({
        draftId: "draft-status",
        parameterId: "binding-mt5788-gpio-int",
        candidateRevisionId: "candidate-mt5788",
        workingCandidateRevisionId: "working-tip-2",
        rebasedDraftIds: ["draft-gpio"],
        rawText: "<&gpio6 16 0>",
        action: "set" as const,
        parameterSpecId: "spec-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "mt5788" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({
      createBindingDraft,
      getSpec: vi.fn().mockImplementation(async (specId: string) => ({
        id: specId,
        organizationId: "org-chargelab",
        sourceKind: "vendor",
        specificationKey: specId,
        propertyKey: specId.includes("status") ? "status" : "gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersionId: "spec-version-1",
        currentVersion: 1,
        displayName: specId.includes("status") ? "status" : "gpio_int",
        description: "",
        valueShape: null,
        schemaDefault: null,
        exampleValue: null,
        schemaNamespace: null,
        units: null,
        constraints: null,
        documentation: null,
        compatiblePatterns: null,
        policyTarget: null
      }))
    });
    const loadTopology = repository.getTopology;
    repository.getTopology = vi.fn<ParameterTopologyRepository["getTopology"]>(async (...args) => {
      if (args[2] === "working-tip-1" && args[3] === "effective") {
        // Keep the first reload visible so it replaces the outgoing tree.
        await waitFor(() =>
          expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("aria-busy", "true")
        );
      }
      return loadTopology(...args);
    });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "First binding draft",
      rawValue: "<&gpio13 30 0>"
    });
    await screen.findByRole("region", { name: "参数修改提交" });

    // The draft tray can appear before the first working-tip reload settles.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "working-tip-1"
      )
    );
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    const mt5788 = within(workspace).getByRole("treeitem", { name: /未分类 · mt5788/ });
    fireEvent.click(mt5788);
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole(
        "treeitem", { name: /未分类 · mt5788/ }
      )).toHaveAttribute("aria-selected", "true")
    );
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Second binding draft",
      rawValue: "<&gpio6 16 0>",
      editButtonName: /编辑 gpio_int（未分类 · mt5788/
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
    expect(within(tray).queryByText("技术身份")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "working-tip-2"
      )
    );
    const submitButton = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("submits a typed binding draft with server-filtered role assignees", async () => {
    const repository = createRepository({
      createBindingDraft: vi.fn().mockResolvedValue({
        draftId: "draft-typed-1",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-candidate-2",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
    });
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
        onNavigate={onNavigate}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Raise gpio line for typed workflow", rawValue: "<&gpio13 30 0>" });

    const submission = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(submission).getByRole("heading", { name: "本轮已修改" })).toBeVisible();
    await waitFor(() => expect(listWorkflowAssignees).toHaveBeenCalledWith("aurora"));
    expect(await within(submission).findByLabelText("硬件 MDE")).toHaveValue("u-hw");
    expect(within(submission).getByLabelText("软件 MDE")).toHaveValue("u-sw");
    expect(within(submission).getByLabelText("软件开发")).toHaveValue("u-user");
    const submitButton = within(submission).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitBindingChanges).toHaveBeenCalledWith({
        projectId: "aurora",
        items: [
          {
            draftId: "draft-typed-1",
            action: "set",
            targetValue: "<&gpio13 30 0>",
            reason: "Raise gpio line for typed workflow",
            projectParameterBindingId: "binding-sc8562-gpio-int",
            parameterSpecId: "spec-sc8562-gpio-int",
            editSubjectKind: "binding"
          }
        ],
        assignees: {
          hardwareCommitterId: "u-hw",
          softwareCommitterId: "u-sw",
          softwareUserId: "u-user"
        }
      });
    });
    // Consumed drafts leave the tray; the success notice keeps the review entry.
    const successNotice = await screen.findByRole("region", { name: "参数提交结果" });
    expect(within(successNotice).getByRole("status")).toHaveTextContent(/已提交正式审核（1 项）/);
    fireEvent.click(within(successNotice).getByRole("button", { name: "查看变更审阅" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");
  });

  it("replaces a draft for the same binding and keeps the original binding value in the current-edits diff", async () => {
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-first",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-first",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockResolvedValueOnce({
        draftId: "draft-replacement",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-replacement",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "First typed change", rawValue: "<&gpio13 30 0>" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("data-revision-id", "candidate-first"));

    const replacementWorkspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(replacementWorkspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(replacementWorkspace, fireEvent, { reason: "Replacement typed change", rawValue: "<&gpio13 31 0>" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-replacement"
      );
    });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const diff = within(tray).getByLabelText("gpio_int 值变更");
    expect(within(diff).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(within(diff).getByText("<&gpio13 31 0>")).toBeVisible();
    expect(within(tray).queryByText("candidate-first")).not.toBeInTheDocument();
    expect(within(tray).queryByText("技术身份")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "candidate-replacement"
    );
    expect(within(tray).getByText(/^本轮 1 项$/)).toBeVisible();
  });

  it("locks only the submitting project until the real submit mutation settles", async () => {
    let resolveSubmit!: () => void;
    const pendingSubmit = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const submitBindingChanges = vi.fn(() => pendingSubmit);
    const createBindingDraft = vi.fn().mockResolvedValue({
      draftId: "draft-project-lock",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "candidate-project-lock",
      rawText: "<&gpio13 30 0>",
      action: "set" as const,
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts"
    });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { act, fireEvent } = await import("@testing-library/react");
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Lock Aurora while submitting", rawValue: "<&gpio13 30 0>" });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const submit = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(submitBindingChanges).toHaveBeenCalledTimes(1);
    expect(within(tray).getByRole("button", { name: "移出本轮修改" })).toBeDisabled();
    expect(within(tray).getByLabelText("硬件 MDE")).toBeDisabled();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    fireEvent.click(within(workspace).getByRole("button", { name: /查看 gpio_int（未分类 · sc8562/ }));
    const detail = screen.getByRole("dialog", { name: /参数详情/ });
    expect(within(detail).queryByLabelText("目标值")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /加入草稿/ })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();
    expect(createBindingDraft).toHaveBeenCalledTimes(1);

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    await waitFor(() => {
      expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();
    });
  });

  it("blocks formal submit while a delayed replacement draft mutation owns the project lock", async () => {
    let resolveReplacement!: (value: Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>) => void;
    const replacementRequest = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((resolve) => {
      resolveReplacement = resolve;
    });
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-reused",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-first",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockImplementationOnce(() => replacementRequest);
    const repository = createRepository({ createBindingDraft });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { act, fireEvent } = await import("@testing-library/react");
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create first draft", rawValue: "<&gpio13 30 0>" });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-first"
      );
    });
    await screen.findByRole("region", { name: "参数修改提交" });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Delayed replacement",
      rawValue: "<&gpio13 31 0>"
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    let tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    const blockedSubmit = within(tray).getByText(/^提交审核/).closest("button") as HTMLButtonElement;
    expect(blockedSubmit).toBeDisabled();
    expect(within(tray).getByRole("alert", { hidden: true })).toHaveTextContent(/正在创建 typed draft/);
    fireEvent.click(blockedSubmit);
    expect(submitBindingChanges).not.toHaveBeenCalled();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();
    expect(createBindingDraft).toHaveBeenCalledTimes(2);

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveReplacement({
        draftId: "draft-reused",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-replacement",
        rawText: "<&gpio13 31 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
      await replacementRequest;
    });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(screen.queryByText("candidate-replacement")).not.toBeInTheDocument();
    expect(submitBindingChanges).not.toHaveBeenCalled();
  });

  it("releases the project mutation lock when replacement draft creation rejects", async () => {
    let rejectReplacement!: (error: Error) => void;
    const replacementRequest = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((_resolve, reject) => {
      rejectReplacement = reject;
    });
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-existing",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-existing",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockImplementationOnce(() => replacementRequest);
    const repository = createRepository({ createBindingDraft });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const { act, fireEvent } = await import("@testing-library/react");
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create existing draft" });
    await screen.findByRole("region", { name: "参数修改提交" });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-existing"
      );
    });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Replacement must reject",
      rawValue: "<&gpio13 31 0>"
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    let tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    expect(within(tray).getByRole("button", { name: /^提交审核/, hidden: true })).toBeDisabled();

    await act(async () => {
      rejectReplacement(new Error("replacement rejected"));
      await replacementRequest.catch(() => undefined);
    });
    tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    const submit = within(tray).getByText(/^提交审核/).closest("button") as HTMLButtonElement;
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
  });

  it("does not render a toolbar revision-validate action", async () => {
    const repository = createRepository();
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workspace).queryByRole("button", { name: "校验" })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
    expect(repository.validateRevision).not.toHaveBeenCalled();
  });

  it("deletes the server draft on tray removal and refreshes the draft list", async () => {
    const serverDraft = {
      id: "draft-server-1",
      projectId: "aurora",
      parameterId: "binding-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-real-1",
      targetValue: "<&gpio13 30 0>",
      action: "set" as const,
      reason: "Server draft to delete",
      updatedAt: "2026-08-01T02:00:00.000Z"
    };
    const listDrafts = vi.fn()
      .mockResolvedValueOnce([serverDraft])
      .mockResolvedValue([]);
    const deleteDraft = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={deleteDraft}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText("Server draft to delete")).toBeVisible();

    fireEvent.click(within(tray).getByRole("button", { name: "移出本轮修改" }));

    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("draft-server-1"));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    // Draft list is re-read from the server so a reload cannot revive the deleted draft.
    await waitFor(() => expect(listDrafts.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("keeps the draft and shows an inline error when server draft delete fails", async () => {
    const serverDraft = {
      id: "draft-server-1",
      projectId: "aurora",
      parameterId: "binding-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-real-1",
      targetValue: "<&gpio13 30 0>",
      action: "set" as const,
      reason: "Draft delete must fail visibly",
      updatedAt: "2026-08-01T02:00:00.000Z"
    };
    const listDrafts = vi.fn().mockResolvedValue([serverDraft]);
    const deleteDraft = vi.fn().mockRejectedValue(new Error("server offline"));
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={deleteDraft}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    fireEvent.click(within(tray).getByRole("button", { name: "移出本轮修改" }));

    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("draft-server-1"));
    expect(await within(tray).findByText(/移除草稿失败/)).toBeVisible();
    expect(within(tray).getByText("Draft delete must fail visibly")).toBeVisible();
  });

  it("clears the tray after a successful submit so consumed draft ids cannot be resubmitted", async () => {
    const listDrafts = vi.fn().mockResolvedValue([]);
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository();
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={vi.fn()}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Submit then clear",
      rawValue: "<&gpio13 30 0>"
    });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const submit = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(submit).toHaveTextContent("提交审核（1 项）");
    fireEvent.click(submit);

    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    // The workspace returns to the current revision once the round is consumed.
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
  });

  it("loads project-primary DTS in tech view via parameter file repository", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);
    const parameterFileRepository = createTestParameterFileRepository({
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-board",
          projectId: "aurora",
          fileName: "aurora-board.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "ver-1",
          currentVersionNumber: 2,
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]),
      downloadVersion: vi.fn().mockResolvedValue({
        contentType: "text/plain",
        fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode('/ {\n  board_id = "aurora";\n};')
      })
    });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        parameterFileRepository={parameterFileRepository}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "DTS 源码" }));

    await waitFor(() => expect(parameterFileRepository.listFiles).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(parameterFileRepository.downloadVersion).toHaveBeenCalledWith("aurora", "file-board", "ver-1")
    );
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "生效 DTS 拓扑" })).not.toBeInTheDocument();
    expect(screen.queryByText(/aurora-board\.dts · v2/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });

  it("renders format switcher when JSON bindings exist and switches between DTS and JSON workbenches", async () => {
    const jsonBinding: ProjectParameterBinding = {
      id: "binding-json-camera",
      parameterSpecId: "spec-cam-cfg",
      parameterSpecVersionId: "specver-cam-cfg-1",
      propertyKey: "camera_tuning",
      driverModule: "camera",
      logicalNodeId: "logical-cam",
      instanceName: "camera@0",
      locator: "system/camera/tuning.json",
      effectiveValue: {
        kind: "json",
        raw: '{"exposure": 100, "iso": 400}',
        parsed: { exposure: 100, iso: 400 }
      },
      rawValue: '{"exposure": 100, "iso": 400}',
      schemaState: "valid",
      policyState: "pass",
      moduleId: driverFallbackModuleId("camera")
    };
    const bindings = [...TOPOLOGY_TEACHING_BINDINGS, jsonBinding];
    const repository = createRepository({
      listBindings: vi.fn().mockResolvedValue(bindings)
    });
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tablist", { name: "参数配置格式" })).toBeInTheDocument();
    });

    const dtsTab = screen.getByRole("tab", { name: /DTS 设备树参数/ });
    const jsonTab = screen.getByRole("tab", { name: /JSON 参数/ });
    expect(dtsTab).toHaveAttribute("aria-selected", "true");
    expect(jsonTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "JSON 参数工作台" })).not.toBeInTheDocument();

    fireEvent.click(jsonTab);

    expect(dtsTab).toHaveAttribute("aria-selected", "false");
    expect(jsonTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "DTS 参数工作台" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "JSON 参数" })).toBeInTheDocument();
    expect(screen.getAllByText("camera_tuning").length).toBeGreaterThan(0);

    fireEvent.click(dtsTab);
    expect(dtsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
  });
});
