import { act, isInaccessible, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditWorkspace } from "./AuditWorkspace";
import { collectConsistencyMeasurements } from "../../../e2e/quality/consistency-collector";
import { requireRowActionVisibility } from "../../../e2e/quality/consistency-assertions";
import * as auditHttp from "@/infrastructure/http/auditClient";
import type { AuditEventDto, AuditEventListResponse } from "@/domain/audit/types";
import { useState } from "react";
import type { AuditQueryState } from "@/hooks/useAuditEvents";

const apiEvent: AuditEventDto = { id: "audit-1", organizationId: "org", projectId: null, actorUserId: "actor-1",
  actorType: "user", actorName: "用户", app: "parameters", kind: "parameter-topology-governance",
  action: "value-change-applied", severity: "Medium", targetType: null, targetId: null, metadata: {},
  traceId: "", createdAt: "2026-10-15T00:00:00Z" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("advanced audit kind filter", () => {
  const base: AuditQueryState = { appGroup: "all", severity: "all", search: "", timeWindow: "all" };
  const workspace = (query: AuditQueryState, onQueryChange: (patch: Partial<AuditQueryState>) => void) => <AuditWorkspace isApiMode={false} query={query} onQueryChange={onQueryChange}
    mockEvents={[
      { id: "parameter", app: "parameters", kind: "parameter-update", action: "参数更新", actor: "用户", severity: "Low", time: "刚刚" },
      { id: "role", app: "user-permissions", kind: "user-role-change", action: "角色变更", actor: "用户", severity: "Low", time: "刚刚" },
    ]} />;
  const kind = () => screen.getByRole("combobox", { name: "事件类型筛选" });
  const chooseKind = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
    await user.click(kind());
    const menu = screen.getByRole("listbox");
    // Check the chosen option's accessibility without recalculating names/styles for every sibling.
    const labelText = within(menu).getByText(label, { exact: true });
    const option = labelText.closest('[role="option"]');
    expect(option).toHaveAccessibleName(label);
    expect(isInaccessible(option!)).toBe(false);
    await user.click(labelText);
  };

  it("keeps selection as a draft, discards it on close, and submits it only on apply", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(workspace(base, onQueryChange));
    await user.click(screen.getByRole("button", { name: /^更多筛选/ }));
    await chooseKind(user, "参数更新");
    expect(kind()).toHaveTextContent("参数更新");
    expect(onQueryChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^更多筛选/ }));
    await user.click(screen.getByRole("button", { name: /^更多筛选/ }));
    expect(kind()).toHaveTextContent("全部类型");

    await chooseKind(user, "参数更新");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "parameter-update", eventId: undefined }));
  });

  it("resets drafts on URL changes and restores empty, clear and unknown-kind values", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const { rerender } = render(workspace({ ...base, kind: "parameter-update" }, onQueryChange));
    await user.click(screen.getByRole("button", { name: /^更多筛选/ }));
    await chooseKind(user, "删除参数");
    expect(onQueryChange).not.toHaveBeenCalled();
    rerender(workspace({ ...base, kind: "user-role-change" }, onQueryChange));
    expect(kind()).toHaveTextContent("角色变更");
    await chooseKind(user, "全部类型");
    expect(onQueryChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: undefined }));
    rerender(workspace(base, onQueryChange));
    rerender(workspace({ ...base, kind: "user-role-change" }, onQueryChange));
    expect(kind()).toHaveTextContent("角色变更");
    onQueryChange.mockClear();
    await user.click(screen.getByRole("button", { name: "清除筛选条件" }));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: undefined }));
    rerender(workspace(base, onQueryChange));
    expect(kind()).toHaveTextContent("全部类型");
    rerender(workspace({ ...base, kind: "future-kind" }, onQueryChange));
    expect(kind()).toHaveTextContent("全部类型");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: undefined }));
  });
});

it("keeps the severity menu available while server filters reload so another level can be selected", async () => {
  const listAuditEvents = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockImplementation(() => new Promise(() => {}));
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents });
  function Workspace() {
    const [query, setQuery] = useState<AuditQueryState>({ appGroup: "all", severity: "all", search: "", timeWindow: "all" });
    return <AuditWorkspace isApiMode mockEvents={[]} query={query} onQueryChange={(patch) => setQuery((current) => ({ ...current, ...patch }))} />;
  }
  render(<Workspace />);
  await waitFor(() => expect(screen.queryByLabelText("正在加载审计记录")).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "筛选严重度" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "高" }));
  expect(screen.getByRole("checkbox", { name: "高" })).toBeChecked();
  expect(screen.getByLabelText("正在加载审计记录")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "中" }));
  expect(screen.getByRole("checkbox", { name: "中" })).toBeChecked();
  expect(listAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ severities: ["High", "Medium"] }));
  await userEvent.click(screen.getByRole("button", { name: "清除" }));
  expect(screen.getByRole("checkbox", { name: "高" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "中" })).not.toBeChecked();
});

it.each([{ severity: "info", label: "信息" }, { severity: undefined, label: "未记录" }])("keeps audit row status measurable for wire severity $severity", async ({ severity, label }) => {
  const listAuditEvents = vi.fn().mockResolvedValue({ items: [{ ...apiEvent, id: "audit-value", app: "parameter-bindings",
    kind: "project-value", action: "新增项目参数值", actorType: "system", severity }], nextCursor: null });
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents });
  const { container } = render(<main><AuditWorkspace isApiMode
    query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={[]} /></main>);
  await waitFor(() => expect(within(screen.getByRole("table", { name: "审计事件" })).getByText(label)).toBeVisible());
  for (const element of container.querySelectorAll("*")) {
    element.getBoundingClientRect = () => new DOMRect(100, 100,
      element.matches("[data-row-status]") && !element.textContent?.trim() ? 0 : 120, 28);
    Object.defineProperty(element, "checkVisibility", { value: () => true });
  }
  const measurements = collectConsistencyMeasurements();
  expect(() => requireRowActionVisibility(measurements.rowActions, "/audit")).not.toThrow();
  expect(within(screen.getByRole("table", { name: "审计事件" })).getByText(label)).toBeVisible();
  expect(measurements.rowActions[0].actions).toHaveLength(1);
  expect(measurements.rowActions[0].statuses).toHaveLength(1);
});

it("opens the selected audit and writes its shareable ID without replacing filters", async () => {
  const onQueryChange = vi.fn();
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents: vi.fn().mockResolvedValue({ items: [apiEvent], nextCursor: null }) });
  render(<AuditWorkspace isApiMode onQueryChange={onQueryChange}
    query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={[]} />);
  const table = screen.getByRole("table", { name: "审计事件" });
  await userEvent.click(await within(table).findByRole("button", { name: "查看" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(onQueryChange).toHaveBeenCalledWith({ eventId: "audit-1" });
});

it("exports Chinese labels and untouched event codes in separate CSV columns", async () => {
  const blobs = vi.fn();
  vi.stubGlobal("Blob", class { constructor(parts: unknown[]) { blobs(parts); } });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:audit"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents: vi.fn().mockResolvedValue({ items: [apiEvent], nextCursor: null }) });
  render(<AuditWorkspace isApiMode query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }} mockEvents={[]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
  await waitFor(() => expect(blobs).toHaveBeenCalled());
  const csv = blobs.mock.calls[0][0][0] as string;
  expect(csv).toContain("类型,类型标识,操作,操作标识,操作人");
  expect(csv).toContain('"参数值变更已应用","value-change-applied"');
  expect(csv).toContain('"拓扑治理","parameter-topology-governance"');
});

it("shows one continuous list without duplicate more menus or misleading page totals", () => {
  render(<AuditWorkspace isApiMode={false} query={{ appGroup: "all", severity: "all", search: "", timeWindow: "all" }}
    mockEvents={Array.from({ length: 25 }, (_, index) => ({ id: String(index), app: "parameters", kind: "parameter-update",
      action: "更新参数", actor: "用户", severity: "Low", time: "刚刚" }))} />);
  expect(screen.getAllByRole("button", { name: "查看" })).toHaveLength(25);
  expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /更多$/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(/已加载 25 条/).length).toBeGreaterThan(0);
});

it("can select a related event outside the filtered list and filter its full chain once", async () => {
  const onQueryChange = vi.fn();
  const items: AuditEventDto[] = [
    { ...apiEvent, id: "one", kind: "parameter-update", action: "主事件", severity: "Low", traceId: "trace-one" },
    { ...apiEvent, id: "outside", kind: "parameter-review-advance", action: "相关审阅", actorName: "审阅人", severity: "Low", traceId: "trace-one" },
  ];
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents: vi.fn().mockImplementation((params) =>
    Promise.resolve({ items: params.traceId ? items : [items[0]], nextCursor: null })) });
  render(<AuditWorkspace isApiMode onQueryChange={onQueryChange}
    query={{ appGroup: "all", severity: "all", search: "主事件", timeWindow: "all" }}
    mockEvents={[]} />);
  await userEvent.click(await screen.findByRole("button", { name: "查看" }));
  await userEvent.click(await within(screen.getByLabelText("关联事件")).findByRole("button", { name: /相关审阅/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("heading", { level: 3 })).toHaveTextContent("相关审阅");
  onQueryChange.mockClear();
  await userEvent.click(screen.getByRole("button", { name: "查看完整链路" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onQueryChange).toHaveBeenCalledTimes(1);
  expect(onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ traceId: "trace-one", eventId: undefined, search: "", appGroup: "all", severity: "all" }));
});

it("cancels a stale export if the URL filter changes before it finishes", async () => {
  let resolveExport!: (value: AuditEventListResponse) => void;
  const item = { id: "audit-api", organizationId: "org", projectId: null, actorUserId: null, actorType: "system" as const,
    app: "parameter-bindings", kind: "project-value", action: "project-value-appended", severity: "info" as const,
    targetType: "project-value", targetId: "value", metadata: {}, traceId: "trace", createdAt: "2026-10-15T00:00:00Z" };
  const listAuditEvents = vi.fn().mockImplementation((params) => params.limit === 100
    ? new Promise((resolve) => { resolveExport = resolve; }) : Promise.resolve({ items: [item], nextCursor: null }));
  vi.spyOn(auditHttp, "createAuditClient").mockReturnValue({ listAuditEvents });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const query = { appGroup: "all" as const, severity: "all" as const, search: "", timeWindow: "all" as const };
  const { rerender } = render(<AuditWorkspace isApiMode mockEvents={[]} query={query} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
  rerender(<AuditWorkspace isApiMode mockEvents={[]} query={{ ...query, search: "new-filter" }} />);
  await act(async () => { resolveExport({ items: [item], nextCursor: null }); });
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("筛选条件已变化，本次导出已取消");
});
