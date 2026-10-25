import { selectControlOption } from "@/test/selectControlOption";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument,
  registeredSubject,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { CatalogListQuery } from "@/infrastructure/http/parameterCatalogDtos";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";

import { CanonicalSubjectPlacementPanel } from "./CanonicalSubjectPlacementPanel";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function subject(
  overrides: Partial<typeof unregisteredSubject> & { id: string; canonicalName: string }
) {
  return {
    ...unregisteredSubject,
    ...overrides,
    membership: { ...unregisteredSubject.membership, status: "active" as const, catalogReleaseId: CATALOG_RELEASE_ID },
    registration: { status: "unregistered" as const },
    definitionCounts: { active: 1, deprecated: 0, retired: 0 }
  };
}

function module(id: string, name: string, kind: ParameterModule["kind"]): ParameterModule {
  return {
    id,
    name,
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "organization",
    importance: "medium",
    kind,
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "medium",
    parameterCount: 0,
    definitionCount: 0
  };
}

function createPorts() {
  const driver = {
    ...registeredSubject,
    id: "subject-driver",
    canonicalName: "vendor,driver",
    registration: {
      ...registeredSubject.registration,
      id: "registration-driver",
      placement: {
        ...(registeredSubject.registration.status === "unregistered" ? undefined : registeredSubject.registration.placement),
        moduleId: "issue897-driver-a"
      }
    }
  };
  const node = subject({
    id: "subject-node",
    type: "node-type",
    canonicalName: "vendor,node"
  });
  const configuration = subject({
    id: "subject-config",
    type: "configuration-schema",
    canonicalName: "vendor,configuration"
  });
  const secondDefinition = {
    ...activeDefinition,
    id: "definition-extra-119",
    propertyKey: "extra_119",
    subject: {
      ...activeDefinition.subject,
      id: driver.id,
      canonicalName: driver.canonicalName
    }
  };
  const subjectQueries: CatalogListQuery[] = [];
  const definitionQueries: CatalogListQuery[] = [];
  const listSubjects = vi.fn(async (query?: CatalogListQuery) => {
    subjectQueries.push(query ?? {});
    if (query?.lifecycle === "retired") return { items: [], totalCount: 0, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID };
    if (query?.cursor === "subjects-2") {
      return {
        items: [configuration],
        totalCount: 3,
        hasMore: false,
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    return {
      items: [driver, node],
      totalCount: 3,
      hasMore: true,
      nextCursor: "subjects-2",
      catalogReleaseId: CATALOG_RELEASE_ID
    };
  });
  const listDefinitions = vi.fn(async (query?: CatalogListQuery) => {
    definitionQueries.push(query ?? {});
    if (query?.cursor === "definitions-2") {
      return {
        items: [secondDefinition],
        totalCount: 2,
        hasMore: false,
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    if (query?.subjectId === driver.id) {
      return {
        items: [
          {
            ...activeDefinition,
            subject: {
              ...activeDefinition.subject,
              id: driver.id,
              canonicalName: driver.canonicalName
            }
          }
        ],
        totalCount: 2,
        hasMore: true,
        nextCursor: "definitions-2",
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    return {
      items: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    };
  });
  const catalog = {
    getCatalog: vi.fn(async () => readyCatalogDocument),
    listSubjects,
    listDefinitions
  } as unknown as ParameterCatalogRepository;
  const listRegistrations = vi.fn<ParameterCatalogGovernanceRepository["listRegistrations"]>(async () => ({
    items: [
      {
        id: "registration-driver",
        organizationId: CATALOG_ORGANIZATION_ID,
        subjectId: driver.id,
        status: "active" as const,
        method: "explicit" as const,
        placement: {
          id: "placement-driver",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        },
        catalogReleaseId: CATALOG_RELEASE_ID
      }
    ],
    totalCount: 1,
    hasMore: false,
    nextCursor: null,
    catalogReleaseId: CATALOG_RELEASE_ID
  }));
  const createRegistration = vi.fn<ParameterCatalogGovernanceRepository["createRegistration"]>(async () => ({
    item: {
      id: "registration-node",
      organizationId: CATALOG_ORGANIZATION_ID,
      subjectId: node.id,
      status: "active" as const,
      method: "explicit" as const,
      placement: {
        id: "placement-node",
        displayName: "Node",
        parentPlacementId: null,
        moduleId: "issue897-node"
      },
      catalogReleaseId: CATALOG_RELEASE_ID
    }
  }));
  const getRegistration = vi.fn<ParameterCatalogGovernanceRepository["getRegistration"]>(async () => ({
    item: {
      id: "registration-driver",
      organizationId: CATALOG_ORGANIZATION_ID,
      subjectId: driver.id,
      status: "active" as const,
      method: "explicit" as const,
      placement: {
        id: "placement-driver",
        displayName: "Driver A",
        parentPlacementId: null,
        moduleId: "issue897-driver-a"
      },
      catalogReleaseId: CATALOG_RELEASE_ID,
      impact: { bindingCount: 1, projectCount: 1 }
    }
  }));
  const getPlacement = vi.fn<(...args: Parameters<ParameterCatalogGovernanceRepository["getPlacement"]>) => Promise<Awaited<ReturnType<ParameterCatalogGovernanceRepository["getPlacement"]>> & { etag: string }>>(async () => ({
    item: {
      id: "placement-driver",
      displayName: "Driver A",
      parentPlacementId: null,
      moduleId: "issue897-driver-a"
    },
    etag: "etag-driver"
  }));
  const updatePlacement = vi.fn<ParameterCatalogGovernanceRepository["updatePlacement"]>(async () => ({
    item: {
      id: "placement-driver",
      displayName: "Driver B",
      parentPlacementId: null,
      moduleId: "issue897-driver-b"
    },
    etag: "etag-driver-b"
  }));
  const governance = {
    listRegistrations,
    createRegistration,
    getRegistration,
    getPlacement,
    updatePlacement
  } as unknown as ParameterCatalogGovernanceRepository;

  return {
    catalog,
    governance,
    listSubjects,
    listRegistrations,
    createRegistration,
    getRegistration,
    getPlacement,
    updatePlacement,
    subjectQueries,
    definitionQueries,
    modules: [
      module("issue897-driver-a", "Driver A", "driver-group"),
      module("issue897-driver-b", "Driver B", "driver-group"),
      module("issue897-node", "Node", "node-type"),
      module("issue897-config", "Configuration", "business")
    ]
  };
}

describe("CanonicalSubjectPlacementPanel", () => {
  it.each(["active", "retired"] as const)("keeps %s occupants visible to replacement preview even when their subject is absent from the current list", async (status) => {
    const ports = createPorts();
    const registrations = await ports.listRegistrations(CATALOG_ORGANIZATION_ID);
    const source = await ports.getRegistration(CATALOG_ORGANIZATION_ID, "registration-driver");
    const sourcePlacement = await ports.getPlacement(CATALOG_ORGANIZATION_ID, "registration-driver");
    const placement = { id: "placement-retired-owner", moduleId: "issue897-driver-b", displayName: "Driver B", parentPlacementId: null };
    const occupant = { ...source.item, id: "registration-retired-owner", subjectId: "subject-outside-list",
      status, placement, impact: { bindingCount: 8, projectCount: 3 } };
    ports.listRegistrations.mockResolvedValue({ ...registrations, items: [...registrations.items, occupant], totalCount: 2 });
    ports.getRegistration.mockImplementation(async (_org, id) => id === occupant.id
      ? { item: occupant, etag: `"registration-retired-owner:${status}:200"` } : source);
    ports.getPlacement.mockImplementation(async (_org, id) => id === occupant.id
      ? { item: placement, etag: '"placement-retired-owner:300"' } : sourcePlacement);
    render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "调整归属：vendor,driver" }));
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-driver-b");
    const preview = await screen.findByRole("region", { name: "替换归属影响" });
    await waitFor(() => expect(preview).toHaveTextContent("8 个参数绑定、3 个项目"));
    expect(preview).toHaveTextContent("subject-outside-list");
    expect(preview).toHaveTextContent(`subject-outside-list（${status === "retired" ? "已停用" : "有效"}）`);
    expect(preview).toHaveTextContent("有效定义数量暂不可用");
    expect(ports.updatePlacement).not.toHaveBeenCalled();
  });

  it("hides retired registrations by default and exposes a labelled recovery in the retired filter", async () => {
    const ports = createPorts();
    const registrations = await ports.listRegistrations(CATALOG_ORGANIZATION_ID);
    ports.listRegistrations.mockResolvedValue({ ...registrations, items: registrations.items.map(item => ({ ...item, status: "retired" })) });
    render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin />);
    await screen.findByRole("list", { name: "规范主体列表" });
    expect(screen.queryByText("vendor,driver")).not.toBeInTheDocument();
    await selectControlOption(screen.getByRole("combobox", { name: "筛选登记状态" }), "retired");
    const row = await screen.findByRole("listitem", { name: "vendor,driver（驱动）" });
    expect(row).toHaveTextContent("已停用");
    expect(within(row).getByRole("button", { name: "恢复驱动：vendor,driver" })).toBeEnabled();
    expect(within(row).queryByRole("button", { name: /调整归属|移除驱动/ })).not.toBeInTheDocument();
  });

  it.each([true, false])("offers removal only to an administrator (canAdmin=%s)", async (canAdmin) => {
    const ports = createPorts();
    render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor={canAdmin ? "org-admin" : "user"} canAdmin={canAdmin} />);
    await screen.findByRole("list", { name: "规范主体列表" });
    expect(screen.queryByRole("button", { name: "移除驱动：vendor,driver" })).toBe(canAdmin ? screen.getByRole("button", { name: "移除驱动：vendor,driver" }) : null);
  });

  it.each([0, 2])("offers removal for an unregistered driver with %s definitions without requiring a destination module", async (count) => {
    const ports = createPorts();
    ports.listSubjects.mockResolvedValue({ items: [{ ...subject({ id: unregisteredSubject.id, canonicalName: "arm,gic-v3", type: "driver" }),
      definitionCounts: { active: count, deprecated: 0, retired: 0 } }],
    totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    ports.listRegistrations.mockResolvedValue({ items: [], totalCount: 0, hasMore: false, nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID });
    render(<CanonicalSubjectPlacementPanel {...ports} modules={[]} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin />);
    const remove = await screen.findByRole("button", { name: "移除驱动：arm,gic-v3" });
    await waitFor(() => expect(remove).toBeEnabled());
  });

  it("keeps a failed partial inventory readable and retries the complete inventory before enabling writes", async () => {
    const ports = createPorts();
    const original = ports.listSubjects.getMockImplementation()!;
    let fail = true;
    ports.listSubjects.mockImplementation(async (query) => {
      if (query?.cursor && fail) throw new Error("offline");
      return original(query);
    });
    render(<CanonicalSubjectPlacementPanel catalog={ports.catalog} governance={ports.governance}
      organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin modules={ports.modules} />);
    expect(await screen.findByRole("button", { name: "重新读取完整目录" })).toBeVisible();
    expect(screen.getByText("vendor,node")).toBeVisible();
    expect(screen.queryByRole("button", { name: "登记主体：vendor,node" })).not.toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "重新读取完整目录" }));
    expect(await screen.findByText("vendor,configuration")).toBeVisible();
    expect(screen.getByRole("button", { name: "登记主体：vendor,node" })).toBeEnabled();
  });

  it("keeps zero-definition subjects quiet while preserving a real empty response for nonzero counts", async () => {
    const ports = createPorts();
    const empty = { ...subject({ id: "empty", canonicalName: "empty-subject" }), definitionCounts: { active: 0, deprecated: 0, retired: 0 } };
    const counted = subject({ id: "counted", canonicalName: "counted-subject" });
    ports.listSubjects.mockResolvedValue({ items: [empty, counted], totalCount: 2, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    render(<CanonicalSubjectPlacementPanel catalog={ports.catalog} governance={ports.governance}
      organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin modules={ports.modules} />);
    const row = await screen.findByRole("listitem", { name: /empty-subject/ });
    expect(within(row).getByRole("button", { name: "暂无有效参数" })).toBeDisabled();
    expect(within(row).queryByText(/已废弃定义/)).not.toBeInTheDocument();
    await userEvent.setup().click(within(screen.getByRole("listitem", { name: /counted-subject/ })).getByRole("button", { name: "查看参数" }));
    expect(await screen.findByText("当前主体没有有效参数定义。")).toBeVisible();
  });

  it("shows the first batch while later pages load, blocks writes and stops cancelled pagination", async () => {
    const ports = createPorts();
    let resolveSecondPage!: (value: Awaited<ReturnType<typeof ports.listSubjects>>) => void;
    const secondPage = { promise: new Promise<Awaited<ReturnType<typeof ports.listSubjects>>>((resolve) => { resolveSecondPage = resolve; }) };
    const original = ports.listSubjects.getMockImplementation()!;
    ports.listSubjects.mockImplementation(async (query) => {
      if (query?.cursor === "subjects-2") return secondPage.promise;
      return original(query);
    });
    const view = render(<CanonicalSubjectPlacementPanel catalog={ports.catalog} governance={ports.governance}
      organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin
      modules={[module("issue897-node", "Node", "node-type"), module("issue897-driver-a", "Driver A", "driver-group")]} />);
    expect(await screen.findByText("vendor,node")).toBeVisible();
    expect(screen.getByText(/搜索与筛选仅覆盖已加载记录/)).toBeVisible();
    expect(screen.getByRole("button", { name: "登记主体：vendor,node" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "调整归属：vendor,driver" })).toBeDisabled();
    view.unmount();
    resolveSecondPage({ items: [], totalCount: 3, hasMore: true, nextCursor: "subjects-3", catalogReleaseId: CATALOG_RELEASE_ID });
    await secondPage.promise;
    await Promise.resolve();
    expect(ports.listSubjects).toHaveBeenCalledTimes(3);
  });
  it("restores a later subject page and treats an empty tree-filter scope as empty", async () => {
    const ports = createPorts();
    ports.listSubjects.mockResolvedValue({ items: Array.from({ length: 25 }, (_, index) => subject({ id: `subject-${index}`, canonicalName: `vendor,subject-${index}` })), totalCount: 25, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID } as never);
    const view = render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="user" search="?subjectPage=3&expandedSubject=subject-24" />);
    expect(await screen.findByRole("navigation", { name: "规范主体分页" })).toHaveTextContent("第 3 / 3 页");
    expect(await screen.findByRole("region", { name: "vendor,subject-24 的有效参数" })).toBeVisible();
    view.rerender(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="user" search="?subjectPage=3" visibleModuleIds={[]} />);
    expect(screen.queryByRole("listitem", { name: /vendor,subject-/ })).not.toBeInTheDocument();
    expect(screen.getByText("没有匹配的规范主体。")).toBeVisible();
  });
  it("ignores an earlier subject placement response after a later subject was selected", async () => {
    const ports = createPorts();
    const first = (await ports.catalog.listSubjects()).items[0];
    const second = { ...first, id: "subject-second", canonicalName: "vendor,second", registration: { ...first.registration, id: "registration-second" } };
    ports.listSubjects.mockResolvedValue({ items: [first, second], totalCount: 2, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID } as never);
    const registrations = await ports.governance.listRegistrations(CATALOG_ORGANIZATION_ID);
    ports.listRegistrations.mockResolvedValue({ ...registrations, items: [...registrations.items, { ...registrations.items[0], id: "registration-second", subjectId: second.id }], totalCount: 2 });
    const initialRegistration = await ports.governance.getRegistration(CATALOG_ORGANIZATION_ID, "registration-driver");
    const initialPlacement = await ports.governance.getPlacement(CATALOG_ORGANIZATION_ID, "registration-driver");
    let releaseFirst!: (value: typeof initialPlacement) => void;
    vi.spyOn(ports.governance, "getRegistration").mockImplementation(async (_org, id) => ({ item: { ...initialRegistration.item, id, subjectId: id === "registration-second" ? second.id : first.id } }));
    vi.spyOn(ports.governance, "getPlacement").mockImplementation((_org, id) => id === "registration-driver"
      ? new Promise((resolve) => { releaseFirst = resolve; }) : Promise.resolve({ ...initialPlacement, etag: "etag-second" }));
    render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "调整归属：vendor,driver" }));
    await user.click(screen.getByRole("button", { name: "调整归属：vendor,second" }));
    await screen.findByRole("dialog", { name: "调整放置" });
    releaseFirst(initialPlacement);
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-driver-b");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirm = screen.getByRole("dialog", { name: "确认调整放置" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认调整放置" }));
    await waitFor(() => expect(ports.updatePlacement).toHaveBeenCalled());
    expect(ports.updatePlacement.mock.calls[0]).toMatchObject([CATALOG_ORGANIZATION_ID, "registration-second", expect.anything(), expect.objectContaining({ ifMatch: "etag-second" })]);
  });

  it("refreshes current placement and impact together while keeping the draft target and requiring confirmation again", async () => {
    const ports = createPorts();
    ports.updatePlacement.mockRejectedValueOnce(catalogApiFailure("placement-conflict"));
    render(<CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" canAdmin />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "调整归属：vendor,driver" }));
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-driver-b");
    const confirm = async () => { await user.click(screen.getByRole("button", { name: "继续确认" })); const dialog = screen.getByRole("dialog", { name: "确认调整放置" }); await user.click(within(dialog).getByRole("checkbox")); await user.click(within(dialog).getByRole("button", { name: "确认调整放置" })); };
    await confirm();
    await screen.findByRole("alert");
    const registration = await ports.governance.getRegistration(CATALOG_ORGANIZATION_ID, "registration-driver");
    ports.getRegistration.mockResolvedValue({ item: { ...registration.item, impact: { bindingCount: 9, projectCount: 3 } } });
    const placement = await ports.governance.getPlacement(CATALOG_ORGANIZATION_ID, "registration-driver");
    ports.getPlacement.mockResolvedValue({ ...placement, etag: "etag-refreshed", item: { ...placement.item, moduleId: "issue897-driver-b", displayName: "Driver B" } });
    await user.click(screen.getByRole("button", { name: "刷新证据" }));
    expect(await screen.findByText(/证据已刷新/)).toBeVisible();
    expect(screen.getByText(/9 个参数绑定、3 个项目/)).toBeVisible();
    expect(screen.getByLabelText("目标模块")).toHaveAttribute("data-value", "issue897-driver-b");
    expect(ports.updatePlacement).toHaveBeenCalledTimes(1);
    await confirm();
    await waitFor(() => expect(ports.updatePlacement).toHaveBeenCalledTimes(2));
    expect(ports.updatePlacement.mock.calls[1][3]).toMatchObject({ ifMatch: "etag-refreshed" });
  });
  it("restores subject filters and expanded definitions from the URL and preserves module query keys", async () => {
    const ports = createPorts();
    const navigate = vi.fn();
    function Harness() {
      const [search, setSearch] = useState("?tab=tree&moduleId=scope&subjectQ=driver&subjectKind=driver&subjectRegistration=registered&expandedSubject=subject-driver");
      return <CanonicalSubjectPlacementPanel {...ports} organizationId={CATALOG_ORGANIZATION_ID} actor="org-admin" search={search}
        onNavigate={(path) => { navigate(path); setSearch(new URL(path, window.location.origin).search); }} />;
    }
    render(<Harness />);
    const row = await screen.findByRole("listitem", { name: /vendor,driver/ });
    expect(screen.getByRole("searchbox", { name: "筛选规范主体" })).toHaveValue("driver");
    expect(await within(row).findByText("extra_119")).toBeVisible();
    expect(screen.queryByRole("listitem", { name: /vendor,node/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "筛选规范主体" }));
    expect(new URL(navigate.mock.calls.at(-1)![0], window.location.origin).searchParams.get("moduleId")).toBe("scope");
    expect(screen.getByLabelText("筛选登记状态")).toHaveAttribute("data-value", "registered");
  });
  it("pages a large subject list and searches across every page", async () => {
    const ports = createPorts();
    ports.listSubjects.mockReset();
    ports.listSubjects.mockResolvedValue({
      items: Array.from({ length: 25 }, (_, index) => subject({
        id: `subject-${index}`,
        canonicalName: `vendor,subject-${index}`
      })),
      totalCount: 25,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    } as never);
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    expect(await screen.findByRole("navigation", { name: "规范主体分页" })).toHaveTextContent("第 1 / 3 页");
    expect(screen.getAllByRole("listitem", { name: /vendor,subject-/ })).toHaveLength(10);
    await userEvent.setup().click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByRole("navigation", { name: "规范主体分页" })).toHaveTextContent("第 2 / 3 页");
    expect(screen.getByRole("listitem", { name: /vendor,subject-10/ })).toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "筛选规范主体" }), "subject-24");
    expect(screen.getByRole("listitem", { name: /vendor,subject-24/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "规范主体分页" })).not.toBeInTheDocument();
  });

  it("loads all subject pages, keeps identity visible, and loads all active definitions", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    expect(await screen.findByText("vendor,configuration")).toBeInTheDocument();
    expect(screen.getAllByText("驱动").length).toBeGreaterThan(0);
    expect(screen.getAllByText("节点类型").length).toBeGreaterThan(0);
    expect(screen.getAllByText("配置规范").length).toBeGreaterThan(0);
    expect(ports.subjectQueries).toEqual([
      { catalogReleaseId: CATALOG_RELEASE_ID, limit: 100 },
      { catalogReleaseId: CATALOG_RELEASE_ID, lifecycle: "retired", limit: 100 },
      { catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, cursor: "subjects-2" }
    ]);

    const driverRow = screen.getByRole("listitem", { name: /vendor,driver/ });
    await userEvent.setup().click(within(driverRow).getByRole("button", { name: "查看参数" }));
    expect(await within(driverRow).findByText("extra_119")).toBeInTheDocument();
    expect(within(driverRow).getAllByRole("link")[0]).toHaveAttribute("href",
      expect.stringContaining(`subjectId=subject-driver&definitionId=${activeDefinition.id}&catalogReleaseId=${CATALOG_RELEASE_ID}`));
    expect(ports.definitionQueries).toEqual([
      {
        subjectId: "subject-driver",
        lifecycle: "active",
        catalogReleaseId: CATALOG_RELEASE_ID,
        limit: 100
      },
      {
        subjectId: "subject-driver",
        lifecycle: "active",
        catalogReleaseId: CATALOG_RELEASE_ID,
        limit: 100,
        cursor: "definitions-2"
      }
    ]);
  });

  it("filters placements by selected module and descendants while preserving search", async () => {
    const ports = createPorts();
    const modules = [...ports.modules, module("category-root", "业务分类", "business")]
      .map((item) => item.id === "issue897-driver-a" ? { ...item, parentId: "category-root" } : item);
    const view = (selectedModuleId: string | null) => <CanonicalSubjectPlacementPanel catalog={ports.catalog}
      governance={ports.governance} organizationId={CATALOG_ORGANIZATION_ID} actor="user" modules={modules}
      selectedModuleId={selectedModuleId} />;
    const rendered = render(view("category-root"));
    expect(await screen.findByRole("listitem", { name: /vendor,driver/ })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /vendor,node/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "筛选规范主体" }), "driver");
    rendered.rerender(view("issue897-driver-b"));
    expect(screen.queryByRole("listitem", { name: /vendor,driver/ })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "筛选规范主体" })).toHaveValue("driver");
    rendered.rerender(view(null));
    expect(screen.getByRole("listitem", { name: /vendor,driver/ })).toBeInTheDocument();
  });

  it("registers an unregistered subject with the selected real module ID", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const nodeRow = await screen.findByRole("listitem", { name: /vendor,node/ });
    const user = userEvent.setup();
    await user.click(within(nodeRow).getByRole("button", { name: "登记主体：vendor,node" }));
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-node");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = await screen.findByRole("dialog", { name: "确认登记主体" });
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "确认登记" }));

    await waitFor(() => expect(ports.createRegistration).toHaveBeenCalledTimes(1));
    expect(ports.createRegistration.mock.calls[0]?.[1]).toMatchObject({
      subjectId: "subject-node",
      placement: { mode: "use-default" },
      destinationModuleId: "issue897-node"
    });
    expect(ports.createRegistration.mock.calls[0]?.[2]).toMatchObject({
      catalogReleaseId: CATALOG_RELEASE_ID,
      idempotencyKey: expect.any(String)
    });
  });

  it("reads an ETag before changing a registered subject's module", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const driverRow = await screen.findByRole("listitem", { name: /vendor,driver/ });
    const user = userEvent.setup();
    await user.click(
      within(driverRow).getByRole("button", { name: "调整归属：vendor,driver" })
    );
    await waitFor(() => expect(ports.getPlacement).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      "registration-driver"
    ));
    expect(ports.getRegistration).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      "registration-driver"
    );
    expect(screen.getByText(/14 个有效定义、1 个参数绑定、1 个项目/)).toBeInTheDocument();
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-driver-b");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = await screen.findByRole("dialog", { name: "确认调整放置" });
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "确认调整放置" }));

    await waitFor(() => expect(ports.updatePlacement).toHaveBeenCalledTimes(1));
    expect(ports.updatePlacement.mock.calls[0]).toEqual([
      CATALOG_ORGANIZATION_ID,
      "registration-driver",
      {
        placement: { mode: "use-default" },
        destinationModuleId: "issue897-driver-b"
      },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: expect.any(String),
        ifMatch: "etag-driver"
      }
    ]);
  });

  it("blocks placement changes when a registered subject has no canonical impact", async () => {
    const ports = createPorts();
    ports.getRegistration.mockResolvedValueOnce({
      item: {
        id: "registration-driver",
        organizationId: CATALOG_ORGANIZATION_ID,
        subjectId: "subject-driver",
        status: "active",
        method: "explicit",
        placement: {
          id: "placement-driver",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        },
        catalogReleaseId: CATALOG_RELEASE_ID
      }
    } as never);
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const driverRow = await screen.findByRole("listitem", { name: /vendor,driver/ });
    await userEvent.setup().click(
      within(driverRow).getByRole("button", { name: "调整归属：vendor,driver" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("当前主体缺少影响数据");
    expect(screen.getByRole("listitem", { name: /vendor,node/ })).toBeVisible();
    expect(screen.getByRole("listitem", { name: /vendor,driver/ })).toBeVisible();
    expect(screen.queryByLabelText("目标模块")).not.toBeInTheDocument();
    expect(ports.updatePlacement).not.toHaveBeenCalled();
  });

  it("keeps retired subjects visible but read-only", async () => {
    const ports = createPorts();
    const retiredSubject = {
      ...subject({ id: "subject-retired", canonicalName: "vendor,retired" }),
      membership: { status: "retired" as const, catalogReleaseId: CATALOG_RELEASE_ID },
      registration: {
        status: "retired" as const,
        id: "registration-retired",
        method: "explicit" as const,
        placement: {
          id: "placement-retired",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        }
      }
    };
    ports.listSubjects.mockReset();
    ports.listSubjects.mockImplementation(async (query) => ({
      items: query?.lifecycle === "retired" ? [retiredSubject] : [],
      totalCount: query?.lifecycle === "retired" ? 1 : 0,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    }) as never);
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    await selectControlOption(await screen.findByRole("combobox", { name: "筛选登记状态" }), "retired");
    const row = await screen.findByRole("listitem", { name: /vendor,retired/ });
    expect(within(row).queryByRole("button", { name: "登记主体：vendor,retired" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "调整归属：vendor,retired" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "恢复驱动：vendor,retired" })).toBeDisabled();
  });

  it("does not show a zero active count while canonical loading fails", async () => {
    const ports = createPorts();
    vi.spyOn(ports.catalog, "getCatalog").mockRejectedValueOnce(new Error("catalog unavailable"));
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("查看参数定义，或维护主体的模块归属。")).toBeInTheDocument();
    expect(screen.queryByText(/个有效主体/)).not.toBeInTheDocument();
  });

  it("keeps an active subject read-only when its organization registration is retired", async () => {
    const ports = createPorts();
    ports.listRegistrations.mockResolvedValue({
      items: [
        {
          id: "registration-driver",
          organizationId: CATALOG_ORGANIZATION_ID,
          subjectId: "subject-driver",
          status: "retired" as const,
          method: "explicit" as const,
          placement: {
            id: "placement-driver",
            displayName: "Driver A",
            parentPlacementId: null,
            moduleId: "issue897-driver-a"
          },
          catalogReleaseId: CATALOG_RELEASE_ID
        }
      ],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    });
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    await selectControlOption(await screen.findByRole("combobox", { name: "筛选登记状态" }), "retired");
    const row = await screen.findByRole("listitem", { name: /vendor,driver/ });
    expect(within(row).queryByRole("button", { name: "调整归属：vendor,driver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "规范模块统计" })).not.toBeInTheDocument();
  });
});
