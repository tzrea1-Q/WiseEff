import { useState, type ReactNode } from "react";

import type {
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsRestorePreviewResult
} from "@/application/ports/DtsStructuredRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/common/SelectControl";
import { baselineRestoreBlockedReason } from "@/application/project-configuration/releaseBaselineSession";
import { formatRestorePreviewDescription } from "./WorkbenchBaselineDock";

export type WorkbenchBaselineDialogsProps = {
  createOpen: boolean;
  releaseOpen: boolean;
  restoreOpen: boolean;
  leaveOpen: boolean;
  leaveError?: string;
  leavePending?: boolean;
  sessionDraftsDirty: boolean;
  baselineActionError: string;
  newBaselineName: string;
  onNewBaselineNameChange: (value: string) => void;
  pendingAction: string | null;
  releaseReadiness: DtsReleaseReadiness | null;
  acknowledgedWarningIds: ReadonlySet<string>;
  restorePreview: DtsRestorePreviewResult | null;
  selectedBaselineId: string | null;
  baselines: DtsReleaseBaseline[];
  onCancelCreate: () => void;
  onConfirmCreate: () => void;
  onCancelRelease: () => void;
  onConfirmRelease: () => void;
  onCancelRestore: () => void;
  onConfirmRestore: (input?: { reason: string; confirmCompositionChanges: boolean }) => void;
  onRefreshRestorePreview?: (sourceConfigRevisionId?: string) => void;
  onCancelLeave: () => void;
  onConfirmLeave: () => void;
  confirmation: {
    key: string;
    title: string;
    description: ReactNode;
    confirmLabel: string;
    pendingLabel?: string;
    tone: "primary" | "danger";
  } | null;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  /** Soft-pass revision gate: ConfirmDialog acknowledgement before release. */
  releaseRequiresConfirmation?: boolean;
};

export function WorkbenchBaselineDialogs({
  createOpen,
  releaseOpen,
  restoreOpen,
  leaveOpen,
  leaveError,
  leavePending,
  sessionDraftsDirty,
  baselineActionError,
  newBaselineName,
  onNewBaselineNameChange,
  pendingAction,
  releaseReadiness,
  acknowledgedWarningIds,
  restorePreview,
  selectedBaselineId,
  baselines,
  onCancelCreate,
  onConfirmCreate,
  onCancelRelease,
  onConfirmRelease,
  onCancelRestore,
  onConfirmRestore,
  onRefreshRestorePreview,
  onCancelLeave,
  onConfirmLeave,
  confirmation,
  onCancelConfirmation,
  onConfirmConfirmation,
  releaseRequiresConfirmation = false
}: WorkbenchBaselineDialogsProps) {
  const [restoreReason, setRestoreReason] = useState({ baselineId: selectedBaselineId,value: "" });
  const reason = restoreReason.baselineId === selectedBaselineId ? restoreReason.value : "";
  const canonical = restorePreview?.canonical;
  const restoreBlockedReason = baselineRestoreBlockedReason(restorePreview, selectedBaselineId);
  const restoreDescription = (
    <div>
      {canonical ? <>
        <p>整套恢复将原子生成新的工作配置及参数来源记录；原快照和正式版本保持不变。</p>
        {canonical.entryFile ? <p>入口：{canonical.entryFile}；include 路径：{canonical.includeSearchPaths.join("、")}；overlay 顺序：{canonical.overlayOrder.join(" → ") || "无"}。</p> : null}
        {canonical.members.length ? <table><caption>恢复后的成员组成</caption><thead><tr><th>文件</th><th>目标版本</th><th>用途 / 顺序</th><th>操作</th></tr></thead>
          <tbody>{canonical.members.map((member) => <tr key={member.fileId}><td>{member.fileName}</td><td>v{member.versionNumber}</td><td>{member.role} / {member.sortOrder}</td>
            <td>{{ restore: "恢复版本",reattach: "补回成员", "retain-added": "保留新增成员",unchanged: "保持" }[member.action]}{member.compositionChanged ? "（组成变化）" : ""}</td></tr>)}</tbody></table> : null}
        {canonical.canRestore ? <p>参数变化：{canonical.impact.parameterChanges}；保留参数：{canonical.impact.retainedBindings}；恢复参数：{canonical.impact.restoredBindings}；来源转移：{canonical.impact.sourceReplacements}。</p> : null}
        {canonical.missingInformation.map((message) => <p key={message}>{message}</p>)}
        {!canonical.canRestore && canonical.historicalRevisions.length > 0 && onRefreshRestorePreview ? <label>实际历史配置修订<SelectControl
          ariaLabel="实际历史配置修订" value={canonical.sourceConfigRevisionId ?? ""} placeholder="明确选择匹配的历史组成"
          options={canonical.historicalRevisions.map((row) => ({ value: row.id,label: `配置修订 ${row.revisionNumber}` }))}
          onValueChange={(id) => onRefreshRestorePreview(id)} /></label> : null}
        <a href={canonical.editorHref}>进入配置编辑器</a>
        {onRefreshRestorePreview ? <button type="button" className="button subtle" disabled={pendingAction === "restore-baseline"}
          onClick={() => onRefreshRestorePreview(canonical.sourceConfigRevisionId)}>重新预览</button> : null}
      </> : restorePreview && restorePreview.baselineId === selectedBaselineId
        ? formatRestorePreviewDescription(
            baselines.find((item) => item.id === selectedBaselineId)?.name ?? selectedBaselineId,
            restorePreview.members,
            restorePreview.releasedBaselineUnchanged,
            Boolean(restoreBlockedReason)
          )
        : "正在准备恢复预览…"}
      {restoreBlockedReason && !canonical ? <p role="note">{restoreBlockedReason}</p> : null}
      {baselineActionError ? <p role="alert">{baselineActionError}</p> : null}
    </div>
  );
  return (
    <>
      <ConfirmDialog
        open={createOpen}
        title="保存版本快照"
        description={
          <div>
            <p>保存当前整套配置的文件及版本组合，供后续对比和定版。</p>
            {sessionDraftsDirty ? (
              <p role="alert">还有未保存的本机会话变更；请先提交或丢弃后再保存版本快照。</p>
            ) : null}
            {baselineActionError ? <p role="alert">{baselineActionError}</p> : null}
            <label>
              <span>版本名称</span>
              <Input
                aria-label="版本名称"
                placeholder="例如：量产 1.0"
                disabled={pendingAction === "create-baseline"}
                value={newBaselineName}
                onChange={(event) => onNewBaselineNameChange(event.target.value)}
              />
            </label>
          </div>
        }
        confirmLabel="保存版本快照"
        confirmDisabled={!newBaselineName.trim() || sessionDraftsDirty}
        cancelLabel="取消"
        pending={pendingAction === "create-baseline"}
        pendingLabel="保存中…"
        tone="primary"
        onCancel={onCancelCreate}
        onConfirm={onConfirmCreate}
      />

      <ConfirmDialog
        open={releaseOpen}
        title="设为正式版本确认"
        description={
          <div>
            <p>
              将选中快照设为此配置的正式版本，原正式版本保留在历史记录中。此操作只在平台内定版，不向设备下发文件。
            </p>
            {releaseReadiness?.warnings
              .filter((item) => item.acknowledgementRequired)
              .map((item) => (
                <p key={item.id} role="note">
                  警告：{item.message}
                  {acknowledgedWarningIds.has(item.id) ? "（已确认）" : "（待确认）"}
                </p>
              ))}
            {baselineActionError ? <p role="alert">{baselineActionError}</p> : null}
          </div>
        }
        confirmLabel="确认设为正式版本"
        cancelLabel="取消"
        pending={pendingAction === "release-baseline"}
        pendingLabel="设置中…"
        tone="danger"
        acknowledgement={
          releaseRequiresConfirmation
            ? "我已了解修订校验未硬性通过的风险，确认继续设为正式版本。"
            : undefined
        }
        onCancel={onCancelRelease}
        onConfirm={onConfirmRelease}
      />

      {restoreBlockedReason ? (
        <ModalDialog
          open={restoreOpen}
          onDismiss={onCancelRestore}
          className="confirm-dialog governance-confirm-dialog"
          backdropClassName="param-admin-modal-backdrop"
          describedBy
        >
          {({ titleId, descriptionId }) => (
            <>
              <h2 id={titleId}>恢复版本预览</h2>
              <div className="confirm-dialog__scroll" id={descriptionId}>{restoreDescription}</div>
              <div className="dialog-actions">
                <button className="button subtle" type="button" onClick={onCancelRestore}>关闭</button>
              </div>
            </>
          )}
        </ModalDialog>
      ) : <ConfirmDialog
        open={restoreOpen}
        title="恢复版本确认"
        description={restoreDescription}
        confirmLabel="确认恢复"
        cancelLabel="取消"
        pending={pendingAction === "restore-baseline"}
        pendingLabel="恢复中…"
        tone="danger"
        confirmDisabled={Boolean(canonical && !reason.trim())}
        acknowledgement={canonical?.requiresCompositionConfirmation ? "我确认上述成员的归属、用途及顺序变化。" : undefined}
        extra={canonical ? <label>恢复原因<Input aria-label="恢复原因" value={reason} disabled={pendingAction === "restore-baseline"}
          onChange={(event) => setRestoreReason({ baselineId: selectedBaselineId,value: event.target.value })} /></label> : undefined}
        onCancel={onCancelRestore}
        onConfirm={() => canonical ? onConfirmRestore({ reason: reason.trim(),confirmCompositionChanges: canonical.requiresCompositionConfirmation }) : onConfirmRestore()}
      />}

      <ConfirmDialog
        open={leaveOpen}
        title="离开配置工作台"
        description={
          <>
            <p>还有未提交的会话变更。离开将丢弃本机可恢复草稿；若仅想稍后继续，请留在本页或先复制草稿。</p>
            {leaveError ? <p role="alert">{leaveError}</p> : null}
          </>
        }
        confirmLabel="丢弃并离开"
        cancelLabel="留在本页"
        pending={leavePending}
        tone="danger"
        onCancel={onCancelLeave}
        onConfirm={onConfirmLeave}
      />

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? null}
        confirmLabel={confirmation?.confirmLabel ?? "确认"}
        pending={pendingAction === confirmation?.key}
        pendingLabel={confirmation?.pendingLabel}
        tone={confirmation?.tone ?? "primary"}
        onCancel={onCancelConfirmation}
        onConfirm={onConfirmConfirmation}
      />
    </>
  );
}
