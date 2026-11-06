import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { selectControlOption } from "@/test/selectControlOption";
import { createMockParameterCatalogRepository } from "@/application/parameter-catalog/mockAdapter";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { ProjectComparison, comparisonLines } from "./ProjectComparison";

type Instance = NonNullable<CatalogProjectConfigurationsResponse["baseline"]>;
const instance = (id: string, projectId: string, rawValue = `<${id}>`): Instance => ({ kind: "instance", bindingId: id, projectId, projectName: projectId,
  configSetId: id, configSetName: `配置 ${id}`, sourceOccurrenceId: id, sourceFormat: "dts", fileId: id, fileVersionId: id, fileName: `${id}.dts`, sourceLocator: {}, sourceLocation: "/node · limit",
  currentValueId: id, definitionRevisionId: "revision", definitionRevisionNumber: "1", effectiveRevisionId: "revision", unit: null, definitionLifecycle: "active",
  valueState: "present", valueKind: "number", valuePreview: "truncated preview", valuePreviewTruncated: true, rawValue });
const response = (items: Instance[]): CatalogProjectConfigurationsResponse => ({ items, summary: { configuredProjectCount: new Set(items.map(item => item.projectId)).size, configuredInstanceCount: items.length },
  totalCount: items.length, readAt: "2026-11-06T00:00:00.000Z", nextCursor: null, continuedProjectId: null, selected: null });
function repositoryWith(items: Instance[]) {
  return { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn(async (_id: string, query?: { cursor?: string; baselineBindingId?: string; targetBindingId?: string; valueState?: "present"; excludeProjectId?: string; limit?: number }): Promise<CatalogProjectConfigurationsResponse> => ({
    ...response(items), baseline: items.find(item => item.bindingId === query?.baselineBindingId) ?? null,
    target: items.find(item => item.bindingId === query?.targetBindingId) ?? null
  })) };
}
function Harness({ repository, onChange = vi.fn() }: { repository: ReturnType<typeof repositoryWith>; onChange?: (selection: { baseline: string | null; target: string | null }, mode?: "push" | "replace") => void }) {
  const [selection, setSelection] = useState<{ baseline: string | null; target: string | null }>({ baseline: null, target: null });
  return <ProjectComparison repository={repository} definitionId="definition" baselineId={selection.baseline} targetId={selection.target}
    onChange={(next, mode) => { onChange(next, mode); setSelection(next); }} />;
}

it("aligns insertions and removals without shifting unchanged lines and preserves newlines", () => {
  const { rows } = comparisonLines("a\nb\nc\n", "a\ninserted\nb\nc\n");
  expect(rows.map(row => [row.left?.text, row.right?.text])).toEqual([["a\n", "a\n"], [undefined, "inserted\n"], ["b\n", "b\n"], ["c\n", "c\n"]]);
  expect(rows[2]).toMatchObject({ left: { number: 2, changed: false }, right: { number: 3, changed: false } });
  expect(comparisonLines("a\nb", "a\nc").rows[1]).toMatchObject({ left: { text: "b", changed: true }, right: { text: "c", changed: true } });
  expect(comparisonLines("a\n", "a").rows[0].left?.changed).toBe(true);
});

it("defaults to two distinct configured projects across pages and changes each exact instance independently", async () => {
  const items = [instance("a1", "A"), instance("a2", "A"), instance("b1", "B")];
  const repository = repositoryWith(items);
  const read = repository.getProjectConfigurations.getMockImplementation()!;
  repository.getProjectConfigurations.mockImplementation(async (id, query) => query?.baselineBindingId ? read(id, query)
    : { ...response(items), items: query?.excludeProjectId ? [items[2]] : items.slice(0, 2), nextCursor: query?.excludeProjectId ? null : "page2" });
  const onChange = vi.fn();
  render(<Harness repository={repository} onChange={onChange} />);
  expect(await screen.findByText("<b1>")).toBeVisible();
  expect(repository.getProjectConfigurations).toHaveBeenCalledWith("definition", { valueState: "present", excludeProjectId: "A", limit: 1 });
  expect(onChange).toHaveBeenCalledWith({ baseline: "a1", target: "b1" }, "replace");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await selectControlOption(screen.getByRole("combobox", { name: "左侧配置实例" }), "a2");
  await waitFor(() => expect(repository.getProjectConfigurations).toHaveBeenLastCalledWith("definition", { baselineBindingId: "a2", targetBindingId: "b1" }));
  await selectControlOption(screen.getByRole("combobox", { name: "右侧项目" }), "A");
  await waitFor(() => expect(repository.getProjectConfigurations).toHaveBeenLastCalledWith("definition", { baselineBindingId: "a2", targetBindingId: "a1" }));
  expect(screen.getByRole("combobox", { name: "右侧项目" })).toHaveFocus();
});

it("shows the first value while looking up another project and preserves the first page cursor", async () => {
  const items = [instance("a", "A"), instance("b", "B"), instance("c", "C")];
  const repository = repositoryWith(items);
  const read = repository.getProjectConfigurations.getMockImplementation()!;
  let resolvePage!: (page: CatalogProjectConfigurationsResponse) => void;
  repository.getProjectConfigurations.mockImplementation(async (id, query) => query?.baselineBindingId ? read(id, query)
    : query?.excludeProjectId ? new Promise(resolve => { resolvePage = resolve; })
      : { ...response(items), items: [items[0]], nextCursor: "page2" });
  render(<Harness repository={repository} />);
  expect(await screen.findByText("<a>")).toBeVisible();
  expect(screen.getByText("正在查找其他已配置项目…")).toBeVisible();
  expect(screen.getByText("可继续加载更多项目，或选择当前项目中的其他实例。")).toBeVisible();
  await act(async () => resolvePage({ ...response(items), items: [items[1]], nextCursor: null }));
  expect(await screen.findByText("<b>")).toBeVisible();
  expect(screen.getByRole("button", { name: "加载更多项目或实例" })).toBeEnabled();
  expect(repository.getProjectConfigurations).not.toHaveBeenCalledWith("definition", { valueState: "present", cursor: "page2" });
});

it("finds a second project without scanning later pages and keeps them available manually", async () => {
  const items = [instance("a1", "A"), instance("a2", "A"), instance("b", "B")];
  const repository = repositoryWith(items);
  const read = repository.getProjectConfigurations.getMockImplementation()!;
  repository.getProjectConfigurations.mockImplementation(async (id, query) => {
    if (query?.baselineBindingId) return read(id, query);
    if (query?.excludeProjectId) return { ...response(items), items: [items[2]] };
    if (query?.cursor === "page3") return { ...response(items), items: [items[2]] };
    if (query?.cursor === "page2") return { ...response(items), items: [items[1]], nextCursor: "page3" };
    return { ...response(items), items: [items[0]], nextCursor: "page2" };
  });
  render(<Harness repository={repository} />);
  expect(await screen.findByText("<b>")).toBeVisible();
  expect(repository.getProjectConfigurations).toHaveBeenCalledWith("definition", { valueState: "present", excludeProjectId: "A", limit: 1 });
  expect(repository.getProjectConfigurations).not.toHaveBeenCalledWith("definition", { valueState: "present", cursor: "page2" });
  fireEvent.click(screen.getByRole("button", { name: "加载更多项目或实例" }));
  await waitFor(() => expect(repository.getProjectConfigurations).toHaveBeenCalledWith("definition", { valueState: "present", cursor: "page2" }));
  expect(repository.getProjectConfigurations).not.toHaveBeenCalledWith("definition", { valueState: "present", cursor: "page3" });
  expect(repository.getProjectConfigurations).toHaveBeenCalledWith("definition", { baselineBindingId: "a1", targetBindingId: "b" });
});

it("keeps the first value and manual paging available if the other-project lookup fails", async () => {
  const items = [instance("a", "A"), instance("b", "B")];
  const repository = repositoryWith(items);
  const read = repository.getProjectConfigurations.getMockImplementation()!;
  repository.getProjectConfigurations.mockImplementation(async (id, query) => {
    if (query?.baselineBindingId) return read(id, query);
    if (query?.excludeProjectId) throw new Error("lookup failed");
    return { ...response(items), items: query?.cursor ? [items[1]] : [items[0]], nextCursor: query?.cursor ? null : "page2" };
  });
  render(<Harness repository={repository} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("自动查找项目失败");
  expect(await screen.findByText("<a>")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "加载更多项目或实例" }));
  expect(await screen.findByText("<b>")).toBeVisible();
});

it("keeps the comparison after a later page fails and allows retrying to select remaining instances", async () => {
  const items = [instance("a", "A"), instance("b", "B"), instance("c", "C")];
  const repository = repositoryWith(items);
  const read = repository.getProjectConfigurations.getMockImplementation()!;
  let inventoryReads = 0;
  repository.getProjectConfigurations.mockImplementation(async (id, query) => {
    if (query?.baselineBindingId) return read(id, query);
    if (!query?.cursor) return { ...response(items), items: items.slice(0, 2), nextCursor: ++inventoryReads === 1 ? "expired" : "fresh" };
    if (query.cursor === "expired") throw new Error("expired cursor");
    return { ...response(items), items: [items[2]] };
  });
  render(<Harness repository={repository} />);
  expect(await screen.findByText("<b>")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "加载更多项目或实例" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("已显示的对比保留");
  expect(screen.getByText("<a>")).toBeVisible();
  expect(screen.getByText("<b>")).toBeVisible();
  expect(repository.getProjectConfigurations.mock.calls.filter(([, query]) => query?.baselineBindingId)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "重新加载项目列表" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "加载更多项目或实例" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "加载更多项目或实例" })).not.toBeInTheDocument());
  await selectControlOption(screen.getByRole("combobox", { name: "右侧项目" }), "C");
  expect(await screen.findByText("<c>")).toBeVisible();
});

it("keeps a one-project right side empty until chosen and copies a complete empty DTS boolean", async () => {
  const item = { ...instance("boolean", "Only", ""), valueKind: "boolean" as const };
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<Harness repository={repositoryWith([item])} />);
  expect(await screen.findByText("布尔属性存在，无值文本")).toBeVisible();
  expect(screen.getByText(/只有一个已配置项目/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "复制配置：基准实例完整原值" }));
  await waitFor(() => expect(write).toHaveBeenCalledWith(""));
  await selectControlOption(screen.getByRole("combobox", { name: "右侧项目" }), "Only");
  expect(await screen.findByText("原文相同")).toBeVisible();
  write.mockRestore();
});

it("honors linked instances, preserves incompatible semantics and never substitutes truncated previews", async () => {
  const a = instance("a", "A", "<0x3e9>");
  const b = { ...instance("b", "B", "<1001>"), comparison: { status: "different-semantics" as const, reason: "revision-semantics" as const, revisionChanged: true } };
  const repository = repositoryWith([a, b]);
  const onChange = vi.fn();
  render(<ProjectComparison repository={repository} definitionId="definition" baselineId="a" targetId="b" onChange={onChange} />);
  expect(await screen.findByText(/定义语义不同，不计算差值/)).toBeVisible();
  expect(screen.getByText(/固定修订不同/)).toBeVisible();
  expect(screen.queryByText("truncated preview")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce();
  fireEvent.click(screen.getByRole("button", { name: "复制配置：基准实例完整原值" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  fireEvent.click(screen.getByRole("button", { name: "复制配置：基准实例完整原值" }));
  await waitFor(() => expect(write).toHaveBeenLastCalledWith("<0x3e9>"));
  expect(within(screen.getByRole("textbox", { name: "基准实例原值" })).getByText("<0x3e9>")).toBeVisible();
  write.mockRestore();
});

it("does not silently replace an unavailable linked baseline", async () => {
  const repository = repositoryWith([instance("a", "A"), instance("b", "B")]);
  repository.getProjectConfigurations.mockImplementation(async (_id, query) => {
    if (query?.baselineBindingId) throw new WiseEffApiError("NOT_FOUND", "missing", { reason: "baseline-unavailable" }, "request");
    return response([instance("a", "A"), instance("b", "B")]);
  });
  const onChange = vi.fn();
  render(<ProjectComparison repository={repository} definitionId="definition" baselineId="missing" targetId="b" onChange={onChange} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("基准实例已不可用");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新选择" }));
  expect(onChange).toHaveBeenCalledWith({ baseline: null, target: null });
});

it("hides old values immediately on organization change and ignores a delayed old response", async () => {
  const repository = repositoryWith([instance("a", "A"), instance("b", "B")]);
  const view = render(<ProjectComparison repository={repository} organizationId="old" definitionId="definition" baselineId="a" targetId="b" onChange={() => {}} />);
  expect(await screen.findByText("<a>")).toBeVisible();
  let resolve!: (value: CatalogProjectConfigurationsResponse) => void;
  repository.getProjectConfigurations.mockReturnValueOnce(new Promise(complete => { resolve = complete; }));
  view.rerender(<ProjectComparison repository={repository} organizationId="old" definitionId="definition" baselineId="b" targetId="a" onChange={() => {}} />);
  repository.getProjectConfigurations.mockImplementation(async () => response([]));
  view.rerender(<ProjectComparison repository={repository} organizationId="new" definitionId="definition" onChange={() => {}} />);
  expect(screen.queryByText("<a>")).not.toBeInTheDocument();
  await act(async () => resolve({ ...response([]), baseline: instance("old", "Old") }));
  expect(await screen.findByText("当前没有可用于对比的项目配置。")).toBeVisible();
  expect(screen.queryByText("<old>")).not.toBeInTheDocument();
});

it.each(["baseline", "target"] as const)("refreshes inventory before replacing an unavailable %s", async side => {
  const before = [instance("a", "A"), instance("b", "B"), instance("c", "C")];
  const unavailable = side === "baseline" ? "a" : "b";
  const after = before.filter(item => item.bindingId !== unavailable);
  const repository = repositoryWith(before);
  let inventoryReads = 0;
  repository.getProjectConfigurations.mockImplementation(async (_id, query) => {
    if (!query?.baselineBindingId) return response(++inventoryReads === 1 ? before : after);
    if (query.baselineBindingId === unavailable || query.targetBindingId === unavailable) throw new WiseEffApiError("NOT_FOUND", "gone", { reason: `${side}-unavailable` }, "request");
    return { ...response(after), baseline: after.find(item => item.bindingId === query.baselineBindingId), target: after.find(item => item.bindingId === query.targetBindingId) };
  });
  render(<Harness repository={repository} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("实例已不可用");
  fireEvent.click(screen.getByRole("button", { name: "重新选择" }));
  expect(await screen.findByText("<c>")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(repository.getProjectConfigurations.mock.lastCall?.[1]).toEqual({ baselineBindingId: after[0].bindingId, targetBindingId: "c" });
});

it("keeps source metadata out of the selectors, preserves exact handoff and bounds long source rendering", async () => {
  const a = instance("a", "A");
  const b = instance("b", "B");
  const raw = "full source\n".repeat(2_100);
  const repository = repositoryWith([a, b]);
  repository.getProjectConfigurations.mockImplementation(async (_id, query) => ({ ...response([a, b]),
    ...(query?.baselineBindingId ? { baseline: { ...a, fileName: "new-source.dts", sourceLocation: "/new-node", rawValue: raw }, target: b } : {}) }));
  const onOpenProject = vi.fn();
  render(<ProjectComparison repository={repository} definitionId="definition" baselineId="a" targetId="b" onChange={() => {}} onOpenProject={onOpenProject} />);
  expect(await screen.findByText(/内容较长/)).toBeVisible();
  expect(screen.queryByText(/new-source.dts/)).not.toBeInTheDocument();
  expect(screen.queryByText("/new-node")).not.toBeInTheDocument();
  expect(screen.queryByText(/值固定修订/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "在项目中打开 基准实例" }));
  expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ bindingId: "a", fileName: "new-source.dts", sourceLocation: "/new-node", rawValue: raw }));
  const source = screen.getByRole("textbox", { name: "基准实例原值" });
  expect(source.textContent).toBe(raw);
  expect(source.querySelectorAll(".parameter-library-compare__line")).toHaveLength(0);
});
