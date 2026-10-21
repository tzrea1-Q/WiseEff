import { useEffect, useState } from "react";
import { selectControlOption } from "@/test/selectControlOption";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { activeDefinition, catalogPublicationJob, CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID, readyCatalogDocument, registeredSubject } from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogPageProps } from "@/features/parameter-catalog/CatalogPage";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";

// Isolate the heavy catalog page, but keep the real editor and its subject select.
// These are component/port-double tests, not public API or browser evidence.
vi.mock("@/features/parameter-catalog", () => ({
  CatalogPage: function EditorHost(props: CatalogPageProps) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
      props.onDomainStateChange?.(deriveCatalogDomainState({ document: readyCatalogDocument }));
    }, [props.onDomainStateChange]);
    return <>
      <button onClick={() => setOpen(true)}>打开定义编辑器</button>
      <button onClick={props.onEditorClosed}>刷新目录</button>
      {open && props.renderDefinitionEditor?.(activeDefinition, {
        domainState: deriveCatalogDomainState({ document: readyCatalogDocument }),
        timeline: null, revisions: [], onRequestHistory: vi.fn(), onClose: vi.fn()
      })}
    </>;
  }
}));
vi.mock("../parameter-catalog/CatalogPage", () => ({ CatalogHistoryBody: () => null }));

type SubjectPage = Awaited<ReturnType<ParameterCatalogRepository["listSubjects"]>>;
const firstSubjects = Array.from({ length: 100 }, (_, index) => ({
  ...registeredSubject,
  id: index === 0 ? registeredSubject.id : `subject-${index + 1}`,
  canonicalName: `主体 ${index + 1}`
}));
const laterSubject = { ...registeredSubject, id: "subject-101", canonicalName: "最后一页主体" };
const firstPage: SubjectPage = { items: firstSubjects, hasMore: true, nextCursor: "page-2", totalCount: 101, catalogReleaseId: CATALOG_RELEASE_ID };
const lastPage: SubjectPage = { items: [laterSubject], hasMore: false, nextCursor: null, totalCount: 101, catalogReleaseId: CATALOG_RELEASE_ID };

function deferredPage() {
  let resolve!: (page: SubjectPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SubjectPage>((yes, no) => { resolve = yes; reject = no; });
  // The old one-page implementation never observes this controlled second page.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function surface(catalog: ParameterCatalogRepository, onAnchorChange = vi.fn()) {
  return <CatalogOrganizationSurface
    catalog={catalog} governance={createMockCatalogPorts({ scenario: "ready" }).governance}
    actor="org-admin" sessionPermissions={["catalog:author", "catalog:publish"]}
    search="" onAnchorChange={onAnchorChange} currentPersonId="person-admin"
  />;
}

async function readSubjectOptions() {
  await userEvent.click(screen.getByRole("combobox", { name: "主体" }));
  const options = within(await screen.findByRole("listbox")).queryAllByRole("option");
  await userEvent.keyboard("{Escape}");
  return options;
}

describe("CatalogOrganizationSurface editor subject collection", () => {
  it("advances the reload anchor after a content publication activates while keeping its result visible", async () => {
    const user = userEvent.setup();
    const { catalog } = createMockCatalogPorts({ scenario: "ready", publicationOutcome: "queued" });
    const latest = "crel_content_revision_applied";
    const current = vi.spyOn(catalog, "getCatalog").mockResolvedValue({
      ...readyCatalogDocument, item: { ...readyCatalogDocument.item!, catalogReleaseId: latest }
    });
    vi.spyOn(catalog, "getPublication").mockResolvedValue({ item: {
      ...catalogPublicationJob, status: "active", effective: true, isCurrent: true, currentness: "active"
    } });
    const navigate = vi.fn();
    render(surface(catalog, navigate));
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await user.type(screen.getByLabelText("显示名"), "更新");
    await user.type(screen.getByLabelText("修改原因"), "发布内容修订");
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    expect(await screen.findByRole("region", { name: "内容修订结果" })).toHaveTextContent("发布已入队");
    expect(current).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringContaining(`catalogReleaseId=${latest}`), "replace"), { timeout: 4000 });
    expect(screen.getByRole("region", { name: "内容修订结果" })).toHaveTextContent("目录发布已生效");
  });

  it("ignores an automatic evidence check that finishes after the organization changes", async () => {
    const oldPorts = createMockCatalogPorts({ scenario: "ready" });
    let finishOldRead!: (value: Awaited<ReturnType<ParameterCatalogRepository["getCatalog"]>>) => void;
    const oldRead = vi.spyOn(oldPorts.catalog, "getCatalog").mockImplementation(() =>
      new Promise((resolve) => { finishOldRead = resolve; }));
    const props = { actor: "org-admin" as const, sessionPermissions: ["catalog:author", "catalog:publish"],
      search: "?review=open", onAnchorChange: vi.fn(), currentPersonId: "person-admin" };
    const view = render(<CatalogOrganizationSurface {...props} organizationId={CATALOG_ORGANIZATION_ID}
      catalog={oldPorts.catalog} governance={oldPorts.governance} />);
    await userEvent.click(await screen.findByRole("button", { name: "处理审核" }));
    await waitFor(() => expect(oldRead).toHaveBeenCalledTimes(1));
    const newPorts = createMockCatalogPorts({ scenario: "ready" });
    vi.spyOn(newPorts.catalog, "listSubjects").mockResolvedValue({ ...lastPage, items: [registeredSubject, laterSubject] });
    view.rerender(<CatalogOrganizationSurface {...props} organizationId="new-org"
      catalog={newPorts.catalog} governance={newPorts.governance} />);
    await userEvent.click(await screen.findByRole("button", { name: "关闭" }));
    await userEvent.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在读取主体列表" })).not.toBeInTheDocument());
    expect((await readSubjectOptions()).find((option) => option.textContent === laterSubject.canonicalName)).toBeDefined();
    await act(async () => { finishOldRead(readyCatalogDocument); });
    const options = await readSubjectOptions();
    expect(options).toHaveLength(2);
    expect(options.find((option) => option.textContent === laterSubject.canonicalName)).toHaveAttribute("data-value", laterSubject.id);
  });

  it("supplies all 101 subjects to the real editor selection boundary", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const second = deferredPage();
    const read = vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(second.promise);
    render(surface(ports.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    expect(screen.getByRole("status", { name: "正在读取主体列表" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "属性键" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "定义详情" })).toHaveTextContent(activeDefinition.subject.canonicalName);
    await act(async () => second.resolve(lastPage));
    const select = screen.getByRole("combobox", { name: "主体" });
    const options = await readSubjectOptions();
    expect(options.find((option) => option.textContent === laterSubject.canonicalName)).toHaveAttribute("data-value", laterSubject.id);
    expect(options).toHaveLength(101);
    await selectControlOption(select, laterSubject.id);
    expect(select).toHaveAttribute("data-value", laterSubject.id);
    expect(read.mock.calls.map(([query]) => query)).toEqual([{ limit: 100 }, { limit: 100, cursor: "page-2" }]);
  });

  it("keeps an edited draft through a read-only reload, second-page failure and retry", async () => {
    const initialPorts = createMockCatalogPorts({ scenario: "ready" });
    vi.spyOn(initialPorts.catalog, "listSubjects").mockResolvedValueOnce(firstPage).mockResolvedValueOnce(lastPage);
    const view = render(surface(initialPorts.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    const property = await screen.findByRole("textbox", { name: "属性键" });
    await user.clear(property);
    await user.type(property, "preserved-draft");

    const ports = createMockCatalogPorts({ scenario: "ready" });
    const second = deferredPage();
    const retrySecond = deferredPage();
    const read = vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(second.promise).mockResolvedValueOnce(firstPage).mockReturnValueOnce(retrySecond.promise);
    const publicationRead = vi.spyOn(ports.catalog, "getPublicationSurface");
    // Replacing the port reloads its collection without remounting the editor.
    view.rerender(surface(ports.catalog));
    expect(screen.getByRole("status", { name: "正在读取主体列表" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "属性键" })).not.toBeInTheDocument();
    await act(async () => second.reject(new Error("private transport diagnostic")));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("无法读取主体列表，请重试。");
    expect(error).not.toHaveTextContent("private transport diagnostic");
    expect(screen.queryByRole("combobox", { name: "主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "属性键" })).not.toBeInTheDocument();
    await user.click(within(error).getByRole("button", { name: "重试" }));
    expect(screen.getByRole("status", { name: "正在读取主体列表" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "属性键" })).not.toBeInTheDocument();
    await act(async () => retrySecond.resolve(lastPage));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await readSubjectOptions()).toHaveLength(101);
    expect(screen.getByRole("textbox", { name: "属性键" })).toHaveValue("preserved-draft");
    expect(read.mock.calls.map(([query]) => query)).toEqual([
      { limit: 100 }, { limit: 100, cursor: "page-2" },
      { limit: 100 }, { limit: 100, cursor: "page-2" }
    ]);
    expect(publicationRead).toHaveBeenCalledTimes(1);
  });

  it("refreshes the complete subject collection when the catalog surface epoch changes", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const read = vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage).mockResolvedValueOnce({ ...lastPage, items: [firstSubjects[0]] });
    render(surface(ports.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在读取主体列表" })).not.toBeInTheDocument());
    expect(await readSubjectOptions()).toHaveLength(101);
    await user.clear(screen.getByRole("textbox", { name: "显示名" }));
    await user.type(screen.getByRole("textbox", { name: "显示名" }), "刷新时保留浏览上下文");
    await user.click(screen.getByRole("button", { name: "刷新目录" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在读取主体列表" })).not.toBeInTheDocument());
    const options = await readSubjectOptions();
    expect(options).toHaveLength(1);
    expect(options.some((option) => option.textContent === laterSubject.canonicalName)).toBe(false);
    expect(read).toHaveBeenLastCalledWith({ limit: 100 });
    expect(screen.getByRole("textbox", { name: "显示名" })).toHaveValue("刷新时保留浏览上下文");
  });

  it.each(["success", "failure"] as const)("ignores stale %s after the catalog changes", async (outcome) => {
    const oldPorts = createMockCatalogPorts({ scenario: "ready" });
    const stale = deferredPage();
    const oldRead = vi.spyOn(oldPorts.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(stale.promise);
    const view = render(surface(oldPorts.catalog));
    await waitFor(() => expect(oldRead).toHaveBeenCalledTimes(2));
    const newPorts = createMockCatalogPorts({ scenario: "ready" });
    vi.spyOn(newPorts.catalog, "listSubjects").mockResolvedValue({ ...lastPage, items: [registeredSubject, laterSubject] });
    view.rerender(surface(newPorts.catalog));
    await userEvent.setup().click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在读取主体列表" })).not.toBeInTheDocument());
    expect((await readSubjectOptions()).find((option) => option.textContent === laterSubject.canonicalName)).toHaveAttribute("data-value", laterSubject.id);
    await act(async () => outcome === "success" ? stale.resolve({ ...lastPage, items: firstSubjects }) : stale.reject(new Error("stale")));
    const options = await readSubjectOptions();
    expect(options).toHaveLength(2);
    expect(options.find((option) => option.textContent === laterSubject.canonicalName)).toHaveAttribute("data-value", laterSubject.id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
