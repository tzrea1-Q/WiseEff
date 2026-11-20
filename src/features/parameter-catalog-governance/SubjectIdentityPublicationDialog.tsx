import { useEffect, useState } from "react";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Input } from "@/components/ui/input";
import type { CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { SubjectIdentityChange, SubjectRulesImpact } from "../../../server/modules/contracts/dtoSchemas/catalogSubjectIdentity";
import { PublicationConfirmation } from "./PublicationConfirmation";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "./publicationSurface";
import { emptyPublicationDraft, publicationJobIsPending, publicationStatusCopy, publicationSuccessKind } from "./publicationState";
import { usePublicationFlow } from "./usePublicationFlow";

type Subject = CatalogSubjectResponse["item"];
const identityActions = [
  { value: "rename", label: "更正规范标识" },
  { value: "add", label: "新增正式别名" },
  { value: "disable", label: "停用正式别名" },
  { value: "restore", label: "恢复正式别名" },
  { value: "transfer", label: "从另一主体转入正式别名" },
] as const;
const rulesActions = [
  { value: "defaults", label: "修订驱动默认规则" },
  { value: "owner", label: "更正规范所属驱动" },
  { value: "kind", label: "更正主体类型" },
  { value: "retire-subject", label: "退役共享主体" },
  { value: "restore-subject", label: "恢复共享主体" },
] as const;
type Action = (typeof identityActions | typeof rulesActions)[number]["value"];
const kinds = [{ value: "driver", label: "驱动" }, { value: "node-type", label: "节点类型" },
  { value: "configuration-schema", label: "配置规范" }] as const;
const natures = [{ value: "physical-device", label: "物理设备" }, { value: "logical-service", label: "逻辑服务" }] as const;
const cardinalities = [{ value: "multiple", label: "多实例" }, { value: "singleton-per-project", label: "每项目单例" }] as const;
const ROOT = "independent";

const resolution: Record<SubjectRulesImpact["conflicts"][number]["reason"], string> = {
  "singleton-project": "项目存在多个实例。请在项目配置中减少到一个实例，或由所属组织在主体识别规则中保留多实例，再重新预览。",
  "owner-registration-required": "请先在相关组织登记并启用目标驱动，再重新预览。",
  "organization-selector-collision": "同一组织归属下已有相同节点名或别名。请调整其中一个识别规则或选择其他驱动。",
  "organization-driver-override": "将节点挂到驱动前，请在相关组织重置该节点的驱动识别覆盖。",
};

function SubjectRulesPreview({ rules }: { rules: SubjectRulesImpact }) {
  const describe = (state: SubjectRulesImpact["after"]) => [
    kinds.find(item => item.value === state.kind)?.label,
    state.lifecycle === "active" ? "生效" : "退役",
    state.ownerSubjectId ? `所属驱动 ${state.ownerSubjectId}` : state.kind === "node-type" ? "独立节点" : null,
    natures.find(item => item.value === state.defaults?.nature)?.label,
    cardinalities.find(item => item.value === state.defaults?.cardinality)?.label,
  ].filter(Boolean).join(" · ");
  const counts = rules.registrationCounts;
  return <>
    <p>当前规则 {describe(rules.before)}<br />发布后 {describe(rules.after)}</p>
    {rules.successor ? <p>承接主体 <strong>{rules.successor.selector}</strong> · {describe(rules.successor)} · <code>{rules.successor.id}</code>。
      原定义、登记、项目绑定和历史值保留原主体身份。需承接定义或项目绑定时，使用对应的迁移流程。</p> : null}
    <p>有效定义 {rules.definitions.length} · 项目 {rules.projectCount} · 项目绑定 {rules.bindingCount}</p>
    <p>组织登记中，启用 {counts.active} · 独立停用 {counts.independentlyRetired} · 组织级联停用 {counts.cascadeRetired} ·
      因共享退役暂停 {counts.sharedSuspended} · 所属驱动覆盖 {counts.ownerOverrides} · 识别规则覆盖 {counts.recognitionOverrides}</p>
    {rules.children.length ? <details><summary>子节点（{rules.children.length}）</summary>
      <ul>{rules.children.map(child => <li key={child.id}>{child.selector} · {child.inherited ? "由承接驱动继承" : "保留所属驱动"}</li>)}</ul>
    </details> : null}
    {rules.definitions.length ? <details><summary>有效定义明细</summary>
      <ul>{rules.definitions.map(definition => <li key={definition.id}>{definition.propertyKey} · <code>{definition.id}</code></li>)}</ul>
    </details> : null}
    {rules.registrations.length ? <details><summary>当前组织登记与覆盖</summary><ul>
      {rules.registrations.map(row => <li key={row.id}>{row.subjectId} · {row.status === "active" ? "启用" : row.cascadeRetired ? "级联停用" : "独立停用"}
        {row.ownerOverride ? ` · 组织所属驱动 ${row.ownerOverride}` : ""}
        {row.cardinalityOverride ? ` · 组织${cardinalities.find(item => item.value === row.cardinalityOverride)?.label}` : ""}</li>)}
    </ul></details> : null}
    {rules.projects.length ? <details><summary>可查看的项目引用</summary>
      <ul>{rules.projects.map(project => <li key={project.id}>{project.id} · {project.instanceCount} 个实例 · {project.bindingCount} 项绑定</li>)}</ul>
    </details> : null}
    {rules.conflictCounts.length ? <div role="alert">
      <p>解决以下冲突后可重新预览。</p>
      <ul>{rules.conflictCounts.map(conflict => <li key={conflict.reason}>{conflict.count} 项。{resolution[conflict.reason]}</li>)}</ul>
      <ul>{rules.conflicts.map((conflict, index) => <li key={`${conflict.reason}-${conflict.projectId ?? conflict.subjectId}-${index}`}>
        {conflict.projectId ? `项目 ${conflict.projectId} · ${conflict.instanceCount} 个实例` : `主体 ${conflict.subjectId}`}
      </li>)}</ul>
    </div> : null}
  </>;
}

export function SubjectIdentityPublicationDialog(props: {
  subject: Subject; subjects: readonly Subject[]; catalog: ParameterCatalogRepository;
  catalogReleaseId: string; currentPersonId: string; organizationId: string;
  surface: PublicationSurfaceItem | null;
  onClose: () => void; onRefreshEvidence: () => void | Promise<void>;
}) {
  const { subject, catalog, catalogReleaseId, surface } = props;
  const flow = usePublicationFlow({ ...props, subjectIdentityId: subject.id });
  const { candidate, pending, job, failure, confirm, setConfirm } = flow;
  const canonicalType = subject.canonicalType ?? subject.type;
  const active = subject.membership.status === "active";
  const actions = active ? [...identityActions, ...rulesActions.filter(entry => entry.value !== "restore-subject" &&
    (entry.value !== "defaults" || canonicalType === "driver") && (entry.value !== "owner" || canonicalType === "node-type"))]
    : rulesActions.filter(entry => entry.value === "restore-subject");
  const [selectedAction, setAction] = useState<Action>("rename");
  const action = actions.some(entry => entry.value === selectedAction) ? selectedAction : actions[0]!.value;
  const [selector, setSelector] = useState("");
  const [from, setFrom] = useState("");
  const [keepOldAlias, setKeepOldAlias] = useState(true);
  const [reviewId, setReviewId] = useState("");
  const [nature, setNature] = useState<"" | (typeof natures)[number]["value"]>("");
  const [cardinality, setCardinality] = useState<"" | (typeof cardinalities)[number]["value"]>("");
  const [nextKind, setNextKind] = useState<(typeof kinds)[number]["value"]>(canonicalType === "driver" ? "node-type" : "driver");
  const [inheritChildren, setInheritChildren] = useState(false);
  const success = job ? publicationSuccessKind(job) : null;
  const inFlight = Boolean(job && publicationJobIsPending(job.status));
  const busy = pending || inFlight;
  const stale = Boolean(candidate && candidate.expectedBaseReleaseId !== catalogReleaseId);
  const impact = candidate?.impactSummary.subjectIdentity;
  const rules = impact?.rules;
  const advisory = surface && publicationSurfaceAdvisory(surface);
  const subjectsWithAliases = props.subjects.filter(other => other.id !== subject.id &&
    (other.canonicalType ?? other.type) === (subject.canonicalType ?? subject.type) && other.formalAliases?.length);
  const aliasSource = action === "transfer" ? subjectsWithAliases.find(other => other.id === from) : subject;
  const offeredAliases = aliasSource?.formalAliases?.filter(alias =>
    action === "transfer" || alias.status === (action === "disable" ? "active" : "retired")) ?? [];
  const available = props.subjects.filter(other => other.id !== subject.id && other.membership.status === "active");
  const subjectOption = (other: Subject) => ({ value: other.id, label: `${other.canonicalName} · ${other.id}` });
  const requiresSelector = identityActions.some(entry => entry.value === action) || action === "kind";
  const driverRules = nature && cardinality ? { nature, cardinality } : null;
  const needsDriverRules = action === "defaults" || (action === "kind" && nextKind === "driver");
  const canPreview = surface?.authoringAllowed === true && (!requiresSelector || Boolean(selector.trim())) &&
    (!needsDriverRules || Boolean(driverRules)) && ((action !== "transfer" && action !== "owner") || Boolean(from)) && !busy && !success;
  const canReview = surface?.publishingAllowed === true || surface?.reviewHighRiskAllowed === true;
  const canPublish = canReview && flow.candidateVerified && Boolean(impact) && !rules?.conflictCounts.length && !stale && !busy && !job;

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
    const subjectId = subject.id;
    const value = selector.trim();
    const change: SubjectIdentityChange | null = (() => {
      switch (action) {
        case "rename": return { op: "rename-subject", subjectId, selector: value, keepOldAlias };
        case "defaults": return driverRules && { op: "set-driver-defaults", subjectId, ...driverRules };
        case "owner": return { op: "change-subject-owner", subjectId, ownerSubjectId: from === ROOT ? null : from };
        case "kind": return nextKind === "driver"
          ? driverRules && { op: "replace-subject-kind", subjectId, replacement: { kind: nextKind, selector: value, ...driverRules } }
          : { op: "replace-subject-kind", subjectId, replacement: { kind: nextKind, selector: value } };
        case "retire-subject": return { op: "retire-subject", subjectId,
          ...(from ? { successorSubjectId: from, ...(inheritChildren ? { inheritChildren: true } : {}) } : {}) };
        case "restore-subject": return { op: "restore-subject", subjectId };
        default: return { op: "set-subject-alias", subjectId, selector: value,
          active: action !== "disable", ...(action === "transfer" ? { fromSubjectId: from } : {}) };
      }
    })();
    if (!change) return;
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
          <p id={descriptionId}>共享目录规则适用于所有组织。各组织已有的识别覆盖、所属驱动覆盖和独立停用记录各自保留。</p>
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
              onValueChange={next => setEdited(() => { setAction(next); setSelector(""); setFrom(""); setInheritChildren(false); })} /></label>
            {action === "transfer" ? <label className="field">转出主体<SelectControl ariaLabel="转出主体" value={from} disabled={busy}
              placeholder="选择转出主体" options={subjectsWithAliases.map(other => ({ value: other.id, label: `${other.canonicalName} · ${other.id}` }))}
              onValueChange={next => setEdited(() => { setFrom(next); setSelector(""); })} /></label> : null}
            {action === "rename" || action === "add" ? <label className="field">{action === "rename" ? "新规范标识" : "正式别名"}
              <Input value={selector} disabled={busy} onChange={event => setEdited(() => setSelector(event.target.value))} /></label>
              : identityActions.some(entry => entry.value === action) ? <label className="field">正式别名<SelectControl ariaLabel="正式别名" value={selector} disabled={busy || !offeredAliases.length}
                placeholder={offeredAliases.length ? "选择正式别名" : "无可选别名"} options={offeredAliases.map(alias => ({ value: alias.selector, label: alias.selector }))}
                onValueChange={next => setEdited(() => setSelector(next))} /></label> : null}
            {action === "rename" ? <label><input type="checkbox" checked={keepOldAlias} disabled={busy}
              onChange={event => setEdited(() => setKeepOldAlias(event.target.checked))} /> 保留旧名为正式目录别名</label> : null}
            {action === "owner" ? <label className="field">规范所属驱动<SelectControl ariaLabel="规范所属驱动" value={from}
              disabled={busy} placeholder="选择归属" options={[{ value: ROOT, label: "独立节点" },
                ...available.filter(other => (other.canonicalType ?? other.type) === "driver").map(subjectOption)]}
              onValueChange={next => setEdited(() => setFrom(next))} /></label> : null}
            {action === "kind" ? <>
              <label className="field">承接主体类型<SelectControl ariaLabel="承接主体类型" value={nextKind}
                options={kinds.filter(kind => kind.value !== canonicalType)} disabled={busy}
                onValueChange={next => setEdited(() => { setNextKind(next); setSelector(""); })} /></label>
              <label className="field">{nextKind === "driver" ? "承接驱动 compatible" : "承接主体规范标识"}<Input value={selector}
                disabled={busy} onChange={event => setEdited(() => setSelector(event.target.value))} /></label>
            </> : null}
            {needsDriverRules ? <>
              <label className="field">驱动性质<SelectControl ariaLabel="驱动性质" value={nature} options={natures} disabled={busy}
                placeholder="选择驱动性质"
                onValueChange={next => setEdited(() => setNature(next))} /></label>
              <label className="field">项目实例规则<SelectControl ariaLabel="项目实例规则" value={cardinality} options={cardinalities} disabled={busy}
                placeholder="选择项目实例规则"
                onValueChange={next => setEdited(() => setCardinality(next))} /></label>
            </> : null}
            {action === "retire-subject" ? <>
              <label className="field">承接主体<SelectControl ariaLabel="承接主体" value={from || ROOT} disabled={busy}
                options={[{ value: ROOT, label: "无承接主体" }, ...available.filter(other => (other.canonicalType ?? other.type) === canonicalType).map(subjectOption)]}
                onValueChange={next => setEdited(() => { setFrom(next === ROOT ? "" : next); setInheritChildren(false); })} /></label>
              {canonicalType === "driver" && from ? <label><input type="checkbox" checked={inheritChildren} disabled={busy}
                onChange={event => setEdited(() => setInheritChildren(event.target.checked))} /> 由承接驱动继承有效子节点</label> : null}
            </> : null}
          </div> : null}
          {impact && candidate ? <section aria-label={success ? "共享标识发布结果" : "共享标识发布预览"}>
            <p>影响所有使用共享目录的组织及其 DTS 匹配。主体 ID、定义、登记和既有项目绑定保留。</p>
            <ul>{impact.subjects.map(entry => <li key={entry.id}>
              {impact.change.op === "set-subject-alias" && impact.change.fromSubjectId ? entry.id === impact.change.fromSubjectId ? "转出：" : "转入：" : ""}
              {entry.canonicalName} · {entry.id} · {entry.definitionCount} 项定义
              {entry.ownerSubjectId ? ` · 所属驱动 ${entry.ownerSubjectId}` : ""}
            </li>)}</ul>
            {impact.change.op === "rename-subject" ? <p>新规范标识 {impact.change.selector}。{impact.change.keepOldAlias ? "旧名继续匹配。" : "旧名退出共享匹配。"}</p>
              : impact.change.op === "set-subject-alias" ? <p>正式目录别名 {impact.change.selector} {success ? "已" : "将"}{impact.change.active ? "启用" : "停用"}。</p> : null}
            {rules ? <SubjectRulesPreview rules={rules} /> : null}
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
