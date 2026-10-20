import { SelectControl } from "@/components/common/SelectControl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { catalogActionsForActor, type CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type {
  CatalogResolveReviewItemRequest,
  CatalogReviewItemResponse,
  CatalogReviewResolutionResponse,
  CatalogSubjectListResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog, type ModalDialogRenderProps } from "@/components/common/ModalDialog";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";

import {
  canExecuteGovernanceAction,
  createGovernanceSubmitGate,
  fingerprintGovernanceDraft,
  governanceCopy,
  governanceFailureMessage,
  reviewItemGovernanceState,
  reviewReasonLabels,
  type GovernanceSubmitGate
} from "./governanceState";
import type { PlacementOption, RegistrationModuleOption } from "./RegistrationDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import "./review-resolution.css";

export type ReviewResolutionDialogProps = {
  open: boolean;
  actor: CatalogActorKind;
  domainState: CatalogDomainState;
  repository: ParameterCatalogGovernanceRepository;
  organizationId: string;
  catalogReleaseId: string;
  item: CatalogReviewItemResponse["item"];
  placementOptions?: PlacementOption[];
  moduleOptions?: RegistrationModuleOption[];
  subjects?: CatalogSubjectListResponse["items"];
  onContinueDefinition?: (context: { subjectId?: string; propertyKey?: string; proposalId: string }) => void;
  defaultRegistrationId?: string;
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => Promise<CatalogReviewItemResponse["item"]>;
  embedded?: boolean;
  onLeaveGuardChange?: (guard: (() => boolean) | null) => void;
};

type ResolutionType = CatalogResolveReviewItemRequest["resolution"]["type"];
type ReviewItem = CatalogReviewItemResponse["item"];

const resolutionCopy: Record<ResolutionType, { label: string; description: string; result: string }> = {
  "register-subject": { label: "登记主体", description: "将已识别的目录主体登记到组织模块，供后续配置使用。", result: "主体将登记到所选模块，并关联当前有效定义。" },
  "restore-registration": { label: "恢复登记", description: "恢复此来源对应的已退役登记，沿用原有归属。", result: "所选登记将恢复使用，保留原有模块归属。" },
  "open-definition-proposal": { label: "记录定义修订意向", description: "记录需要补充或修改定义的需求，之后前往定义目录编写和发布。", result: "仅记录修订意向；参数定义需在定义目录继续编写、审核和发布。" },
  "mark-out-of-scope": { label: "标为范围外", description: "确认此来源无需纳入本次参数目录管理，将其移出待处理队列。", result: "此事项将标为范围外，保留识别证据和处理记录。" }
};

function availableSubjects(item: ReviewItem, subjects: CatalogSubjectListResponse["items"]) {
  return item.candidates.filter((candidate) => {
    const subject = subjects.find((entry) => entry.id === candidate.subjectId);
    const kind = subject?.type ?? candidate.kind;
    return (!subject || subject.membership.status !== "retired") && (kind === "driver" || kind === "node-type");
  });
}

function hasRegistrationTarget(item: ReviewItem, subjects: CatalogSubjectListResponse["items"], modules: RegistrationModuleOption[]) {
  return availableSubjects(item, subjects).some((candidate) => {
    const kind = subjects.find((entry) => entry.id === candidate.subjectId)?.type ?? candidate.kind;
    return modules.some((module) => module.kind === (kind === "driver" ? "driver-group" : "node-type"));
  });
}

function firstResolution(item: ReviewItem, subjects: CatalogSubjectListResponse["items"], modules: RegistrationModuleOption[]) {
  return item.allowedResolutions.find((resolution) =>
    resolution === "register-subject" ? hasRegistrationTarget(item, subjects, modules) :
      resolution === "restore-registration" ? Boolean(item.restorableRegistrations?.length) : true
  ) ?? "mark-out-of-scope";
}

export function ReviewResolutionDialog({
  open,
  actor,
  domainState,
  repository,
  organizationId,
  catalogReleaseId,
  item,
  moduleOptions = [],
  subjects = [],
  onContinueDefinition,
  defaultRegistrationId,
  createIdempotencyKey,
  onOpenChange,
  onCompleted,
  onRefreshEvidence,
  embedded = false,
  onLeaveGuardChange
}: ReviewResolutionDialogProps) {
  const generatedId = useId();
  const itemState = reviewItemGovernanceState(item, domainState);
  const stale = itemState.kind === "conflict" || item.catalogReleaseId !== catalogReleaseId;
  const allowed = item.status === "open" && !stale && canExecuteGovernanceAction(actor, "resolve-review-item", domainState);
  const gateRef = useRef<GovernanceSubmitGate>(createGovernanceSubmitGate());
  const wasOpen = useRef(false);
  const allowedResolutions = item.allowedResolutions;
  const [resolutionType, setResolutionType] = useState<ResolutionType>(() => firstResolution(item, subjects, moduleOptions));
  const [subjectId, setSubjectId] = useState(
    item.candidates.length === 1 ? item.candidates[0].subjectId : ""
  );
  const [destinationModuleId, setDestinationModuleId] = useState("");
  const initialRegistrationId = item.restorableRegistrations?.find((entry) => entry.id === defaultRegistrationId)?.id ??
    (item.restorableRegistrations?.length === 1 ? item.restorableRegistrations[0].id : "");
  const [registrationId, setRegistrationId] = useState(initialRegistrationId);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeFailure, setWriteFailure] = useState<CatalogDomainState | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [checkedEvidence, setCheckedEvidence] = useState<string | null>(null);
  const checking = useRef(false);
  const checkGeneration = useRef(0);
  const evidenceFingerprint = fingerprintGovernanceDraft({ item, moduleOptions, subjects });
  const hasEvidenceRefresh = Boolean(onRefreshEvidence);
  const evidenceChanged = checkedEvidence !== null && checkedEvidence !== evidenceFingerprint;
  const [receipt, setReceipt] = useState<CatalogReviewResolutionResponse["item"] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [draftChanged, setDraftChanged] = useState(false);
  const leaveDecision = useRef<((allowed: boolean) => void) | null>(null);
  const approvedLeave = useRef(false);
  const completed = useRef(false);

  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) {
      return;
    }
    gateRef.current = createGovernanceSubmitGate();
    setResolutionType(firstResolution(item, subjects, moduleOptions));
    const candidates = availableSubjects(item, subjects);
    setSubjectId(candidates.length === 1 ? candidates[0].subjectId : "");
    setDestinationModuleId("");
    setRegistrationId(initialRegistrationId);
    setReason("");
    setConfirmOpen(false);
    setPending(false);
    setWriteFailure(undefined);
    setRefreshing(false);
    setRefreshError("");
    setCheckedEvidence(null);
    setReceipt(null);
    setLeaveOpen(false);
    setDraftChanged(false);
    approvedLeave.current = false;
    completed.current = false;
  }, [open, item, subjects, moduleOptions, initialRegistrationId]);

  const selectedSubject = subjects.find((subject) => subject.id === subjectId);
  const candidates = availableSubjects(item, subjects);
  const selectedCandidate = candidates.find((candidate) => candidate.subjectId === subjectId);
  const subjectType = selectedSubject?.type ?? selectedCandidate?.kind;
  const subjectName = selectedSubject?.canonicalName ?? selectedCandidate?.canonicalName ?? "未选择主体";
  const targetModules = moduleOptions.filter((module) => module.kind === (subjectType === "driver" ? "driver-group" : subjectType === "node-type" ? "node-type" : "unknown"));
  const targetModule = targetModules.find((module) => module.id === destinationModuleId);
  const restoreTarget = item.restorableRegistrations?.find((entry) => entry.id === registrationId);
  const reasonReady = reason.trim().length > 0;
  const placementReady =
    resolutionType !== "register-subject" ||
    Boolean(targetModule);
  const restoreReady = resolutionType !== "restore-registration" || Boolean(restoreTarget);
  const subjectReady = resolutionType !== "register-subject" ||
    Boolean(selectedCandidate);
  const busy = pending || refreshing;
  const canContinue = allowed && !busy && (hasEvidenceRefresh || writeFailure?.kind !== "conflict") &&
    allowedResolutions.includes(resolutionType) && reasonReady && placementReady && restoreReady && subjectReady;
  const dirty = !receipt && (draftChanged || Boolean(reason.trim()));
  const guardLeave = useCallback(() => {
    if (completed.current) return true;
    if (busy) return false;
    if (dirty) {
      setConfirmOpen(false);
      setLeaveOpen(true);
      return false;
    }
    return true;
  }, [busy, dirty]);
  const requestClose = () => { if (guardLeave()) onOpenChange(false); };
  const finishLeave = (leave: boolean) => {
    const resolve = leaveDecision.current;
    leaveDecision.current = null;
    setLeaveOpen(false);
    approvedLeave.current = leave;
    resolve?.(leave);
    if (leave && !resolve) onOpenChange(false);
  };
  useEffect(() => {
    if (!open) return;
    onLeaveGuardChange?.(guardLeave);
    return () => onLeaveGuardChange?.(null);
  }, [guardLeave, onLeaveGuardChange, open]);
  useEffect(() => {
    if (!open || (!dirty && !busy)) return;
    const guardNavigation = (event: Event) => {
      if (event.defaultPrevented) return;
      if (completed.current) return;
      // The container may clear the review URL before this editor unmounts.
      // Let that navigation reuse the discard approval instead of asking twice.
      if (approvedLeave.current) {
        approvedLeave.current = false;
        return;
      }
      event.preventDefault();
      if (busy) return;
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = new Promise<boolean>((resolve) => {
        leaveDecision.current = resolve;
      });
      setConfirmOpen(false);
      setLeaveOpen(true);
    };
    const guardUnload = (event: BeforeUnloadEvent) => {
      if (completed.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("wiseeff:settings-before-leave", guardNavigation);
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardNavigation);
      window.removeEventListener("beforeunload", guardUnload);
      leaveDecision.current?.(false);
      leaveDecision.current = null;
    };
  }, [busy, dirty, open]);

  const refreshEvidence = async (continueToConfirm = false) => {
    if (!onRefreshEvidence) { if (continueToConfirm) setConfirmOpen(true); return; }
    if (checking.current || pending || receipt) return;
    checking.current = true;
    const request = checkGeneration.current;
    const before = evidenceFingerprint;
    setConfirmOpen(false);
    setCheckedEvidence(null);
    setRefreshing(true);
    setRefreshError("");
    try {
      const refreshed = await onRefreshEvidence();
      if (request !== checkGeneration.current) return;
      if (refreshed.id !== item.id || refreshed.catalogReleaseId !== catalogReleaseId ||
        reviewItemGovernanceState(refreshed, domainState).kind === "conflict") {
        throw new Error("审核证据已变化");
      }
      gateRef.current.reset();
      setWriteFailure(undefined);
      setCheckedEvidence(before);
      setConfirmOpen(continueToConfirm);
    } catch {
      if (request === checkGeneration.current) setRefreshError("暂时无法核对最新审核依据，或目录版本已变化。输入已保留，请重试后再确认。");
    } finally {
      if (request === checkGeneration.current) { checking.current = false; setRefreshing(false); }
    }
  };
  const automaticCheck = useRef(refreshEvidence);
  useEffect(() => { automaticCheck.current = refreshEvidence; });
  useEffect(() => {
    if (!open || !hasEvidenceRefresh) return;
    void automaticCheck.current();
    const recheck = () => {
      if (document.visibilityState === "visible") void automaticCheck.current();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      checkGeneration.current += 1;
      checking.current = false;
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [open, item.id, hasEvidenceRefresh]);

  const buildBody = (): CatalogResolveReviewItemRequest => {
    if (resolutionType === "register-subject") {
      return {
        resolution: {
          type: "register-subject",
          subjectId,
          placement: { mode: "use-default" },
          destinationModuleId
        },
        reason: reason.trim()
      };
    }
    if (resolutionType === "restore-registration") {
      return {
        resolution: { type: "restore-registration", registrationId: registrationId.trim() },
        reason: reason.trim()
      };
    }
    if (resolutionType === "open-definition-proposal") {
      return { resolution: { type: "open-definition-proposal" }, reason: reason.trim() };
    }
    return { resolution: { type: "mark-out-of-scope" }, reason: reason.trim() };
  };

  const submit = async () => {
    if (!canContinue || pending || refreshError || writeFailure?.kind === "conflict" ||
      (hasEvidenceRefresh && checkedEvidence !== evidenceFingerprint)) {
      return;
    }
    const body = buildBody();
    const prepared = gateRef.current.begin({
      actor,
      action: "resolve-review-item",
      state: domainState,
      catalogReleaseId,
      ifMatch: item.etag,
      draftFingerprint: fingerprintGovernanceDraft(body),
      createIdempotencyKey
    });
    if (prepared.status !== "ready") {
      return;
    }
    setPending(true);
    try {
      const response = await repository.resolveReviewItem(organizationId, item.id, body, {
        catalogReleaseId: prepared.context.catalogReleaseId,
        idempotencyKey: prepared.context.idempotencyKey,
        ifMatch: "ifMatch" in prepared.context ? prepared.context.ifMatch : ""
      });
      gateRef.current.succeed();
      setConfirmOpen(false);
      completed.current = true;
      setReceipt(response.item);
      onCompleted?.();
    } catch (error) {
      gateRef.current.fail();
      setWriteFailure(catalogStateFromFailure(error));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const failureState = stale ? itemState : writeFailure;
  const sources = item.sources?.length ? item.sources : item.sourceSummary ? [item.sourceSummary] : [];
  const source = sources[0];
  const sourceTitle = source?.compatible ?? source?.propertyKey ?? item.observation?.propertyKey ?? source?.fileName ?? reviewReasonLabels[item.reason];
  const hasAuthority = catalogActionsForActor(actor).includes("resolve-review-item");
  const stateNotice = item.status !== "open" ? "此审核项已处理，不能重复提交。" :
    stale ? undefined : domainState.kind === "loading" ? "正在读取目录和审核依据，输入已保留，请稍候。" :
      !hasAuthority ? "当前身份仅可阅读；处理审核需要组织管理员权限。" :
        !allowed ? "当前目录状态暂不支持处理审核。返回页面时会自动核对最新状态。" : undefined;
  const blockingHint = !allowedResolutions.includes(resolutionType) ? "当前没有可直接执行的处理方式，请先准备主体或登记，返回后自动更新。" :
    !subjectReady ? "请选择与来源证据一致的候选主体。" :
      !placementReady ? (selectedCandidate && targetModules.length === 0 ? "缺少同类型目标模块，请准备模块后返回此页。" : "请选择目标模块。") :
        !restoreReady ? "请选择此来源对应的可恢复登记。" : !reasonReady ? "请填写处理原因后继续确认。" : undefined;
  const actionUnavailable = (resolution: ResolutionType) => resolution === "register-subject" && candidates.length === 0 ?
    "未找到可登记的有效主体。请先在模块管理准备主体，返回后自动更新。" :
    resolution === "register-subject" && !hasRegistrationTarget(item, subjects, moduleOptions) ? "缺少同类型目标模块。请在模块管理准备目标，返回后自动更新。" :
    resolution === "restore-registration" && !item.restorableRegistrations?.length ? "没有与此来源匹配的可恢复登记。" : undefined;
  const affectedTarget = resolutionType === "restore-registration" ? restoreTarget?.canonicalName : subjectName;
  const impact = resolutionCopy[resolutionType].result;
  const definitionSubjectId = item.candidates.length === 1 ? item.candidates[0].subjectId : undefined;
  const renderContent = ({ titleId, descriptionId }: ModalDialogRenderProps) => (
    <section className={`review-resolution${embedded ? " review-resolution--embedded" : ""}`} aria-label="处理审核">
      {!embedded ? <h2 id={titleId}>{governanceCopy.resolveTitle}</h2> : null}
      <div className="review-resolution__scroll">
        <div id={descriptionId} className="review-resolution__body">
          <section className="review-resolution__source" aria-label="审核依据">
            <div className="review-resolution__section-head"><h3>{sourceTitle}</h3><span className="review-resolution__status">{reviewReasonLabels[item.reason]}</span></div>
            <dl className="review-resolution__facts">
              <div><dt>来源项目</dt><dd>{source?.projectName ?? "未提供项目名称"}</dd></div>
              <div><dt>来源文件</dt><dd>{source?.fileName ?? "未提供文件名称"}</dd></div>
              {source?.nodeLocator ? <div><dt>节点位置</dt><dd>{source.nodeLocator}</dd></div> : null}
              {source?.compatible ? <div><dt>兼容标识</dt><dd>{source.compatible}</dd></div> : null}
              {source?.propertyKey ?? item.observation?.propertyKey ? <div><dt>属性键</dt><dd>{source?.propertyKey ?? item.observation?.propertyKey}</dd></div> : null}
            </dl>
            {sources.length > 1 ? <details><summary>本次处理覆盖 {sources.length} 个来源，展开核对全部范围</summary><ol className="review-resolution__all-sources">{sources.map((entry, index) => <li key={index}><dl className="review-resolution__facts"><div><dt>来源项目</dt><dd>{entry.projectName ?? "未提供项目名称"}</dd></div><div><dt>来源文件</dt><dd>{entry.fileName ?? "未提供文件名称"}</dd></div>{entry.nodeLocator ? <div><dt>节点位置</dt><dd>{entry.nodeLocator}</dd></div> : null}{entry.compatible ? <div><dt>兼容标识</dt><dd>{entry.compatible}</dd></div> : null}{entry.propertyKey ? <div><dt>属性键</dt><dd>{entry.propertyKey}</dd></div> : null}</dl>{entry.status === "unavailable" ? <p className="review-resolution__hint">此来源当前不可读取。</p> : null}</li>)}</ol></details> : null}
            {sources.some((entry) => entry.status === "unavailable") ? <p className="review-resolution__hint">部分来源当前不可读取。请先核对来源状态，勿仅凭历史识别结果登记。</p> : null}
            <div className="review-resolution__source-actions"><Button asChild variant="outline" size="sm"><a href="/parameter-admin/modules/queue" target="_blank" rel="noreferrer">查看来源识别</a></Button><span className="review-resolution__hint">在新标签页核对，保留此处输入。</span></div>
            {item.candidates.length ? <details><summary>查看 {item.candidates.length} 个候选及识别依据</summary><ul className="review-resolution__evidence">{item.candidates.map((candidate, index) => <li key={candidate.subjectId}><strong>{subjects.find((entry) => entry.id === candidate.subjectId)?.canonicalName ?? candidate.canonicalName ?? `候选主体 ${index + 1}`}</strong><span>{candidate.evidence.length ? candidate.evidence.map((entry) => entry === "compatible" ? "兼容标识匹配" : entry).join("；") : "未提供额外匹配依据"}</span></li>)}</ul></details> : <p className="review-resolution__hint">尚无可验证的目录主体候选。可记录修订意向，或在确认无需纳管后标为范围外。</p>}
            <details className="review-resolution__technical"><summary>审核追溯信息</summary><dl className="review-resolution__facts"><div><dt>审核编号</dt><dd><code>{item.id}</code></dd></div>{item.observation?.id ? <div><dt>观测编号</dt><dd><code>{item.observation.id}</code></dd></div> : null}<div><dt>目录发布</dt><dd><code>{item.catalogReleaseId}</code></dd></div></dl></details>
          </section>
          {receipt ? <section className="review-resolution__receipt" aria-label="审核处理回执">
            <h3 role="status">{receipt.proposalId ? "定义修订意向已记录，尚未发布。" : resolutionType === "mark-out-of-scope" ? "已标为范围外" : resolutionType === "restore-registration" ? "登记已恢复" : "主体已登记"}</h3>
            <p>来源：{sourceTitle}{sources.length > 1 ? `（共 ${sources.length} 个来源）` : ""}</p><p>{impact}</p>
            {receipt.registration ? <p>主体：{affectedTarget}；目标模块：{targetModule?.displayName ?? receipt.registration.placement.displayName}。</p> : null}
            <p className="parameter-text-content">处理原因：{reason.trim()}</p><p>此次处理不更改项目参数值或源文件。可返回审核列表查看处理记录。</p>
            <div><Button asChild variant="outline" size="sm"><a href={`/audit?kind=parameter-catalog-governance&targetId=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">查看处理记录</a></Button></div>
            {receipt.proposalId ? <>
              <p>{definitionSubjectId ? "本次处理没有修改当前定义。请在定义目录选择目标定义，通过编辑和发布流程继续。" : "尚无唯一匹配主体。请前往参数定义管理准备主体与定义，再按编写和发布流程继续。"}</p>
              {onContinueDefinition ? <Button type="button" onClick={() => onContinueDefinition({ proposalId: receipt.proposalId!, propertyKey: item.observation?.propertyKey, subjectId: definitionSubjectId })}>{definitionSubjectId ? "前往定义目录继续编辑" : "前往参数定义管理"}</Button> : <Button asChild variant="outline"><a href="/parameter-admin/specs">{definitionSubjectId ? "前往定义目录继续编辑" : "前往参数定义管理"}</a></Button>}
            </> : null}
          </section> : <>
            {stateNotice ? <p role="status" className="review-resolution__notice">{stateNotice}</p> : null}
            {item.status === "open" && hasAuthority ? <>
              <fieldset className="review-resolution__choices" disabled={busy || !allowed}>
                <legend>处理方式</legend>
                {allowedResolutions.map((resolution) => {
                  const unavailable = actionUnavailable(resolution);
                  return <label key={resolution} className="review-resolution__choice" data-selected={resolutionType === resolution} data-unavailable={Boolean(unavailable)}>
                    <input type="radio" name={`${generatedId}-resolution`} aria-label={resolutionCopy[resolution].label} aria-describedby={`${generatedId}-${resolution}-help`} checked={resolutionType === resolution} disabled={Boolean(unavailable)} onChange={() => { setResolutionType(resolution); setDraftChanged(true); }} />
                    <span><strong>{resolutionCopy[resolution].label}</strong><span id={`${generatedId}-${resolution}-help`}>{resolutionCopy[resolution].description}</span>{unavailable ? <span className="review-resolution__hint">{unavailable}</span> : null}</span>
                  </label>;
                })}
              </fieldset>
              {allowedResolutions.includes("register-subject") && actionUnavailable("register-subject") ? <div><Button asChild variant="outline" size="sm"><a href="/parameter-admin/modules" target="_blank" rel="noreferrer">前往模块管理准备目标</a></Button><p className="review-resolution__hint">在新标签页准备主体与归属模块，返回后自动更新。</p></div> : null}
              {resolutionType === "register-subject" && allowedResolutions.includes(resolutionType) ? <section className="review-resolution__target" aria-label="登记目标与影响">
                <h3>登记目标</h3>
                {candidates.length > 1 ? <label className="review-resolution__field">选择候选主体 <span>必选</span><SelectControl ariaLabel="选择候选主体" ariaRequired value={subjectId} onValueChange={(value) => { setSubjectId(value); setDestinationModuleId(""); setDraftChanged(true); }} disabled={busy || !allowed} options={[{ value: "", label: "请选择候选主体" }, ...candidates.map((candidate, index) => ({ value: candidate.subjectId, label: subjects.find((entry) => entry.id === candidate.subjectId)?.canonicalName ?? candidate.canonicalName ?? `候选主体 ${index + 1}` }))]} /></label> : <p>主体：{subjectName}</p>}
                <label className="review-resolution__field">目标模块 <span>必选</span><SelectControl ariaLabel="审核登记目标模块" ariaRequired ariaDescribedBy={`${generatedId}-target-help`} value={destinationModuleId} disabled={busy || !allowed || !selectedCandidate} onValueChange={(value) => { setDestinationModuleId(value); setDraftChanged(true); }} options={[{ value: "", label: "请选择目标模块" }, ...targetModules.map((module) => ({ value: module.id, label: module.displayName }))]} /></label>
                <p id={`${generatedId}-target-help`} className="review-resolution__hint">{targetModule ? `${targetModule.displayName}。${targetModule.impactSummary ?? "将作为此主体的组织归属。"}` : selectedCandidate && !targetModules.length ? "当前没有可用的同类型模块。请先准备目标模块，返回后自动更新；输入会保留。" : "请明确选择归属模块，不会自动使用首个模块。"}</p>
                {selectedCandidate && !targetModules.length ? <Button asChild variant="outline" size="sm"><a href="/parameter-admin/modules" target="_blank" rel="noreferrer">前往模块管理准备目标</a></Button> : null}
                <p className="review-resolution__hint">{selectedSubject ? `将关联该主体的 ${selectedSubject.definitionCounts.active} 条当前有效定义。` : "将关联该主体的当前有效定义。"}项目参数值和源文件保持不变。</p>
              </section> : null}
              {resolutionType === "restore-registration" && allowedResolutions.includes(resolutionType) ? <section className="review-resolution__target" aria-label="恢复登记目标"><h3>待恢复登记</h3><label className="review-resolution__field">选择待恢复登记 <span>必选</span><SelectControl ariaLabel="选择待恢复登记" ariaRequired disabled={busy || !allowed} value={registrationId} onValueChange={(value) => { setRegistrationId(value); setDraftChanged(true); }} options={[{ value: "", label: "请选择待恢复登记" }, ...(item.restorableRegistrations ?? []).map((entry) => ({ value: entry.id, label: `${entry.canonicalName} · ${entry.placementDisplayName}` }))]} /></label><p className="review-resolution__hint">仅可恢复与本次来源证据匹配的登记，沿用其原有模块归属。</p></section> : null}
              <label className="review-resolution__field" htmlFor={`${generatedId}-reason`}>处理原因 <span>必填</span><Textarea id={`${generatedId}-reason`} aria-label={governanceCopy.reason} aria-required required aria-describedby={`${generatedId}-reason-help`} rows={4} value={reason} disabled={busy || !allowed} placeholder="说明核对了哪些来源证据，以及选择此处理方式的原因。" onChange={(event) => setReason(event.target.value)} /><span id={`${generatedId}-reason-help`} className="review-resolution__hint">原因将随处理结果保存，便于后续审核和追溯。</span></label>
              {blockingHint && allowed ? <p role="status" className="review-resolution__hint">{blockingHint}</p> : null}
            </> : null}
          </>}
          {!receipt && failureState ? <p className="governance-confirm-dialog__error" role="alert" data-preserve-input={failureState.kind === "conflict" ? "true" : undefined} data-silent-retry="false">{stale ? governanceCopy.staleReview : failureState.kind === "conflict" && hasEvidenceRefresh ? "审核状态已变化。输入已保留，请继续确认以重新核对最新依据。" : governanceFailureMessage(failureState)}</p> : null}
          {!receipt && refreshError ? <p role="alert" className="governance-confirm-dialog__error">{refreshError}</p> : null}
          {!receipt && refreshing ? <p role="status">正在核对最新审核依据…</p> : !receipt && evidenceChanged ? <p role="status">审核依据或可用目标已变化，请重新核对后继续确认。输入已保留。</p> : null}
        </div>
      </div>
      <div className="review-resolution__footer">
        {!receipt && refreshError && onRefreshEvidence ? <Button variant="outline" disabled={busy} onClick={() => void refreshEvidence()}>重试</Button> : <span />}
        <div><Button variant="outline" type="button" disabled={busy} onClick={requestClose}>{embedded ? "返回待审核事项" : receipt ? "完成" : "取消"}</Button>{allowed && !receipt ? <Button type="button" disabled={!canContinue} onClick={() => void refreshEvidence(true)}>{governanceCopy.continueConfirm}</Button> : null}</div>
      </div>
    </section>
  );

  return <>
    {embedded ? open ? renderContent({ titleId: `${generatedId}-title`, descriptionId: `${generatedId}-description` }) : null : <ModalDialog open={open} onDismiss={busy ? undefined : requestClose} className="confirm-dialog governance-confirm-dialog review-resolution-dialog" backdropClassName="param-admin-modal-backdrop" describedBy>{renderContent}</ModalDialog>}
    <ConfirmDialog open={open && confirmOpen && allowed && !refreshing && !refreshError && (!hasEvidenceRefresh || checkedEvidence === evidenceFingerprint)} title={governanceCopy.confirmResolveTitle}
      description={<><p><strong>{resolutionCopy[resolutionType].label}</strong></p><p>来源：{sourceTitle}{sources.length <= 1 && source?.projectName ? ` · ${source.projectName}` : ""}{sources.length <= 1 && source?.fileName ? ` · ${source.fileName}` : ""}</p>{sources.length > 1 ? <><p>此次处理覆盖以下全部 {sources.length} 个来源：</p><ul className="review-resolution__all-sources">{sources.map((entry, index) => <li key={index}>{entry.projectName ?? "未提供项目名称"} · {entry.fileName ?? "未提供文件名称"}{entry.nodeLocator ? ` · ${entry.nodeLocator}` : ""}{entry.compatible ? ` · ${entry.compatible}` : ""}{entry.propertyKey ? ` · ${entry.propertyKey}` : ""}{entry.status === "unavailable" ? "（来源当前不可读取）" : ""}</li>)}</ul></> : null}{resolutionType === "register-subject" ? <p>主体：{subjectName}；目标模块：{targetModule?.displayName}。</p> : resolutionType === "restore-registration" ? <p>主体：{restoreTarget?.canonicalName}；原归属：{restoreTarget?.placementDisplayName}。</p> : null}<p>{impact}项目参数值和源文件保持不变。</p><p className="parameter-text-content">原因：{reason.trim()}</p></>}
      confirmLabel={governanceCopy.confirmResolve} cancelLabel="返回修改" pending={pending} pendingLabel={governanceCopy.pending} acknowledgement="我已核对来源证据、处理对象和上述影响。" onConfirm={() => void submit()} onCancel={() => setConfirmOpen(false)} />
    <ConfirmDialog open={open && leaveOpen} title="放弃未保存的审核处理？" description="离开会丢弃当前处理方式、目标和原因。此事项仍会保持待处理。" confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => finishLeave(true)} onCancel={() => finishLeave(false)} />
  </>;
}
