import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_DEFINITION_ID,
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_SUBJECT_ID,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import {
  createMockCatalogPorts,
  createMockParameterCatalogRepository,
  type CatalogMockScenario
} from "@/application/parameter-catalog/mockAdapter";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { buildCatalogHref, parseCatalogUrlAnchor } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { CatalogPage } from "./CatalogPage";
import type { CatalogLayoutMode } from "./catalogLayout";
import { catalogEmptyMessages } from "./copy";

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
    search?: string;
    layoutMode?: CatalogLayoutMode;
    includeReview?: boolean;
    repository?: ParameterCatalogRepository;
    onHref?: (href: string, mode: "push" | "replace") => void;
  } = {}
) {
  const ports = createMockCatalogPorts({ scenario: options.scenario ?? "ready" });
  const repository = options.repository ?? ports.catalog;
  const onHref = options.onHref ?? vi.fn();
  const view = render(
    <CatalogHarness
      repository={repository}
      actor={options.actor ?? "org-admin"}
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

describe("CatalogPage", () => {
  it("renders the three-view ready catalog without Effective or Governance peers", async () => {
    renderCatalog();

    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-layout", "desktop");
    expect(page).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    expect(within(page).getByRole("region", { name: "目录列表" })).toBeVisible();
    expect(within(page).getByRole("region", { name: "定义详情" })).toBeVisible();
    expect(within(page).getByRole("region", { name: "定义时间线" })).toBeVisible();
    expect(within(page).getByLabelText("目录发布")).toHaveTextContent("2026.08.3");
    expect(within(page).getByLabelText("目录发布")).toHaveTextContent(CATALOG_RELEASE_ID);
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

    await user.click(screen.getByRole("button", { name: /southchip,sc8562/ }));
    const table = await screen.findByRole("table", { name: "参数定义列表" });
    await user.click(within(table).getByText("gpio-int"));

    const detail = await screen.findByRole("region", { name: "定义详情" });
    expect(await within(detail).findByText(/修订 #6/)).toBeInTheDocument();
    const selected =
      [...hrefs].reverse().find((href) => href.includes("subjectId=") && href.includes("definitionId=")) ??
      [...hrefs].reverse().find((href) => href.includes("definitionId=")) ??
      "";
    const parsed = parseCatalogUrlAnchor(selected.slice(selected.indexOf("?")));
    expect(parsed).toEqual({
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
    renderCatalog({
      search: buildCatalogHref({
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
    expect(within(detail).getByText("策略 1 · 项目 2 · 当前值 2")).toBeInTheDocument();
    expect(within(detail).getByText(/已登记/)).toBeInTheDocument();
    expect(within(detail).getByText("Root")).toBeInTheDocument();

    const timeline = screen.getByRole("region", { name: "定义时间线" });
    expect(within(timeline).getByText("目录发布")).toBeInTheDocument();
    expect(within(timeline).getByText("Published")).toBeInTheDocument();
  });

  it("exposes only role-authorized ready actions and keeps the release visible", async () => {
    const { unmount } = renderCatalog({ actor: "user" });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-writes-enabled", "true");
    expect(screen.getByRole("button", { name: "提出定义修订" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("目录发布")).toHaveTextContent(CATALOG_RELEASE_ID);
    unmount();

    const orgAdmin = renderCatalog({ actor: "org-admin" });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.getByRole("button", { name: "提出定义修订" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "调整放置" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "处理审核" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "登记主体" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    orgAdmin.unmount();

    const platformAdmin = renderCatalog({ actor: "platform-admin" });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.getByRole("button", { name: "接受修订" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "驳回修订" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    platformAdmin.unmount();

    renderCatalog({ actor: "agent" });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("目录发布")).toHaveTextContent(CATALOG_RELEASE_ID);
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
    expect(screen.getByRole("button", { name: "调整放置" })).toBeDisabled();
    unmount();

    renderCatalog({ actor: "user", scenario: "unregistered", search: unregisteredSearch });
    await screen.findByRole("region", { name: "参数定义目录" });
    expect(screen.queryByRole("button", { name: "登记主体" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/尚未登记/).length).toBeGreaterThan(0);
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
    await screen.findByRole("button", { name: /southchip,sc8562/ });
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
    expect((await screen.findAllByText(catalogEmptyMessages["no-review-work"])).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-empty-reason", "no-review-work");
  });

  it("keeps retired history readable and disables prohibited new actions", async () => {
    const user = userEvent.setup();
    renderCatalog({
      scenario: "retired",
      search: buildCatalogHref({
        subjectId: CATALOG_SUBJECT_ID,
        definitionId: CATALOG_DEFINITION_ID,
        catalogReleaseId: CATALOG_RELEASE_ID,
        reviewItemId: null
      }).slice("/parameter-admin/specs".length)
    });

    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-state", "retired");
    expect(page).toHaveAttribute("data-writes-enabled", "false");
    expect(screen.getAllByText(/已退役或已弃用，历史记录仍可阅读/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "提出定义修订" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "调整放置" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "定义详情" })).getByText(/修订 #6/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "定义时间线" })).getByText("目录发布")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "提出定义修订" }));
    expect(screen.getByRole("button", { name: "提出定义修订" })).toHaveAttribute(
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
    await screen.findByRole("button", { name: /southchip,sc8562/ });
    blocked = true;
    await user.click(screen.getByRole("button", { name: "刷新" }));
    const page = screen.getByRole("region", { name: "参数定义目录" });
    await waitFor(() => expect(page).toHaveAttribute("data-catalog-state", "loading"));
    expect(page).toHaveAttribute("data-writes-enabled", "false");
    expect(page).toHaveAttribute("data-catalog-release", CATALOG_RELEASE_ID);
    expect(screen.getAllByText("正在刷新目录发布，写入已暂停").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "提出定义修订" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /southchip,sc8562/ })).toBeInTheDocument();
    gate.resolve();
    await waitFor(() => expect(page).toHaveAttribute("data-catalog-state", "ready"));
  });

  it("collapses detail and timeline into a sheet at tablet and mobile widths", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCatalog({ layoutMode: "tablet" });
    const page = await screen.findByRole("region", { name: "参数定义目录" });
    expect(page).toHaveAttribute("data-catalog-layout", "tablet");
    await user.click(screen.getByRole("button", { name: /southchip,sc8562/ }));
    const table = await screen.findByRole("table", { name: "参数定义列表" });
    await user.click(within(table).getByText("gpio-int"));
    const sheet = await screen.findByRole("dialog", { name: "gpio-int" });
    expect(within(sheet).getByRole("tab", { name: "详情" })).toBeVisible();
    expect(within(sheet).getByRole("tab", { name: "时间线" })).toBeVisible();
    await user.click(within(sheet).getByRole("tab", { name: "时间线" }));
    expect(within(sheet).getByText("目录发布")).toBeVisible();
    unmount();

    renderCatalog({
      layoutMode: "mobile",
      search: buildCatalogHref({
        subjectId: CATALOG_SUBJECT_ID,
        definitionId: CATALOG_DEFINITION_ID,
        catalogReleaseId: CATALOG_RELEASE_ID,
        reviewItemId: null
      }).slice("/parameter-admin/specs".length)
    });
    const mobile = await screen.findByRole("region", { name: "参数定义目录" });
    expect(mobile).toHaveAttribute("data-catalog-layout", "mobile");
    expect(await screen.findByRole("dialog", { name: "gpio-int" })).toBeVisible();
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
