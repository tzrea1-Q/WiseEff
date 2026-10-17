import { selectControlOption } from "@/test/selectControlOption";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ReviewInbox, type ReviewInboxRow } from "./ReviewInbox";

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
    const { container } = render(<ReviewInbox projectId="aurora" state={initialState} search="" mineOnly legacyRows={[]}
      renderLegacyDetail={() => null} />);
    expect(screen.getByText("暂无审核中的提交")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "提交状态" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审核中" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/项目成员提交/)).not.toBeInTheDocument();
    expect(container.querySelector(".review-inbox")).toHaveClass("review-inbox--list-only");
    expect(screen.queryByRole("columnheader", { name: "提交人" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "项目" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看已处理提交" }));
    expect(screen.getByText("暂无已处理提交")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "已结束" })).toHaveAttribute("aria-selected", "true");
  });
  it("keeps one selectable summary row with the full title available when truncated", () => {
    const title = "将 Aurora 电池 CCCV 起始电压从 4500 调整为 4600";
    inbox([{ ...older, title }]);
    const queue = screen.getByRole("region", { name: "审阅队列" });
    const rows = within(queue).getAllByRole("row").filter((row) => row.textContent?.includes(title));
    expect(rows).toHaveLength(1);
    const summary = within(rows[0]).getByRole("button", { name: `查看 ${title} 提交详情` });
    expect(summary).toHaveAttribute("title", title);
    expect(within(summary).getByText(title)).toHaveClass("review-inbox__summary");
    fireEvent.click(summary);
    const inspector = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(inspector).getByRole("heading", { name: `${title}详情` })).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
  });

  it("shows one pending empty state with a history action", () => {
    inbox();
    expect(screen.getAllByText("暂无待审核请求")).toHaveLength(1);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveAttribute("data-value", "all");
    fireEvent.click(screen.getByRole("button", { name: "查看已处理记录" }));
    expect(screen.getByRole("tab", { name: "已处理" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toContain("view=history");
  });

  it("exposes full metadata in titles when single-line cells truncate", () => {
    const row = { ...older, project: "Aurora 量产平台", module: "软件配置", submitter: "u-zhao-heng" };
    inbox([row]);
    const cells = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("cell");
    expect(cells[0]).toHaveAttribute("title", "旧版");
    expect(cells[1]).toHaveAttribute("title", row.project);
    expect(cells[2]).toHaveAttribute("title", row.module);
    expect(cells[3]).toHaveAttribute("title", row.submitter);
    expect(cells[5]).toHaveAttribute("title");
    expect(within(cells[5]).getByText(/./)).toHaveAttribute("title");
    expect(cells[6]).toHaveAttribute("title", row.status);
  });

  it("orders pending oldest first and selects a legacy request in the shared detail", () => {
    inbox([newer, older, history]);
    const rows = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("调整电压");
    expect(rows[0]).toHaveTextContent("旧版");
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看 调整电流 提交详情" }));
    expect(screen.getByRole("heading", { name: "调整电流详情" })).toBeInTheDocument();
    expect(window.location.search).toContain("legacyRequest=newer");
  });

  it("names an empty type filter and clears it without another empty panel", async () => {
    inbox([older]);
    await selectControlOption(screen.getByRole("combobox", { name: "变更类型" }), "value");
    expect(screen.getByText("软件配置筛选下暂无请求")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
  });

  it("names applied column filters when they exclude every request", () => {
    inbox([older, { ...newer, submitter: "王杰", status: "待批准" }]);
    fireEvent.click(screen.getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "刘敏" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "待批准" }));
    expect(screen.getByText("提交人：刘敏 · 状态：待批准筛选下暂无请求")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row")).toHaveLength(3);
  });

  it("restores legacy history links and URL filters on browser navigation", () => {
    inbox([older, history], "?legacyRequest=handled&view=history&type=legacy");
    expect(screen.getByRole("heading", { name: "历史电压详情" })).toBeInTheDocument();
    window.history.pushState(null, "", "/parameter-review?legacyRequest=older&view=pending&type=all");
    fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "调整电压详情" })).toBeInTheDocument();
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
    await selectControlOption(screen.getByRole("combobox", { name: "变更类型" }), "value");
    expect(await screen.findByRole("heading", { name: "软件详情 value-new" })).toBeInTheDocument();
    expect(window.location.search).toContain("type=value");
    window.history.pushState(null, "", "/parameter-review?memberRequest=member-old&view=pending&type=member");
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { name: "成员详情 member-old" })).toBeInTheDocument();
  });

  it("never substitutes another request for an unavailable deep link", () => {
    inbox([older], "?request=missing");
    expect(screen.getByRole("alert")).toHaveTextContent("请求不存在或不在当前队列中");
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?request=missing");
  });

  it("treats an unknown type URL as all types", () => {
    inbox([], "?type=constructor");
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveAttribute("data-value", "all");
    expect(screen.getByText("暂无待审核请求")).toBeInTheDocument();
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
});
