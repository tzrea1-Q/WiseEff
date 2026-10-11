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
  it("does not display a previous candidate when the URL selects none", () => {
    renderCanvas({ canvasMode: "candidate", candidateId: null, candidateSource: "previous candidate" });
    expect(screen.getByText("暂无上传的候选")).toBeInTheDocument();
    expect(screen.queryByText("previous candidate")).not.toBeInTheDocument();
  });
  it("shows side-by-side content for an available empty counterpart", () => {
    renderCanvas({ canvasMode: "side-by-side", historyVersionId: "empty", historySourceAvailable: true });
    expect(screen.getByLabelText("并排差异对比")).toBeInTheDocument();
  });
  it("opens available version history without silently choosing a version", () => {
    const props = renderCanvas({ fileVersions: [{ id: "version" } as WorkbenchSourceCanvasProps["fileVersions"][number]], onSelectVersion: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "选择版本" }));
    expect(props.onSelectVersion).toHaveBeenCalledOnce();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
  });
  it.each([null, "removed"])("opens the authorized candidate upload entry (%s)", (candidateId) => {
    const props = renderCanvas({ canvasMode: "candidate", candidateId, onUploadCandidate: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "上传候选" }));
    expect(props.onUploadCandidate).toHaveBeenCalledOnce();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
  });
  it.each(["unified-diff", "side-by-side", "candidate", "history"] as const)("keeps %s request failures distinct from absence", (canvasMode) => {
    renderCanvas({ canvasMode, modeSourceError: "网络连接失败" });
    expect(screen.getByRole("alert")).toHaveTextContent("源码读取失败");
    expect(screen.queryByText("选择要对比的版本")).not.toBeInTheDocument();
  });
  it.each(["unified-diff", "side-by-side"] as const)("recognizes two valid empty sources in %s", (canvasMode) => {
    renderCanvas({ canvasMode, historyVersionId: "empty", historySourceAvailable: true, source: "stale fallback", compareSource: "" });
    expect(screen.getByText("两个版本没有差异")).toBeInTheDocument();
  });
  it.each([null, "removed"])("explains an absent candidate %s without offering unauthorized upload", (candidateId) => {
    renderCanvas({ canvasMode: "candidate", candidateId });
    expect(screen.getByText("暂无上传的候选")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("explains history after the first release", () => {
    renderCanvas({ canvasMode: "history" });
    expect(screen.getByText("暂无历史版本")).toBeInTheDocument();
    expect(screen.getByText("首次发布后，历史版本的只读源码会显示在这里。")).toBeInTheDocument();
  });
  it.each(["unified-diff", "side-by-side"] as const)("explains identical %s instead of rendering a diff", (canvasMode) => {
    renderCanvas({ canvasMode, historyVersionId: "version", historySource: "working source", unifiedDiffText: "--- working\n+++ version\n working source" });
    expect(screen.getByText("两个版本没有差异")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^(统一差异对比|并排差异对比)$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回工作源" })).not.toBeInTheDocument();
  });
  it.each(["unified-diff", "side-by-side"] as const)("recovers an unavailable %s counterpart explicitly", (canvasMode) => {
    const props = renderCanvas({ canvasMode, historyVersionId: "removed" });
    expect(screen.getByText("对比版本不可用")).toBeInTheDocument();
    expect(props.onExitSpecialCanvasMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回工作源" }));
    expect(props.onExitSpecialCanvasMode).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it.each(["unified-diff", "side-by-side"] as const)("explains unselected %s without an unavailable action", (canvasMode) => {
    const props = renderCanvas({ canvasMode });
    expect(screen.getByText("选择要对比的版本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择版本" })).not.toBeInTheDocument();
    expect(props.onEnterCanvasMode).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
