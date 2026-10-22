import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchSourceCanvas, type WorkbenchSourceCanvasProps } from "./WorkbenchSourceCanvas";

afterEach(cleanup);

function renderCanvas(overrides: Partial<WorkbenchSourceCanvasProps> = {}) {
  const props: WorkbenchSourceCanvasProps = {
    sourceRegionRef: createRef(), selectedConfigSetName: "default",
    selectedMember: { configSetId: "set", fileId: "file", fileName: "board.dts", format: "dts",
      role: "base", sortOrder: 0, currentVersionId: "working", currentVersionNumber: 2 },
    canvasMode: "unified-diff", historyVersionId: null, candidateId: null, activeCandidate: null,
    fileVersions: [], onEnterCanvasMode: vi.fn(), onExitSpecialCanvasMode: vi.fn(),
    candidateError: "", sourceLoading: false, modeSourceLoading: false, sourceError: "",
    modeSourceError: "", onSourceRetry: vi.fn(), onClearModeSourceError: vi.fn(),
    source: "working source", historySource: "", candidateSource: "", candidateLoading: false,
    compareSource: "working source", unifiedDiffText: "", focusSpan: null, focusLineOverride: null,
    restoredScrollLine: null, findQuery: "", findNextToken: 0, onVisibleLineChange: vi.fn(),
    sessionChangeMarkers: [], ...overrides
  };
  render(<WorkbenchSourceCanvas {...props} />);
  return props;
}

describe("source canvas empty states", () => {
  it("compares a source update with its current file and returns without applying it", () => {
    const props = renderCanvas({ canvasMode: "candidate", candidateId: "update", source: "current\n", candidateBaseSource: "old\n", candidateSource: "new\n",
      activeCandidate: { id: "update", projectId: "project", fileId: "file", fileName: "board.dts", format: "dts", status: "ready",
        diagnostics: [], blockers: [], impact: {}, createdAt: "now", updatedAt: "now" } });
    const diff = screen.getByLabelText("来源更新差异");
    expect(diff).toHaveTextContent("-old");
    expect(diff).toHaveTextContent("+new");
    fireEvent.click(screen.getByRole("button", { name: "返回工作配置" }));
    expect(props.onExitSpecialCanvasMode).toHaveBeenCalledOnce();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /上传|确认应用/ })).not.toBeInTheDocument();
  });
  it.each([
    [true, "", undefined], [false, "working source failed", undefined],
    [true, "", "B before"], [false, "working source failed", "B before"]
  ] as const)("never uses stale working A as B's comparison base (loading=%s, error=%s, base=%s)", (sourceLoading, sourceError, candidateBaseSource) => {
    renderCanvas({ canvasMode: "candidate", candidateId: "candidate-b", source: "A stale", sourceLoading, sourceError,
      candidateSource: "B proposed", candidateBaseSource,
      selectedMember: { configSetId: "set", fileId: "file-b", fileName: "b.dts", format: "dts", role: "base", sortOrder: 0 },
      activeCandidate: { id: "candidate-b", projectId: "project", fileId: "file-b", fileName: "b.dts", format: "dts", status: "ready",
        diagnostics: [], blockers: [], impact: {}, createdAt: "now", updatedAt: "now" } });
    if (candidateBaseSource !== undefined) {
      expect(screen.getByLabelText("来源更新差异")).toHaveTextContent("-B before");
      expect(screen.getByLabelText("来源更新差异")).toHaveTextContent("+B proposed");
    } else {
      expect(screen.queryByLabelText("来源更新差异")).not.toBeInTheDocument();
      expect(screen.getByLabelText("DTS 源码")).toHaveTextContent("B proposed");
    }
    expect(screen.queryByText(/A stale/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试源码" })).not.toBeInTheDocument();
  });
  it("does not reuse the previous candidate's comparison proof while the next candidate loads", () => {
    renderCanvas({ canvasMode: "candidate", candidateId: "candidate-b", candidateSource: "B proposed", candidateBaseSource: "A before",
      activeCandidate: { id: "candidate-a", projectId: "project", fileId: "file-a", fileName: "a.dts", format: "dts", status: "ready",
        diagnostics: [], blockers: [], impact: { textDiff: "--- A\n+++ A2\n-A before\n+A proposed" }, createdAt: "now", updatedAt: "now" } });
    expect(screen.queryByLabelText("来源更新差异")).not.toBeInTheDocument();
    expect(screen.getByText("正在加载更新差异…")).toBeInTheDocument();
    expect(screen.queryByLabelText("DTS 源码")).not.toBeInTheDocument();
    expect(screen.queryByText(/A before|A proposed/)).not.toBeInTheDocument();
  });
  it("directs a member without an active version to version history", () => {
    renderCanvas({ canvasMode: "working", selectedMember: {
      configSetId: "set", fileId: "file", fileName: "board.dts", format: "dts", role: "base", sortOrder: 0
    } });
    expect(screen.getByText("文件身份仍保留在树中；请在「文件管理」中打开该文件的「版本历史与下载」检查。")).toBeInTheDocument();
  });
  it("keeps source retry beside the correct version history guidance for empty content", () => {
    const props = renderCanvas({ canvasMode: "working", source: "" });
    expect(screen.getByText("当前活跃版本没有可显示的源码内容；可重试或在「文件管理」中查看该文件的版本历史。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试源码" }));
    expect(props.onSourceRetry).toHaveBeenCalledOnce();
  });
  it("shows the file identity once and does not invent candidate version zero", () => {
    renderCanvas({ canvasMode: "candidate", candidateId: "candidate", candidateSource: "candidate source" });
    expect(screen.getAllByText("board.dts")).toHaveLength(1);
    expect(screen.getByText("候选 · 只读")).toBeInTheDocument();
    expect(screen.queryByText(/版本\s*0|v0/)).not.toBeInTheDocument();
  });
  it("identifies a candidate that is not yet a configuration member", () => {
    renderCanvas({ selectedMember: null, canvasMode: "candidate", candidateId: "candidate", candidateSource: "candidate source" });
    expect(screen.getByRole("heading", { name: "候选文件" })).toBeInTheDocument();
    expect(screen.queryByText("没有可读取的文件源码")).not.toBeInTheDocument();
  });
  it("uses the candidate format when an unassigned JSON candidate is opened beside a DTS member", () => {
    renderCanvas({ canvasMode: "candidate", candidateId: "new-json", candidateSource: '{"enabled":true}',
      activeCandidate: { id: "new-json", projectId: "project", fileName: "extra.json", format: "json", status: "ready",
        diagnostics: [], impact: {}, blockers: [], createdAt: "now", updatedAt: "now" } });
    expect(screen.getByRole("main", { name: /只读 JSON 源码/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "extra.json" })).toBeInTheDocument();
    expect(screen.getByLabelText("来源更新差异")).toHaveTextContent('+{"enabled":true}');
    expect(screen.queryByLabelText("DTS 源码")).not.toBeInTheDocument();
  });
  it("navigates distinct changes and preserves readable added and removed lines", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
    renderCanvas({ historyVersionId: "v1", historySource: "old source", unifiedDiffText: "--- working\n+++ history\n-old\n+new\n context\n+inserted" });
    expect(screen.getByText("2 处变更")).toBeInTheDocument();
    expect(screen.getByText("-old")).toHaveClass("is-removed");
    expect(screen.getByText("+new")).toHaveClass("is-added");
    const next = screen.getByRole("button", { name: "下一处变更" });
    fireEvent.click(next);
    expect(screen.getByText("第 1 / 2 处")).toBeInTheDocument();
    expect(screen.getByText("-old")).toHaveFocus();
    fireEvent.click(next);
    expect(screen.getByText("+inserted")).toHaveFocus();
    expect(next).toBeDisabled();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "上一处变更" }));
    expect(screen.getByText("-old")).toHaveFocus();
  });
  it("does not display a previous candidate when the URL selects none", () => {
    renderCanvas({ canvasMode: "candidate", candidateId: null, candidateSource: "previous candidate" });
    expect(screen.getByText("尚未选择来源更新")).toBeInTheDocument();
    expect(screen.queryByText("previous candidate")).not.toBeInTheDocument();
  });
  it("keeps a bounded diff notice and file headers out of change navigation", () => {
    renderCanvas({ historyVersionId: "v1", historySource: "old source",
      unifiedDiffText: "# 差异较大，以下按整块替换显示。\n--- 工作配置\n+++ 历史版本\n@@ -1,1 +1,1 @@\n-old\n+new" });
    expect(screen.getByText("1 处变更")).toBeInTheDocument();
    expect(screen.getByText("+++ 历史版本")).toHaveClass("is-header");
    expect(screen.getByText("+++ 历史版本")).not.toHaveAttribute("tabindex");
  });
  it("shows a unified diff for an available empty counterpart", () => {
    renderCanvas({ historyVersionId: "empty", historySourceAvailable: true, compareSource: "current",
      unifiedDiffText: "--- working\n+++ empty\n-current" });
    expect(screen.getByLabelText("统一差异对比")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "并排对比" })).not.toBeInTheDocument();
  });
  it("offers only one comparison action from history", () => {
    const props = renderCanvas({ canvasMode: "history", historyVersionId: "v1", historySource: "old" });
    fireEvent.click(screen.getByRole("button", { name: "对比" }));
    expect(props.onEnterCanvasMode).toHaveBeenCalledWith("unified-diff", "v1");
    expect(screen.queryByRole("button", { name: "统一差异" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "并排对比" })).not.toBeInTheDocument();
  });
  it("opens available version history without silently choosing a version", () => {
    const props = renderCanvas({ fileVersions: [{ id: "version" } as WorkbenchSourceCanvasProps["fileVersions"][number]], onSelectVersion: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "选择版本" }));
    expect(props.onSelectVersion).toHaveBeenCalledOnce();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
  });
  it.each([null, "removed"])("keeps the source updates entry outside the empty canvas (%s)", (candidateId) => {
    const props = renderCanvas({ canvasMode: "candidate", candidateId });
    expect(screen.queryByRole("button", { name: "上传候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新来源" })).not.toBeInTheDocument();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
  });
  it.each(["unified-diff", "candidate", "history"] as const)("keeps %s request failures distinct from absence", (canvasMode) => {
    renderCanvas({ canvasMode, modeSourceError: "网络连接失败" });
    expect(screen.getByRole("alert")).toHaveTextContent("源码读取失败");
    expect(screen.queryByText("选择要对比的版本")).not.toBeInTheDocument();
  });
  it("hides raw internal failures in historical source reads", () => {
    renderCanvas({ canvasMode: "history", modeSourceError: "Internal server error." });
    expect(screen.getByRole("alert")).toHaveTextContent("源码加载失败。");
    expect(screen.queryByText("Internal server error.")).not.toBeInTheDocument();
  });
  it.each(["unified-diff", "history"] as const)("retries the actual working-source failure in %s", (canvasMode) => {
    const props = renderCanvas({ canvasMode, sourceError: "工作源码暂不可用" });
    fireEvent.click(screen.getByRole("button", { name: "重试源码" }));
    expect(props.onSourceRetry).toHaveBeenCalledOnce();
    expect(props.onClearModeSourceError).not.toHaveBeenCalled();
  });
  it.each(["unified-diff"] as const)("recognizes two valid empty sources in %s", (canvasMode) => {
    renderCanvas({ canvasMode, historyVersionId: "empty", historySourceAvailable: true, source: "stale fallback", compareSource: "" });
    expect(screen.getByText("两个版本没有差异")).toBeInTheDocument();
  });
  it.each([null, "removed"])("explains an absent candidate %s without offering unauthorized upload", (candidateId) => {
    renderCanvas({ canvasMode: "candidate", candidateId });
    expect(screen.getByText("尚未选择来源更新")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("explains history after the first release", () => {
    renderCanvas({ canvasMode: "history" });
    expect(screen.getByText("暂无历史版本")).toBeInTheDocument();
    expect(screen.getByText("首次发布后，历史版本的只读源码会显示在这里。")).toBeInTheDocument();
  });
  it.each(["unified-diff"] as const)("explains identical %s instead of rendering a diff", (canvasMode) => {
    renderCanvas({ canvasMode, historyVersionId: "version", historySource: "working source", unifiedDiffText: "--- working\n+++ version\n working source" });
    expect(screen.getByText("两个版本没有差异")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^(统一差异对比|并排差异对比)$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回工作源" })).not.toBeInTheDocument();
  });
  it.each(["unified-diff"] as const)("recovers an unavailable %s counterpart explicitly", (canvasMode) => {
    const props = renderCanvas({ canvasMode, historyVersionId: "removed" });
    expect(screen.getByText("对比版本不可用")).toBeInTheDocument();
    expect(props.onExitSpecialCanvasMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回工作源" }));
    expect(props.onExitSpecialCanvasMode).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it.each(["unified-diff"] as const)("explains unselected %s without an unavailable action", (canvasMode) => {
    const props = renderCanvas({ canvasMode });
    expect(screen.getByText("选择要对比的版本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择版本" })).not.toBeInTheDocument();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
