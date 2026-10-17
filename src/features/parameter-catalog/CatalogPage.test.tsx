import { selectControlOption } from "@/test/selectControlOption";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { catalogSubjectListResponseSchema, catalogDefinitionResponseSchema } from "@wiseeff/dto-schemas";

import {
  catalogResultCountLabel,
} from "./copy";
import {
  CATALOG_DEFINITION_ID,
  CATALOG_MODULE_ID,
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_SUBJECT_ID,
  activeDefinition,
  retiredSubject,
  registeredSubject,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import {
  createMockCatalogPorts,
  createMockParameterCatalogRepository,
  type CatalogMockScenario
} from "@/application/parameter-catalog/mockAdapter";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { buildCatalogHref, EMPTY_CATALOG_URL_ANCHOR, parseCatalogUrlAnchor } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogListQuery, CatalogSubjectListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { CatalogPage } from "./CatalogPage";
import type { CatalogLayoutMode } from "./catalogLayout";
import { catalogEmptyMessages } from "./copy";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

type PageProps = ComponentProps<typeof CatalogPage>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapAfterGate(repository: ParameterCatalogRepository, gate: Promise<void>): ParameterCatalogRepository {
  return {
    ...repository,
    getCatalog: async (query) => {
      await gate;
      return repository.getCatalog(query);
    },
    listSubjects: async (query) => {
      await gate;
      return repository.listSubjects(query);
    },
    getSubject: async (subjectId, query) => {
      await gate;
      return repository.getSubject(subjectId, query);
    },
    listSubjectDefinitions: async (subjectId, query) => {
      await gate;
      return repository.listSubjectDefinitions(subjectId, query);
    },
    listDefinitions: async (query) => {
      await gate;
      return repository.listDefinitions(query);
    },
    getDefinition: async (definitionId, query) => {
      await gate;
      return repository.getDefinition(definitionId, query);
    },
    listDefinitionRevisions: async (definitionId, query) => {
      await gate;
      return repository.listDefinitionRevisions(definitionId, query);
    },
    getDefinitionRevision: async (definitionId, revisionId) => {
      await gate;
      return repository.getDefinitionRevision(definitionId, revisionId);
    },
    listDefinitionTimeline: async (definitionId, query) => {
      await gate;
      return repository.listDefinitionTimeline(definitionId, query);
    },
    getLegacyIdentifier: async (legacyType, legacyId) => {
      await gate;
      return repository.getLegacyIdentifier(legacyType, legacyId);
    },
    createPublicationCandidate: async (body, context) => {
      await gate;
      return repository.createPublicationCandidate(body, context);
    },
    getPublicationCandidate: async (candidateId) => {
      await gate;
      return repository.getPublicationCandidate(candidateId);
    },
    publishPublicationCandidate: async (candidateId, body, context) => {
      await gate;
      return repository.publishPublicationCandidate(candidateId, body, context);
    },
    getPublication: async (jobId) => {
      await gate;
      return repository.getPublication(jobId);
    },
    getPublicationSurface: async () => {
      await gate;
      return repository.getPublicationSurface();
    },
    listPublications: async (query) => {
      await gate;
      return repository.listPublications(query);
    }
  };
}

function CatalogHarness({
  initialSearch = "",
  onHref,
  ...props
}: Omit<PageProps, "search" | "onAnchorChange"> & {
  initialSearch?: string;
  onHref?: (href: string, mode: "push" | "replace") => void;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [entries, setEntries] = useState([initialSearch]);
  const [index, setIndex] = useState(0);
  const currentSearch = entries[index] ?? search;
  const handleAnchorChange = useCallback(
    (href: string, mode: "push" | "replace") => {
      onHref?.(href, mode);
      const next = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      setSearch(next);
      setEntries((current) => {
        const cursor = Math.min(index, current.length - 1);
        if (mode === "replace") {
          const copy = current.slice(0, cursor + 1);
          copy[cursor] = next;
          return copy;
        }
        return [...current.slice(0, cursor + 1), next];
      });
      if (mode === "push") {
        setIndex((value) => value + 1);
      }
    },
    [index, onHref]
  );

  return (
    <div>
      <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))}>
        后退
      </button>
      <button type="button" onClick={() => setIndex((value) => Math.min(entries.length - 1, value + 1))}>
        前进
      </button>
      <CatalogPage {...props} search={currentSearch} onAnchorChange={handleAnchorChange} />
    </div>
  );
}

function renderCatalog(
  options: {
    scenario?: CatalogMockScenario;
    actor?: CatalogActorKind;
    sessionPermissions?: readonly string[];
    search?: string;
    layoutMode?: CatalogLayoutMode;
    includeReview?: boolean;
    repository?: ParameterCatalogRepository;
    onHref?: (href: string, mode: "push" | "replace") => void;
    definitionAuthoringAllowed?: boolean;
    definitionPublishingAllowed?: boolean;
    onDefinitionCommand?: PageProps["onDefinitionCommand"];
    renderDefinitionEditor?: PageProps["renderDefinitionEditor"];
  } = {}
) {
  const ports = createMockCatalogPorts({ scenario: options.scenario ?? "ready" });
  const repository = options.repository ?? ports.catalog;
  const onHref = vi.fn(options.onHref ?? (() => undefined));
  const view = render(
    <CatalogHarness
      repository={repository}
      actor={options.actor ?? "org-admin"}
      onOpenPendingWork={vi.fn()}
      sessionPermissions={options.sessionPermissions}
      definitionAuthoringAllowed={options.definitionAuthoringAllowed}
      definitionPublishingAllowed={options.definitionPublishingAllowed}
      onDefinitionCommand={options.onDefinitionCommand}
      renderDefinitionEditor={options.renderDefinitionEditor}
      initialSearch={options.search ?? ""}
      layoutMode={options.layoutMode ?? "desktop"}
      organizationId={options.includeReview ? CATALOG_ORGANIZATION_ID : undefined}
      listReviewItems={
        options.includeReview ? (organizationId) => ports.governance.listReviewItems(organizationId) : undefined
      }
      onHref={onHref}
    />
  );
  return { ...view, ports, repository, onHref };
}

// These tests page through 101-subject inventories with user events; CI runners need more than the 5s default.
describe("CatalogPage", { timeout: 15_000 }, () => {
  const historicalSubject = { ...retiredSubject, id: "csub_historical", canonicalName: "retired,driver", registration: { status: "unregistered" as const } };
  const historicalDefinition = {
    ...activeDefinition, id: "pdef_historical", propertyKey: "historical-key",
    subject: { ...activeDefinition.subject, id: historicalSubject.id, canonicalName: historicalSubject.canonicalName }
  };

  function lifecycleInventory() {
    const repository = createMockParameterCatalogRepository({ scenario: "ready" });
    vi.spyOn(repository, "listSubjects").mockImplementation(async (query) => ({
      items: query?.lifecycle === "retired" ? [historicalSubject] : [registeredSubject],
      totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    }));
    vi.spyOn(repository, "getSubject").mockImplementation(async (id) => ({
      item: id === historicalSubject.id ? historicalSubject : registeredSubject
    }));
    vi.spyOn(repository, "getDefinition").mockImplementation(async (id) => ({
      item: id === historicalDefinition.id ? historicalDefinition : activeDefinition
    }));
    vi.spyOn(repository, "listSubjectDefinitions").mockImplementation(async (id) => ({
      items: [id === historicalSubject.id ? historicalDefinition : activeDefinition],
      totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    }));
    return repository;
  }

  it("defaults to active subjects, explicitly includes history, and keeps detail retirement local", async () => {
    const user = userEvent.setup();
    const repository = lifecycleInventory();
    const list = vi.spyOn(repository, "listDefinitions").mockImplementation(async (query) => {
      const items = query?.subjectLifecycle === "active" ? [activeDefinition] : [activeDefinition, historicalDefinition];
      return { items, totalCount: items.length, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID };
    });
    const { onHref } = renderCatalog({ repository, search: "?pageSize=20", definitionAuthoringAllowed: true,
      renderDefinitionEditor: () => <p>只读内容</p> });
    await screen.findByRole("table", { name: "参数定义列表" });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ subjectLifecycle: "active", limit: 20 })));
    expect(screen.queryByRole("button", { name: "查看 historical-key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `选择主体 ${historicalSubject.canonicalName}` })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "包含退役主体" }));
    await user.click(await screen.findByRole("button", { name: "查看 historical-key" }));
    const dialog = await screen.findByRole("dialog", { name: "查看 historical-key" });
    await waitFor(() => expect(within(dialog).getByText("主体已退役 · 只读")).toBeVisible());
    expect(screen.getAllByText("主体已退役 · 只读")).toHaveLength(1);
    expect(document.querySelector('[data-catalog-banner="retired"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "调整放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: catalogResultCountLabel })).toHaveTextContent("共 2 项");
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("checkbox", { name: "包含退役主体" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "查看 historical-key" })).not.toBeInTheDocument());
    expect(parseCatalogUrlAnchor(onHref.mock.calls.at(-1)![0].split("?")[1])).toMatchObject({ includeRetiredSubjects: false, pageSize: 20 });
  });

  it("restores a historical subject bookmark and clears its scope when history is hidden", async () => {
    const user = userEvent.setup();
    const repository = lifecycleInventory();
    const { onHref } = renderCatalog({ repository,
      search: `?subjectId=${historicalSubject.id}&q=key&pageSize=20&cursor=old-page` });
    expect(await screen.findByRole("button", { name: "查看 historical-key" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "包含退役主体" })).toBeChecked();
    expect(parseCatalogUrlAnchor(onHref.mock.calls.at(-1)![0].split("?")[1])).toMatchObject({
      includeRetiredSubjects: true, subjectId: historicalSubject.id, cursor: null, q: "key", pageSize: 20
    });
    await user.click(screen.getByRole("checkbox", { name: "包含退役主体" }));
    await waitFor(() => expect(parseCatalogUrlAnchor(onHref.mock.calls.at(-1)![0].split("?")[1])).toMatchObject({
      includeRetiredSubjects: false, subjectId: null, cursor: null, q: "key", pageSize: 20
    }));
  });

  it.each(["desktop", "mobile"] as const)("offers only viewing for a retired owner in the %s list", async (layoutMode) => {
    const repository = lifecycleInventory();
    vi.spyOn(repository, "listDefinitions").mockResolvedValue({
      items: [historicalDefinition, activeDefinition], totalCount: 2, hasMore: false,
      nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    });
    renderCatalog({ repository, layoutMode, search: "?includeRetiredSubjects=true", definitionAuthoringAllowed: true,
      definitionPublishingAllowed: true, onDefinitionCommand: vi.fn(), renderDefinitionEditor: () => <p>完整详情</p> });
    expect(await screen.findByRole("button", { name: "查看 historical-key" })).toBeVisible();
    expect(await screen.findByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` })).toBeVisible();
    expect(screen.queryByRole("button", { name: "编辑 historical-key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "弃用 historical-key" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 historical-key" })
      .closest(layoutMode === "desktop" ? "tr" : ".parameter-catalog__card-row")).toHaveTextContent("主体已退役");
  });

  it("keeps deprecated and retired definitions read-only while preserving legitimate lifecycle commands", async () => {
    const repository = lifecycleInventory();
    vi.spyOn(repository, "listDefinitions").mockResolvedValue({
      items: [
        { ...activeDefinition, id: "deprecated", propertyKey: "deprecated-key", lifecycle: "deprecated" },
        { ...activeDefinition, id: "retired", propertyKey: "retired-key", lifecycle: "retired" },
        { ...activeDefinition, id: "registration-retired", propertyKey: "registration-key",
          registration: { ...registeredSubject.registration, status: "retired", id: "registration-retired" } }
      ], totalCount: 3, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    });
    renderCatalog({ repository, definitionAuthoringAllowed: true, definitionPublishingAllowed: true,
      onDefinitionCommand: vi.fn(), renderDefinitionEditor: () => <p>完整详情</p> });
    expect(await screen.findByRole("button", { name: "查看 deprecated-key" })).toBeVisible();
    expect(screen.getByRole("button", { name: "查看 retired-key" })).toBeVisible();
    expect(await screen.findByRole("button", { name: "恢复 retired-key" })).toBeVisible();
    expect(screen.getByRole("button", { name: "查看 registration-key" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "弃用 registration-key" })).not.toBeInTheDocument();
  });

  it("identifies the retired subject without marking the entire catalog release retired", async () => {
    const repository = lifecycleInventory();
    renderCatalog({ repository, search: `?subjectId=${historicalSubject.id}&definitionId=${historicalDefinition.id}`,
      definitionAuthoringAllowed: true, renderDefinitionEditor: () => <p>完整详情</p> });
    const dialog = await screen.findByRole("dialog", { name: "查看 historical-key" });
    expect(within(dialog).getByText("主体已退役 · 只读")).toBeVisible();
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    expect(screen.queryByLabelText("目录发布")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("目录版本状态")).not.toBeInTheDocument();
  });

  it("passes the active owner state to lifecycle commands even when the selected definition is retired", async () => {
    const repository = lifecycleInventory();
    const retired = { ...activeDefinition, lifecycle: "retired" as const };
    vi.spyOn(repository, "getDefinition").mockResolvedValue({ item: retired });
    vi.spyOn(repository, "listSubjectDefinitions").mockResolvedValue({ items: [retired], totalCount: 1,
      hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    const onDefinitionCommand = vi.fn();
    renderCatalog({ repository, search: `?subjectId=${registeredSubject.id}&definitionId=${retired.id}`,
      definitionPublishingAllowed: true, onDefinitionCommand });
    await screen.findByRole("dialog", { name: `查看 ${retired.propertyKey}` });
    fireEvent.click(await screen.findByRole("button", { name: `恢复 ${retired.propertyKey}` }));
    expect(onDefinitionCommand).toHaveBeenCalledWith("restore-definition", retired,
      { kind: "ready", catalogReleaseId: CATALOG_RELEASE_ID, writesEnabled: true });
  });

  it.each(["编辑", "查看"])("preserves the collection and navigator scope when opening and closing %s", async (action) => {
    const repository = lifecycleInventory();
    const definitions = [historicalDefinition, activeDefinition];
    const list = vi.spyOn(repository, "listDefinitions").mockResolvedValue({
      items: definitions, totalCount: 2, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    });
    const { onHref } = renderCatalog({ repository, definitionAuthoringAllowed: true,
      renderDefinitionEditor: () => <p>完整详情</p> });
    const selected = action === "编辑" ? activeDefinition : historicalDefinition;
    const rowAction = await screen.findByRole("button", { name: `${action} ${selected.propertyKey}` });
    const before = list.mock.calls.at(-1);
    await userEvent.click(rowAction);
    const dialog = await screen.findByRole("dialog", { name: `${action} ${selected.propertyKey}` });
    const title = within(dialog).getByRole("heading", { level: 2, name: `${action} ${selected.propertyKey}` });
    expect(title.closest(".parameter-catalog__editor-dialog-head")?.textContent).toBe(`${action} ${selected.propertyKey}`);
    const href = onHref.mock.calls.at(-1)![0] as string;
    expect(parseCatalogUrlAnchor(href.slice(href.indexOf("?"))).subjectId).toBeNull();
    expect(screen.getByRole("status", { name: catalogResultCountLabel })).toHaveTextContent("共 2 项");
    expect(within(screen.getByRole("navigation", { name: "参数定义模块树" })).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(list.mock.calls.at(-1)).toEqual(before);
    expect(repository.listSubjectDefinitions).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: catalogResultCountLabel })).toHaveTextContent("共 2 项");
  });

  it.each([true, false])("keeps independent list scope while deriving detail state from its real owner (retired scope: %s)", async (retiredAnchor) => {
    const repository = lifecycleInventory();
    const definition = retiredAnchor ? activeDefinition : historicalDefinition;
    const subjectId = retiredAnchor ? historicalSubject.id : registeredSubject.id;
    const onHref = vi.fn();
    renderCatalog({ repository, onHref, search: `?subjectId=${subjectId}&definitionId=${definition.id}` });
    await screen.findByRole("dialog", { name: `查看 ${definition.propertyKey}` });
    expect(onHref.mock.calls.some(([href]) => parseCatalogUrlAnchor(href.slice(href.indexOf("?"))).subjectId !== subjectId)).toBe(false);
    expect(within(screen.getByRole("navigation", { name: "参数定义模块树" })).getByRole("button", { name: `选择主体 ${retiredAnchor ? historicalSubject.canonicalName : registeredSubject.canonicalName}` })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", retiredAnchor ? "ready" : "retired"));
  });

  it("keeps a module selection, collapsed branch, search and pagination while editing", async () => {
    const repository = lifecycleInventory();
    const list = vi.spyOn(repository, "listDefinitions").mockResolvedValue({
      items: [activeDefinition], totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    });
    const { onHref } = renderCatalog({ repository, definitionAuthoringAllowed: true,
      search: `?moduleNodeId=${CATALOG_MODULE_ID}&q=GPIO&lifecycle=active&pageSize=20&cursor=opaque-next`,
      renderDefinitionEditor: () => <p>完整详情</p> });
    const user = userEvent.setup();
    const rowAction = await screen.findByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` });
    await user.click(screen.getByRole("button", { name: "收起 Root" }));
    const before = list.mock.calls.at(-1);
    await user.click(rowAction);
    await screen.findByRole("dialog", { name: `编辑 ${activeDefinition.propertyKey}` });
    expect(screen.getByRole("button", { name: /^Root\s*1$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "展开 Root" })).toHaveAttribute("aria-expanded", "false");
    const href = onHref.mock.calls.at(-1)![0] as string;
    expect(parseCatalogUrlAnchor(href.slice(href.indexOf("?")))).toMatchObject({
      moduleNodeId: CATALOG_MODULE_ID, subjectId: null, q: "GPIO", lifecycle: "active", pageSize: 20, cursor: "opaque-next"
    });
    expect(list.mock.calls.at(-1)).toEqual(before);
    expect(repository.listSubjectDefinitions).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "展开 Root" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "前进" }));
    expect(screen.getByRole("button", { name: /^Root\s*1$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores a late retired-subject response after switching to an active subject", async () => {
    const repository = lifecycleInventory();
    const gate = deferred<{ item: typeof historicalSubject }>();
    const getSubject = vi.spyOn(repository, "getSubject").mockImplementation(async (id) =>
      id === historicalSubject.id ? gate.promise : { item: registeredSubject });
    const props = { repository, actor: "user" as const };
    const view = render(<CatalogPage {...props} search={`?subjectId=${historicalSubject.id}`} />);
    await waitFor(() => expect(getSubject).toHaveBeenCalledWith(historicalSubject.id, expect.anything()));
    view.rerender(<CatalogPage {...props} search={`?subjectId=${registeredSubject.id}`} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", "ready"));
    await act(async () => { gate.resolve({ item: historicalSubject }); });
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", "ready");
    expect(screen.queryByText(`主体「${historicalSubject.canonicalName}」已退役，其参数定义仅供查看和历史追溯。`)).not.toBeInTheDocument();
  });
  it("guards unsaved editor dismissal and blocks dismissal during a write", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    render(<CatalogHarness repository={ports.catalog} actor="org-admin" initialSearch={`?definitionId=${CATALOG_DEFINITION_ID}`}
      onHref={() => { expect(requestSettingsLeave()).toBe(true); }}
      renderDefinitionEditor={(_definition, context) => <>
        <button onClick={() => context.onEditorStateChange?.({ dirty: true, pending: false })}>修改正文</button>
        <button onClick={() => context.onEditorStateChange?.({ dirty: true, pending: true })}>开始提交</button>
        <button onClick={() => context.onEditorStateChange?.({ dirty: true, pending: false })}>结束提交</button>
      </>} />);
    await user.click(await screen.findByRole("button", { name: "修改正文" }));
    let navigationDecision: boolean | Promise<boolean> = false;
    act(() => { navigationDecision = requestSettingsLeave(); });
    expect(navigationDecision).toBeInstanceOf(Promise);
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(await navigationDecision).toBe(false);
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    await user.click(screen.getByRole("button", { name: "开始提交" }));
    expect(requestSettingsLeave()).toBe(false);
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "放弃未保存的修改？" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "结束提交" }));
    act(() => { navigationDecision = requestSettingsLeave(); });
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(await navigationDecision).toBe(true);
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads later revision and timeline pages and compares historical fields with the current revision", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const base = await ports.catalog.getDefinition(CATALOG_DEFINITION_ID);
    const previous = { ...base.item.currentRevision, id: "revision-old", revisionNumber: 1, displayName: "原显示名称" };
    const revisions = vi.spyOn(ports.catalog, "listDefinitionRevisions").mockImplementation(async (_id, query) => ({
      catalogReleaseId: CATALOG_RELEASE_ID, totalCount: 2,
      items: [query?.cursor ? previous : base.item.currentRevision],
      hasMore: !query?.cursor, nextCursor: query?.cursor ? null : "revision-page-2"
    }));
    const timeline = vi.spyOn(ports.catalog, "listDefinitionTimeline").mockResolvedValue({ catalogReleaseId: CATALOG_RELEASE_ID, totalCount: 0, items: [], hasMore: false, nextCursor: null });
    renderCatalog({ repository: ports.catalog, search: `?definitionId=${CATALOG_DEFINITION_ID}` });
    await user.click(await screen.findByRole("button", { name: /查看历史/ }));
    await user.click(await screen.findByRole("button", { name: "加载更多历史" }));
    await user.click(await screen.findByText("修订 #1 · 查看内容与当前比较"));
    const compare = screen.getByRole("table", { name: "修订 #1 内容比较" });
    expect(compare).toHaveTextContent("原显示名称");
    expect(compare).toHaveTextContent(base.item.currentRevision.displayName);
    expect(within(compare).getByText("原显示名称").closest("tr")).toHaveAttribute("data-changed", "true");
    expect(revisions).toHaveBeenLastCalledWith(CATALOG_DEFINITION_ID, expect.objectContaining({ cursor: "revision-page-2", catalogReleaseId: CATALOG_RELEASE_ID }));
    expect(timeline).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "加载更多历史" })).not.toBeInTheDocument();
  });
  it("keeps governance evidence in the task region while collapsing only the module navigator", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    render(<CatalogPage repository={ports.catalog} actor="org-admin" search=""
      taskContent={<section aria-label="节点对应确认">只读历史证据</section>} />);
    const task = screen.getByRole("region", { name: "目录列表" });
    expect(within(task).getByRole("region", { name: "节点对应确认" })).toHaveTextContent("只读历史证据");
    expect(within(task).queryByRole("table", { name: "参数定义列表" })).not.toBeInTheDocument();
    const navigator = screen.getByRole("region", { name: "模块导航" });
    await user.click(await within(navigator).findByRole("button", { name: "展开 Root" }));
    const module = await within(navigator).findByRole("button", { name: /southchip,sc8562/ });
    await user.click(within(navigator).getByRole("button", { name: "收起模块导航" }));
    expect(module).not.toBeVisible();
    expect(within(task).getByText("只读历史证据")).toBeVisible();
    await user.click(within(navigator).getByRole("button", { name: "展开模块导航" }));
    expect(module).toBeVisible();
  });

  it("orders workbench actions, navigation and definitions without a redundant release context", async () => {
    renderCatalog();
    await screen.findByRole("table", { name: "参数定义列表" });
    const toolbar = screen.getByRole("group", { name: "工作台操作" });
    expect(screen.queryByRole("region", { name: "目录发布" })).not.toBeInTheDocument();
    const navigator = screen.getByRole("region", { name: "模块导航" });
    const task = screen.getByRole("region", { name: "目录列表" });
    expect(within(toolbar).getByRole("searchbox", { name: "搜索参数定义" })).toBeVisible();
    expect(within(toolbar).queryByRole("button", { name: "搜索" })).not.toBeInTheDocument();
    expect(toolbar.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(navigator.compareDocumentPosition(task) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: "收起模块导航" })).toBeVisible();
  });

  it("does not reload the definition catalog when only the review selection changes", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const read = vi.spyOn(ports.catalog, "listDefinitions");
    const props = { repository: ports.catalog, actor: "org-admin" as const };
    const view = render(<CatalogPage {...props} onAnchorChange={vi.fn()} search={`?catalogReleaseId=${CATALOG_RELEASE_ID}`} />);
    await screen.findByRole("table", { name: "参数定义列表" });
    const count = read.mock.calls.length;
    view.rerender(<CatalogPage {...props} onAnchorChange={vi.fn()} search={`?catalogReleaseId=${CATALOG_RELEASE_ID}&reviewItemId=review-one&review=open`} />);
    await act(async () => { await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(count);
    expect(screen.getByRole("table", { name: "参数定义列表" })).toBeVisible();
  });

  it("automatically searches and clears without a submit button, preserving scope and resetting pagination", async () => {
    const onHref = vi.fn();
    renderCatalog({ onHref, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}&lifecycle=active&pageSize=20&cursor=opaque-next` });
    const input = screen.getByRole("searchbox", { name: "搜索参数定义" });
    fireEvent.change(input, { target: { value: "  gpio  " } });
    await waitFor(() => expect(onHref).toHaveBeenCalled());
    const [href, mode] = onHref.mock.calls.at(-1)!;
    const query = new URL(href, "http://localhost").searchParams;
    expect(query.get("q")).toBe("gpio");
    expect(query.get("lifecycle")).toBe("active");
    expect(query.get("pageSize")).toBe("20");
    expect(query.get("catalogReleaseId")).toBe(CATALOG_RELEASE_ID);
    expect(query.has("cursor")).toBe(false);
    expect(mode).toBe("replace");
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "清空输入" }));
    await waitFor(() => expect(new URL(onHref.mock.calls.at(-1)![0], "http://localhost").searchParams.has("q")).toBe(false));
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument();
  });

  it("waits for Chinese composition to finish before searching", async () => {
    const onHref = vi.fn();
    renderCatalog({ onHref, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}` });
    await screen.findByRole("table", { name: "参数定义列表" });
    onHref.mockClear();
    const input = screen.getByRole("searchbox", { name: "搜索参数定义" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "电源" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(onHref).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(new URL(onHref.mock.calls.at(-1)?.[0] ?? "/", "http://localhost").searchParams.get("q")).toBe("电源"));
  });

  it("does not overwrite a restored URL with a pending search draft", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const onAnchorChange = vi.fn();
    const props = { repository: ports.catalog, actor: "org-admin" as const, onAnchorChange };
    const view = render(<CatalogPage {...props} search={`?catalogReleaseId=${CATALOG_RELEASE_ID}`} />);
    await screen.findByRole("table", { name: "参数定义列表" });
    onAnchorChange.mockClear();
    const input = screen.getByRole("searchbox", { name: "搜索参数定义" });
    fireEvent.change(input, { target: { value: "pending" } });
    view.rerender(<CatalogPage {...props} search={`?catalogReleaseId=${CATALOG_RELEASE_ID}&q=restored`} />);
    expect(input).toHaveValue("restored");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(onAnchorChange).not.toHaveBeenCalled();
  });

  it("exposes directory actions as a named group for read-only users", async () => {
    renderCatalog({ actor: "user" });
    const actions = await screen.findByRole("group", { name: "目录动作" });
    expect(within(actions).getByRole("button", { name: "待审核事项" })).toBeInTheDocument();
    const { default: axe } = await import("axe-core");
    expect((await axe.run(actions, { runOnly: ["aria-prohibited-attr"] })).violations).toEqual([]);
  });

  it.each(["desktop", "mobile"] as const)("offers viewing with access guidance in the %s read-only catalog", async (layoutMode) => {
    renderCatalog({ actor: "user", layoutMode });
    const user = userEvent.setup();
    const action = await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(action).toHaveTextContent("查看");
    await user.click(action);
    const dialog = await screen.findByRole("dialog", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(within(dialog).getAllByText("如需编辑参数定义，请联系组织管理员开通参数目录编写权限。")).toHaveLength(1);
    expect(within(dialog).getByRole("region", { name: "定义详情" })).toHaveTextContent(activeDefinition.propertyKey);
  });

  function pagedInventory() {
    const subjects = Array.from({ length: 101 }, (_, index) => ({
      ...registeredSubject,
      id: `csub_inventory_${index}`,
      canonicalName: `inventory-subject-${index}`,
      registration: {
        ...registeredSubject.registration,
        id: `creg_inventory_${index}`,
        placement: {
          id: `cpl_inventory_${index}`,
          moduleId: `module_inventory_${index}`,
          displayName: `Inventory module ${index}`,
          parentPlacementId: index === 0 ? null : "cpl_inventory_0"
        }
      }
    }));
    const last = subjects[100];
    const definition = {
      ...activeDefinition,
      subject: { id: last.id, type: last.type, canonicalName: last.canonicalName },
      registration: last.registration
    };
    const first: CatalogSubjectListResponse = {
      items: subjects.slice(0, 100), catalogReleaseId: CATALOG_RELEASE_ID,
      totalCount: 101, hasMore: true, nextCursor: "subject-page-2"
    };
    const second: CatalogSubjectListResponse = {
      ...first, items: [last], hasMore: false, nextCursor: null
    };
    catalogSubjectListResponseSchema.parse(first);
    catalogSubjectListResponseSchema.parse(second);
    catalogDefinitionResponseSchema.parse({ item: definition });
    const ready = createMockParameterCatalogRepository({ scenario: "ready" });
    const retired: CatalogSubjectListResponse = { ...second, items: [], totalCount: 0 };
    const listSubjects = vi.fn(async (query?: CatalogListQuery) => query?.lifecycle === "retired" ? retired : query?.cursor ? second : first);
    const listDefinitions = vi.fn(async () => ({
      items: [definition], catalogReleaseId: CATALOG_RELEASE_ID,
      totalCount: 1, hasMore: false, nextCursor: null
    }));
    const repository: ParameterCatalogRepository = {
      ...ready, listSubjects, listDefinitions,
      listSubjectDefinitions: vi.fn(async () => listDefinitions()),
      getSubject: async (id) => ({ item: subjects.find((item) => item.id === id)! })
    };
    return { repository, listSubjects, listDefinitions, first, second, retired, last };
  }

  it("restores the module scope from its URL and clears it when the active module is reselected", async () => {
    const user = userEvent.setup();
    const inventory = pagedInventory();
    const onHref = vi.fn();
    const first = renderCatalog({ repository: inventory.repository, onHref });
    await user.click(await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ }));
    await waitFor(() => expect(screen.getByText("已选模块子树 · 101 个主体")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "选择主体 inventory-subject-0" }));
    await user.click(screen.getByRole("button", { name: /^Inventory module 0\s*101$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Inventory module 0\s*101$/ })).toHaveAttribute("aria-pressed", "true"));
    const href = onHref.mock.calls.at(-1)![0] as string;
    expect(new URL(href, "http://localhost").searchParams.get("moduleNodeId")).toBe("module_inventory_0");
    first.unmount();

    renderCatalog({ repository: inventory.repository, search: href.slice(href.indexOf("?")), onHref });
    const selected = await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    await user.click(selected);
    await waitFor(() => expect(selected).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByText("已选模块子树 · 101 个主体")).not.toBeInTheDocument();
    expect(new URL(onHref.mock.calls.at(-1)![0], "http://localhost").searchParams.has("moduleNodeId")).toBe(false);
  });

  it("loads all 101 subjects before publishing the navigator and scopes the second-page definition", async () => {
    const user = userEvent.setup();
    const inventory = pagedInventory();
    const gate = deferred<CatalogSubjectListResponse>();
    inventory.listSubjects.mockImplementation(async (query) => query?.lifecycle === "retired" ? inventory.retired : query?.cursor ? gate.promise : inventory.first);
    const { onHref } = renderCatalog({
      repository: inventory.repository,
      search: `?catalogReleaseId=${CATALOG_RELEASE_ID}&moduleNodeId=module_inventory_0`
    });
    await waitFor(() => expect(inventory.listSubjects).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("navigation", { name: "参数定义模块树" })).not.toBeInTheDocument();
    expect(inventory.listDefinitions).not.toHaveBeenCalled();
    gate.resolve(inventory.second);
    expect(await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ })).toBeVisible();
    expect(screen.getByText("已选模块子树 · 101 个主体")).toBeVisible();
    expect(within(screen.getByRole("table", { name: "参数定义列表" })).getByText("gpio-int")).toBeVisible();
    expect(inventory.listSubjects.mock.calls.slice(0, 3)).toEqual([
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100 }],
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, lifecycle: "retired" }],
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, cursor: "subject-page-2" }]
    ]);
    expect(inventory.listDefinitions).toHaveBeenCalledWith(expect.objectContaining({
      placementModuleId: "module_inventory_0", catalogReleaseId: CATALOG_RELEASE_ID
    }));
    expect(screen.queryByRole("button", { name: "全部定义" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Inventory module 0\s*101$/ }));
    await waitFor(() => expect(screen.queryByText("已选模块子树 · 101 个主体")).not.toBeInTheDocument());
    expect(within(screen.getByRole("table", { name: "参数定义列表" })).getByText("gpio-int")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Inventory module 100\s*1$/ }));
    await waitFor(() => expect(screen.getByText("已选模块子树 · 1 个主体")).toBeVisible());
    expect(within(screen.getByRole("table", { name: "参数定义列表" })).getByText("gpio-int")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "选择主体 inventory-subject-100" }));
    await waitFor(() => expect(inventory.repository.listSubjectDefinitions).toHaveBeenCalledWith(
      inventory.last.id, expect.objectContaining({ catalogReleaseId: CATALOG_RELEASE_ID })
    ));
    expect(onHref).toHaveBeenCalledWith(expect.stringContaining(`subjectId=${inventory.last.id}`), "push");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(parseCatalogUrlAnchor(onHref.mock.calls.at(-1)![0].split("?")[1])).toMatchObject({
      subjectId: null, moduleNodeId: "module_inventory_100"
    }));
  }, 15_000);

  it("fails closed on a second subject page failure and recovers through explicit retry", async () => {
    const user = userEvent.setup();
    const inventory = pagedInventory();
    inventory.listSubjects.mockImplementation(async (query) => {
      if (query?.lifecycle === "retired") return inventory.retired;
      if (query?.cursor) throw new Error("second page failed");
      return inventory.first;
    });
    renderCatalog({ repository: inventory.repository, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}` });
    expect(await screen.findByRole("button", { name: "重试" })).toBeVisible();
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "false");
    expect(screen.queryByRole("navigation", { name: "参数定义模块树" })).not.toBeInTheDocument();
    expect(inventory.listDefinitions).not.toHaveBeenCalled();
    inventory.listSubjects.mockImplementation(async (query) => query?.lifecycle === "retired" ? inventory.retired : query?.cursor ? inventory.second : inventory.first);
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "true");
  });

  it("retains a valid first-page descendant definition under the selected ancestor", async () => {
    const inventory = pagedInventory();
    inventory.listSubjects.mockResolvedValue({
      ...inventory.first, items: [inventory.first.items[0], inventory.last],
      hasMore: false, nextCursor: null, totalCount: 2
    });
    renderCatalog({ repository: inventory.repository,
      search: `?catalogReleaseId=${CATALOG_RELEASE_ID}&moduleNodeId=module_inventory_0` });
    expect(await screen.findByRole("button", { name: /^Inventory module 0\s*2$/ })).toBeVisible();
    expect(screen.getByText("已选模块子树 · 2 个主体")).toBeVisible();
    expect(within(screen.getByRole("table", { name: "参数定义列表" })).getByText("gpio-int")).toBeVisible();
    expect(inventory.listDefinitions).toHaveBeenCalledWith(expect.objectContaining({
      placementModuleId: "module_inventory_0"
    }));
  });

  it.each([null, "subject-page-2"])("fails closed for invalid or repeated subject cursor %s", async (cursor) => {
    const inventory = pagedInventory();
    inventory.listSubjects.mockImplementation(async (query) => query?.lifecycle === "retired" ? inventory.retired : query?.cursor
      ? { ...inventory.second, hasMore: true, nextCursor: cursor }
      : { ...inventory.first, nextCursor: cursor });
    renderCatalog({ repository: inventory.repository, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}` });
    expect(await screen.findByRole("button", { name: "重试" })).toBeVisible();
    expect(inventory.listSubjects).toHaveBeenCalledTimes(cursor ? 3 : 2);
    expect(inventory.listDefinitions).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation", { name: "参数定义模块树" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "false");
  });

  it("preserves the real empty subject metadata instead of inventing a successful collection", async () => {
    const inventory = pagedInventory();
    inventory.listSubjects.mockResolvedValue({
      items: [], catalogReleaseId: CATALOG_RELEASE_ID, totalCount: 0,
      hasMore: false, nextCursor: null, emptyReason: "no-registrations"
    });
    renderCatalog({ repository: inventory.repository, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}` });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" }))
      .toHaveAttribute("data-empty-reason", "no-registrations"));
    expect(inventory.listDefinitions).not.toHaveBeenCalled();
    expect(inventory.listSubjects).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "false");
  });

  it("pins every subject page to the captured document release before the URL is pinned", async () => {
    const inventory = pagedInventory();
    renderCatalog({ repository: inventory.repository });
    expect(await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ })).toBeVisible();
    expect(inventory.listSubjects.mock.calls.slice(0, 3)).toEqual([
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100 }],
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, lifecycle: "retired" }],
      [{ catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, cursor: "subject-page-2" }]
    ]);
    expect(inventory.first.items).toHaveLength(100);
    expect(inventory.first).toMatchObject({ hasMore: true, nextCursor: "subject-page-2", totalCount: 101 });
  });

  it("keeps the previous complete snapshot read-only if a later subject page fails", async () => {
    const user = userEvent.setup();
    const inventory = pagedInventory();
    renderCatalog({ repository: inventory.repository, search: `?catalogReleaseId=${CATALOG_RELEASE_ID}` });
    expect(await screen.findByRole("button", { name: /^Inventory module 0\s*101$/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "展开 Inventory module 0" }));
    inventory.listSubjects.mockImplementation(async (query) => {
      if (query?.cursor) throw new Error("refresh second page failed");
      return inventory.first;
    });
    await user.click(screen.getByRole("button", { name: /^Inventory module 100\s*1$/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" }))
      .toHaveAttribute("data-catalog-state", "error"));
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "false");
    expect(screen.getByRole("button", { name: /^Inventory module 0\s*101$/ })).toBeVisible();
    expect(within(screen.getByRole("table", { name: "参数定义列表" })).getByText("gpio-int")).toBeVisible();
    expect(inventory.listDefinitions).toHaveBeenCalledTimes(1);
  });

  it("shows the unpublished empty state without requesting pinned collections", async () => {
    const repository = createMockParameterCatalogRepository({ scenario: "ready" });
    repository.getCatalog = async () => ({ item: null, publicationState: "unpublished" });
    const list = vi.spyOn(repository, "listSubjects");
    renderCatalog({ repository });
    expect(await screen.findByText("尚无首个 Catalog 发布。旧参数不会自动迁入；请先发布真实参数定义。"))
      .toBeVisible();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "目录列表" })).queryByRole("table")).not.toBeInTheDocument();
    expect(document.querySelector("[data-catalog-unpublished-workspace='true']")).toBeInTheDocument();
  });
  it("renders the three-view ready catalog without Effective or Governance peers", async () => {
    renderCatalog();

    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-layout", "desktop");
    expect(page).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    expect(within(page).getByRole("region", { name: "目录列表" })).toBeVisible();
    // The detail is disclosed in a dialog, never inline on the page.
    expect(within(page).queryByRole("region", { name: "定义详情" })).not.toBeInTheDocument();
    // The module navigator owns the side rail and the table keeps the rest.
    expect(within(page).getByRole("navigation", { name: "参数定义模块树" })).toBeVisible();
    expect(within(page).getByRole("status", { name: catalogResultCountLabel })).toHaveTextContent(/共 \d+ 项/);
    expect(within(page).getByRole("navigation", { name: "分页" })).toBeVisible();
    // History and pending work open on demand instead of owning the workspace.
    expect(screen.queryByRole("region", { name: "定义时间线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "待审核事项" })).not.toBeInTheDocument();
    expect(within(page).queryByLabelText("目录发布")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /生效|治理|Effective|Governance/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/生效目录|治理视图|catalogView/)).not.toBeInTheDocument();
  });

  it("pins the captured release and restores opaque selection through Back and Forward", async () => {
    const user = userEvent.setup();
    const hrefs: string[] = [];
    renderCatalog({
      onHref: (href) => hrefs.push(href)
    });

    await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(hrefs.some((href) => href.includes(`catalogReleaseId=${CATALOG_RELEASE_ID}`))).toBe(true));

    await user.click(await screen.findByRole("button", { name: "展开 Root" }));
    await user.click(screen.getByRole("button", { name: "选择主体 southchip,sc8562" }));
    const table = await screen.findByRole("table", { name: "参数定义列表" });
    await user.click(within(table).getByText("gpio-int"));

    const detail = await screen.findByRole("region", { name: "定义详情" });
    expect(await within(detail).findByText(/修订 #6/)).toBeInTheDocument();
    const selected =
      [...hrefs].reverse().find((href) => href.includes("subjectId=") && href.includes("definitionId=")) ??
      [...hrefs].reverse().find((href) => href.includes("definitionId=")) ??
      "";
    const parsed = parseCatalogUrlAnchor(selected.slice(selected.indexOf("?")));
    expect(parsed).toMatchObject({
      subjectId: CATALOG_SUBJECT_ID,
      definitionId: CATALOG_DEFINITION_ID,
      catalogReleaseId: CATALOG_RELEASE_ID,
      reviewItemId: null
    });
    expect(selected).not.toMatch(/catalogView|view=effective|view=governance|parameterSpecId/);

    await user.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => expect(screen.queryAllByText(/修订 #6/)).toHaveLength(0));
    await user.click(screen.getByRole("button", { name: "前进" }));
    expect(await within(screen.getByRole("region", { name: "定义详情" })).findByText(/修订 #6/)).toBeInTheDocument();
  });

  it("opens formal identity, revision, usage, registration, and placement from a deep link", async () => {
    const user = userEvent.setup();
    renderCatalog({
      search: buildCatalogHref({
        ...EMPTY_CATALOG_URL_ANCHOR,
        subjectId: CATALOG_SUBJECT_ID,
        definitionId: CATALOG_DEFINITION_ID,
        catalogReleaseId: CATALOG_RELEASE_ID,
        reviewItemId: null
      }).slice("/parameter-admin/specs".length)
    });

    const detail = await screen.findByRole("region", { name: "定义详情" });
    expect(within(detail).getByText("gpio-int")).toBeInTheDocument();
    expect(within(detail).getByText("southchip,sc8562")).toBeInTheDocument();
    expect(within(detail).getByText(CATALOG_SUBJECT_ID)).toBeInTheDocument();
    expect(within(detail).getByText(CATALOG_DEFINITION_ID)).toBeInTheDocument();
    expect(within(detail).getByText(/修订 #6/)).toBeInTheDocument();
    expect(within(detail).getByText("策略使用量暂不可用 · 项目 2 · 当前值 2")).toBeInTheDocument();
    expect(within(detail).getByText(/已登记/)).toBeInTheDocument();
    expect(within(detail).getByText("Root")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /查看历史/ }));
    const timeline = await screen.findByRole("region", { name: "定义时间线" });
    expect(within(timeline).getByText("目录发布")).toBeInTheDocument();
    expect(within(timeline).getByText("Published")).toBeInTheDocument();
  });

  it("exposes only role-authorized ready actions and keeps the release pinned", async () => {
    const { unmount } = renderCatalog({ actor: "user" });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(page).toHaveAttribute("data-writes-enabled", "true"));
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(page).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    unmount();

    const orgAdmin = renderCatalog({ actor: "org-admin" });
    const orgPage = await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(orgPage).toHaveAttribute("data-writes-enabled", "true"));
    // Definition proposals have no surface on this page, so the toolbar offers
    // no proposal action; the remaining write entry points stay reachable.
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤回修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "调整放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待审核事项" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增定义" })).not.toBeInTheDocument();
    orgAdmin.unmount();

    const platformAdmin = renderCatalog({ actor: "platform-admin" });
    const platformPage = await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(platformPage).toHaveAttribute("data-writes-enabled", "true"));
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "驳回修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    platformAdmin.unmount();

    renderCatalog({ actor: "agent" });
    const agentPage = await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增定义" })).not.toBeInTheDocument();
    expect(agentPage).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
  });

  it("hides the M1 publication entry without catalog:author and shows it from session permissions", async () => {
    const { unmount } = renderCatalog({ actor: "org-admin" });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "新增定义" })).not.toBeInTheDocument();
    unmount();

    const authorized = renderCatalog({
      actor: "user",
      sessionPermissions: ["catalog:author"]
    });
    await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(screen.getByRole("button", { name: "新增定义" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复核高风险发布" })).not.toBeInTheDocument();
    authorized.unmount();

    const publisher = renderCatalog({
      actor: "user",
      sessionPermissions: ["catalog:publish", "catalog:review-high-risk"]
    });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "新增定义" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复核高风险发布" })).not.toBeInTheDocument();
    publisher.unmount();

    renderCatalog({
      actor: "agent",
      sessionPermissions: ["catalog:author", "catalog:publish"]
    });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "新增定义" })).not.toBeInTheDocument();
  });

  it("lets Org Admin see register-subject on an unregistered Subject while other roles cannot", async () => {
    const unregisteredSearch = `?subjectId=${CATALOG_SUBJECT_ID}&catalogReleaseId=${CATALOG_RELEASE_ID}`;
    const { unmount } = renderCatalog({
      actor: "org-admin",
      scenario: "unregistered",
      search: unregisteredSearch
    });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-state", "unregistered");
    expect(screen.getByRole("button", { name: "登记主体" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "调整放置" })).not.toBeInTheDocument();
    unmount();

    renderCatalog({ actor: "user", scenario: "unregistered", search: unregisteredSearch });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/尚未登记/).length).toBeGreaterThan(0);
  });

  it("lets an administrator select the first published, unregistered subject from the list", async () => {
    renderCatalog({ actor: "org-admin", scenario: "unregistered" });
    await userEvent.click(await screen.findByRole("button", { name: "展开 未登记主体" }));
    const subjectLeaves = await screen.findAllByRole("button", { name: /^选择主体 / });
    await userEvent.click(subjectLeaves[0]!);
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", "unregistered"));
    expect(screen.getByRole("button", { name: "登记主体" })).toBeEnabled();
  });

  it("distinguishes loading, error, and the four empty reasons", async () => {
    const gate = deferred<void>();
    const { unmount } = renderCatalog({
      repository: wrapAfterGate(createMockParameterCatalogRepository({ scenario: "ready" }), gate.promise)
    });
    const loadingPage = await screen.findByRole("region", { name: "参数定义目录" });
    expect(loadingPage).toHaveAttribute("data-catalog-state", "loading");
    expect(screen.getByRole("status", { name: "正在加载目录" })).toBeInTheDocument();
    expect(loadingPage).toHaveAttribute("data-writes-enabled", "false");
    gate.resolve();
    await userEvent.click(await screen.findByRole("button", { name: "展开 Root" }));
    await screen.findByRole("button", { name: "选择主体 southchip,sc8562" });
    unmount();

    const { unmount: unmountError } = renderCatalog({ scenario: "error" });
    expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getAllByText("目录发布尚未就绪，请稍后重试。").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-writes-enabled", "false");
    unmountError();

    const { unmount: unmountNone } = renderCatalog({ scenario: "empty-no-registrations" });
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-empty-reason", "no-registrations")
    );
    expect(screen.getAllByText(catalogEmptyMessages["no-registrations"]).length).toBeGreaterThan(0);
    unmountNone();

    const { unmount: unmountDefs } = renderCatalog({ scenario: "empty-no-definitions" });
    expect((await screen.findAllByText(catalogEmptyMessages["no-definitions"])).length).toBeGreaterThan(0);
    unmountDefs();

    const { unmount: unmountFilter } = renderCatalog({ scenario: "empty-no-filter-match" });
    expect((await screen.findAllByText(catalogEmptyMessages["no-filter-match"])).length).toBeGreaterThan(0);
    unmountFilter();

    renderCatalog({ scenario: "empty-no-review-work", includeReview: true });
    // The review queue itself is disclosed by the host dialog; this page reports
    // the empty reason and offers the single count-bearing entry point.
    expect(await screen.findByRole("button", { name: /待审核事项/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-empty-reason", "no-review-work");
  });

  it("keeps retired history readable and disables prohibited new actions", async () => {
    const user = userEvent.setup();
    renderCatalog({
      scenario: "retired",
      search: buildCatalogHref({
        ...EMPTY_CATALOG_URL_ANCHOR,
        subjectId: CATALOG_SUBJECT_ID,
        definitionId: CATALOG_DEFINITION_ID,
        catalogReleaseId: CATALOG_RELEASE_ID,
        reviewItemId: null
      }).slice("/parameter-admin/specs".length)
    });

    const page = await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(page).toHaveAttribute("data-catalog-state", "retired"));
    expect(page).toHaveAttribute("data-writes-enabled", "false");
    expect(screen.getByText("定义已退役 · 只读")).toBeVisible();
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "调整放置" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "定义详情" })).getByText(/修订 #6/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看历史/ }));
    expect(within(await screen.findByRole("region", { name: "定义时间线" })).getByText("目录发布")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "调整放置" }));
    expect(screen.getByRole("button", { name: "调整放置" })).toHaveAttribute(
      "title",
      expect.stringMatching(/禁止新增操作|写入已暂停|已退役/)
    );
  });

  it("disables writes while a previous release remains visible during refresh", async () => {
    const gate = deferred<void>();
    const ready = createMockParameterCatalogRepository({ scenario: "ready" });
    let blocked = false;
    const repository: ParameterCatalogRepository = {
      ...ready,
      getCatalog: async () => {
        if (blocked) {
          await gate.promise;
        }
        return ready.getCatalog();
      }
    };
    const user = userEvent.setup();
    renderCatalog({ repository });
    await user.click(await screen.findByRole("button", { name: "展开 Root" }));
    await screen.findByRole("button", { name: "选择主体 southchip,sc8562" });
    blocked = true;
    // A scope change reloads the collection; there is no refresh button.
    await selectControlOption(screen.getByLabelText("每页条数"), "20");
    const page = screen.getByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(page).toHaveAttribute("data-catalog-state", "loading"));
    expect(page).toHaveAttribute("data-writes-enabled", "false");
    expect(page).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    expect(screen.getAllByText("正在刷新目录发布，写入已暂停").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "调整放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /southchip,sc8562/ })).toBeInTheDocument();
    gate.resolve();
    await waitFor(() => expect(page).toHaveAttribute("data-catalog-state", "ready"));
  });

  it("collapses detail and timeline into a sheet at tablet and mobile widths", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCatalog({ layoutMode: "tablet" });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-layout", "tablet");
    await user.click(await screen.findByRole("button", { name: "展开 Root" }));
    await user.click(screen.getByRole("button", { name: "选择主体 southchip,sc8562" }));
    const table = await screen.findByRole("table", { name: "参数定义列表" });
    await user.click(within(table).getByText("gpio-int"));
    const sheet = await screen.findByRole("dialog", { name: /gpio-int/ });
    // One editor dialog: the definition reads there and history is disclosed
    // from its own toggle rather than a second tab.
    expect(within(sheet).getByRole("region", { name: "定义详情" })).toBeVisible();
    await user.click(within(sheet).getByRole("button", { name: /查看历史/ }));
    expect(within(sheet).getByText("目录发布")).toBeVisible();
    unmount();

    renderCatalog({
      layoutMode: "mobile",
      search: buildCatalogHref({
        ...EMPTY_CATALOG_URL_ANCHOR,
        subjectId: CATALOG_SUBJECT_ID,
        definitionId: CATALOG_DEFINITION_ID,
        catalogReleaseId: CATALOG_RELEASE_ID,
        reviewItemId: null
      }).slice("/parameter-admin/specs".length)
    });
    const mobile = await screen.findByRole("region", { name: "参数定义目录" });
    expect(mobile).toHaveAttribute("data-catalog-layout", "mobile");
    expect(await screen.findByRole("dialog", { name: /gpio-int/ })).toBeVisible();
  });

  it("does not invent a fifth empty reason or leak mixed peer query keys", async () => {
    const hrefs: string[] = [];
    renderCatalog({
      search: "?catalogView=governance&view=effective&subjectId=&catalogReleaseId=",
      onHref: (href) => hrefs.push(href)
    });
    await screen.findByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(hrefs.length).toBeGreaterThan(0));
    expect(hrefs.at(-1)).toBe(`/parameter-admin/specs?catalogReleaseId=${CATALOG_RELEASE_ID}`);
    expect(Object.keys(catalogEmptyMessages)).toEqual([
      "no-registrations",
      "no-definitions",
      "no-review-work",
      "no-filter-match"
    ]);
    expect(readyCatalogDocument.item.catalogReleaseId).toBe(CATALOG_RELEASE_ID);
  });

  it("does not replace a historical catalogReleaseId after refresh", async () => {
    const historical = "crel_historical";
    const hrefs: string[] = [];
    const ready = createMockParameterCatalogRepository({ scenario: "ready" });
    const historicalDocument = {
      item: { ...readyCatalogDocument.item, catalogReleaseId: historical, releaseName: "2026.07.1" }
    };
    const unpin = <T extends { catalogReleaseId?: string }>(query?: T) => {
      if (!query) return query;
      const { catalogReleaseId: _ignored, ...rest } = query;
      return rest as T;
    };
    const repository: ParameterCatalogRepository = {
      ...ready,
      getCatalog: async (query) => {
        if (query?.catalogReleaseId === historical) {
          return historicalDocument;
        }
        return ready.getCatalog(unpin(query));
      },
      listSubjects: (query) => ready.listSubjects(unpin(query)),
      getSubject: (subjectId, query) => ready.getSubject(subjectId, unpin(query)),
      listSubjectDefinitions: (subjectId, query) => ready.listSubjectDefinitions(subjectId, unpin(query)),
      listDefinitions: (query) => ready.listDefinitions(unpin(query)),
      getDefinition: (definitionId, query) => ready.getDefinition(definitionId, unpin(query)),
      listDefinitionRevisions: (definitionId, query) =>
        ready.listDefinitionRevisions(definitionId, unpin(query)),
      listDefinitionTimeline: (definitionId, query) =>
        ready.listDefinitionTimeline(definitionId, unpin(query))
    };
    renderCatalog({
      repository,
      search: `?catalogReleaseId=${historical}`,
      onHref: (href) => hrefs.push(href)
    });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-release", historical);
    expect(hrefs.some((href) => href.includes(`catalogReleaseId=${CATALOG_RELEASE_ID}`))).toBe(false);
  });

  it("resolves a leftover spec bookmark through official legacy identifiers", async () => {
    const hrefs: string[] = [];
    const ready = createMockParameterCatalogRepository({ scenario: "ready" });
    const getLegacyIdentifier = vi.fn().mockImplementation(ready.getLegacyIdentifier);
    renderCatalog({
      repository: { ...ready, getLegacyIdentifier },
      search: "?spec=spec-sc8562-gpio-int",
      onHref: (href) => hrefs.push(href)
    });
    await waitFor(() =>
      expect(getLegacyIdentifier).toHaveBeenCalledWith("parameter-spec", "spec-sc8562-gpio-int")
    );
    await waitFor(() =>
      expect(hrefs.some((href) => href.includes(`definitionId=${CATALOG_DEFINITION_ID}`))).toBe(true)
    );
    expect(hrefs.at(-1)).not.toMatch(/(^|[?&])spec=/);
  });
});
