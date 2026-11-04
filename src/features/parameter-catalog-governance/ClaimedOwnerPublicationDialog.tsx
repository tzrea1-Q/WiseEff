import { useEffect, useRef, useState } from "react";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Input } from "@/components/ui/input";
import { PublicationConfirmation } from "./PublicationConfirmation";
import { usePublicationFlow } from "./usePublicationFlow";
import { emptyPublicationDraft, publicationJobIsPending, publicationStatusCopy, publicationSuccessKind } from "./publicationState";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "./publicationSurface";

export function ClaimedOwnerPublicationDialog(props: {
  catalog: ParameterCatalogRepository; catalogReleaseId: string; currentPersonId: string; organizationId: string;
  actor: CatalogActorKind; surface: PublicationSurfaceItem | null; runtimeMode?: string;
  onClose: () => void; onRefreshEvidence: () => void | Promise<void>;
}) {
  const flow = usePublicationFlow({ ...props, claimedOwners: true });
  const { candidate, job, pending, failure, confirm, setConfirm } = flow;
  const [noChange, setNoChange] = useState(false);
  const [reviewId, setReviewId] = useState("");
  const requestGeneration = useRef(0);
  const claims = candidate?.impactSummary.ownerDeclarations ?? [];
  const success = job && publicationSuccessKind(job);
  const inFlight = Boolean(job && publicationJobIsPending(job.status));
  const unavailable = props.runtimeMode === "mock" || !props.catalog.previewClaimedOwners;
  const canPreview = !unavailable && props.actor !== "agent" && props.surface?.authoringAllowed === true;
  const canReview = !unavailable && props.actor !== "agent"
    && Boolean(props.surface?.publishingAllowed || props.surface?.reviewHighRiskAllowed);
  const stale = Boolean(candidate && candidate.expectedBaseReleaseId !== props.catalogReleaseId);
  const canPublish = canReview && flow.candidateVerified && candidate?.impactSummary.ownerPublicationOnly === true
    && claims.length > 0 && !stale && !success
    && !inFlight && !pending && !job;
  const advisory = props.surface ? publicationSurfaceAdvisory(props.surface) : null;

  useEffect(() => {
    const generation = ++requestGeneration.current;
    const stored = flow.restore(false, () => null);
    let active = true;
    if (stored) void props.catalog.getPublicationCandidate(stored.candidateId).then(result => {
      if (active && generation === requestGeneration.current) { flow.setCandidate(result.item); flow.setCandidateVerified(result.item.impactSummary.ownerPublicationOnly === true); }
    }).catch(error => { if (active && generation === requestGeneration.current) flow.captureError(error); });
    return () => { active = false; flow.stopPolling(); };
  }, [props.catalog, props.currentPersonId, props.organizationId]);

  const preview = async () => {
    if (!canPreview || pending || inFlight) return;
    requestGeneration.current += 1;
    setNoChange(false);
    flow.setCandidateVerified(false);
    await flow.preview(async () => {
      const result = await props.catalog.previewClaimedOwners!({ catalogReleaseId: props.catalogReleaseId });
      setNoChange(result.item.noChange);
      return result.item.candidate;
    }, props.catalogReleaseId, flow.captureError);
  };
  const review = async () => {
    if (!canReview || pending || inFlight || !reviewId.trim()) return;
    requestGeneration.current += 1;
    setNoChange(false);
    flow.setCandidateVerified(false);
    await flow.preview(async () => {
      const result = await props.catalog.getPublicationCandidate(reviewId.trim());
      if (result.item.impactSummary.ownerPublicationOnly !== true || !result.item.impactSummary.ownerDeclarations?.length) {
        throw new Error("该候选不是仅包含归属的发布，请核对候选编号。");
      }
      return result.item;
    }, reviewId, flow.captureError);
  };
  const publish = async () => {
    if (!canPublish) return;
    await flow.publish(emptyPublicationDraft(), false, flow.captureError);
  };

  return <>
    <ModalDialog open onDismiss={pending ? undefined : props.onClose}
      className="confirm-dialog governance-confirm-dialog modal-card--lg parameter-catalog-publication-dialog"
      backdropClassName="param-admin-modal-backdrop" describedBy>
      {({ titleId, descriptionId }) => <>
        <h2 id={titleId}>发布已认领归属</h2>
        <div className="confirm-dialog__scroll"><div id={descriptionId} className="governance-confirm-dialog__body">
          <p>将维护流程已认领、尚未写入发布版本的子节点归属发布到共享目录。预览不会激活版本；本页不能新增认领或更换驱动。</p>
          <p>影响所有使用该共享目录的组织，不修改参数定义、项目取值或组织登记。归属发布生效后，再按升级手册迁移技术模块。</p>
          {unavailable ? <p role="status">模拟模式不支持归属发布，请使用 API 模式。</p> : null}
          {!props.surface ? <p role="status">发布状态尚未就绪，请刷新状态。</p> : null}
          {advisory ? <p role="status">{advisory.message}</p> : null}
          {failure ? <p role="alert">{failure}</p> : null}
          {noChange ? <p role="status">没有待发布的已认领归属，无需创建新版本。</p> : null}
          {stale && !success ? <p role="alert">目录版本已变化，请刷新状态后重新预览，不要发布旧候选。</p> : null}
          {candidate && claims.length > 0 ? <>
            <p>本次发布 {claims.length} 项归属。请逐项核对后确认发布。</p>
            <table className="parameter-catalog__table" aria-label="待发布的子节点归属">
              <thead><tr><th scope="col">子节点</th><th scope="col">所属驱动</th></tr></thead>
              <tbody>{claims.map(claim => <tr key={claim.subjectId}>
                <td title={claim.subjectId}>{claim.subjectName}</td><td title={claim.ownerSubjectId}>{claim.ownerName}</td>
              </tr>)}</tbody>
            </table>
            <details><summary>发布与审核信息</summary><p>候选编号：{candidate.id}</p>
              <p>基准版本：{candidate.expectedBaseReleaseId}</p>
              <p>这是高风险目录变更，沿用现有发布权限和审核规则。组织管理员可按既有规则自批；其他编写者可将候选编号交给有审核权限的人员。</p>
            </details>
          </> : null}
          {job ? <p role="status">{publicationStatusCopy(job).message}{success ? "。归属发布已生效。" : ""}</p> : null}
          {job && !success && !inFlight ? <p>发布尚未生效，请核对错误并刷新状态后重新预览。</p> : null}
          {canReview && !inFlight && !success ? <details><summary>审核已有归属候选</summary>
            <label>候选编号<Input value={reviewId} onChange={event => setReviewId(event.target.value)} disabled={pending} /></label>
            <button type="button" className="button subtle" disabled={pending || !reviewId.trim()} onClick={() => void review()}>读取待审核候选</button>
          </details> : null}
        </div></div>
        <div className="confirm-dialog__actions">
          <button type="button" className="button subtle" disabled={pending} onClick={props.onClose}>关闭</button>
          <button type="button" className="button subtle" disabled={pending || inFlight} onClick={() => {
            flow.setPending(true);
            void Promise.resolve().then(props.onRefreshEvidence).catch(flow.captureError).finally(() => flow.setPending(false));
          }}>刷新发布状态</button>
          {!success ? <button type="button" className="button subtle" disabled={!canPreview || pending || inFlight} onClick={() => setConfirm("preview")}>预览待发布归属</button> : null}
          {!success && candidate ? <button type="button" className="button primary" disabled={!canPublish} onClick={() => setConfirm("publish")}>确认发布归属</button> : null}
        </div>
      </>}
    </ModalDialog>
    <PublicationConfirmation confirm={confirm} allowed={confirm === "publish" ? canPublish : canPreview}
      risk="high" actor={props.actor} pending={pending} onPreview={() => void preview()}
      onPublish={() => void publish()} onCancel={() => setConfirm(null)} />
  </>;
}
