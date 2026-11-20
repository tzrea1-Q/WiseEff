import { useEffect, useState } from "react";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Input } from "@/components/ui/input";
import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { PublicationConfirmation } from "./PublicationConfirmation";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "./publicationSurface";
import { emptyPublicationDraft, publicationJobIsPending, publicationStatusCopy, publicationSuccessKind } from "./publicationState";
import { usePublicationFlow } from "./usePublicationFlow";

type Subject = CatalogSubjectResponse["item"];
const actions = [
  { value: "rename", label: "更正规范标识" },
  { value: "add", label: "新增正式别名" },
  { value: "disable", label: "停用正式别名" },
  { value: "restore", label: "恢复正式别名" },
  { value: "transfer", label: "从另一主体转入正式别名" },
] as const;
type Action = (typeof actions)[number]["value"];

export function SubjectIdentityPublicationDialog(props: {
  subject: Subject; subjects: readonly Subject[]; catalog: ParameterCatalogRepository;
  catalogReleaseId: string; currentPersonId: string; organizationId: string;
  surface: PublicationSurfaceItem | null;
  onClose: () => void; onRefreshEvidence: () => void | Promise<void>;
}) {
  const { subject, catalog, catalogReleaseId, surface } = props;
  const flow = usePublicationFlow({ ...props, subjectIdentityId: subject.id });
  const { candidate, pending, job, failure, confirm, setConfirm } = flow;
  const [action, setAction] = useState<Action>("rename");
  const [selector, setSelector] = useState("");
  const [from, setFrom] = useState("");
  const [keepOldAlias, setKeepOldAlias] = useState(true);
  const [reviewId, setReviewId] = useState("");
  const success = job ? publicationSuccessKind(job) : null;
  const inFlight = Boolean(job && publicationJobIsPending(job.status));
  const busy = pending || inFlight;
  const stale = Boolean(candidate && candidate.expectedBaseReleaseId !== catalogReleaseId);
  const impact = candidate?.impactSummary.subjectIdentity;
  const advisory = surface && publicationSurfaceAdvisory(surface);
  const subjectsWithAliases = props.subjects.filter(other => other.id !== subject.id &&
    (other.canonicalType ?? other.type) === (subject.canonicalType ?? subject.type) && other.formalAliases?.length);
  const aliasSource = action === "transfer" ? subjectsWithAliases.find(other => other.id === from) : subject;
  const offeredAliases = aliasSource?.formalAliases?.filter(alias =>
    action === "transfer" || alias.status === (action === "disable" ? "active" : "retired")) ?? [];
  const canPreview = surface?.authoringAllowed === true && Boolean(selector.trim()) && (action !== "transfer" || Boolean(from)) && !busy && !success;
  const canReview = surface?.publishingAllowed === true || surface?.reviewHighRiskAllowed === true;
  const canPublish = canReview && flow.candidateVerified && Boolean(impact) && !stale && !busy && !job;

  useEffect(() => {
    const stored = flow.restore(false, () => null);
    let active = true;
    if (stored) void catalog.getPublicationCandidate(stored.candidateId).then(({ item }) => {
      if (active) flow.setCandidate(item);
    }).catch(error => { if (active) flow.captureError(error); });
    return () => { active = false; flow.stopPolling(); };
  }, [catalog, props.currentPersonId, props.organizationId, subject.id]);

  const preview = () => {
    if (!canPreview) return;
    const change = action === "rename"
      ? { op: "rename-subject" as const, subjectId: subject.id, selector: selector.trim(), keepOldAlias }
      : { op: "set-subject-alias" as const, subjectId: subject.id, selector: selector.trim(),
          active: action !== "disable", ...(action === "transfer" ? { fromSubjectId: from } : {}) };
    void flow.preview(async () => (await catalog.createPublicationCandidate({ changeSet: [change] }, { catalogReleaseId })).item,
      JSON.stringify(change), flow.captureError);
  };
  const loadReview = () => {
    if (!canReview || !reviewId.trim() || busy) return;
    const mismatch = new Error("候选与当前主体不符，请核对候选编号。");
    void flow.preview(async () => {
      const { item } = await catalog.getPublicationCandidate(reviewId.trim());
      if (item.impactSummary.subjectIdentity?.change.subjectId !== subject.id) throw mismatch;
      return item;
    }, reviewId, error => {
      if (error === mismatch) flow.setFailure(mismatch.message);
      else flow.captureError(error);
    });
  };
  const setEdited = (edit: () => void) => { flow.reset(); edit(); };

  return <>
    <ModalDialog open onDismiss={pending ? undefined : props.onClose} describedBy
      className="confirm-dialog governance-confirm-dialog modal-card--lg parameter-catalog-publication-dialog"
      backdropClassName="param-admin-modal-backdrop">
      {({ titleId, descriptionId }) => <>
        <h2 id={titleId}>共享标识：{subject.canonicalName}</h2>
        <div className="confirm-dialog__scroll"><div className="governance-confirm-dialog__body">
          <p id={descriptionId}>规范标识和正式目录别名用于共享目录匹配。组织 compatible 规则只影响当前组织，组织展示别名用于界面显示。</p>
          <dl className="parameter-catalog-publication-dialog__preview">
            <div><dt>规范标识</dt><dd>{subject.canonicalName}</dd></div>
            <div><dt>正式目录别名</dt><dd>{subject.formalAliases?.length ? subject.formalAliases.map(alias =>
              <div key={alias.selector}>{alias.selector}（{alias.status === "active" ? "启用" : "停用"}）</div>) : "无"}</dd></div>
          </dl>
          {advisory ? <p role="status">{advisory.message}</p> : null}
          {failure ? <p role="alert">{failure}</p> : null}
          {stale && !success ? <p role="alert">目录版本已变化，请刷新后重新预览。</p> : null}
          {job ? <p role="status">{publicationStatusCopy(job).message}</p> : null}
          {surface?.authoringAllowed && !success ? <div className="parameter-catalog-publication-dialog__form">
            <label className="field">操作<SelectControl ariaLabel="共享标识操作" value={action} options={actions} disabled={busy}
              onValueChange={next => setEdited(() => { setAction(next); setSelector(""); setFrom(""); })} /></label>
            {action === "transfer" ? <label className="field">转出主体<SelectControl ariaLabel="转出主体" value={from} disabled={busy}
              placeholder="选择转出主体" options={subjectsWithAliases.map(other => ({ value: other.id, label: `${other.canonicalName} · ${other.id}` }))}
              onValueChange={next => setEdited(() => { setFrom(next); setSelector(""); })} /></label> : null}
            {action === "rename" || action === "add" ? <label className="field">{action === "rename" ? "新规范标识" : "正式别名"}
              <Input value={selector} disabled={busy} onChange={event => setEdited(() => setSelector(event.target.value))} /></label>
              : <label className="field">正式别名<SelectControl ariaLabel="正式别名" value={selector} disabled={busy || !offeredAliases.length}
                placeholder={offeredAliases.length ? "选择正式别名" : "无可选别名"} options={offeredAliases.map(alias => ({ value: alias.selector, label: alias.selector }))}
                onValueChange={next => setEdited(() => setSelector(next))} /></label>}
            {action === "rename" ? <label><input type="checkbox" checked={keepOldAlias} disabled={busy}
              onChange={event => setEdited(() => setKeepOldAlias(event.target.checked))} /> 保留旧名为正式目录别名</label> : null}
          </div> : null}
          {impact && candidate ? <section aria-label={success ? "共享标识发布结果" : "共享标识发布预览"}>
            <p>影响所有使用共享目录的组织及其 DTS 匹配。主体 ID、定义、登记和既有项目绑定保留。</p>
            <ul>{impact.subjects.map(entry => <li key={entry.id}>
              {impact.change.op === "set-subject-alias" && impact.change.fromSubjectId ? entry.id === impact.change.fromSubjectId ? "转出：" : "转入：" : ""}
              {entry.canonicalName} · {entry.id} · {entry.definitionCount} 项定义
              {entry.ownerSubjectId ? ` · 所属驱动 ${entry.ownerSubjectId}` : ""}
            </li>)}</ul>
            {impact.change.op === "rename-subject" ? <p>新规范标识 {impact.change.selector}。{impact.change.keepOldAlias ? "旧名继续匹配。" : "旧名退出共享匹配。"}</p>
              : <p>正式目录别名 {impact.change.selector} {success ? "已" : "将"}{impact.change.active ? "启用" : "停用"}。</p>}
            {!success ? <p>高风险发布。复核人可凭候选编号读取并确认影响。</p> : null}
            <p>候选编号 <code>{candidate.id}</code> · 基准版本 <code>{candidate.expectedBaseReleaseId}</code></p>
          </section> : null}
          {canReview && !success ? <details><summary>复核已有共享标识候选</summary>
            <label className="field">候选编号<Input value={reviewId} onChange={event => setReviewId(event.target.value)} disabled={busy} /></label>
            <button type="button" className="button subtle" disabled={busy || !reviewId.trim()} onClick={loadReview}>读取待审核候选</button>
          </details> : null}
        </div></div>
        <div className="dialog-actions">
          <button type="button" className="button subtle" disabled={pending} onClick={props.onClose}>关闭</button>
          {stale || failure || job?.status === "needs-rebase" ? <button type="button" className="button subtle" disabled={busy}
            onClick={() => void Promise.resolve().then(props.onRefreshEvidence).catch(flow.captureError)}>刷新目录状态</button> : null}
          {surface?.authoringAllowed && !success ? <button type="button" className="button subtle" disabled={!canPreview} onClick={() => setConfirm("preview")}>生成发布预览</button> : null}
          {canPublish ? <button type="button" className="button primary" onClick={() => setConfirm("publish")}>提交发布</button> : null}
        </div>
      </>}
    </ModalDialog>
    <PublicationConfirmation confirm={confirm} allowed={confirm === "publish" ? canPublish : canPreview}
      risk="high" actor="platform-admin" pending={pending} onPreview={preview}
      onPublish={() => { if (canPublish) void flow.publish(emptyPublicationDraft(), false, flow.captureError); }}
      onCancel={() => setConfirm(null)} />
  </>;
}
