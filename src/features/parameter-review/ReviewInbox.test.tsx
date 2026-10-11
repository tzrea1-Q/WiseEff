import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("shows one pending empty state with a history action", () => {
    inbox();
    expect(screen.getAllByText("暂无待审核请求")).toHaveLength(1);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveValue("all");
    fireEvent.click(screen.getByRole("button", { name: "查看已处理记录" }));
    expect(screen.getByRole("tab", { name: "已处理" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toContain("view=history");
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

  it("names an empty type filter and clears it without another empty panel", () => {
    inbox([older]);
    fireEvent.change(screen.getByRole("combobox", { name: "变更类型" }), { target: { value: "value" } });
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
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveValue("all");
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
    const rows = within(screen.getByRole("table", { name: "审阅队列" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-review-row-id"))).toEqual(["member-old", "older", "value-new"]);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "变更类型" }), { target: { value: "value" } });
    expect(screen.getByRole("heading", { name: "软件详情 value-new" })).toBeInTheDocument();
    expect(window.location.search).toContain("type=value");
    window.history.pushState(null, "", "/parameter-review?memberRequest=member-old&view=pending&type=member");
    fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "成员详情 member-old" })).toBeInTheDocument();
  });

  it("never substitutes another request for an unavailable deep link", () => {
    inbox([older], "?request=missing");
    expect(screen.getByRole("alert")).toHaveTextContent("请求不存在或不在当前队列中");
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?request=missing");
  });

  it("treats an unknown type URL as all types", () => {
    inbox([], "?type=constructor");
    expect(screen.getByRole("combobox", { name: "变更类型" })).toHaveValue("all");
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
});
