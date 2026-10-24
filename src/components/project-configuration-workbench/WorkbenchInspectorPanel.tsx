import { RowActionMenu } from "@/components/common/RowActionMenu";
import { historicalIdentityLabel } from "@/domain/identity/historicalAttribution";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { candidateStatusLabels } from "./WorkbenchCandidateList";
import { Lock, TriangleAlert, X } from "lucide-react";
import "./workbench-configuration-versions-dialog.css";

import type {
  DtsBaselineMemberComparison,
  DtsCompareBaselineResult,
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
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import type { SessionPropertyDraft } from "@/application/project-configuration/sessionDrafts";
import { sourceReviewReason } from "@/application/project-configuration/sourceReviewReason";
import { candidateReceiptMessage } from "@/application/project-configuration/candidateRequestReceipt";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { isCriticalDtsNodePath } from "@/components/parameters/dtsCriticalPath";
import {
  StructuredValueEditor,
  type StructuredValueChange
} from "@/components/parameters/StructuredValueEditor";
import { dtsValueTypeLabel } from "@/domain/dts/dtsValueTypeLabels";
import { WorkbenchBaselineDock } from "./WorkbenchBaselineDock";
import { ReviewProvenance } from "@/features/parameter-review/ReviewProvenance";
import { workbenchReadinessAllowsCreate, workbenchReadinessAllowsRelease } from "./WorkbenchReleaseReadiness";
import type { WorkbenchActivityRow } from "./workbenchActivityModel";
import {
  formatSourceSpan,
  type InspectorLevel,
  type WorkbenchCanvasMode
} from "./workbenchInspectorModel";

const ORIGIN_LABELS: Record<ProjectParameterFileVersion["origin"], string> = {
  upload: "手动上传",
  writeback: "参数回写",
  rollback: "版本回滚"
};

export type WorkbenchInspectorPanelProps = {
  sourceEditing?: boolean;
  inspectorPersistent: boolean;
  narrowViewport: boolean;
  inspectorLevel: InspectorLevel;
  configSetName: string;
  onClose: () => void;
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
  baselinePinnedMembersLoading: boolean;
  baselinePinnedMembersError: string;
  onRetryBaselineMembers: () => void;
  canAdmin: boolean;
  releaseReadiness: DtsReleaseReadiness | null;
  sessionDraftsDirty: boolean;
  readinessLoading: boolean;
  onOpenCreateBaseline: () => void;
  releaseIssues: ReactNode;
  canvasMode: WorkbenchCanvasMode;
  onSelectBaseline: (baselineId: string) => void;
  onBaselinesRetry: () => void;
  onCompareBaseline: (against: "working" | "released") => void;
  onOpenRelease: () => void;
  onOpenRestoreBaseline: () => void;
  onSelectBaselineCompareMember: (member: DtsBaselineMemberComparison) => void;
  activeCandidate: ParameterFileCandidate | null;
  sourcePreview: ParameterFileSourcePreview | null;
  sourcePreviewLoading: boolean;
  sourcePreviewError: string;
  onRetrySourceUpdate?: () => void;
  sourceReviewResult: ParameterFileSourceReviewResult | null;
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
  sourceWorkflow: ParameterFileSourceWorkflow | null;
  sourceWorkflowLoading: boolean;
  sourceWorkflowError: string;
  sourceWorkflowSetReady: boolean;
  sourceWorkflowSetCanonical: boolean;
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
  editorLocked: boolean;
  criticalLocked: boolean;
  staleDraftLocked: boolean;
  onStructuredValueChange: (change: StructuredValueChange) => void;
  revisionGate?: ReactNode;
  propertyDefinition?: ReactNode;
  propertyValueSchema?: unknown;
  draftStorageError?: string;
  onDiscardPropertyDraft?: () => void;
  onOpenDrafts?: () => void;
  candidateList?: ReactNode;
  sourceUpdateUpload?: ReactNode;
  sourceUpdateReview?: ReactNode;
  batchReviewInline?: boolean;
  onRetryVersions?: () => void;
};

export function WorkbenchInspectorPanel({
  sourceEditing = false,
  inspectorPersistent,
  narrowViewport,
  inspectorLevel,
  configSetName,
  onClose,
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
  baselinePinnedMembersLoading,
  baselinePinnedMembersError,
  onRetryBaselineMembers,
  canAdmin,
  releaseReadiness,
  sessionDraftsDirty,
  readinessLoading,
  onOpenCreateBaseline,
  releaseIssues,
  canvasMode,
  onSelectBaseline,
  onBaselinesRetry,
  onCompareBaseline,
  onOpenRelease,
  onOpenRestoreBaseline,
  onSelectBaselineCompareMember,
  activeCandidate,
  sourcePreview,
  sourcePreviewLoading,
  sourcePreviewError,
  onRetrySourceUpdate,
  sourceReviewResult,
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
  sourceWorkflow,
  sourceWorkflowLoading,
  sourceWorkflowError,
  sourceWorkflowSetReady,
  sourceWorkflowSetCanonical,
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
  editorLocked,
  criticalLocked,
  staleDraftLocked,
  onStructuredValueChange,
  revisionGate,
  propertyDefinition,
  propertyValueSchema,
  draftStorageError = "",
  onDiscardPropertyDraft,
  onOpenDrafts,
  candidateList,
  sourceUpdateUpload,
  sourceUpdateReview,
  batchReviewInline = false,
  onRetryVersions
}: WorkbenchInspectorPanelProps) {
  const closeVersionsRef = useRef<HTMLButtonElement>(null);
  const editorIdentity = JSON.stringify([selectedMember?.fileId, selectedStructureNode?.nodePath, selectedStructureProperty?.name]);
  const [showPropertyErrors, setShowPropertyErrors] = useState(false);
  const editorRegionRef = useRef<HTMLElement>(null);
  useEffect(() => { setShowPropertyErrors(false); }, [editorIdentity]);
  const propertyEditor = selectedStructureProperty && selectedStructureNode ? <section ref={editorRegionRef} className="configuration-workbench__property-editor" aria-label="当前属性">
    <div className="configuration-workbench__property-summary"><code>{selectedStructureNode.nodePath || "/"}</code></div>
    {propertyDefinition}
    {isCriticalDtsNodePath(selectedStructureNode.nodePath) ? <p className="configuration-workbench__risk-note" role="note">
      <TriangleAlert size={16} aria-hidden="true" /><span>安全关键节点：改动电源或温控取值可能损坏硬件，提交前请确认取值来源。</span>
    </p> : null}
    {editorLocked ? <p className="configuration-workbench__locked" role="note"><Lock size={16} aria-hidden="true" /><span>{staleDraftLocked
      ? "基线版本已变更：会话草稿仅可检查或复制。请先基于当前基线继续编辑，再修改取值。"
      : criticalLocked ? "这是安全关键节点，你的角色没有修改它的权限。当前取值可以查看，但不能编辑或提交。"
        : "你的角色没有修改参数的权限。当前取值可以查看，但不能编辑或提交。"}</span></p> : null}
    <div className="configuration-workbench__typed-editor" role="group" aria-label="属性值编辑">
      <StructuredValueEditor key={editorIdentity} propertyName={selectedStructureProperty.name} valueType={selectedStructureProperty.valueType}
        rawText={activePropertyDraft?.rawText ?? selectedStructureProperty.rawText} present={activePropertyDraft?.present}
        editorState={activePropertyDraft?.editorState} valueSchema={propertyValueSchema}
        showErrors={showPropertyErrors}
        disabled={editorLocked}
        onChange={onStructuredValueChange} />
    </div>
    <div className="configuration-workbench__property-feedback">
      <p role="status">{draftStorageError || (activePropertyDraft ? activePropertyDraft.valid === false ? "本地修改 · 该参数有待修正的输入" : "已保留本地修改 · 尚未保存为待审核草稿" : "当前文件值 · 尚无本地修改")}</p>
      {activePropertyDraft?.valid === false ? <p role="alert">{activePropertyDraft.error || "请修正输入后再保存。"}</p> : null}
      <div className="configuration-workbench__inspector-actions">
        {activePropertyDraft?.valid === false ? <Button variant="outline" size="sm" onClick={() => { setShowPropertyErrors(true); editorRegionRef.current?.querySelector("textarea")?.focus(); }}>定位错误</Button> : null}
        {activePropertyDraft && onDiscardPropertyDraft ? <Button variant="ghost" size="sm" disabled={editorLocked} onClick={onDiscardPropertyDraft}>撤销当前参数</Button> : null}
        {activePropertyDraft && onOpenDrafts ? <Button variant="ghost" size="sm" onClick={onOpenDrafts}>查看本轮更改</Button> : null}
      </div>
    </div>
    <details className="configuration-workbench__property-baseline"><summary>查看原值与差异 · v{selectedMember?.currentVersionNumber ?? "—"}</summary>
      <p>当前文件值</p><pre className="parameter-value-content" aria-label="当前属性完整值" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete property values support keyboard scrolling. */}>{selectedStructureProperty.rawText || "空值"}</pre>
      {activePropertyDraft ? <><p>本地修改{activePropertyDraft.present === false ? " · 将删除属性" : ""}</p><pre className="parameter-value-content" aria-label="本地属性完整值" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete draft values support keyboard scrolling. */}>{activePropertyDraft.rawText || "空值"}</pre></> : null}
    </details>
  </section> : null;
  if (inspectorLevel === "release") {
    const busy = Boolean(pendingAction && ["create-baseline", "release-baseline", "restore-baseline"].includes(pendingAction));
    const issues = releaseReadiness ? [...releaseReadiness.blockers, ...releaseReadiness.warnings] : [];
    const checkStatus = readinessLoading ? "检查中…" : !releaseReadiness?.available ? "检查不可用"
      : issues.length ? `${issues.length} 项需关注` : "检查通过";
    return <ModalDialog open onDismiss={busy ? undefined : onClose}
      className="configuration-versions-dialog" backdropClassName="param-admin-modal-backdrop" describedBy initialFocusRef={closeVersionsRef}>
      {({ titleId, descriptionId }) => <>
        <header className="configuration-versions-dialog__header">
          <div><h2 id={titleId}>配置版本</h2><p id={descriptionId}>{configSetName} · 保存整套文件的版本组合，供验收与追溯。</p></div>
          {canAdmin ? <Button size="sm" disabled={pendingAction !== null || readinessLoading || !workbenchReadinessAllowsCreate(releaseReadiness, sessionDraftsDirty)}
            title={sessionDraftsDirty ? "请先保存或撤销本地变更" : !releaseReadiness?.canCreateBaseline ? "请先处理定版检查问题" : undefined}
            onClick={onOpenCreateBaseline}>保存版本快照</Button> : null}
          <Button ref={closeVersionsRef} size="icon-sm" variant="ghost" aria-label="关闭配置版本" disabled={busy} onClick={onClose}><X aria-hidden="true" /></Button>
        </header>
        <div className="configuration-versions-dialog__body">
          <WorkbenchBaselineDock baselines={baselines} fileNames={Object.fromEntries(selectedMembers.map((member) => [member.fileId, member.fileName]))}
            releasedTipId={releasedBaseline?.id} selectedBaselineId={selectedBaselineId}
            loading={baselinesLoading} error={baselinesError} actionError={baselineActionError}
            compareMembers={baselineCompare?.members ?? null} compareAgainst={baselineCompareAgainst}
            pinnedMembers={baselinePinnedMembers} pinnedMembersLoading={baselinePinnedMembersLoading} pinnedMembersError={baselinePinnedMembersError}
            onRetryMembers={onRetryBaselineMembers} canAdmin={canAdmin}
            canRelease={pendingAction === null && !readinessLoading && workbenchReadinessAllowsRelease(releaseReadiness, sessionDraftsDirty)}
            canPreviewRestore={canAdmin && pendingAction === null && Boolean(selectedBaselineId) && sourceWorkflowSetReady}
            releaseBlockedReason={sessionDraftsDirty ? "请先保存或撤销本地变更" : !releaseReadiness?.canRelease ? "请先处理定版检查问题" : undefined}
            comparing={pendingAction === "compare-baseline"}
            onSelectBaseline={onSelectBaseline} onRetry={onBaselinesRetry} onCompare={onCompareBaseline}
            onOpenRelease={onOpenRelease} onOpenRestore={onOpenRestoreBaseline} onSelectCompareMember={onSelectBaselineCompareMember} />
          {canAdmin ? <details className="configuration-versions-dialog__checks" open={!readinessLoading && (!releaseReadiness?.available || issues.length > 0)}>
            <summary>定版检查<span>{checkStatus}</span></summary>{releaseIssues}
          </details> : null}
          {revisionGate ? <details className="configuration-versions-dialog__checks"><summary>高级校验</summary>{revisionGate}</details> : null}
        </div>
      </>}
    </ModalDialog>;
  }
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
          <strong>
            {inspectorLevel === "activity" ? "项目活动"
              : inspectorLevel === "versions" ? "版本历史"
              : inspectorLevel === "candidates" ? "来源更新"
              : inspectorLevel === "property" ? selectedPropertyName
              : inspectorLevel === "node" ? selectedNodePath
              : "配置文件"}
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
        {inspectorLevel === "candidates" ? <>{sourceUpdateUpload}{candidateList}</> : null}
        {inspectorLevel === "property" ? sourceEditing ? <section aria-label="当前属性说明">
          {propertyDefinition}
          <p>在源码区切换到编辑模式可修改完整 DTS。</p>
          <pre className="parameter-value-content" aria-label="当前属性完整值" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete source values support keyboard scrolling. */}>{selectedStructureProperty?.rawText}</pre>
        </section> : propertyEditor : null}
        <div className="configuration-workbench__context-details">
        <div className="configuration-workbench__inspector-details">
          {inspectorLevel === "candidates" && activeCandidate && canvasMode === "candidate" ? (
            <>
              <dl>
              <div>
                <dt>更新状态</dt>
                <dd>{sourcePreview?.request?.status === "pending" ? "待审核"
                  : sourcePreview?.request?.status === "approved" ? activeCandidate.status === "active" ? "已生效" : "审核通过"
                  : candidateStatusLabels[activeCandidate.status]}</dd>
              </div>
              <div>
                <dt>对照版本</dt>
                <dd>{fileVersions.find((version) => version.id === activeCandidate.baseVersionId)?.versionNumber
                  ? `v${fileVersions.find((version) => version.id === activeCandidate.baseVersionId)?.versionNumber}` : "新文件或版本未加载"}</dd>
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
                    {onRetrySourceUpdate ? <button type="button" className="button subtle" onClick={onRetrySourceUpdate}>重试核对</button> : null}
                  </dd>
                </div>
              ) : null}
              {sourcePreview ? (
                <>
                  <div>
                    <dt>来源工作流</dt>
                    <dd>
                      {sourcePreview.request ? "已提交审核" : sourcePreview.kind === "canonical" || sourcePreview.kind === "source_revision" ? "需要人工审核" : canActivate ? "确认后可应用" : sourceWorkflowSetCanonical ? "当前配置受审核保护，暂不支持直接应用新文件候选。" : !canAdmin ? "需要项目管理员确认。" : "来源校验尚未满足应用条件。"}
                      {sourcePreview.reason && !(batchPreview && sourcePreview.reason === "canonical-batch-review-required")
                        ? <small> · {sourceReviewReason(sourcePreview.reason)}</small> : null}
                    </dd>
                  </div>
                  {sourcePreview.kind === "canonical" && !batchReviewInline ? (
                    <>
                      <div>
                        <dt>变更内容</dt>
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
                        </dd>
                      </div>
                    </>
                  ) : null}
                  {sourcePreview.request || sourceReviewResult ? (
                    <div>
                      <dt>来源审核</dt>
                      <dd>
                        <span>
                          审核状态：{({ pending: "待审核", approved: "已通过", rejected: "已驳回", withdrawn: "已撤回" } as Record<string, string>)[sourcePreview.request?.status ?? sourceReviewResult?.status ?? ""] ?? "请查看审核详情"}
                          {sourcePreview.request ? ` · ${sourcePreview.request.kind === "source_revision" ? "整文件" : sourcePreview.request.kind === "batch" ? "批量" : "单目标"}` : ""}
                        </span>
                        <button className="button subtle" type="button" onClick={onOpenReview}>
                          查看审核
                        </button>
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {(activeCandidate.diagnostics?.length ?? 0) > 0 ? <div>
                <dt>诊断</dt>
                <dd>
                  {activeCandidate.diagnostics.map((item) => (
                        <div key={`${item.code}-${item.message}`}>
                          {item.message}
                        </div>
                      ))}
                </dd>
              </div> : null}
              {(activeCandidate.blockers?.length ?? 0) > 0 ? <div>
                <dt>阻断</dt>
                <dd>
                  {activeCandidate.blockers.map((item) => (
                        <div key={`${item.code}-${item.message}`}>
                          {item.message}
                        </div>
                      ))}
                </dd>
              </div> : null}
              {(activeCandidate.impact.structuralDiff?.length ?? 0) > 0 ? <div>
                <dt>结构差异</dt>
                <dd>{activeCandidate.impact.structuralDiff?.length} 项</dd>
              </div> : null}
              {activeCandidate.impact.coverage ? <div>
                <dt>覆盖/映射</dt>
                <dd>
                  已注册 {activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 {activeCandidate.impact.coverage.newUnregisteredCount}
                </dd>
              </div> : null}
              {(activeCandidate.impact.conflicts?.length ?? 0) > 0 ? <div>
                <dt>冲突证据</dt>
                <dd>
                  {activeCandidate.impact.conflicts?.map((item, index) => (
                        <div key={item.id}>
                          {item.parameterName || `冲突 ${index + 1}`}
                        </div>
                      ))}
                </dd>
              </div> : null}
              </dl>
              {!batchReviewInline ? <ReviewProvenance entries={[{ label: "候选版本", value: activeCandidate },
                { label: "完整来源预览", value: sourcePreview }, { label: "审核回执", value: sourceReviewResult }]} /> : null}
              <div className="configuration-workbench__inspector-actions">
                {canRecompute ? (
                  <button className="button subtle" type="button" onClick={onRecomputeCandidate}>
                    重新核对
                  </button>
                ) : null}
                {canActivate ? (
                  <button
                    className="button primary"
                    type="button"
                    data-testid="activate-candidate"
                    onClick={onActivateCandidate}
                  >
                    确认应用
                  </button>
                ) : null}
                {canAbandon ? (
                  <button className="button subtle" type="button" onClick={onAbandonCandidate}>
                    放弃更新
                  </button>
                ) : null}
                {sourcePreview?.request?.status === "pending" || sourcePreview?.request?.status === "approved" ? (
                  <p className="configuration-workbench__locked" role="note">
                    {sourcePreview.request.status === "pending"
                      ? "已有待处理的来源审核，请等待审核完成后再放弃或重算候选。"
                      : "来源审核已通过，候选仍保留审核关联，不能放弃或重算。"}
                  </p>
                ) : null}
                {sourcePreview?.request?.status === "rejected" || sourcePreview?.request?.status === "withdrawn" ? (
                  <p className="configuration-workbench__locked" role="note">{candidateReceiptMessage(sourcePreview.request)}</p>
                ) : null}
              </div>
              {sourceUpdateReview}
            </>
          ) : null}
          {inspectorLevel === "activity" ? (
            <section className="configuration-workbench__activity" aria-label="项目活动">
              {activityMissingNotice ? <p role="status" aria-label="活动目标不可用">{activityMissingNotice}</p> : null}
              {activityLoading ? <p role="status">正在加载项目活动…</p> : null}
              {activityError ? <div role="alert"><p>{activityError}</p>
                <button className="button subtle" type="button" onClick={onActivityRetry}>重试活动</button>
              </div> : null}
              {!activityLoading && !activityError && activityRows.length === 0 ? <p role="status">暂无项目活动记录</p> : null}
              {!activityLoading && activityRows.length > 0 ? (
                <ul className="configuration-workbench__activity-list" aria-label="项目活动事件">
                  {activityRows.map((row) => (
                    <li key={row.id}>
                      <button type="button" className="button subtle configuration-workbench__activity-item"
                        aria-label={`${row.action} · ${row.targetLabel}`} onClick={() => onActivityEventSelect(row.id)}>
                        <span className="configuration-workbench__activity-action">{row.action}</span>
                        <span className="configuration-workbench__activity-meta">{row.actor} · {row.targetLabel} · {row.outcome}</span>
                        <time dateTime={row.createdAtIso || undefined} title={row.absoluteTime}>{row.timeLabel}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {inspectorLevel === "node" && selectedStructureNode ? (
            <dl>
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
              {selectedStructureNode.labels.length > 0 ? <div>
                <dt>节点标签</dt>
                <dd>{selectedStructureNode.labels.join(", ")}</dd>
              </div> : null}
              {selectedStructureNode.compatible?.trim() ? <div>
                <dt>compatible</dt>
                <dd>{selectedStructureNode.compatible}</dd>
              </div> : null}
              {selectedStructureNode.status?.trim() ? <div>
                <dt>节点状态</dt>
                <dd>{({ok:"已启用",okay:"已启用",disabled:"已禁用",reserved:"已保留"} as Record<string,string>)[selectedStructureNode.status] ?? selectedStructureNode.status}</dd>
              </div> : null}
              <div>
                <dt>来源</dt>
                <dd title={selectedMember?.currentVersionId ?? undefined}>
                  工作配置 · 文件版本 {selectedMember?.currentVersionNumber ? `v${selectedMember.currentVersionNumber}` : "未知"}
                </dd>
              </div>
            </dl>
          ) : null}
          {inspectorLevel === "property" && selectedStructureProperty && selectedStructureNode ? (
            <details className="configuration-workbench__property-technical">
              <summary>属性与来源详情</summary>
              <dl>
                <div><dt>节点路径</dt><dd><code>{selectedStructureNode.nodePath}</code></dd></div>
                <div><dt>属性类型</dt><dd>{dtsValueTypeLabel(selectedStructureProperty.valueType)}</dd></div>
                <div><dt>源码位置</dt><dd>{formatSourceSpan(selectedStructureProperty.source ?? selectedStructureNode.source)}</dd></div>
                <div><dt>源版本</dt><dd>{selectedMember?.currentVersionNumber ? `v${selectedMember.currentVersionNumber}` : "未提供"}</dd></div>
              </dl>
            </details>
          ) : null}
        </div>
        </div>
        {inspectorLevel === "versions" && selectedMember ? (
          <section className="configuration-workbench__version-history" aria-label="版本历史">
            <strong>{selectedMember.fileName}</strong>
            <dl aria-label="文件信息">
              <div><dt>文件格式</dt><dd>{selectedMember.format.toUpperCase()}</dd></div>
              <div><dt>来源一致性</dt><dd>
                {sourceWorkflowLoading || !sourceWorkflow && !sourceWorkflowError ? "正在核对来源状态…"
                  : sourceWorkflowError ? `${sourceWorkflowError} 受保护操作已禁用。`
                  : sourceWorkflow?.canonical
                    ? `需人工审核 · ${sourceWorkflow.bindingCount} 个关联参数${sourceWorkflow.reason ? ` · ${sourceReviewReason(sourceWorkflow.reason)}` : ""}`
                    : "确认后可更新来源"}
                {sourceWorkflowError ? <button className="button subtle" type="button" onClick={onRetrySourceWorkflow}>重试来源校验</button> : null}
              </dd></div>
            </dl>
            {versionsLoading ? <p role="status">正在加载版本历史…</p> : null}
            {versionsError ? (
              <div role="alert">
                <p>{versionsError}</p>
                {onRetryVersions ? <button className="button subtle" type="button" onClick={onRetryVersions}>重试版本历史</button> : null}
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
                    <button type="button" className="button subtle configuration-workbench__version-record"
                      aria-label={`查看版本 ${version.versionNumber} 历史源码`}
                      onClick={() => onEnterCanvasMode("history", version.id)}>
                      <strong>
                        版本 {version.versionNumber}
                        {active ? " · 活跃" : ""}
                      </strong>
                      <span>来源：{ORIGIN_LABELS[version.origin]}</span>
                      <span title={formatAbsolute(version.createdAt)}>创建时间：{formatRelativeOrAbsolute(version.createdAt)}</span>
                      <span title={version.historicalAttribution ? `发生组织：${version.historicalAttribution.organization.name
                        ? historicalIdentityLabel(version.historicalAttribution.organization) : "历史组织名称未记录"}` : undefined}>
                        操作人：{version.createdByDisplayName === null ? "用户已注销或未记录" : version.createdByDisplayName ?? "未记录"}
                      </span>
                    </button>
                    <div className="configuration-workbench__version-actions">
                      <RowActionMenu label={`版本 ${version.versionNumber} 操作`} items={[
                        { id: "download", label: "下载", ariaLabel: `下载版本 ${version.versionNumber}`, onSelect: () => onDownloadVersion(version) },
                        ...(canAdmin && !active ? [{ id: "rollback", label: sourceWorkflow?.canonical ? "申请回滚" : "恢复为当前",
                          ariaLabel: sourceWorkflow?.canonical ? `申请回滚至版本 ${version.versionNumber}` : `将版本 ${version.versionNumber} 恢复为当前`,
                          onSelect: () => onRequestRollbackVersion(version) }] : [])
                      ]} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <ReviewProvenance entries={[{ label: "文件", value: selectedMember }, { label: "版本记录", value: fileVersions }]} />
            {downloadMessage ? <p role="status">{downloadMessage}</p> : null}
          </section>
        ) : null}

      </div>
    </aside>
  );
}
