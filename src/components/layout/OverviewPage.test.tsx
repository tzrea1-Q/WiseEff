import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPage, OverviewTile, OverviewVerdict } from "./OverviewPage";

describe("OverviewPage", () => {
  it("preserves a measured zero trend", () => {
    render(<dl><OverviewTile label="今日分析" value={4} trend={0} hasSamples /></dl>);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders summary tiles, content and quick actions without inventing empty-source values or trends", () => {
    const onOpen = vi.fn();
    render(
      <OverviewPage label="分析概览" summary={
        <dl className="overview-page__tiles">
          <OverviewTile label="今日分析" value={4} trend="较昨日 +2" hasSamples />
          <OverviewTile label="平均置信度" value="100%" trend="质量稳定" hasSamples={false} />
          <OverviewTile label="失败文件" value={0} hasSamples />
        </dl>
      } quickActions={<button onClick={onOpen}>查看日志</button>}>
        <OverviewVerdict hasSamples={false}>质量表现稳定</OverviewVerdict>
      </OverviewPage>
    );
    const page = screen.getByRole("region", { name: "分析概览" });
    expect(within(page).getByText("4")).toBeInTheDocument();
    expect(within(page).getByText("较昨日 +2")).toBeInTheDocument();
    expect(within(page).getByText("0")).toBeInTheDocument();
    expect(within(page).getByText("暂无样本")).toBeInTheDocument();
    expect(within(page).getByText("暂无样本，无法判断")).toBeInTheDocument();
    for (const unsupported of ["100%", "质量稳定", "质量表现稳定"]) {
      expect(screen.queryByText(unsupported)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "查看日志" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
