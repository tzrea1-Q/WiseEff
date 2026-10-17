import { selectControlOption } from "@/test/selectControlOption";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ReviewInbox, type ReviewInboxRow } from "./ReviewInbox";
import { getContextQuery } from "@/workbenchUi";

vi.mock("./CanonicalProjectValueReviewPanel", () => ({
  CanonicalProjectValueReviewPanel: ({ initialRequestId }: { initialRequestId: string }) => <h3>软件详情 {initialRequestId}</h3>
}));
vi.mock("./CanonicalMemberRemovalReviewPanel", () => ({
  CanonicalMemberRemovalReviewPanel: ({ initialRequestId }: { initialRequestId: string }) => <h3>成员详情 {initialRequestId}</h3>
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-review");
});

const older: ReviewInboxRow = { id: "older", kind: "legacy", projectId: "aurora", project: "Aurora", module: "电池",
  title: "调整电压", submitter: "刘敏", createdAt: "2026-10-09T01:00:00Z", status: "待审核", view: "pending" };
const newer: ReviewInboxRow = { ...older, id: "newer", title: "调整电流", createdAt: "2026-10-10T01:00:00Z" };
const history: ReviewInboxRow = { ...older, id: "handled", title: "历史电压", status: "已批准", view: "history" };

function inbox(rows: ReviewInboxRow[] = [], search = "") {
  window.history.replaceState(null, "", `/parameter-review${search}`);
  return render(<ReviewInbox projectId="aurora" state={initialState} search={search} legacyRows={rows}
    renderLegacyDetail={(row) => <h3>{row.title}详情</h3>} />);
}

describe("unified review inbox", () => {
  it("uses personal submission language and gives an empty queue the full width", () => {
    const onNavigate = vi.fn();
    const { container } = render(<ReviewInbox projectId="aurora" state={initialState} search="" mineOnly legacyRows={[]}
      renderLegacyDetail={() => null} onNavigate={onNavigate} />);
    expect(screen.getByText("暂无审核中的提交")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "提交状态" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审核中" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/项目成员提交/)).not.toBeInTheDocument();
    expect(container.querySelector(".review-inbox")).toHaveClass("review-inbox--list-only");
    expect(screen.queryByRole("columnheader", { name: "提交人" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "项目" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "我的提交" })).queryByRole("columnheader")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "前往参数修改" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters?project=aurora");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "已结束" }));
    expect(screen.getByText("暂无已处理提交")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens legacy details inside the personal submission workspace", () => {
    render(<ReviewInbox projectId="aurora" state={initialState} search="" mineOnly legacyRows={[older]}
      renderLegacyDetail={(row) => <h3>{row.title}详情</h3>} />);
    const table = screen.getByRole("table", { name: "我的提交" });
    fireEvent.click(within(table).getByRole("button", { name: "查看 调整电压 提交详情" }));
    expect(within(screen.getByRole("complementary", { name: "提交详情" }))
      .getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
    expect(window.location.search).toContain("legacyRequest=older");
  });

  it("keeps older project bookmarks compatible while preferring the canonical query", () => {
    expect(getContextQuery("?projectId=nebula").projectId).toBe("nebula");
    expect(getContextQuery("?project=aurora&projectId=nebula").projectId).toBe("aurora");
  });
  it("keeps one selectable summary row with the full title available when truncated", () => {
    const title = "将 Aurora 电池 CCCV 起始电压从 4500 调整为 4600";
    inbox([{ ...older, title }]);
    const queue = screen.getByRole("region", { name: "审阅队列" });
    const rows = within(queue).getAllByRole("row").filter((row) => row.textContent?.includes(title));
    expect(rows).toHaveLength(1);
    const summary = within(rows[0]).getByRole("button", { name: `查看 ${title} 提交详情` });
    expect(summary).toHaveAttribute("title", title);
    expect(summary).toHaveAttribute("data-size", "sm");
    expect(summary).toHaveAttribute("data-variant", "outline");
    expect(within(summary).getByText(title).closest(".review-inbox__summary")).not.toBeNull();
    fireEvent.click(summary);
    const inspector = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(inspector).getByRole("heading", { name: `${title}详情` })).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a multiline legacy preview outside the fixed-size detail button", () => {
    render(<ReviewInbox projectId="aurora" state={initialState} search="" legacyRows={[older]}
      renderRowTitle={() => <span>复杂配置<br />24 行 · 当前与目标不同</span>}
      renderLegacyDetail={(row) => <h3>{row.title}详情</h3>} />);
    const button = screen.getByRole("button", { name: `查看 ${older.title} 提交详情` });
    expect(button).toHaveTextContent(older.title);
    expect(within(button).queryByText("复杂配置")).not.toBeInTheDocument();
    expect(screen.getByText(/24 行/).closest(".review-inbox__summary")).toContainElement(button);
  });

  it("includes the visible object label in the detail button's accessible name", () => {
    inbox([{ ...older, objectLabel: "cccv_0" }]);
    const button = screen.getByRole("button", { name: "cccv_0，查看 调整电压 提交详情" });
    expect(button).toHaveTextContent("cccv_0");
    expect(button).not.toHaveTextContent("调整电压");
    expect(screen.getByText("调整电压")).toBeInTheDocument();
  });

  it("shows one pending empty state with a history action", () => {
    inbox([history]);
    expect(screen.getAllByText("暂无待审核请求")).toHaveLength(1);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "变更类型" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已处理记录" }));
    expect(screen.getByRole("tab", { name: "已处理" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toContain("view=history");
  });

  it("keeps an entirely empty queue free of filters and a link to empty history", () => {
    inbox();
    expect(screen.getByText("暂无待审核请求")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看已处理记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
  });

  it("keeps project context, people, module and full time readable in the compact queue", () => {
    const row = { ...older, project: "Aurora 量产平台", module: "软件配置", submitter: "u-zhao-heng" };
    inbox([row]);
    const cells = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("cell");
    expect(cells).toHaveLength(3);
    expect(within(cells[0]).getByText("参数变更")).toBeInTheDocument();
    expect(within(cells[0]).getByText(row.module)).toHaveAttribute("title", row.module);
    expect(within(cells[0]).getByText(row.submitter)).toHaveAttribute("title", `提交人：${row.submitter}`);
    expect(within(screen.getByRole("complementary", { name: "审阅详情" })).getByText(`${row.project} · 参数与节点`)).toBeInTheDocument();
    expect(within(cells[1]).getByText(/./)).toHaveAttribute("title");
    expect(cells[2]).toHaveTextContent(row.status);
  });

  it("orders pending oldest first and selects a legacy request in the shared detail", () => {
    inbox([newer, older, history]);
    const rows = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("调整电压");
    expect(rows[0]).toHaveTextContent("参数变更");
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看 调整电流 提交详情" }));
    expect(screen.getByRole("heading", { name: "调整电流详情" })).toBeInTheDocument();
    expect(window.location.search).toContain("legacyRequest=newer");
  });

  it.each(["参数初始化", "节点状态", "历史参数"])("uses %s consistently without changing the legacy query key", (typeLabel) => {
    inbox([{ ...older, typeLabel }], "?type=legacy");
    const queue = screen.getByRole("table", { name: "审阅队列" });
    expect(within(queue).getByText(typeLabel)).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "审阅详情" })).getByText(`${older.project} · ${typeLabel}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const typeFilter = screen.getByRole("combobox", { name: "变更类型" });
    expect(typeFilter).toHaveAttribute("data-value", "legacy");
    expect(typeFilter).toHaveTextContent("参数与节点");
    expect(window.location.search).toContain("type=legacy");
  });

  it("names an empty type filter and clears it without another empty panel", async () => {
    inbox([older]);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    await selectControlOption(screen.getByRole("combobox", { name: "变更类型" }), "value");
    expect(screen.getByText("没有符合当前筛选条件的请求")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除软件配置筛选" })).toBeInTheDocument();
    expect(screen.queryByText("当前项目暂无待审变更。")).not.toBeInTheDocument();
    expect(screen.getByText("调整或清除筛选条件可查看其他请求。")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
  });

  it("names applied column filters when they exclude every request", () => {
    inbox([older, { ...newer, submitter: "王杰", status: "待批准" }]);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "刘敏" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "待批准" }));
    expect(screen.getByText("没有符合当前筛选条件的请求")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除刘敏筛选" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除待批准筛选" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row")).toHaveLength(3);
  });

  it("restores legacy history links and URL filters on browser navigation", () => {
    inbox([older, history], "?legacyRequest=handled&view=history&type=legacy");
    expect(screen.getByRole("heading", { name: "历史电压详情" })).toBeInTheDocument();
    window.history.pushState(null, "", "/parameter-review?legacyRequest=older&view=pending&type=all");
    fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveAttribute("data-value", "all");
  });

  it("combines canonical and legacy requests by age and restores member deep links", async () => {
    const request = { id: "value-new", bindingId: "binding", reason: "校准电压", submitterUserId: "author",
      createdAt: "2026-10-10T02:00:00Z", status: "pending" };
    const member = { ...request, id: "member-old", reason: "移除旧成员", createdAt: "2026-10-08T02:00:00Z" };
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }),
      listProjectValueBatchChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [member] })
    } as unknown as ParameterCatalogRepository;
    render(<ReviewInbox projectId="aurora" state={initialState} search="" repository={repository} canReview legacyRows={[older]}
      renderLegacyDetail={(row) => <h3>{row.title}详情</h3>} />);
    await screen.findByRole("heading", { name: "成员详情 member-old" });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("request")).toBe("member-old"));
    const rows = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-review-row-id"))).toEqual(["member-old", "older", "value-new"]);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    await selectControlOption(screen.getByRole("combobox", { name: "变更类型" }), "value");
    expect(await screen.findByRole("heading", { name: "软件详情 value-new" })).toBeInTheDocument();
    expect(window.location.search).toContain("type=value");
    window.history.pushState(null, "", "/parameter-review?memberRequest=member-old&view=pending&type=member");
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { name: "成员详情 member-old" })).toBeInTheDocument();
  });

  it("never substitutes another request for an unavailable deep link", () => {
    inbox([older], "?request=missing");
    expect(screen.getByRole("alert")).toHaveTextContent("无法打开该请求");
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?request=missing");
    fireEvent.click(screen.getByRole("button", { name: "返回当前项目队列" }));
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
  });

  it("distinguishes a selected request hidden by a filter from an unavailable request", async () => {
    inbox([older, { ...newer, submitter: "王杰" }], "?legacyRequest=newer");
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "刘敏" }));
    expect(screen.getByText("当前请求被筛选条件隐藏，清除筛选后可继续查看。")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toContain("legacyRequest=newer");
    fireEvent.click(screen.getByRole("button", { name: "显示当前请求" }));
    expect(await screen.findByRole("heading", { name: "调整电流详情" })).toBeInTheDocument();
  });

  it("searches request content and assigned work without clearing the deep link", () => {
    inbox([{ ...older, assignedToId: "another" }, { ...newer, assignedToId: initialState.currentUserId }]);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索审阅请求" }), { target: { value: "调整电流" } });
    expect(screen.queryByRole("button", { name: "查看 调整电压 提交详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 调整电流 提交详情" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "待我处理" }));
    expect(screen.getByRole("table", { name: "审阅队列" })).toHaveTextContent("调整电流");
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row")).toHaveLength(3);
  });

  it("sorts history by handling time and labels missing handling time honestly", () => {
    inbox([{ ...history, id: "old-created", createdAt: "2026-01-01T00:00:00Z", handledAt: "2026-10-12T00:00:00Z" },
      { ...history, id: "new-created", createdAt: "2026-10-10T00:00:00Z", handledAt: "2026-10-11T00:00:00Z" },
      { ...history, id: "unrecorded", createdAt: "2026-01-01T00:00:00Z" }], "?view=history");
    const rows = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-review-row-id"))).toEqual(["old-created", "new-created", "unrecorded"]);
    expect(screen.getByRole("columnheader", { name: "处理时间" })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("未记录");
  });

  it("treats an unknown type URL as all types", () => {
    inbox([], "?type=constructor");
    expect(screen.queryByLabelText("已应用筛选")).not.toBeInTheDocument();
    expect(screen.getByText("暂无待审核请求")).toBeInTheDocument();
  });

  it("drops pending assignment filtering when switching to history", () => {
    inbox([{ ...older, assignedToId: initialState.currentUserId }, { ...history, assignedToId: "another" }]);
    fireEvent.click(screen.getByRole("checkbox", { name: "待我处理" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "已处理" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("heading", { name: "历史电压详情" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "待我处理" })).not.toBeInTheDocument();
    expect(screen.queryByText(/待我处理筛选/)).not.toBeInTheDocument();
  });

  it("does not confuse the assigned reviewer with the actor in history", () => {
    inbox([{ ...history, assignedTo: "指定审核人", handledBy: "实际审核人" }], "?view=history");
    const queue = screen.getByRole("table", { name: "审阅队列" });
    expect(queue).toHaveTextContent("实际审核人 处理");
    expect(queue).not.toHaveTextContent("指定审核人");
  });

  it("does not offer an inaccessible review page to a personal hardware user", () => {
    render(<ReviewInbox projectId="aurora" state={{ ...initialState, activeRoleId: "hardware-user" }} search="" mineOnly
      legacyRows={[]} renderLegacyDetail={() => null} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "前往变更审阅" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前往参数修改" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审核中" })).toBeInTheDocument();
  });

  it("shows a load failure rather than a false empty queue and can retry", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [] });
    const repository = { listProjectValueChangeRequests: list } as unknown as ParameterCatalogRepository;
    render(<ReviewInbox projectId="aurora" state={initialState} search="" repository={repository} legacyRows={[]}
      renderLegacyDetail={() => null} />);
    await screen.findByRole("button", { name: "重试" });
    expect(screen.queryByText("暂无待审核请求")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("暂无待审核请求");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("uses authorized actor names and never presents the live value as a frozen before value", async () => {
    const request = { id: "named-request", bindingId: "binding", reason: "提高电压", action: "set", targetValue: "4600",
      submitterUserId: "author", submitterName: "张明", assignedToUserId: "reviewer", assignedToName: "李敏",
      createdAt: "2026-10-10T02:00:00Z", status: "pending" };
    const repository = { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }) } as unknown as ParameterCatalogRepository;
    render(<ReviewInbox projectId="aurora" state={{ ...initialState, parameters: [{ ...initialState.parameters[0], id: "binding", currentValue: "9999" }] }}
      search="" repository={repository} legacyRows={[]} renderLegacyDetail={() => null} />);
    const queue = await screen.findByRole("table", { name: "审阅队列" });
    expect(queue).toHaveTextContent("张明");
    expect(queue).toHaveTextContent("李敏");
    expect(queue).toHaveTextContent("目标值 4600");
    expect(queue).not.toHaveTextContent("9999");
  });

  it("locks navigation and refresh while a request is being applied", () => {
    render(<ReviewInbox projectId="aurora" state={initialState} search="" legacyRows={[older]} busy renderLegacyDetail={() => null} />);
    expect(screen.getByRole("button", { name: "刷新队列" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "已处理" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索审阅请求" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看 调整电压 提交详情" })).toBeDisabled();
  });

  it("hides the previous canonical queue while a replacement repository is loading", async () => {
    const request = { id: "value-1", bindingId: "binding", reason: "校准电压", submitterUserId: "author",
      createdAt: "2026-10-10T02:00:00Z", status: "pending" };
    let finish!: (response: { items: typeof request[] }) => void;
    const repository = { listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [request] }) } as unknown as ParameterCatalogRepository;
    const replacement = { listProjectValueChangeRequests: vi.fn().mockReturnValue(
      new Promise<{ items: typeof request[] }>((resolve) => { finish = resolve; })) } as unknown as ParameterCatalogRepository;
    const mounted = render(<ReviewInbox projectId="aurora" state={initialState} search="" repository={repository}
      legacyRows={[]} renderLegacyDetail={() => null} />);
    await screen.findByRole("heading", { name: "软件详情 value-1" });
    mounted.rerender(<ReviewInbox projectId="aurora" state={initialState} search="" repository={replacement}
      legacyRows={[]} renderLegacyDetail={() => null} />);
    expect(screen.queryByRole("heading", { name: "软件详情 value-1" })).not.toBeInTheDocument();
    expect(screen.queryByText("暂无待审核请求")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { finish({ items: [{ ...request, reason: "更新电压" }] }); });
    expect(screen.getByRole("heading", { name: "软件详情 value-1" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "审阅队列" })).toHaveTextContent("更新电压");
  });

  it.each(["account", "role", "permission"] as const)("clears private filters and old details when the %s changes", async (change) => {
    const request = { id: "same-id", bindingId: "binding", reason: "提高电压", targetValue: "4600", status: "pending" };
    let finish!: (value: { items: typeof request[] }) => void;
    const list = vi.fn().mockResolvedValueOnce({ items: [request] })
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const repository = { listProjectValueChangeRequests: list } as unknown as ParameterCatalogRepository;
    const element = (changed = false) => <ReviewInbox projectId="aurora" state={{ ...initialState,
      currentUserId: changed && change === "account" ? "other-user" : initialState.currentUserId,
      activeRoleId: changed && change === "role" ? "software-user" : initialState.activeRoleId }}
      canReview={!(changed && change === "permission")} search="" repository={repository} legacyRows={[]}
      renderLegacyDetail={() => null} />;
    const mounted = render(element());
    await screen.findByRole("heading", { name: "软件详情 same-id" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "私人输入" } });
    mounted.rerender(element(true));
    expect(screen.queryByRole("heading", { name: "软件详情 same-id" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("私人输入")).not.toBeInTheDocument();
    await act(async () => { finish({ items: [request] }); });
    expect(screen.getByRole("heading", { name: "软件详情 same-id" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
