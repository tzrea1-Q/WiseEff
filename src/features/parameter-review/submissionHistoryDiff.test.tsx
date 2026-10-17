import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialState } from "@/mockData";
import { SubmissionHistoryDiffCard } from "./submissionHistoryDiff";

afterEach(cleanup);

describe("SubmissionHistoryDiffCard business labels", () => {
  it("names a node state change and preserves its frozen values and reason without scalar line counts", () => {
    const item = { ...initialState.parameterSubmissionRounds[0].items[0], editSubjectKind: "node-enablement" as const,
      name: "sc8562", module: "节点启用", valueKind: "scalar" as const, unit: "", currentValue: '"okay"', targetValue: '"disabled"',
      reason: "关闭未连接节点，保留原始拓扑值" };
    render(<SubmissionHistoryDiffCard item={item} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("节点状态")).toBeInTheDocument();
    expect(within(card).queryByText("数值配置")).not.toBeInTheDocument();
    expect(card.querySelector(".history-submission-meta-row")).not.toBeInTheDocument();
    expect(card.querySelector("[data-kind='remove'] code")).toHaveTextContent('"okay"');
    expect(card.querySelector("[data-kind='add'] code")).toHaveTextContent('"disabled"');
    expect(card).toHaveTextContent(item.reason);
  });

  it("keeps one scalar type label and its values with units and reason", () => {
    const item = { ...initialState.parameterSubmissionRounds[0].items[0], editSubjectKind: "binding" as const, name: "current_limit", valueKind: "scalar" as const,
      currentValue: "3850", targetValue: "3200", unit: "mA", reason: "同步推荐电流限制" };
    render(<SubmissionHistoryDiffCard item={item} />);
    const card = screen.getByRole("article");
    expect(within(card).getAllByText("数值配置")).toHaveLength(1);
    expect(card.querySelector(".history-submission-meta-row")).not.toBeInTheDocument();
    expect(card.querySelector("[data-kind='remove'] code")).toHaveTextContent("3850 mA");
    expect(card.querySelector("[data-kind='add'] code")).toHaveTextContent("3200 mA");
    expect(card).toHaveTextContent(item.reason);
  });

  it("retains multiline configuration metadata and exact changed source lines", () => {
    const item = { ...initialState.parameterSubmissionRounds[0].items[0], editSubjectKind: "binding" as const, name: "charge_config", valueKind: "complex" as const,
      currentValue: "mode = 1;\nlimit = 3850;", targetValue: "mode = 1;\nlimit = 3200;\nfast = 1;", unit: "", reason: "调整充电工况" };
    render(<SubmissionHistoryDiffCard item={item} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("复杂配置")).toBeInTheDocument();
    const metadata = within(card).getByLabelText("charge_config 历史提交摘要");
    expect(metadata).toHaveTextContent("配置文本");
    expect(metadata).toHaveTextContent("当前 2 行");
    expect(metadata).toHaveTextContent("目标 3 行");
    expect(card.querySelector("[data-kind='remove'] code")).toHaveTextContent("limit = 3850;");
    expect(within(card).getByText("limit = 3200;")).toBeInTheDocument();
    expect(within(card).getByText("fast = 1;")).toBeInTheDocument();
    expect(card).toHaveTextContent(item.reason);
  });
});
