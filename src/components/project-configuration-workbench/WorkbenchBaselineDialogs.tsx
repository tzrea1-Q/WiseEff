import { useRef, useState, type ReactNode } from "react";

import type {
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsRestorePreviewResult
} from "@/application/ports/DtsStructuredRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/common/SelectControl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  onKeepDraftsAndLeave: () => void;
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
  onKeepDraftsAndLeave,
  confirmation,
  onCancelConfirmation,
  onConfirmConfirmation,
  releaseRequiresConfirmation = false
}: WorkbenchBaselineDialogsProps) {
  const keepDraftsRef = useRef<HTMLButtonElement>(null);
  const [restoreReason, setRestoreReason] = useState({ baselineId: selectedBaselineId,value: "" });
  const reason = restoreReason.baselineId === selectedBaselineId ? restoreReason.value : "";
  const canonical = restorePreview?.canonical;
  const restoreBlockedReason = baselineRestoreBlockedReason(restorePreview, selectedBaselineId);
  const restoreDescription = (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      {canonical ? <>
        <p>整套恢复将原子生成新的工作配置及参数来源记录；原快照和正式版本保持不变。</p>
        {canonical.sharedDependencies?.length ? <>
          <p>恢复项目快照会恢复历史项目差异；仅切换依赖版本会保留当前项目差异。后加成员按预览保留。</p>
          <Table aria-label="恢复后的共享依赖"><TableHeader><TableRow><TableHead>共享资源</TableHead><TableHead>固定版本</TableHead><TableHead>挂载目录</TableHead></TableRow></TableHeader>
            <TableBody>{canonical.sharedDependencies.map((resource) => <TableRow key={resource.resourceId}><TableCell className="whitespace-normal [overflow-wrap:anywhere]">{resource.name}</TableCell>
              <TableCell>{resource.beforeVersion === null ? "未引用" : `v${resource.beforeVersion}`} → v{resource.targetVersion}</TableCell><TableCell className="whitespace-normal [overflow-wrap:anywhere]">{resource.mountPath || "根目录"}</TableCell></TableRow>)}</TableBody></Table>
        </> : null}
        {canonical.entryFile ? <p>入口：{canonical.entryFile}；include 路径：{canonical.includeSearchPaths.join("、")}；overlay 顺序：{canonical.overlayOrder.join(" → ") || "无"}。</p> : null}
        {canonical.members.length ? <Table aria-label="恢复后的成员组成"><TableHeader><TableRow><TableHead>文件</TableHead><TableHead>目标版本</TableHead><TableHead>用途 / 顺序</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
          <TableBody>{canonical.members.map((member) => <TableRow key={member.fileId}><TableCell className="whitespace-normal [overflow-wrap:anywhere]">{member.fileName}</TableCell><TableCell>v{member.versionNumber}</TableCell><TableCell>{({ base: "基础",overlay: "覆盖层",include: "包含文件",charging: "充电",thermal: "温控",misc: "其他" } as Record<string,string>)[member.role] ?? member.role} / {member.sortOrder}</TableCell>
            <TableCell>{{ restore: "恢复版本",reattach: "补回成员", "retain-added": "保留新增成员",unchanged: "保持" }[member.action]}{member.compositionChanged ? "（组成变化）" : ""}</TableCell></TableRow>)}</TableBody></Table> : null}
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
      {sessionDraftsDirty ? <p role="alert">还有未保存的本地修改，请先保存或撤销后恢复。</p> : null}
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
        className={canonical ? "workbench-baseline-restore-dialog" : undefined}
        title="恢复版本确认"
        description={restoreDescription}
        confirmLabel="确认恢复"
        cancelLabel="取消"
        pending={pendingAction === "restore-baseline"}
        pendingLabel="恢复中…"
        tone="danger"
        confirmDisabled={sessionDraftsDirty || Boolean(canonical && !reason.trim())}
        acknowledgement={canonical?.requiresCompositionConfirmation ? "我确认上述成员归属、用途、顺序及 include/overlay 组成变化。" : undefined}
        extra={canonical ? <label>恢复原因<Input aria-label="恢复原因" value={reason} disabled={pendingAction === "restore-baseline"}
          onChange={(event) => setRestoreReason({ baselineId: selectedBaselineId,value: event.target.value })} /></label> : undefined}
        onCancel={onCancelRestore}
        onConfirm={() => canonical ? onConfirmRestore({ reason: reason.trim(),confirmCompositionChanges: canonical.requiresCompositionConfirmation }) : onConfirmRestore()}
      />}

      <ModalDialog
        open={leaveOpen}
        className="confirm-dialog governance-confirm-dialog"
        backdropClassName="param-admin-modal-backdrop"
        initialFocusRef={keepDraftsRef}
        onDismiss={leavePending ? undefined : onCancelLeave}
        describedBy
      >
        {({ titleId, descriptionId }) => <>
          <h2 id={titleId}>离开配置工作台</h2>
          <div className="confirm-dialog__scroll">
            <p id={descriptionId}>还有未保存的修改。保留草稿后，返回本页可继续编辑。</p>
            {leaveError ? <p role="alert">{leaveError}</p> : null}
          </div>
          <div className="dialog-actions">
            <Button variant="outline" disabled={leavePending} onClick={onCancelLeave}>留在本页</Button>
            <Button variant="destructive" disabled={leavePending} onClick={onConfirmLeave}>丢弃并离开</Button>
            <Button ref={keepDraftsRef} disabled={leavePending} onClick={onKeepDraftsAndLeave}>{leavePending ? "处理中…" : "保留草稿并离开"}</Button>
          </div>
        </>}
      </ModalDialog>

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
