import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchTaskDock, type WorkbenchTaskDockProps } from "./WorkbenchTaskDock";
import { WorkbenchSetupGate } from "./WorkbenchSetupGate";

afterEach(cleanup);

function renderDock(overrides: Partial<WorkbenchTaskDockProps> = {}) {
  const props: WorkbenchTaskDockProps = {
    tasksOpen: false, onTasksOpenChange: vi.fn(), sessionDraftRows: [], syncEvidence: "", canonicalSyncCheck: false,
    exportEvidence: "", syncConflicts: [],
    draftRecoveryStatus: "none", draftCopyFallbackRef: createRef(), draftCopyStatus: "", onCopySessionDrafts: vi.fn(),
    onReconfirmStaleDrafts: vi.fn(), selectedDraftKeys: new Set(), onToggleDraftKey: vi.fn(),
    submitReason: "", onSubmitReasonChange: vi.fn(), canEdit: true, onSubmitSelected: vi.fn(),
    submittingEdits: false, validateStatus: "", submitStatus: "", stagedDrafts: [], onSubmitReview: vi.fn(), submitError: "",
    projectId: "project", fileRepository: {} as WorkbenchTaskDockProps["fileRepository"], sourceWorkflowByFileId: {},
    sourceWorkflowLoading: false, onConflictsChange: vi.fn(), onLocateConflict: vi.fn(),
    ...overrides
  };
  const view = render(<WorkbenchTaskDock {...props} />);
  return { ...props, rerender: view.rerender };
}

describe("workbench tasks", () => {
  it("does not occupy space for an empty, healthy session", () => {
    renderDock();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
  it("does not render an empty panel just because it was opened", () => {
    renderDock({ tasksOpen: true });
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
  it("keeps operation results accessible without counting them as edits or adding empty sections", () => {
    renderDock({ tasksOpen: true, exportEvidence: "导出完成" });
    expect(screen.getByText("导出完成")).toBeInTheDocument();
    expect(screen.queryByText("本轮更改")).not.toBeInTheDocument();
    expect(screen.queryByText("会话变更")).not.toBeInTheDocument();
    expect(screen.queryByText("任务证据")).not.toBeInTheDocument();
    expect(screen.queryByText(/暂无同步/)).not.toBeInTheDocument();
  });
  it("dismisses both operation results through one action and removes an otherwise empty task area", () => {
    const props = renderDock({ tasksOpen: true, syncEvidence: "同步完成", exportEvidence: "导出完成", onDismissOperationResults: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "关闭操作结果" }));
    expect(props.onDismissOperationResults).toHaveBeenCalledOnce();
    props.rerender(<WorkbenchTaskDock {...props} syncEvidence="" exportEvidence="" />);
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
  it("keeps drafts, errors and conflicts after operation results are dismissed", () => {
    const props = renderDock({ tasksOpen: true, syncEvidence: "同步完成", exportEvidence: "导出完成", onDismissOperationResults: vi.fn(),
      submitError: "保存失败，请重试", showConflictArbitration: false,
      syncConflicts: [{ id: "conflict" } as WorkbenchTaskDockProps["syncConflicts"][number]],
      sessionDraftRows: [{ fileId: "file", nodePath: "/board", propertyName: "status", identity: "/board::status", key: "file::/board::status",
        beforeRawText: "okay", rawText: "disabled", normalizedValue: "disabled", startLine: 1, valid: true }] });
    fireEvent.click(screen.getByRole("button", { name: "关闭操作结果" }));
    props.rerender(<WorkbenchTaskDock {...props} syncEvidence="" exportEvidence="" />);
    expect(screen.getByRole("list", { name: "会话变更列表" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.getByRole("button", { name: "任务" })).toHaveTextContent(/冲突\s*1/);
    expect(screen.queryByRole("button", { name: "关闭操作结果" })).not.toBeInTheDocument();
  });
  it("offers one discard action for a single edit and preserves the review step", () => {
    const props = renderDock({ tasksOpen: true, onDiscardDraft: vi.fn(), onDiscardAllDrafts: vi.fn(), selectedDraftKeys: new Set(["file::/board::status"]),
      sessionDraftRows: [{ fileId: "file", nodePath: "/board", propertyName: "status", identity: "/board::status", key: "file::/board::status",
        beforeRawText: "okay", rawText: "disabled", normalizedValue: "disabled", startLine: 1, valid: true }] });
    fireEvent.click(screen.getByRole("button", { name: "撤销 /board/status" }));
    expect(props.onDiscardDraft).toHaveBeenCalledWith("file::/board::status");
    expect(screen.queryByRole("button", { name: "全部撤销" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校验所选" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存为待审核草稿（1）" }));
    expect(props.onSubmitSelected).toHaveBeenCalledOnce();
    expect(props.onSubmitReview).not.toHaveBeenCalled();
  });
  it("offers complete discard for multiple edits", () => {
    const rows: WorkbenchTaskDockProps["sessionDraftRows"] = ["status", "model"].map((propertyName) => ({
      fileId: "file", nodePath: "/board", propertyName, identity: `/board::${propertyName}`, key: `file::/board::${propertyName}`,
      beforeRawText: "old", rawText: "new", normalizedValue: "new", startLine: 1, valid: true
    }));
    const props = renderDock({ tasksOpen: true, sessionDraftRows: rows, onDiscardAllDrafts: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "全部撤销" }));
    expect(props.onDiscardAllDrafts).toHaveBeenCalledOnce();
  });
  it("summarizes long arrays and locates the original parameter without dropping storage warnings", () => {
    const values = Array.from({ length: 200 }, (_, index) => index);
    const changed = [...values]; changed[120] = 300;
    const row = { fileId: "file", nodePath: "/board", propertyName: "array", identity: "/board::array", key: "file::/board::array",
      beforeRawText: `<${values.join(" ")}>`, rawText: `<${changed.join(" ")}>`, normalizedValue: "", startLine: 1, valid: true };
    const props = renderDock({ tasksOpen: true, sessionDraftRows: [row], onLocateDraft: vi.fn(), storageError: "修改仅当前页面保留" });
    expect(screen.getByText("1 项取值变更")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("修改仅当前页面保留");
    fireEvent.click(screen.getByRole("button", { name: "编辑 /board/array" }));
    expect(props.onLocateDraft).toHaveBeenCalledWith(row);
    expect(screen.queryByText(row.rawText)).not.toBeInTheDocument();
  });
  it("keeps staged receipt identities in one disclosure and preserves the submission handoff", async () => {
    const props = renderDock({ tasksOpen: true, submitStatus: "已暂存 1 项待审核草稿；当前值未变。", stagedDrafts: [{ key: "file::/board::status", draftId: "draft-1",
      bindingId: "binding-1", currentValueId: "value-1", pending: true }] });
    const receipt = screen.getByRole("region", { name: "待审核草稿回执" });
    expect(screen.getAllByText(/当前值未变/)).toHaveLength(1);
    expect(receipt).toHaveTextContent("提交审核并获通过后生效");
    expect(screen.queryByText(/已暂存/)).not.toBeInTheDocument();
    expect(receipt).not.toHaveTextContent("draft-1");
    fireEvent.click(screen.getByText("溯源信息", { exact: true }));
    expect(await screen.findByLabelText("完整溯源数据")).toHaveTextContent("draft-1");
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("binding-1");
    expect(screen.getByLabelText("完整溯源数据")).toHaveTextContent("value-1");
    expect(screen.getAllByRole("button", { name: "复制完整技术数据" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "前往提交审核" }));
    expect(props.onSubmitReview).toHaveBeenCalledOnce();
  });
  it("explains automatic save validation while protecting stale drafts", () => {
    const props = renderDock({ tasksOpen: true, draftRecoveryStatus: "stale-base", selectedDraftKeys: new Set(["file::/board::status"]),
      sessionDraftRows: [{ fileId: "file", nodePath: "/board", propertyName: "status", identity: "/board::status", key: "file::/board::status",
        beforeRawText: "okay", rawText: "disabled", normalizedValue: "disabled", startLine: 1, valid: true }] });
    expect(screen.getByRole("status")).toHaveTextContent("保存时会自动校验");
    expect(screen.getByRole("button", { name: "保存为待审核草稿（1）" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "基于当前基线继续编辑" }));
    expect(props.onReconfirmStaleDrafts).toHaveBeenCalledOnce();
    expect(props.onSubmitSelected).not.toHaveBeenCalled();
  });
  it.each([true, false])("retains conflict counts and protected arbitration without a duplicate navigation action (embedded=%s)", (showConflictArbitration) => {
    renderDock({ tasksOpen: true, showConflictArbitration, syncConflicts: [{
      id: "conflict", organizationId: "org", projectId: "project", projectParameterValueId: "value", parameterDefinitionId: "definition",
      fileId: "file", fileVersionId: "version", fileDraftId: "file-draft", uiDraftId: "ui-draft", fileValue: "file-value",
      uiDraftValue: "ui-value", status: "open", createdAt: "2026-10-17T00:00:00Z"
    }] });
    expect(screen.getByRole("button", { name: "任务" })).toHaveTextContent(/冲突\s*1/);
    expect(screen.queryByRole("button", { name: /处理.*项冲突/ })).not.toBeInTheDocument();
    if (showConflictArbitration) {
      expect(screen.getByRole("region", { name: "冲突仲裁" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "使用文件值" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "保留界面值" })).toBeDisabled();
    } else {
      expect(screen.queryByRole("region", { name: "冲突仲裁" })).not.toBeInTheDocument();
    }
  });
  it("offers a direct setup action only to administrators", () => {
    const onCreateConfigSet = vi.fn();
    const props = { configSetsLoading: false, configSetsError: "", onConfigSetsRetry: vi.fn(), selectedConfigSet: null, onCreateConfigSet };
    const { rerender } = render(<WorkbenchSetupGate {...props} canAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "新建配置" }));
    expect(onCreateConfigSet).toHaveBeenCalledOnce();
    rerender(<WorkbenchSetupGate {...props} canAdmin={false} />);
    expect(screen.queryByRole("button", { name: "新建配置" })).not.toBeInTheDocument();
  });
});
