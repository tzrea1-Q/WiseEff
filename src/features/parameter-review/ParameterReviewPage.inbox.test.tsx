import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import { ParameterReviewPage } from "./ParameterReviewPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-review");
});

it("offers one review context and one empty message rather than per-type queues", () => {
  render(<ParameterReviewPage state={{ ...initialState, changeRequests: [], parameterSubmissionRounds: [],
    parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" runtimeMode="mock" />);
  expect(screen.getAllByRole("tablist")).toHaveLength(1);
  expect(screen.getByRole("tab", { name: "待处理" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "变更类型" })).toBeInTheDocument();
  expect(screen.getAllByText("暂无待审核请求")).toHaveLength(1);
  expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
});

it("leads legacy details with the change and full comparison before collapsed provenance", async () => {
  const request = { ...initialState.changeRequests[0], id: "legacy-summary", title: "电池电压", status: "硬件Committer检视" as const,
    currentValue: "4500", targetValue: "4600", submissionRoundId: undefined };
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "hardware-committer", changeRequests: [request],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" runtimeMode="mock" />);
  const detail = screen.getByRole("complementary", { name: "审阅详情" });
  const summary = within(detail).getByText("变更摘要");
  const comparison = within(detail).getByText("前后对比");
  const impact = within(detail).getByText("影响范围");
  const provenance = within(detail).getByText("溯源信息").closest("details")!;
  expect(summary.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(comparison.compareDocumentPosition(impact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(comparison.compareDocumentPosition(within(detail).getByLabelText("影响面")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(provenance).not.toHaveAttribute("open");
  fireEvent.click(within(provenance).getByText("溯源信息"));
  expect(await within(provenance).findByRole("button", { name: "复制 请求 ID" })).toBeInTheDocument();
});

it.each(["second", "missing"])("invalidates an open rejection when browser navigation selects %s", (requestId) => {
  const first = { ...initialState.changeRequests[0], id: "first", title: "第一次修改", submissionRoundId: undefined };
  const second = { ...first, id: "second", title: "第二次修改" };
  window.history.replaceState(null, "", "/parameter-review?legacyRequest=first");
  const dispatch = vi.fn();
  render(<ParameterReviewPage state={{ ...initialState, activeRoleId: "admin", changeRequests: [first, second],
    parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={dispatch} onNavigate={vi.fn()}
    search="?legacyRequest=first" runtimeMode="mock" />);
  fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
  const dialog = screen.getByRole("alertdialog", { name: "打回修改" });
  fireEvent.change(within(dialog).getByLabelText("打回原因"), { target: { value: "第一项需要补充证据" } });
  window.history.pushState(null, "", `/parameter-review?legacyRequest=${requestId}`);
  fireEvent.popState(window);
  expect(screen.queryByRole("alertdialog", { name: "打回修改" })).not.toBeInTheDocument();
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "REJECT_REVIEW" }));
});
