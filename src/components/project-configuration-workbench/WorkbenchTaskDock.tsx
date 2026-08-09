import type { RefObject } from "react";

import type {
  DtsReleaseReadiness,
  DtsReleaseReadinessIssue
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ParameterFileSyncConflict
} from "@/application/ports/ParameterFileRepository";
import type { SessionDraftRow } from "@/application/project-configuration/sessionDrafts";
import type { StructuredEditRecoveryStatus } from "@/application/project-configuration/structuredEditSession";
import { WorkbenchConflictArbitrationDock } from "./WorkbenchConflictArbitrationDock";
import { WorkbenchReleaseReadinessIssues } from "./WorkbenchReleaseReadiness";

export type WorkbenchTaskDockProps = {
  tasksOpen: boolean;
  onTasksOpenChange: (open: boolean) => void;
  sessionDraftRows: SessionDraftRow[];
  syncEvidence: string;
  exportEvidence: string;
  syncConflicts: ParameterFileSyncConflict[];
  releaseReadiness: DtsReleaseReadiness | null;
  draftRecoveryStatus: StructuredEditRecoveryStatus;
  draftCopyFallbackRef: RefObject<HTMLTextAreaElement | null>;
  draftCopyStatus: string;
  onCopySessionDrafts: () => void;
  onReconfirmStaleDrafts: () => void;
  selectedDraftKeys: ReadonlySet<string>;
  onToggleDraftKey: (key: string) => void;
  submitReason: string;
  onSubmitReasonChange: (value: string) => void;
  canEdit: boolean;
  onValidateSelected: () => void;
  onSubmitSelected: () => void;
  submittingEdits: boolean;
  validateStatus: string;
  submitStatus: string;
  submitError: string;
  projectId: string;
  fileRepository: ParameterFileRepository;
  onConflictsChange: (next: ParameterFileSyncConflict[]) => void;
  onLocateConflict: (conflict: ParameterFileSyncConflict) => void;
  canAdmin: boolean;
  acknowledgedWarningIds: ReadonlySet<string>;
  onAcknowledgeWarning: (issueId: string) => void;
  onSelectReadinessIssue: (issue: DtsReleaseReadinessIssue) => void;
  onReadinessRetry: () => void;
};

export function WorkbenchTaskDock({
  tasksOpen,
  onTasksOpenChange,
  sessionDraftRows,
  syncEvidence,
  exportEvidence,
  syncConflicts,
  releaseReadiness,
  draftRecoveryStatus,
  draftCopyFallbackRef,
  draftCopyStatus,
  onCopySessionDrafts,
  onReconfirmStaleDrafts,
  selectedDraftKeys,
  onToggleDraftKey,
  submitReason,
  onSubmitReasonChange,
  canEdit,
  onValidateSelected,
  onSubmitSelected,
  submittingEdits,
  validateStatus,
  submitStatus,
  submitError,
  projectId,
  fileRepository,
  onConflictsChange,
  onLocateConflict,
  canAdmin,
  acknowledgedWarningIds,
  onAcknowledgeWarning,
  onSelectReadinessIssue,
  onReadinessRetry
}: WorkbenchTaskDockProps) {
  return (
    <footer className={tasksOpen ? "configuration-workbench__tasks is-open" : "configuration-workbench__tasks"}>
      <button
        className="button subtle configuration-workbench__task-toggle"
        type="button"
        aria-label="任务"
        aria-expanded={tasksOpen}
        onClick={() => onTasksOpenChange(!tasksOpen)}
      >
        <span>
          本轮更改 <strong>{sessionDraftRows.length + (syncEvidence || exportEvidence ? 1 : 0)}</strong>
        </span>
        <span>
          校验问题 <strong>{sessionDraftRows.filter((row) => row.valid === false).length}</strong>
        </span>
        <span>
          冲突 <strong>{syncConflicts.length}</strong>
        </span>
        <span>
          就绪问题{" "}
          <strong>{(releaseReadiness?.blockers.length ?? 0) + (releaseReadiness?.warnings.length ?? 0)}</strong>
        </span>
        <span>{tasksOpen ? "收起" : "展开任务"}</span>
      </button>
      {tasksOpen ? (
        <div role="region" aria-label="配置任务" className="configuration-workbench__task-panel">
          <strong>会话变更</strong>
          {sessionDraftRows.length === 0 ? (
            <p>没有本轮更改。从结构树或源码定位选中属性后，用类型化编辑器写入本地会话变更。</p>
          ) : (
            <>
              {draftRecoveryStatus === "stale-base" ? (
                <div className="configuration-workbench__stale-draft" role="status">
                  <p>
                    基线版本已变更。这些会话草稿仍可检查与复制，但在基于当前基线继续编辑之前不能校验或提交。
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
                          <small>
                            {row.beforeRawText} → {row.rawText}
                          </small>
                        </span>
                      </label>
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
              <div className="configuration-workbench__task-actions">
                <button
                  className="button subtle"
                  type="button"
                  onClick={onValidateSelected}
                  disabled={!canEdit || sessionDraftRows.length === 0 || draftRecoveryStatus === "stale-base"}
                >
                  校验所选
                </button>
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
                  {submittingEdits ? "提交中…" : `提交所选（${selectedDraftKeys.size}）`}
                </button>
              </div>
            </>
          )}
          {validateStatus ? <p role="status">{validateStatus}</p> : null}
          {submitStatus ? <p role="status">{submitStatus}</p> : null}
          {submitError ? <p role="alert">{submitError}</p> : null}
          <strong>任务证据</strong>
          {syncEvidence ? <p role="status">{syncEvidence}</p> : null}
          {exportEvidence ? <p role="status">{exportEvidence}</p> : null}
          {syncConflicts.length > 0 ? (
            <WorkbenchConflictArbitrationDock
              projectId={projectId}
              repository={fileRepository}
              conflicts={syncConflicts}
              onConflictsChange={onConflictsChange}
              onQueueEmpty={() => onTasksOpenChange(false)}
              onLocateConflict={onLocateConflict}
            />
          ) : null}
          {canAdmin ? (
            <WorkbenchReleaseReadinessIssues
              readiness={releaseReadiness}
              acknowledgedWarningIds={acknowledgedWarningIds}
              onAcknowledgeWarning={onAcknowledgeWarning}
              onSelectIssue={onSelectReadinessIssue}
              onRetry={onReadinessRetry}
            />
          ) : null}
          {!syncEvidence && !exportEvidence && syncConflicts.length === 0 ? (
            <p>暂无同步或导出证据。手动同步与配置集导出结果会显示在这里。</p>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}
