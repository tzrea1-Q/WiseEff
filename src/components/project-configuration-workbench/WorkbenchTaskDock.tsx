import type { RefObject } from "react";

import type {
  ParameterFileRepository,
  ParameterFileSourceWorkflow,
  ParameterFileSyncConflict
} from "@/application/ports/ParameterFileRepository";
import type { SessionDraftRow } from "@/application/project-configuration/sessionDrafts";
import type { StagedStructuredDraft, StructuredEditRecoveryStatus } from "@/application/project-configuration/structuredEditSession";
import { WorkbenchConflictArbitrationDock } from "./WorkbenchConflictArbitrationDock";
import { ReviewProvenance } from "@/features/parameter-review/ReviewProvenance";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";

function draftSummary(row: SessionDraftRow): string {
  if (row.present === false) return "将删除属性";
  if (row.valid === false) return row.error || "输入待修正";
  try {
    const before = parseDtsValue(row.propertyName, row.beforeRawText).value;
    const after = parseDtsValue(row.propertyName, row.rawText).value;
    const items = (value: typeof before): string[] | null => value.kind === "strings" ? value.values
      : value.kind === "cells" ? value.groups.flat().map((cell) => cell.kind === "integer" ? cell.value : `&${cell.label}`)
        : value.kind === "bytes" ? value.values.map(String) : null;
    const left = items(before); const right = items(after);
    if (left && right && Math.max(left.length, right.length) > 3) {
      const unit = "项";
      return left.length === right.length ? `${right.filter((value, index) => value !== left[index]).length} ${unit}取值变更`
        : `原 ${left.length} ${unit} → 新 ${right.length} ${unit}`;
    }
  } catch { /* Incomplete input stays available in the editor. */ }
  const text = `${row.beforeRawText || "空值"} → ${row.rawText || "空值"}`;
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export type WorkbenchTaskDockProps = {
  tasksOpen: boolean;
  onTasksOpenChange: (open: boolean) => void;
  sessionDraftRows: SessionDraftRow[];
  storageError?: string;
  onLocateDraft?: (row: SessionDraftRow) => void;
  syncEvidence: string;
  canonicalSyncCheck: boolean;
  exportEvidence: string;
  onDismissOperationResults?: () => void;
  syncConflicts: ParameterFileSyncConflict[];
  autoLocateConflicts?: boolean;
  showConflictArbitration?: boolean;
  draftRecoveryStatus: StructuredEditRecoveryStatus;
  draftCopyFallbackRef: RefObject<HTMLTextAreaElement | null>;
  draftCopyStatus: string;
  onCopySessionDrafts: () => void;
  onReconfirmStaleDrafts: () => void;
  selectedDraftKeys: ReadonlySet<string>;
  onToggleDraftKey: (key: string) => void;
  onDiscardDraft?: (key: string) => void;
  onDiscardAllDrafts?: () => void;
  submitReason: string;
  onSubmitReasonChange: (value: string) => void;
  canEdit: boolean;
  onSubmitSelected: () => void;
  submittingEdits: boolean;
  validateStatus: string;
  submitStatus: string;
  stagedDrafts: StagedStructuredDraft[];
  onSubmitReview: () => void;
  submitError: string;
  projectId: string;
  fileRepository: ParameterFileRepository;
  sourceWorkflowByFileId: Readonly<Record<string, ParameterFileSourceWorkflow | null>>;
  sourceWorkflowLoading: boolean;
  onConflictsChange: (next: ParameterFileSyncConflict[]) => void;
  onLocateConflict: (conflict: ParameterFileSyncConflict) => void;
};

export function WorkbenchTaskDock({
  tasksOpen,
  onTasksOpenChange,
  sessionDraftRows,
  storageError = "",
  onLocateDraft,
  syncEvidence,
  exportEvidence,
  onDismissOperationResults,
  syncConflicts,
  autoLocateConflicts = true,
  showConflictArbitration = true,
  draftRecoveryStatus,
  draftCopyFallbackRef,
  draftCopyStatus,
  onCopySessionDrafts,
  onReconfirmStaleDrafts,
  selectedDraftKeys,
  onToggleDraftKey,
  onDiscardDraft,
  onDiscardAllDrafts,
  submitReason,
  onSubmitReasonChange,
  canEdit,
  onSubmitSelected,
  submittingEdits,
  validateStatus,
  submitStatus,
  stagedDrafts,
  onSubmitReview,
  submitError,
  projectId,
  fileRepository,
  sourceWorkflowByFileId,
  sourceWorkflowLoading,
  onConflictsChange,
  onLocateConflict
}: WorkbenchTaskDockProps) {
  const invalidCount = sessionDraftRows.filter((row) => row.valid === false).length;
  const hasEvidence = Boolean(syncEvidence || exportEvidence);
  const hasTasks = Boolean(sessionDraftRows.length || stagedDrafts.length || syncConflicts.length || hasEvidence ||
    validateStatus || submitStatus || submitError);
  if (!hasTasks) return null;

  return (
    <footer className={tasksOpen ? "configuration-workbench__tasks is-open" : "configuration-workbench__tasks"}>
      <button
        className="button subtle configuration-workbench__task-toggle"
        type="button"
        aria-label="任务"
        aria-expanded={tasksOpen}
        onClick={() => onTasksOpenChange(!tasksOpen)}
      >
        {sessionDraftRows.length > 0 ? <span>
          本轮更改 <strong>{sessionDraftRows.length}</strong>
        </span> : null}
        {invalidCount > 0 ? <span>
          校验问题 <strong>{invalidCount}</strong>
        </span> : null}
        {syncConflicts.length > 0 ? <span>
          冲突 <strong>{syncConflicts.length}</strong>
        </span> : null}
        {stagedDrafts.length > 0 ? <span>待提交审核 <strong>{stagedDrafts.length}</strong></span> : null}
        {hasEvidence ? <span>操作结果</span> : null}
        <span>{tasksOpen ? "收起" : "展开任务"}</span>
      </button>
      {tasksOpen ? (
        <div role="region" aria-label="配置任务" className="configuration-workbench__task-content">
        <div className="configuration-workbench__task-panel">
          {storageError ? <p role="alert">{storageError}</p> : null}
          {sessionDraftRows.length > 0 ? (
            <>
              <div className="configuration-workbench__task-actions">
                <strong>未提交变更</strong>
                {onDiscardAllDrafts && sessionDraftRows.length > 1 ? <button className="button subtle" type="button" disabled={submittingEdits} onClick={onDiscardAllDrafts}>全部撤销</button> : null}
              </div>
              {draftRecoveryStatus === "stale-base" ? (
                <div className="configuration-workbench__stale-draft" role="status">
                  <p>
                    基线版本已变更。请先基于当前基线继续编辑；保存时会自动校验。草稿仍可检查与复制。
                  </p>
                  <div className="configuration-workbench__task-actions">
                    <button className="button subtle" type="button" onClick={() => void onCopySessionDrafts()}>
                      复制草稿
                    </button>
                    <button className="button primary" type="button" onClick={onReconfirmStaleDrafts}>
                      基于当前基线继续编辑
                    </button>
                  </div>
                  <textarea
                    ref={draftCopyFallbackRef}
                    aria-hidden="true"
                    tabIndex={-1}
                    readOnly
                    className="configuration-workbench__draft-copy-fallback"
                    style={{ position: "absolute", left: "-9999px", height: 1, width: 1, opacity: 0 }}
                  />
                  {draftCopyStatus ? <p role="status">{draftCopyStatus}</p> : null}
                </div>
              ) : null}
              <ul className="configuration-workbench__session-changes" aria-label="会话变更列表">
                {sessionDraftRows.map((row) => {
                  const checked = selectedDraftKeys.has(row.key);
                  return (
                    <li key={row.key}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          data-property-identity={row.identity}
                          aria-label={`${row.nodePath}/${row.propertyName}`}
                          onChange={() => onToggleDraftKey(row.key)}
                        />
                        <span>
                          <code>
                            {row.nodePath}/{row.propertyName}
                          </code>
                          <small>{draftSummary(row)}</small>
                        </span>
                      </label>
                      {row.error ? <p role="alert">{row.error}</p> : null}
                      {onLocateDraft ? <button className="button subtle" type="button" aria-label={`编辑 ${row.nodePath}/${row.propertyName}`} onClick={() => onLocateDraft(row)}>{row.valid === false ? "定位错误" : "继续编辑"}</button> : null}
                      {onDiscardDraft ? <button className="button subtle" type="button" disabled={submittingEdits} aria-label={`撤销 ${row.nodePath}/${row.propertyName}`} onClick={() => onDiscardDraft(row.key)}>撤销</button> : null}
                    </li>
                  );
                })}
              </ul>
              <label className="configuration-workbench__reason">
                <span>变更原因</span>
                <textarea
                  aria-label="变更原因"
                  value={submitReason}
                  onChange={(event) => onSubmitReasonChange(event.target.value)}
                  rows={2}
                  disabled={!canEdit}
                />
              </label>

            </>
          ) : null}
          {validateStatus ? <p role="status">{validateStatus}</p> : null}
          {submitStatus && stagedDrafts.length === 0 ? <p role="status">{submitStatus}</p> : null}
          {stagedDrafts.length > 0 ? (
            <section aria-label="待审核草稿回执">
              <p>已保存 {stagedDrafts.length} 项待审核草稿，当前值未变。提交审核并获通过后生效。</p>
              <ReviewProvenance entries={[{ label: "待审核草稿", value: stagedDrafts }]} />
              <button className="button primary" type="button" onClick={onSubmitReview}>前往提交审核</button>
            </section>
          ) : null}
          {submitError ? <p role="alert">{submitError}</p> : null}
          {hasEvidence ? <div className="configuration-workbench__task-actions">
            <strong>操作结果</strong>
            {onDismissOperationResults ? <button className="button subtle" type="button" onClick={onDismissOperationResults}>关闭操作结果</button> : null}
          </div> : null}
          {syncEvidence ? <p role="status">{syncEvidence}</p> : null}
          {exportEvidence ? <p role="status">{exportEvidence}</p> : null}
          {showConflictArbitration && syncConflicts.length > 0 ? (
            <WorkbenchConflictArbitrationDock
              projectId={projectId}
              repository={fileRepository}
              conflicts={syncConflicts}
              autoLocate={autoLocateConflicts}
              sourceWorkflowByFileId={sourceWorkflowByFileId}
              sourceWorkflowLoading={sourceWorkflowLoading}
              onConflictsChange={onConflictsChange}
              onQueueEmpty={() => onTasksOpenChange(false)}
              onLocateConflict={onLocateConflict}
            />
          ) : null}
        </div>
      {sessionDraftRows.length > 0 ? (
              <div className="configuration-workbench__task-actions configuration-workbench__submit-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={() => void onSubmitSelected()}
                  disabled={
                    !canEdit ||
                    submittingEdits ||
                    selectedDraftKeys.size === 0 ||
                    draftRecoveryStatus === "stale-base"
                  }
                >
                  {submittingEdits ? "保存中…" : `保存为待审核草稿（${selectedDraftKeys.size}）`}
                </button>
              </div>
      ) : null}
        </div>
      ) : null}
    </footer>
  );
}
