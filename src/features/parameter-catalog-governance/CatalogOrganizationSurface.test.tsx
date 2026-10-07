import { useEffect, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { activeDefinition, readyCatalogDocument, registeredSubject } from "@/application/parameter-catalog/fixtures";
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
const firstPage: SubjectPage = { items: firstSubjects, hasMore: true, nextCursor: "page-2" };
const lastPage: SubjectPage = { items: [laterSubject], hasMore: false, nextCursor: null };

function deferredPage() {
  let resolve!: (page: SubjectPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<SubjectPage>((yes, no) => { resolve = yes; reject = no; });
  // The old one-page implementation never observes this controlled second page.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function surface(catalog: ParameterCatalogRepository) {
  return <CatalogOrganizationSurface
    catalog={catalog} governance={createMockCatalogPorts({ scenario: "ready" }).governance}
    actor="org-admin" sessionPermissions={["catalog:author", "catalog:publish"]}
    search="" onAnchorChange={vi.fn()} currentPersonId="person-admin"
  />;
}

describe("CatalogOrganizationSurface editor subject collection", () => {
  it("supplies all 101 subjects to the real editor selection boundary", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const second = deferredPage();
    const read = vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(second.promise);
    render(surface(ports.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await act(async () => second.resolve(lastPage));
    const select = screen.getByRole("combobox", { name: "主体" });
    expect(await within(select).findByRole("option", { name: laterSubject.canonicalName })).toHaveValue(laterSubject.id);
    expect(within(select).getAllByRole("option")).toHaveLength(101);
    await user.selectOptions(select, laterSubject.id);
    expect(select).toHaveValue(laterSubject.id);
    expect(read.mock.calls.map(([query]) => query)).toEqual([{ limit: 100 }, { limit: 100, cursor: "page-2" }]);
  });

  it("shows a second-page failure without partial subjects and retries without discarding the editor draft", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const second = deferredPage();
    const retrySecond = deferredPage();
    vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(second.promise).mockResolvedValueOnce(firstPage).mockReturnValueOnce(retrySecond.promise);
    const publicationRead = vi.spyOn(ports.catalog, "getPublicationSurface");
    render(surface(ports.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    const property = screen.getByRole("textbox", { name: "属性键" });
    await user.clear(property);
    await user.type(property, "preserved-draft");
    expect(screen.getByRole("status", { name: "正在读取主体列表" })).toBeVisible();
    expect(within(screen.getByRole("combobox", { name: "主体" })).queryAllByRole("option")).toHaveLength(0);
    await act(async () => second.reject(new Error("private transport diagnostic")));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("无法读取主体列表，请重试。");
    expect(error).not.toHaveTextContent("private transport diagnostic");
    expect(within(screen.getByRole("combobox", { name: "主体" })).queryAllByRole("option")).toHaveLength(0);
    await user.click(within(error).getByRole("button", { name: "重试" }));
    expect(screen.getByRole("status", { name: "正在读取主体列表" })).toBeVisible();
    await act(async () => retrySecond.resolve(lastPage));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(within(screen.getByRole("combobox", { name: "主体" })).getAllByRole("option")).toHaveLength(101);
    expect(screen.getByRole("textbox", { name: "属性键" })).toBe(property);
    expect(property).toHaveValue("preserved-draft");
    expect(publicationRead).toHaveBeenCalledTimes(1);
  });

  it("refreshes the complete subject collection when the catalog surface epoch changes", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const read = vi.spyOn(ports.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage).mockResolvedValueOnce({ ...lastPage, items: [firstSubjects[0]] });
    render(surface(ports.catalog));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await screen.findByRole("option", { name: laterSubject.canonicalName });
    await user.click(screen.getByRole("button", { name: "刷新目录" }));
    await user.click(screen.getByRole("button", { name: "打开定义编辑器" }));
    await waitFor(() => expect(within(screen.getByRole("combobox", { name: "主体" })).getAllByRole("option")).toHaveLength(1));
    expect(screen.queryByRole("option", { name: laterSubject.canonicalName })).not.toBeInTheDocument();
    expect(read).toHaveBeenLastCalledWith({ limit: 100 });
  });

  it.each(["success", "failure"] as const)("ignores stale %s after the catalog changes", async (outcome) => {
    const oldPorts = createMockCatalogPorts({ scenario: "ready" });
    const stale = deferredPage();
    const oldRead = vi.spyOn(oldPorts.catalog, "listSubjects").mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(stale.promise);
    const view = render(surface(oldPorts.catalog));
    await waitFor(() => expect(oldRead).toHaveBeenCalledTimes(2));
    const newPorts = createMockCatalogPorts({ scenario: "ready" });
    vi.spyOn(newPorts.catalog, "listSubjects").mockResolvedValue(lastPage);
    view.rerender(surface(newPorts.catalog));
    await userEvent.setup().click(screen.getByRole("button", { name: "打开定义编辑器" }));
    const select = screen.getByRole("combobox", { name: "主体" });
    await within(select).findByRole("option", { name: laterSubject.canonicalName });
    await act(async () => outcome === "success" ? stale.resolve({ ...lastPage, items: firstSubjects }) : stale.reject(new Error("stale")));
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    expect(within(select).getByRole("option", { name: laterSubject.canonicalName })).toHaveValue(laterSubject.id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
