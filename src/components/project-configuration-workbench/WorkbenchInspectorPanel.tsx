import { type ReactNode } from "react";
import { Lock, TriangleAlert } from "lucide-react";

import type {
  ConfigSetRole,
  DtsBaselineMemberComparison,
  DtsCompareBaselineResult,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsStructuralNode,
  DtsStructuralProperty
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileCandidate,
  ParameterFileSourcePreview,
  ParameterFileSourceReviewResult,
  ParameterFileSourceWorkflow,
  ProjectParameterFile,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import type { SessionPropertyDraft } from "@/application/project-configuration/sessionDrafts";
import { sourceReviewReason } from "@/application/project-configuration/sourceReviewReason";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { isCriticalDtsNodePath } from "@/components/parameters/dtsCriticalPath";
import {
  StructuredValueEditor,
  type StructuredValueChange
} from "@/components/parameters/StructuredValueEditor";
import { dtsValueTypeLabel } from "@/domain/dts/dtsValueTypeLabels";
import { WorkbenchBaselineDock } from "./WorkbenchBaselineDock";
import { WorkbenchCanonicalConflictDecision } from "./WorkbenchCanonicalConflictDecision";
import { workbenchReadinessAllowsRelease } from "./WorkbenchReleaseReadiness";
import type { WorkbenchActivityRow } from "./workbenchActivityModel";
import {
  classifyNodeRisk,
  formatSourceSpan,
  type InspectorLevel,
  type WorkbenchCanvasMode
} from "./workbenchInspectorModel";

const CONFIG_SET_ROLES: ConfigSetRole[] = ["base", "overlay", "charging", "thermal", "misc"];

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

const ORIGIN_LABELS: Record<ProjectParameterFileVersion["origin"], string> = {
  upload: "手动上传",
  writeback: "参数回写",
  rollback: "版本回滚"
};

export type WorkbenchInspectorPanelProps = {
  inspectorPersistent: boolean;
  narrowViewport: boolean;
  inspectorLevel: InspectorLevel;
  onClose: () => void;
  selectedConfigSet: DtsConfigSet;
  selectedMember: DtsConfigSetMemberFile | null;
  selectedPropertyName: string | null;
  selectedNodePath: string | null;
  baselines: DtsReleaseBaseline[];
  releasedBaseline: DtsReleaseBaseline | null;
  selectedBaselineId: string | null;
  baselinesLoading: boolean;
  baselinesError: string;
  baselineActionError: string;
  baselineCompare: DtsCompareBaselineResult | null;
  baselineCompareAgainst: "working" | "released";
  baselinePinnedMembers: Array<{ fileId: string; fileVersionId: string; versionNumber: number }>;
  canAdmin: boolean;
  releaseReadiness: DtsReleaseReadiness | null;
  sessionDraftsDirty: boolean;
  canvasMode: WorkbenchCanvasMode;
  onSelectBaseline: (baselineId: string) => void;
  onBaselinesRetry: () => void;
  onCompareBaseline: (against: "working" | "released") => void;
  onOpenRelease: () => void;
  onOpenRestoreBaseline: () => void;
  onExitBaselineCompare: () => void;
  onSelectBaselineCompareMember: (member: DtsBaselineMemberComparison) => void;
  activeCandidate: ParameterFileCandidate | null;
  projectId: string;
  currentUserId: string;
  onConflictSubmitted: (requestId: string) => void;
  sourcePreview: ParameterFileSourcePreview | null;
  sourcePreviewLoading: boolean;
  sourcePreviewError: string;
  canSubmitSourceReview: boolean;
  canSubmitBatchReview: boolean;
  submittingSourceReview: boolean;
  sourceReviewError: string;
  sourceReviewResult: ParameterFileSourceReviewResult | null;
  onSubmitSourceReview: () => void;
  onOpenReview: () => void;
  canRecompute: boolean;
  canActivate: boolean;
  canAbandon: boolean;
  onRecomputeCandidate: () => void;
  onActivateCandidate: () => void;
  onAbandonCandidate: () => void;
  activityMissingNotice: string;
  activityLoading: boolean;
  activityError: string;
  activityRows: WorkbenchActivityRow[];
  onActivityRetry: () => void;
  onActivityEventSelect: (eventId: string) => void;
  selectedMembers: DtsConfigSetMemberFile[];
  pendingAction: string | null;
  ungroupedFiles: ProjectParameterFile[];
  memberFileId: string;
  memberRole: ConfigSetRole;
  memberSortOrder: number;
  onMemberFileIdChange: (fileId: string) => void;
  onMemberRoleChange: (role: ConfigSetRole) => void;
  onMemberSortOrderChange: (sortOrder: number) => void;
  onAddMember: () => void;
  onRequestRemoveMember: (member: DtsConfigSetMemberFile) => void;
  canRequestReviewedMemberRemoval?: boolean;
  onSyncFile: () => void;
  onOpenManualSync?: () => void;
  sourceWorkflow: ParameterFileSourceWorkflow | null;
  sourceWorkflowLoading: boolean;
  sourceWorkflowError: string;
  sourceWorkflowSetLoading: boolean;
  sourceWorkflowSetReady: boolean;
  sourceWorkflowSetCanonical: boolean;
  sourceWorkflowSetError: string;
  onRetrySourceWorkflow: () => void;
  fileVersions: ProjectParameterFileVersion[];
  versionsLoading: boolean;
  versionsError: string;
  onEnterCanvasMode: (mode: WorkbenchCanvasMode, versionId: string) => void;
  onDownloadVersion: (version: ProjectParameterFileVersion) => void;
  onRequestRollbackVersion: (version: ProjectParameterFileVersion) => void;
  downloadMessage: string;
  selectedStructureNode: DtsStructuralNode | null;
  selectedStructureProperty: DtsStructuralProperty | null;
  activePropertyDraft: SessionPropertyDraft | undefined;
  availableLabels: string[];
  editorLocked: boolean;
  criticalLocked: boolean;
  staleDraftLocked: boolean;
  onStructuredValueChange: (change: StructuredValueChange) => void;
  canEdit: boolean;
  revisionGate?: ReactNode;
};

export function WorkbenchInspectorPanel({
  inspectorPersistent,
  narrowViewport,
  inspectorLevel,
  onClose,
  selectedConfigSet,
  selectedMember,
  selectedPropertyName,
  selectedNodePath,
  baselines,
  releasedBaseline,
  selectedBaselineId,
  baselinesLoading,
  baselinesError,
  baselineActionError,
  baselineCompare,
  baselineCompareAgainst,
  baselinePinnedMembers,
  canAdmin,
  releaseReadiness,
  sessionDraftsDirty,
  canvasMode,
  onSelectBaseline,
  onBaselinesRetry,
  onCompareBaseline,
  onOpenRelease,
  onOpenRestoreBaseline,
  onExitBaselineCompare,
  onSelectBaselineCompareMember,
  activeCandidate,
  projectId,
  currentUserId,
  onConflictSubmitted,
  sourcePreview,
  sourcePreviewLoading,
  sourcePreviewError,
  canSubmitSourceReview,
  canSubmitBatchReview,
  submittingSourceReview,
  sourceReviewResult,
  onSubmitSourceReview,
  onOpenReview,
  canRecompute,
  canActivate,
  canAbandon,
  onRecomputeCandidate,
  onActivateCandidate,
  onAbandonCandidate,
  activityMissingNotice,
  activityLoading,
  activityError,
  activityRows,
  onActivityRetry,
  onActivityEventSelect,
  selectedMembers,
  pendingAction,
  ungroupedFiles,
  memberFileId,
  memberRole,
  memberSortOrder,
  onMemberFileIdChange,
  onMemberRoleChange,
  onMemberSortOrderChange,
  onAddMember,
  onRequestRemoveMember,
  canRequestReviewedMemberRemoval = false,
  onSyncFile,
  onOpenManualSync,
  sourceWorkflow,
  sourceWorkflowLoading,
  sourceWorkflowError,
  sourceWorkflowSetLoading,
  sourceWorkflowSetReady,
  sourceWorkflowSetCanonical,
  sourceWorkflowSetError,
  onRetrySourceWorkflow,
  fileVersions,
  versionsLoading,
  versionsError,
  onEnterCanvasMode,
  onDownloadVersion,
  onRequestRollbackVersion,
  downloadMessage,
  selectedStructureNode,
  selectedStructureProperty,
  activePropertyDraft,
  availableLabels,
  editorLocked,
  criticalLocked,
  staleDraftLocked,
  onStructuredValueChange,
  canEdit,
  revisionGate
}: WorkbenchInspectorPanelProps) {
  const sourceWorkflowUnknown = Boolean(selectedMember) && !sourceWorkflow && !sourceWorkflowError;
  const sourceMutationBlocked = sourceWorkflowLoading || Boolean(sourceWorkflowError) || sourceWorkflowUnknown;
  const selectedSourceCanonical = sourceWorkflow?.canonical === true;
  const sourceSetMutationBlocked =
    sourceWorkflowSetLoading ||
    !sourceWorkflowSetReady ||
    Boolean(sourceWorkflowSetError) ||
    sourceWorkflowSetCanonical;
  const reviewedRemovalReady = (member: DtsConfigSetMemberFile) =>
    canRequestReviewedMemberRemoval && member.format === "json" && sourceWorkflowSetReady
    && !sourceWorkflowSetLoading && !sourceWorkflowSetError;
  const sourceMutationReason = sourceWorkflowError
    ? sourceWorkflowError
    : sourceWorkflow?.reason ?? "canonical 来源成员必须通过来源审核流程。";
  const sourceSetMutationReason = sourceWorkflowSetError
    ? sourceWorkflowSetError
    : sourceWorkflowSetCanonical
      ? "当前配置集包含 canonical 来源成员，成员变更必须通过来源审核流程。"
      : selectedMembers.length === 0
        ? "当前配置集尚无已验证的来源成员，不能确认目标来源。"
      : "配置集来源一致性尚未完成校验，成员变更已禁用。";
  const batchPreview = sourcePreview?.kind === "canonical"
    && ["json", "dts"].includes(sourcePreview.format.toLowerCase()) && (sourcePreview.bindings?.length ?? 0) > 1;

  return (
    <aside
      className={
        inspectorPersistent && !narrowViewport
          ? "configuration-workbench__inspector is-persistent"
          : "configuration-workbench__inspector"
      }
      aria-label="配置检查器"
      data-layout={inspectorPersistent && !narrowViewport ? "persistent" : "overlay"}
    >
      <div className="configuration-workbench__region-head">
        <div>
          <span>检查器</span>
          <strong>
            {inspectorLevel === "activity"
              ? "项目活动"
              : inspectorLevel === "property"
                ? selectedPropertyName
                : inspectorLevel === "node"
                  ? selectedNodePath
                  : inspectorLevel === "file"
                    ? selectedMember?.fileName
                    : selectedConfigSet.name}
          </strong>
        </div>
        <div className="configuration-workbench__inspector-actions">
          <button
            className="button subtle configuration-workbench__icon-button"
            type="button"
            aria-label="关闭检查器"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div className="configuration-workbench__inspector-body">
        <WorkbenchBaselineDock
          baselines={baselines}
          releasedTipId={releasedBaseline?.id}
          selectedBaselineId={selectedBaselineId}
          loading={baselinesLoading}
          error={baselinesError}
          actionError={baselineActionError}
          compareMembers={baselineCompare?.members ?? null}
          compareAgainst={baselineCompareAgainst}
          pinnedMembers={baselinePinnedMembers}
          canAdmin={canAdmin}
          canRelease={workbenchReadinessAllowsRelease(releaseReadiness, sessionDraftsDirty)}
          canRestore={canAdmin && Boolean(selectedBaselineId)}
          releaseBlockedReason={
            sessionDraftsDirty
              ? "还有未保存的本机会话变更，不能发布"
              : !releaseReadiness?.canRelease
                ? "发布就绪门禁阻止发布"
                : undefined
          }
          comparing={Boolean(baselineCompare) || canvasMode === "unified-diff" || canvasMode === "side-by-side"}
          onSelectBaseline={onSelectBaseline}
          onRetry={onBaselinesRetry}
          onCompare={onCompareBaseline}
          onOpenRelease={onOpenRelease}
          onOpenRestore={onOpenRestoreBaseline}
          onExitCompare={onExitBaselineCompare}
          onSelectCompareMember={onSelectBaselineCompareMember}
        />
        {revisionGate}
        {canAdmin && canEdit && activeCandidate?.status === "ready" && canvasMode === "candidate"
          && sourcePreview?.kind === "canonical" && !sourcePreview.request ? (
            <WorkbenchCanonicalConflictDecision key={activeCandidate.id}
              projectId={projectId} currentUserId={currentUserId} candidate={activeCandidate}
              preview={sourcePreview} allowed
              onSubmitted={onConflictSubmitted} />
          ) : null}
        <dl>
          <div>
            <dt>检查层级</dt>
            <dd>
              {inspectorLevel === "config-set"
                ? "配置集"
                : inspectorLevel === "file"
                  ? "文件"
                  : inspectorLevel === "node"
                    ? "节点"
                    : inspectorLevel === "activity"
                      ? "活动"
                      : "属性"}
            </dd>
          </div>
          <div>
            <dt>工作配置</dt>
            <dd>工作配置</dd>
          </div>
          <div>
            <dt>发布基线</dt>
            <dd>{releasedBaseline?.name ?? "尚未发布"}</dd>
          </div>
          <div>
            <dt>候选文件版本</dt>
            <dd>
              {activeCandidate && activeCandidate.status !== "abandoned"
                ? `${activeCandidate.fileName} · ${activeCandidate.status}`
                : "尚未上传"}
            </dd>
          </div>
          {activeCandidate && canvasMode === "candidate" ? (
            <>
              <div>
                <dt>候选身份</dt>
                <dd className="mono">{activeCandidate.id}</dd>
              </div>
              <div>
                <dt>对照活跃版本</dt>
                <dd className="mono">{activeCandidate.baseVersionId ?? "新文件候选"}</dd>
              </div>
              {sourcePreviewLoading ? (
                <div>
                  <dt>来源预览</dt>
                  <dd role="status">正在加载服务端来源快照…</dd>
                </div>
              ) : null}
              {sourcePreviewError ? (
                <div>
                  <dt>来源预览</dt>
                  <dd>
                    <p role="alert">{sourcePreviewError}</p>
                    <p>来源状态未知，激活与来源审核均已禁用。</p>
                  </dd>
                </div>
              ) : null}
              {sourcePreview ? (
                <>
                  <div>
                    <dt>来源工作流</dt>
                    <dd>
                      {sourcePreview.kind === "canonical" ? "canonical 来源审核" : "legacy 候选激活"}
                      {sourcePreview.reason && !(batchPreview && sourcePreview.reason === "canonical-batch-writer-unavailable")
                        ? <small> · {sourceReviewReason(sourcePreview.reason)}</small> : null}
                    </dd>
                  </div>
                  {sourcePreview.kind === "canonical" ? (
                    <>
                      <div>
                        <dt>来源精确身份</dt>
                        <dd className="mono">
                          {[
                            sourcePreview.bindingId && `binding ${sourcePreview.bindingId}`,
                            sourcePreview.definitionId && `definition ${sourcePreview.definitionId}`,
                            sourcePreview.configRevisionId && `revision ${sourcePreview.configRevisionId}`,
                            sourcePreview.baseCurrentValueId && `value ${sourcePreview.baseCurrentValueId}`,
                            sourcePreview.sourcePinId && `pin ${sourcePreview.sourcePinId}`,
                            sourcePreview.locator && `locator ${sourcePreview.locator}`
                          ]
                            .filter(Boolean)
                            .join(" · ") || (sourcePreview.bindings?.length
                              ? `${sourcePreview.bindings.length} 个绑定的身份见下方目标列表`
                              : "缺少服务端来源身份")}
                        </dd>
                      </div>
                      <div>
                        <dt>字节证明</dt>
                        <dd>
                          <div>{sourcePreview.bindings && sourcePreview.bindings.length > 1
                            ? `${sourcePreview.bindings.length} 个参数绑定的只读差异证明`
                            : "单参数变更校验"}</div>
                          <div className="mono">格式：{sourcePreview.format.toLowerCase() === "json" ? "JSON" : sourcePreview.format.toUpperCase()}</div>
                          {sourcePreview.bindings && sourcePreview.bindings.length > 1 ? (
                            <ol aria-label="来源变更目标">
                              {sourcePreview.bindings.map((binding) => (
                                <li key={binding.bindingId}>
                                  <div className="mono">{binding.locator}</div>
                                  <div>{binding.action === "delete" ? "删除属性" : "设置值"}：{binding.beforeText} → {binding.afterText ?? "已删除"}</div>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <details>
                            <summary>完整字节摘要与来源身份</summary>
                            <div className="mono">基准摘要：{sourcePreview.baseDigest ?? "缺失"}</div>
                            <div className="mono">提议摘要：{sourcePreview.proposedDigest ?? "缺失"}</div>
                            {sourcePreview.bindings && sourcePreview.bindings.length > 1 ? sourcePreview.bindings.map((binding) => (
                              <div className="mono" key={binding.bindingId}>binding {binding.bindingId} · pin {binding.sourcePinId}</div>
                            )) : null}
                          </details>
                          {sourcePreview.before != null ? <pre className="configuration-workbench__diff-view mono">{sourcePreview.before}</pre> : null}
                          {sourcePreview.after != null ? <pre className="configuration-workbench__diff-view mono">{sourcePreview.after}</pre> : null}
                        </dd>
                      </div>
                      {sourcePreview.request || sourceReviewResult ? (
                        <div>
                          <dt>来源审核</dt>
                          <dd>
                            <span>
                              请求 {sourcePreview.request?.id ?? sourceReviewResult?.requestId} · 状态 {sourcePreview.request?.status ?? sourceReviewResult?.status}
                            </span>
                            <button className="button subtle" type="button" onClick={onOpenReview}>
                              查看审核
                            </button>
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              <div>
                <dt>诊断</dt>
                <dd>
                  {(activeCandidate.diagnostics?.length ?? 0) === 0
                    ? "无"
                    : activeCandidate.diagnostics.map((item) => (
                        <div key={`${item.code}-${item.message}`}>
                          [{item.severity}] {item.code}: {item.message}
                        </div>
                      ))}
                </dd>
              </div>
              <div>
                <dt>阻断</dt>
                <dd>
                  {(activeCandidate.blockers?.length ?? 0) === 0
                    ? "无"
                    : activeCandidate.blockers.map((item) => (
                        <div key={`${item.code}-${item.message}`}>
                          {item.code}: {item.message}
                        </div>
                      ))}
                </dd>
              </div>
              <div>
                <dt>结构差异</dt>
                <dd>
                  {(activeCandidate.impact.structuralDiff?.length ?? 0) === 0
                    ? "无"
                    : `${activeCandidate.impact.structuralDiff?.length} 项`}
                </dd>
              </div>
              <div>
                <dt>覆盖/映射</dt>
                <dd>
                  {activeCandidate.impact.coverage
                    ? `已注册 ${activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 ${activeCandidate.impact.coverage.newUnregisteredCount}`
                    : "不适用"}
                </dd>
              </div>
              <div>
                <dt>冲突证据</dt>
                <dd>
                  {(activeCandidate.impact.conflicts?.length ?? 0) === 0
                    ? "无开放冲突"
                    : activeCandidate.impact.conflicts?.map((item) => (
                        <div key={item.id} className="mono">
                          {item.id}
                          {item.parameterName ? ` · ${item.parameterName}` : ""}
                        </div>
                      ))}
                </dd>
              </div>
              {activeCandidate.impact.textDiff ? (
                <div>
                  <dt>文本差异</dt>
                  <dd>
                    <pre className="configuration-workbench__diff-view mono" tabIndex={0}>
                      {activeCandidate.impact.textDiff}
                    </pre>
                  </dd>
                </div>
              ) : null}
              <div className="configuration-workbench__inspector-actions">
                {canRecompute ? (
                  <button className="button subtle" type="button" onClick={onRecomputeCandidate}>
                    重算影响
                  </button>
                ) : null}
                {canActivate ? (
                  <button
                    className="button primary"
                    type="button"
                    data-testid="activate-candidate"
                    onClick={onActivateCandidate}
                  >
                    激活候选
                  </button>
                ) : null}
                {sourcePreview?.kind === "canonical" ? (
                  <button
                    className="button primary"
                    type="button"
                    disabled={!(canSubmitSourceReview || canSubmitBatchReview) || submittingSourceReview}
                    title={!(canSubmitSourceReview || canSubmitBatchReview)
                      ? batchPreview ? sourcePreview.request
                        ? "已有来源审核请求，请先处理或刷新状态。"
                        : "候选状态、完整来源证明或当前权限不满足批量提交条件。"
                        : sourceReviewReason(sourcePreview.reason) : undefined}
                    onClick={onSubmitSourceReview}
                  >
                    {submittingSourceReview ? "提交中…" : batchPreview ? `提交 ${sourcePreview.format.toUpperCase()} 批量审核` : "提交来源变更审核"}
                  </button>
                ) : null}
                {canAbandon ? (
                  <button className="button subtle" type="button" onClick={onAbandonCandidate}>
                    放弃候选
                  </button>
                ) : null}
                {sourcePreview?.request?.status === "pending" || sourcePreview?.request?.status === "approved" ? (
                  <p className="configuration-workbench__locked" role="note">
                    {sourcePreview.request.status === "pending"
                      ? "已有待处理的来源审核，请等待审核完成后再放弃或重算候选。"
                      : "来源审核已通过，候选仍保留审核关联，不能放弃或重算。"}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
          {inspectorLevel === "activity" ? (
            <>
              <div>
                <dt>活动时间线</dt>
                <dd>当前组织与项目范围内的服务器审计投影</dd>
              </div>
              {activityMissingNotice ? (
                <div>
                  <dt>目标状态</dt>
                  <dd>
                    <p role="status" aria-label="活动目标不可用">
                      {activityMissingNotice}
                    </p>
                  </dd>
                </div>
              ) : null}
              {activityLoading ? (
                <div>
                  <dt>加载</dt>
                  <dd role="status">正在加载项目活动…</dd>
                </div>
              ) : null}
              {activityError ? (
                <div>
                  <dt>失败</dt>
                  <dd>
                    <p role="alert">{activityError}</p>
                    <button className="button subtle" type="button" onClick={onActivityRetry}>
                      重试活动
                    </button>
                  </dd>
                </div>
              ) : null}
              {!activityLoading && !activityError && activityRows.length === 0 ? (
                <div>
                  <dt>空态</dt>
                  <dd role="status">暂无项目活动记录</dd>
                </div>
              ) : null}
              {!activityLoading && activityRows.length > 0 ? (
                <div>
                  <dt>事件</dt>
                  <dd>
                    <ul className="configuration-workbench__activity-list" aria-label="项目活动事件">
                      {activityRows.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="button subtle configuration-workbench__activity-item"
                            aria-label={`${row.action} · ${row.targetLabel}`}
                            onClick={() => onActivityEventSelect(row.id)}
                          >
                            <span className="configuration-workbench__activity-action">
                              {row.action}
                            </span>
                            <span className="configuration-workbench__activity-meta">
                              {row.actor} · {row.targetLabel} · {row.outcome} · {row.timeLabel}
                            </span>
                            <time dateTime={row.createdAtIso || undefined}>{row.absoluteTime}</time>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
          {inspectorLevel === "config-set" ? (
            <>
              <div>
                <dt>配置集</dt>
                <dd>{selectedConfigSet.name}</dd>
              </div>
              <div>
                <dt>描述</dt>
                <dd>{selectedConfigSet.description || "无描述"}</dd>
              </div>
              <div>
                <dt>成员数</dt>
                <dd>{selectedMembers.length}</dd>
              </div>
              <section className="configuration-workbench__member-ops" aria-label="成员管理">
                <strong>成员管理</strong>
                {sourceWorkflowSetLoading ? <p role="status">正在校验配置集来源成员…</p> : null}
                {sourceWorkflowSetError ? (
                  <div role="alert">
                    <p>{sourceSetMutationReason} 成员变更已禁用。</p>
                    <button className="button subtle" type="button" onClick={onRetrySourceWorkflow}>
                      重试来源校验
                    </button>
                  </div>
                ) : null}
                {sourceWorkflowSetCanonical ? (
                  <p role="note">{sourceSetMutationReason} 当前配置集成员不能直接增删。</p>
                ) : null}
                {!sourceWorkflowSetReady && !sourceWorkflowSetLoading && !sourceWorkflowSetError ? (
                  <p role="note">{sourceSetMutationReason}</p>
                ) : null}
                {selectedMembers.length === 0 ? (
                  <p>尚无成员。从下方未编组文件编入，或使用表单添加。</p>
                ) : (
                  <ul>
                    {selectedMembers.map((member) => (
                      <li key={member.fileId}>
                        <span>
                          {member.fileName} · {ROLE_LABELS[member.role]} · 顺序 {member.sortOrder}
                        </span>
                        {canAdmin ? (
                          <button
                            className="button subtle"
                            type="button"
                            aria-label={`移除 ${member.fileName}`}
                            disabled={
                              pendingAction !== null ||
                              (sourceSetMutationBlocked && !reviewedRemovalReady(member))
                            }
                            onClick={() => onRequestRemoveMember(member)}
                          >
                            移除
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canAdmin ? (
                  <div className="configuration-workbench__member-form">
                    <label>
                      文件
                      <select
                        aria-label="待编入文件"
                        value={memberFileId}
                        onChange={(event) => onMemberFileIdChange(event.target.value)}
                      >
                        {ungroupedFiles.length === 0 ? (
                          <option value="">无未编组文件</option>
                        ) : (
                          ungroupedFiles.map((file) => (
                            <option key={file.id} value={file.id}>
                              {file.fileName}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <label>
                      角色
                      <select
                        aria-label="成员角色"
                        value={memberRole}
                        onChange={(event) => onMemberRoleChange(event.target.value as ConfigSetRole)}
                      >
                        {CONFIG_SET_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      顺序
                      <input
                        type="number"
                        aria-label="成员顺序"
                        value={memberSortOrder}
                        onChange={(event) => onMemberSortOrderChange(Number(event.target.value) || 0)}
                      />
                    </label>
                    <button
                      className="button subtle"
                      type="button"
                      disabled={!memberFileId || pendingAction !== null || sourceSetMutationBlocked}
                      title={sourceSetMutationBlocked ? sourceSetMutationReason : undefined}
                      onClick={onAddMember}
                    >
                      添加成员
                    </button>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
          {inspectorLevel === "file" && selectedMember ? (
            <>
              <div>
                <dt>文件格式</dt>
                <dd>{selectedMember.format}</dd>
              </div>
              <div>
                <dt>来源一致性</dt>
                <dd>
                  {sourceWorkflowLoading
                    ? "正在加载来源工作流…"
                    : sourceWorkflowError
                      ? `${sourceWorkflowError} 受保护操作已禁用。`
                      : sourceWorkflow?.canonical
                        ? `canonical 来源审核 · ${sourceWorkflow.bindingCount} 个绑定${sourceWorkflow.reason ? ` · ${sourceReviewReason(sourceWorkflow.reason)}` : ""}`
                        : "legacy 文件工作流"}
                  {sourceWorkflowError ? (
                    <button className="button subtle" type="button" onClick={onRetrySourceWorkflow}>
                      重试来源校验
                    </button>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>成员角色</dt>
                <dd>{ROLE_LABELS[selectedMember.role]}</dd>
              </div>
              <div>
                <dt>活跃文件版本</dt>
                <dd>
                  {selectedMember.currentVersionNumber
                    ? `版本 v${selectedMember.currentVersionNumber}`
                    : "无活跃版本"}
                  {selectedMember.currentVersionId ? (
                    <code className="configuration-workbench__version-id">{selectedMember.currentVersionId}</code>
                  ) : null}
                </dd>
              </div>
              {canAdmin ? (
                <div className="configuration-workbench__inspector-actions">
                  <button
                    className="button subtle"
                    type="button"
                    disabled={pendingAction !== null || sourceMutationBlocked}
                    title={sourceMutationBlocked ? sourceMutationReason : undefined}
                    onClick={onSyncFile}
                  >
                    {pendingAction === "sync-file"
                      ? "同步中…"
                      : sourceWorkflow?.canonical
                        ? "来源一致性校验"
                        : "手动同步"}
                  </button>
                  {sourceWorkflow?.canonical && sourceWorkflow.bindingCount >= 2 && onOpenManualSync ? <button
                    className="button subtle" type="button"
                    disabled={pendingAction !== null || sourceWorkflowLoading || Boolean(sourceWorkflowError)
                      || !sourceWorkflow.proofToken || !selectedMember.currentVersionId}
                    onClick={onOpenManualSync}
                  >上传来源并预览批量候选</button> : null}
                  <button
                    className="button subtle"
                    type="button"
                    disabled={pendingAction !== null || (!reviewedRemovalReady(selectedMember)
                      && (sourceSetMutationBlocked || selectedSourceCanonical))}
                    title={reviewedRemovalReady(selectedMember) ? "提交成员删除审核" : sourceSetMutationBlocked
                      ? sourceSetMutationReason : selectedSourceCanonical ? sourceMutationReason : undefined}
                    onClick={() => onRequestRemoveMember(selectedMember)}
                  >
                    从配置集移除
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          {inspectorLevel === "node" && selectedStructureNode ? (
            <>
              <div>
                <dt>节点路径</dt>
                <dd>
                  <code>{selectedStructureNode.nodePath || "/"}</code>
                </dd>
              </div>
              <div>
                <dt>源码位置</dt>
                <dd>{formatSourceSpan(selectedStructureNode.source)}</dd>
              </div>
              <div>
                <dt>labels</dt>
                <dd>
                  {selectedStructureNode.labels.length
                    ? selectedStructureNode.labels.join(", ")
                    : "无"}
                </dd>
              </div>
              <div>
                <dt>compatible</dt>
                <dd>{selectedStructureNode.compatible ?? "无"}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>{classifyNodeRisk(selectedStructureNode.status)}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd title={selectedMember?.currentVersionId ?? undefined}>
                  工作配置 · 文件版本 {selectedMember?.currentVersionNumber ? `v${selectedMember.currentVersionNumber}` : "未知"}
                </dd>
              </div>
              <div>
                <dt>读权限</dt>
                <dd>只读</dd>
              </div>
            </>
          ) : null}
          {inspectorLevel === "property" && selectedStructureProperty && selectedStructureNode ? (
            <>
              <div>
                <dt>属性名</dt>
                <dd>{selectedStructureProperty.name}</dd>
              </div>
              <div>
                <dt>节点路径</dt>
                <dd>
                  <code>{selectedStructureNode.nodePath}</code>
                </dd>
              </div>
              <div>
                <dt>源码位置</dt>
                <dd>
                  {formatSourceSpan(
                    selectedStructureProperty.source ?? selectedStructureNode.source
                  )}
                </dd>
              </div>
              <div>
                <dt>类型</dt>
                <dd>{dtsValueTypeLabel(selectedStructureProperty.valueType)}</dd>
              </div>
              <div>
                <dt>类型约束</dt>
                <dd>
                  须符合「{dtsValueTypeLabel(selectedStructureProperty.valueType)}」语法；提交前可在任务坞校验。
                </dd>
              </div>
              <div>
                <dt>原始值</dt>
                <dd>
                  <code>{activePropertyDraft?.rawText ?? selectedStructureProperty.rawText}</code>
                </dd>
              </div>
              <div>
                <dt>规范化值</dt>
                <dd>{activePropertyDraft?.normalizedValue ?? selectedStructureProperty.normalizedValue}</dd>
              </div>
              <div>
                <dt>风险</dt>
                <dd>
                  {isCriticalDtsNodePath(selectedStructureNode.nodePath)
                    ? "安全关键"
                    : classifyNodeRisk(selectedStructureNode.status)}
                </dd>
              </div>
              <div>
                <dt>变更原因</dt>
                <dd>提交变更请求时必须填写原因；原因会进入既有审核流程。</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd title={selectedMember?.currentVersionId ?? undefined}>
                  工作配置 · 文件版本 {selectedMember?.currentVersionNumber ? `v${selectedMember.currentVersionNumber}` : "未知"}
                </dd>
              </div>
              <div>
                <dt>写权限</dt>
                <dd>
                  {editorLocked
                    ? criticalLocked
                      ? "只读（无安全关键修改权限）"
                      : "只读（无参数修改权限）"
                    : "可编辑"}
                </dd>
              </div>
              {isCriticalDtsNodePath(selectedStructureNode.nodePath) ? (
                <p className="configuration-workbench__risk-note" role="note">
                  <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
                  <span>安全关键节点：改动电源或温控取值可能损坏硬件，提交前请确认取值来源。</span>
                </p>
              ) : null}
              <div className="configuration-workbench__typed-editor" aria-label="属性值编辑">
                {editorLocked ? (
                  <p className="configuration-workbench__locked" role="note">
                    <Lock size={16} strokeWidth={2} aria-hidden="true" />
                    <span>
                      {staleDraftLocked
                        ? "基线版本已变更：会话草稿仅可检查或复制。请先基于当前基线继续编辑，再修改取值。"
                        : criticalLocked
                          ? "这是安全关键节点，你的角色没有修改它的权限。当前取值可以查看，但不能编辑或提交。"
                          : "你的角色没有修改参数的权限。当前取值可以查看，但不能编辑或提交。"}
                    </span>
                  </p>
                ) : null}
                <StructuredValueEditor
                  propertyName={selectedStructureProperty.name}
                  valueType={selectedStructureProperty.valueType}
                  rawText={activePropertyDraft?.rawText ?? selectedStructureProperty.rawText}
                  present={activePropertyDraft?.present}
                  availableLabels={availableLabels}
                  disabled={editorLocked || selectedStructureProperty.valueType === "empty"}
                  onChange={onStructuredValueChange}
                />
              </div>
            </>
          ) : null}
        </dl>
        {inspectorLevel === "file" && selectedMember ? (
          <section className="configuration-workbench__version-history" aria-label="不可变版本历史">
            <strong>不可变版本历史</strong>
            {versionsLoading ? <p role="status">正在加载版本历史…</p> : null}
            {versionsError ? (
              <div role="alert">
                <p>{versionsError}</p>
              </div>
            ) : null}
            {!versionsLoading && !versionsError && fileVersions.length === 0 ? (
              <p>暂无版本记录。</p>
            ) : null}
            <ul>
              {fileVersions.map((version) => {
                const active = version.id === selectedMember.currentVersionId;
                return (
                  <li key={version.id}>
                    <div>
                      <strong>
                        版本 {version.versionNumber}
                        {active ? " · 活跃" : ""}
                      </strong>
                      <small className="mono">{version.id}</small>
                      <span>来源：{ORIGIN_LABELS[version.origin]}</span>
                      <span title={formatAbsolute(version.createdAt)}>创建时间：{formatRelativeOrAbsolute(version.createdAt)}</span>
                      <span>
                        操作人：{version.createdByDisplayName === null ? "用户已注销或未记录" : version.createdByDisplayName ?? "未记录"}
                      </span>
                    </div>
                    <div className="configuration-workbench__version-actions">
                      <button
                        className="button subtle"
                        type="button"
                        aria-label={`查看版本 ${version.versionNumber} 历史源码`}
                        onClick={() => onEnterCanvasMode("history", version.id)}
                      >
                        查看历史
                      </button>
                      <button
                        className="button subtle"
                        type="button"
                        aria-label={`统一差异版本 ${version.versionNumber}`}
                        onClick={() => onEnterCanvasMode("unified-diff", version.id)}
                      >
                        统一差异
                      </button>
                      <button
                        className="button subtle"
                        type="button"
                        aria-label={`下载版本 ${version.versionNumber}`}
                        onClick={() => onDownloadVersion(version)}
                      >
                        下载
                      </button>
                      {canAdmin && !active ? (
                        <button
                          className="button subtle"
                          type="button"
                          aria-label={`将版本 ${version.versionNumber} 恢复为当前`}
                          onClick={() => onRequestRollbackVersion(version)}
                        >
                          恢复为当前
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {downloadMessage ? <p role="status">{downloadMessage}</p> : null}
          </section>
        ) : null}
        <p className="configuration-workbench__read-only-note">
          {canEdit
            ? sourceWorkflow?.canonical
              ? "源码画布保持只读；canonical 来源变更与回滚必须提交来源审核，审核通过前不会激活。当前文件属性仍可在类型化检查器中编辑，并进入会话变更坞提交。"
              : `源码画布保持只读；整文件替换请走候选文件版本。${selectedMember?.format === "json" ? "JSON" : "DTS"} 属性改动在类型化检查器中编辑，并进入会话变更坞提交。候选激活需确认影响范围；配置集创建/成员管理、手动同步与导出同样可用。`
            : "当前检查器为只读上下文。画布模式：" +
              canvasMode +
              "。缺少参数修改权限时仍可浏览结构与源码。"}
        </p>
      </div>
    </aside>
  );
}
