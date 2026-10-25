import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchBaselineDialogs } from "./WorkbenchBaselineDialogs";

afterEach(() => cleanup());

function renderDialogs(overrides: Partial<Parameters<typeof WorkbenchBaselineDialogs>[0]> = {}) {
  return render(
    <WorkbenchBaselineDialogs
      createOpen={false}
      releaseOpen={false}
      restoreOpen={false}
      leaveOpen={false}
      sessionDraftsDirty={false}
      baselineActionError=""
      newBaselineName=""
      onNewBaselineNameChange={vi.fn()}
      pendingAction={null}
      releaseReadiness={null}
      acknowledgedWarningIds={new Set()}
      restorePreview={null}
      selectedBaselineId="bl-1"
      baselines={[]}
      onCancelCreate={vi.fn()}
      onConfirmCreate={vi.fn()}
      onCancelRelease={vi.fn()}
      onConfirmRelease={vi.fn()}
      onCancelRestore={vi.fn()}
      onConfirmRestore={vi.fn()}
      onCancelLeave={vi.fn()}
      onConfirmLeave={vi.fn()}
      onKeepDraftsAndLeave={vi.fn()}
      confirmation={null}
      onCancelConfirmation={vi.fn()}
      onConfirmConfirmation={vi.fn()}
      {...overrides}
    />
  );
}

describe("WorkbenchBaselineDialogs", () => {
  it("defaults to keeping drafts and keeps discard and cancel separate", () => {
    const keep = vi.fn(), discard = vi.fn(), cancel = vi.fn();
    renderDialogs({ leaveOpen: true, onKeepDraftsAndLeave: keep, onConfirmLeave: discard, onCancelLeave: cancel });
    const primary = screen.getByRole("button", { name: "保留草稿并离开" });
    expect(primary).toHaveAttribute("data-variant", "default");
    expect(primary).toHaveFocus();
    fireEvent.click(primary); expect(keep).toHaveBeenCalledOnce(); expect(discard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "留在本页" })); expect(cancel).toHaveBeenCalledOnce();
    const destructive = screen.getByRole("button", { name: "丢弃并离开" });
    expect(destructive).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(destructive); expect(discard).toHaveBeenCalledOnce();
  });
  it("shows the complete Canonical restore plan and requires a reason and explicit membership confirmation", () => {
    const onConfirmRestore = vi.fn();
    renderDialogs({ restoreOpen: true,onConfirmRestore,restorePreview: {
      baselineId: "bl-1",configSetId: "cs-1",releasedBaselineUnchanged: true,driftedCount: 1,members: [],
      canonical: { canRestore: true,proofToken: "proof",sourceConfigRevisionId: "revision",missingInformation: [],historicalRevisions: [],
        editorHref: "/configuration",requiresCompositionConfirmation: true,entryFile: "board.dts",includeSearchPaths: ["."],overlayOrder: [],
        sharedDependencies: [{ resourceId: "resource",name: "电源默认值",beforeVersion: 2,targetVersion: 1,mountPath: "vendor/power" }],
        members: [{ fileId: "f1",fileName: "board.dts",fromVersionId: "v2",toVersionId: "v1",versionNumber: 1,role: "base",sortOrder: 0,action: "reattach",compositionChanged: true },
          { fileId: "f2",fileName: "added.json",fromVersionId: "v3",toVersionId: "v3",versionNumber: 1,role: "misc",sortOrder: 1,action: "retain-added",compositionChanged: false }],
        impact: { parameterChanges: 1,retainedBindings: 2,restoredBindings: 1,sourceReplacements: 0 } }
    } });
    const dialog = screen.getByRole("dialog",{ name: "恢复版本确认" });
    expect(dialog).toHaveTextContent("added.json"); expect(dialog).toHaveTextContent("保留新增成员");
    expect(dialog).toHaveTextContent("恢复项目快照会恢复历史项目差异");
    expect(dialog).toHaveTextContent("仅切换依赖版本会保留当前项目差异");
    expect(within(dialog).getByRole("table",{ name: "恢复后的共享依赖" })).toHaveTextContent("电源默认值v2 → v1vendor/power");
    const confirm = within(dialog).getByRole("button",{ name: "确认恢复" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox",{ name: "恢复原因" }),{ target: { value: "恢复验收配置" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(confirm);
    expect(onConfirmRestore).toHaveBeenCalledWith({ reason: "恢复验收配置",confirmCompositionChanges: true });
  });
  it("requires a nonblank version name before saving a snapshot", () => {
    renderDialogs({ createOpen: true, newBaselineName: "   " });
    const dialog = screen.getByRole("dialog", { name: "保存版本快照" });
    expect(within(dialog).getByRole("button", { name: "保存版本快照" })).toBeDisabled();
  });

  it("names a whole-configuration snapshot clearly and preserves the entered version name", () => {
    const onNewBaselineNameChange = vi.fn();
    renderDialogs({ createOpen: true, newBaselineName: "量产 1.0", onNewBaselineNameChange });
    const dialog = screen.getByRole("dialog", { name: "保存版本快照" });
    expect(dialog).toHaveTextContent("保存当前整套配置的文件及版本组合");
    const input = within(dialog).getByRole("textbox", { name: "版本名称" });
    expect(input).toHaveValue("量产 1.0");
    fireEvent.change(input, { target: { value: "量产 1.1" } });
    expect(onNewBaselineNameChange).toHaveBeenCalledWith("量产 1.1");
  });

  it("keeps canonical drift visible but replaces restore confirmation with a source-transaction explanation", () => {
    renderDialogs({
      restoreOpen: true,
      restorePreview: {
        baselineId: "bl-1", configSetId: "cs-1", releasedBaselineUnchanged: true, driftedCount: 1,
        members: [{ fileId: "f1", fileName: "board.dts", canonicalOwned: true, fromVersionId: "v2",
          fromVersionNumber: 2, toVersionId: "v1", toVersionNumber: 1, action: "rollback-pointer" }]
      }
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("board.dts");
    expect(dialog).toHaveTextContent("v2 → v1");
    expect(dialog).toHaveTextContent("已准备并批准的规范源事务");
    expect(within(dialog).queryByRole("button", { name: "确认恢复" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeEnabled();
  });

  it("keeps legacy source restore confirmation enabled", () => {
    const onConfirmRestore = vi.fn();
    renderDialogs({
      restoreOpen: true, onConfirmRestore,
      restorePreview: {
        baselineId: "bl-1", configSetId: "cs-1", releasedBaselineUnchanged: true, driftedCount: 1,
        members: [{ fileId: "f1", canonicalOwned: false, fromVersionId: "v2", fromVersionNumber: 2,
          toVersionId: "v1", toVersionNumber: 1, action: "rollback-pointer" }]
      }
    });
    const confirm = screen.getByRole("button", { name: "确认恢复" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirmRestore).toHaveBeenCalledOnce();
  });

  it("renders the action error inside the open restore confirmation dialog", () => {
    renderDialogs({
      restoreOpen: true,
      baselineActionError: "恢复版本失败：请求超时"
    });

    const dialog = screen.getByRole("dialog", { name: "恢复版本预览" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("恢复版本失败：请求超时");
  });

  it("renders the action error inside the open release confirmation dialog", () => {
    renderDialogs({
      releaseOpen: true,
      baselineActionError: "检查结果已变化，请重新查看版本检查问题后再操作。"
    });

    const dialog = screen.getByRole("dialog", { name: "设为正式版本确认" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("检查结果已变化");
  });

  it("blocks release confirm until the revision-gate acknowledgement is ticked", () => {
    renderDialogs({
      releaseOpen: true,
      releaseRequiresConfirmation: true
    });

    const dialog = screen.getByRole("dialog", { name: "设为正式版本确认" });
    const confirm = within(dialog).getByRole("button", { name: "确认设为正式版本" });
    const acknowledgement = within(dialog).getByRole("checkbox", {
      name: "我已了解修订校验未硬性通过的风险，确认继续设为正式版本。"
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(acknowledgement);
    expect(confirm).toBeEnabled();
  });
});
