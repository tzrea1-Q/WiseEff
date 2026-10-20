import type { ReactNode } from "react";

import type {
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsRestorePreviewResult
} from "@/application/ports/DtsStructuredRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
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
  onConfirmRestore: () => void;
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
  onCancelLeave,
  onConfirmLeave,
  confirmation,
  onCancelConfirmation,
  onConfirmConfirmation,
  releaseRequiresConfirmation = false
}: WorkbenchBaselineDialogsProps) {
  const restoreBlockedReason = baselineRestoreBlockedReason(restorePreview, selectedBaselineId);
  const restoreDescription = (
    <div>
      {restorePreview && restorePreview.baselineId === selectedBaselineId
        ? formatRestorePreviewDescription(
            baselines.find((item) => item.id === selectedBaselineId)?.name ?? selectedBaselineId,
            restorePreview.members,
            restorePreview.releasedBaselineUnchanged,
            Boolean(restoreBlockedReason)
          )
        : "正在准备恢复预览…"}
      {restoreBlockedReason ? <p role="note">{restoreBlockedReason}</p> : null}
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
        onCancel={onCancelRestore}
        onConfirm={onConfirmRestore}
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
