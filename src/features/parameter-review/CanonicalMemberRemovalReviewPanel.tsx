import { TabPanel } from "@/components/ui/tab-panel";
import { useEffect, useId, useRef, useState } from "react";
import { ViewSwitch } from "@/components/ui/view-switch";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogMemberRemovalRequestResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { canonicalStatusLabels } from "./canonicalSubmissionTracking";
import { ReviewProvenance } from "./ReviewProvenance";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { reviewLocator } from "./ReviewSourceDiff";

type MemberRequest = CatalogMemberRemovalRequestResponse["item"];
type View = "pending" | "history";

function proofMatchesRequest(request: MemberRequest): boolean {
  const proof = request.frozenProof;
  const files = new Set<string>();
  const bindings = new Set<string>();
  if (proof.projectId !== request.projectId || proof.configSetId !== request.configSetId
    || proof.fileId !== request.fileId || proof.fileVersionId !== request.fileVersionId
    || proof.proofDigest !== request.proofDigest || proof.members.length < 2 || proof.cohort.length < 2) return false;
  for (const member of proof.members) {
    if (files.has(member.fileId)) return false;
    files.add(member.fileId);
  }
  if (proof.members.some((member, index) => index > 0 && (
    proof.members[index - 1]!.sortOrder > member.sortOrder
    || (proof.members[index - 1]!.sortOrder === member.sortOrder
      && proof.members[index - 1]!.fileId.localeCompare(member.fileId) > 0)
  ))) return false;
  if (!proof.members.some((member) => member.fileId === request.fileId
    && member.fileVersionId === request.fileVersionId)) return false;
  for (const entry of proof.cohort) {
    if (bindings.has(entry.bindingId) || !proof.members.some((member) => member.fileId === entry.fileId
      && member.fileVersionId === entry.fileVersionId)) return false;
    bindings.add(entry.bindingId);
  }
  if (proof.cohort.some((entry, index) => index > 0
    && proof.cohort[index - 1]!.bindingId.localeCompare(entry.bindingId) > 0)) return false;
  return proof.cohort.some((entry) => entry.fileId === request.fileId)
    && proof.cohort.some((entry) => entry.fileId !== request.fileId);
}

export function CanonicalMemberRemovalReviewPanel({ projectId, repository, currentUserId, canReview = false,
  mineOnly = false, initialRequestId, onSelectRequest, detailOnly = false, externalView,
  onRequestsChanged, onBusyChange, refreshVersion = 0, users = [] }: {
  projectId: string;
  repository?: ParameterCatalogRepository;
  currentUserId?: string;
  canReview?: boolean;
  mineOnly?: boolean;
  initialRequestId?: string;
  onSelectRequest?: (id: string) => void;
  detailOnly?: boolean;
  externalView?: View;
  onRequestsChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
  refreshVersion?: number;
  users?: Array<{ id: string; name: string }>;
}) {
  const [view, setView] = useState<View>(externalView ?? "pending");
  const tabsId = useId();
  const [items, setItems] = useState<MemberRequest[]>([]);
  const [selected, setSelected] = useState<MemberRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestedRef = useRef(initialRequestId ?? null);
  const mountedRef = useRef(false);
  const scopeRef = useRef({ projectId, currentUserId });
  const currentScope = () => mountedRef.current && scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;
  const userName = (id: string | null | undefined) => users.find((user) => user.id === id)?.name ?? (id ? "项目成员（姓名暂不可用）" : "未指派");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { scopeRef.current = { projectId, currentUserId }; }, [projectId, currentUserId]);

  useEffect(() => {
    setRejectOpen(false);
    setApproveOpen(false);
    setWithdrawOpen(false);
    setRejectReason("");
  }, [initialRequestId, projectId, currentUserId, view]);

  useEffect(() => {
    if (externalView) {
      requestedRef.current = initialRequestId ?? null;
      setView(externalView);
    }
  }, [externalView, initialRequestId]);

  useEffect(() => {
    requestedRef.current = initialRequestId ?? null;
  }, [initialRequestId, projectId]);

  useEffect(() => {
    if (!repository?.listMemberRemovalRequests || !repository.getMemberRemovalRequest) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setError(null);
    const requestedId = requestedRef.current ?? (detailOnly ? initialRequestId ?? null : null);
    void repository.listMemberRemovalRequests(projectId, {
      ...(view === "pending" ? { status: "pending" } : {}), mine: mineOnly
    }).then(async (response) => {
      if (cancelled) return;
      const visible = response.items.filter((item) => view === "pending" ? item.status === "pending" : item.status !== "pending");
      const id = requestedId ?? visible[0]?.id;
      const detail = id ? (await repository.getMemberRemovalRequest!(projectId, id)).item : null;
      if (cancelled) return;
      if (detail && (detail.id !== id || detail.projectId !== projectId)) {
        throw new Error("请求详情与当前选择不一致，已阻止显示。");
      }
      if (detail && (detail.status === "pending") !== (view === "pending")) {
        setView(detail.status === "pending" ? "pending" : "history");
        return;
      }
      setItems(visible);
      setSelected(detail);
      if (detail && proofMatchesRequest(detail)) setBlocked(false);
      requestedRef.current = null;
    }).catch((cause) => {
      if (!cancelled) {
        setItems([]);
        setSelected(null);
        setError(presentError(cause, "加载成员删除请求失败，请刷新重试。"));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, repository, currentUserId, detailOnly, mineOnly, initialRequestId, view, reload, refreshVersion]);

  if (!repository?.listMemberRemovalRequests || !repository.getMemberRemovalRequest) return null;
  const valid = Boolean(selected && proofMatchesRequest(selected));
  const assignedReviewer = Boolean(selected && canReview && currentUserId
    && selected.assignedToUserId === currentUserId && selected.submitterUserId !== currentUserId);
  const submitter = Boolean(selected && currentUserId === selected.submitterUserId);
  const sourceName = selected?.frozenProof.members.find((member) => member.fileId === selected.fileId)?.sourceName ?? "配置文件";
  const refresh = () => {
    requestedRef.current = selected?.id ?? null;
    setReload((value) => value + 1);
  };
  const select = async (id: string) => {
    if (busy) return;
    setRejectOpen(false);
    setApproveOpen(false);
    setWithdrawOpen(false);
    setRejectReason("");
    setError(null);
    setSelected(null);
    try {
      const detail = (await repository.getMemberRemovalRequest!(projectId, id)).item;
      if (!currentScope()) return;
      if (detail.id !== id || detail.projectId !== projectId) throw new Error("请求详情与当前选择不一致，已阻止显示。");
      if (!proofMatchesRequest(detail)) throw new Error("成员快照或来源证明不完整，暂不能审核。");
      setSelected(detail);
      setBlocked(false);
      onSelectRequest?.(id);
    } catch (cause) {
      if (currentScope()) setError(presentError(cause, "读取成员删除证明失败。"));
    }
  };
  const refreshDecision = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const latest = (await repository.getMemberRemovalRequest!(projectId, selected.id)).item;
      if (!currentScope()) return;
      if (latest.id !== selected.id || latest.projectId !== projectId || !proofMatchesRequest(latest)) {
        throw new Error("请求详情或来源证明不一致，已阻止再次操作。");
      }
      setSelected(latest);
      setBlocked(false);
      setError(null);
      if (latest.status !== "pending") {
        setRejectOpen(false);
        requestedRef.current = latest.id;
        setView("history");
      }
    } catch (cause) {
      if (currentScope()) setError(presentError(cause, "重新核对请求失败，请重试。"));
    } finally { if (currentScope()) setBusy(false); }
  };
  const decide = async (decision: "approve" | "reject" | "withdraw", note = "") => {
    if (!selected || !valid || busy || blocked || selected.status !== "pending") return;
    if (decision === "withdraw" ? !submitter || !repository.withdrawMemberRemovalRequest
      : !assignedReviewer || !repository.reviewMemberRemovalRequest) return;
    if (decision === "reject" && !note.trim()) return;
    setBusy(true);
    setError(null);
    const id = selected.id;
    try {
      const catalog = await repository.getCatalog();
      if (!currentScope()) return;
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 Catalog release 不可用，已阻止操作。");
      const context = { catalogReleaseId, idempotencyKey: crypto.randomUUID() };
      if (decision === "withdraw") {
        await repository.withdrawMemberRemovalRequest!(projectId, id, context);
      } else {
        await repository.reviewMemberRemovalRequest!(projectId, id,
          { decision, ...(decision === "reject" ? { note: note.trim() } : {}), memberProofDigest: selected.proofDigest }, context);
      }
      if (!currentScope()) return;
      const latest = (await repository.getMemberRemovalRequest!(projectId, id)).item;
      if (!currentScope()) return;
      if (latest.id !== id || latest.projectId !== projectId
        || latest.status !== (decision === "withdraw" ? "withdrawn" : decision === "approve" ? "approved" : "rejected")
        || latest.proofDigest !== selected.proofDigest || !proofMatchesRequest(latest)
        || (decision === "approve" && !latest.appliedSourceResult)) {
        throw new Error("成员删除结果不完整，已阻止展示成功状态。");
      }
      setSelected(latest);
      setRejectOpen(false);
      setApproveOpen(false);
      setWithdrawOpen(false);
      onRequestsChanged?.();
      requestedRef.current = id;
      setView("history");
    } catch (cause) {
      if (!currentScope()) return;
      setApproveOpen(false);
      setWithdrawOpen(false);
      setBlocked(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新后核对状态。")}`
        : presentError(cause, "成员删除操作失败，结果尚未确认；请刷新状态。"));
      try {
        const latest = (await repository.getMemberRemovalRequest!(projectId, id)).item;
        if (!currentScope()) return;
        if (latest.id !== id || latest.projectId !== projectId) return;
        setSelected(latest);
        if (latest.status !== "pending") {
          requestedRef.current = id;
          setView("history");
        }
      } catch { /* A fresh read is required before another decision. */ }
    } finally { if (currentScope()) setBusy(false); }
  };

  return <section className="canonical-project-value-review" aria-label={mineOnly ? "我的 JSON 成员删除" : "JSON 成员删除审核"}>
    {!detailOnly ? <><header><h2>{mineOnly ? "我的 JSON 成员删除" : "JSON 成员删除审核"}</h2>
      <p>核对提交时的成员与关联参数来源；批准后服务端将一次应用全部变更。</p></header>
    <ViewSwitch variant="tabs" ariaLabel="成员删除视角" value={view} onValueChange={(value) => setView(value as View)}
      items={[
        { value: "pending", label: "待审核", id: `${tabsId}-pending-tab`, panelId: `${tabsId}-pending-panel`, disabled: busy },
        { value: "history", label: "历史", id: `${tabsId}-history-tab`, panelId: `${tabsId}-history-panel`, disabled: busy }
      ]} /></> : null}
    <TabPanel role={detailOnly ? undefined : "tabpanel"} id={detailOnly ? undefined : `${tabsId}-${view}-panel`} aria-labelledby={detailOnly ? undefined : `${tabsId}-${view}-tab`}>
    {!selected ? <button className="button subtle" type="button" onClick={refresh} disabled={busy || loading}>{loading ? "刷新中…" : "刷新成员删除结果"}</button> : null}
    {loading ? <p role="status">正在加载成员删除请求…</p> : null}
    {error && !selected ? <p role="alert">{error}</p> : null}
    {!detailOnly && !loading && !error && !items.length && !selected ? <p role="status">当前没有成员删除请求。</p> : null}
    {!detailOnly && items.length ? <div className="table-wrap"><table aria-label="成员删除请求列表">
      <thead><tr><th>源文件</th><th>成员</th><th>关联参数</th><th>状态</th><th>原因</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><button className="button subtle" type="button" disabled={busy}
        aria-current={selected?.id === item.id ? "true" : undefined}
        onClick={() => void select(item.id)}>{item.frozenProof.members.find((member) => member.fileId === item.fileId)?.sourceName ?? item.fileId}</button></td>
        <td>{item.frozenProof.members.length}</td><td>{item.frozenProof.cohort.length}</td>
        <td>{canonicalStatusLabels[item.status]}</td><td>{item.reason}</td></tr>)}</tbody>
    </table></div> : null}
    {selected ? <article className="review-inspector__detail" aria-label="JSON 成员删除请求详情">
      <header className="review-inspector__header">
        <div className="review-inspector__title"><h3>{sourceName}</h3><Badge variant="secondary">{canonicalStatusLabels[selected.status]}</Badge></div>
        <p className="review-inspector__reason">{selected.reason}</p>
        <dl className="review-inspector__meta">
          <div><dt>提交人</dt><dd>{selected.submitterName ?? userName(selected.submitterUserId)}</dd></div>
          <div><dt>指定审核人</dt><dd>{selected.assignedToName ?? userName(selected.assignedToUserId)}</dd></div>
        </dl>
      </header>
      {error || blocked || !valid ? <div className="review-state" role="alert">
        <p>{error ?? (!valid ? "成员快照或来源证明不完整，暂不能审核。" : "结果尚未确认，请重新核对请求状态。")}</p>
        {!rejectOpen && !approveOpen ? <button className="button subtle" type="button" onClick={refresh} disabled={busy || loading}>重新核对状态</button> : null}
      </div> : null}
        <div className="review-inspector__actions">
          {selected.status === "pending" && valid && !blocked ? <>
            {assignedReviewer && !mineOnly ? <><button className="button primary" type="button" disabled={busy} onClick={() => setApproveOpen(true)}>{busy ? "处理中…" : "批准移除"}</button>
              <button className="button subtle" type="button" disabled={busy} onClick={() => setRejectOpen(true)}>驳回</button></> : null}
            {submitter ? <button className="button subtle" type="button" disabled={busy} onClick={() => setWithdrawOpen(true)}>{busy ? "处理中…" : "撤回申请"}</button> : null}
          </> : null}
          {selected.status === "pending" && !assignedReviewer && !submitter ? <p role="note">仅指定的另一名项目软件审核人可以审批此请求。</p> : null}
        </div>
      <section aria-label="变更摘要" className="review-inspector__change-summary">
        <h4 className="sr-only">变更摘要</h4>
        <p>{selected.status === "pending" ? "拟从配置集移除" : "提交方案：移除"} 1 个文件 · 保留 {selected.frozenProof.members.length - 1} 个文件</p>
      </section>
      {selected.status !== "pending" ? <p className="review-inspector__notice" role="note">{selected.status === "approved" ? selected.appliedSourceResult ? "已批准并应用，配置集成员与参数来源已更新。" : "已批准，移除结果待核对。" : `${canonicalStatusLabels[selected.status]}，本次移除未应用。`}</p> : null}
      <section aria-label="前后对比"><h4>前后对比</h4>
        <p role="note">提交时成员快照</p>
        <ol aria-label="冻结成员列表" className="review-inspector__member-list">{selected.frozenProof.members.map((member) => <li key={member.fileId} data-kind={member.fileId === selected.fileId ? "remove" : "equal"}>
          {member.sourceName} · {member.role === "base" ? "基础文件" : member.role === "overlay" ? "覆盖文件" : member.role} · 顺序 {member.sortOrder}
          <span> · {member.fileId !== selected.fileId ? "保留" : selected.status === "pending" ? "拟移除" : selected.status === "approved" ? "已移除" : "移除未应用"}</span>
        </li>)}</ol>
      </section>
      <section aria-label="影响范围"><h4>影响范围</h4>
      <p>提交方案：移除 {selected.frozenProof.cohort.filter((entry) => entry.fileId === selected.fileId).length} 项参数来源；其余 {selected.frozenProof.cohort.filter((entry) => entry.fileId !== selected.fileId).length} 项保留数值并更新来源关联。</p>
      <details className="review-inspector__disclosure"><summary>处理记录</summary>
      <dl className="review-inspector__meta">
        <div><dt>提交时间</dt><dd><time dateTime={selected.createdAt} title={formatAbsolute(selected.createdAt)}>{formatRelativeOrAbsolute(selected.createdAt)}</time></dd></div>
        {selected.reviewerUserId ? <div><dt>实际审核人</dt><dd>{selected.reviewerName ?? userName(selected.reviewerUserId)}</dd></div> : null}
        {selected.status !== "pending" || selected.updatedAt !== selected.createdAt ? <div><dt>{selected.status === "pending" ? "更新时间" : "处理时间"}</dt><dd><time dateTime={selected.updatedAt} title={formatAbsolute(selected.updatedAt)}>{formatRelativeOrAbsolute(selected.updatedAt)}</time></dd></div> : null}
      </dl>
      {selected.reviewerNote ? <p>审核意见：{selected.reviewerNote}</p> : null}
      </details>
      <details className="review-inspector__disclosure"><summary>查看全部 {selected.frozenProof.cohort.length} 项关联参数</summary>
      <ol aria-label="冻结关联参数">{selected.frozenProof.cohort.map((entry, index) => <li key={`${index}:${entry.bindingId}`}>
        <strong>参数 {index + 1}：{entry.fileId === selected.fileId ? selected.status === "pending" ? "拟移除来源" : selected.status === "approved" ? "来源已移除" : "来源未移除" : "保留来源"}</strong>
        <p>{selected.frozenProof.members.find((member) => member.fileId === entry.fileId)?.sourceName} · {reviewLocator(entry.locator)}</p>
      </li>)}</ol></details>
      </section>
      <ReviewProvenance key={selected.id} entries={[
        { label: "请求 ID", value: selected.id }, { label: "项目", value: selected.projectId },
        { label: "配置集", value: selected.configSetId }, { label: "移除文件", value: selected.fileId },
        { label: "冻结版本", value: selected.fileVersionId }, { label: "证明摘要", value: selected.proofDigest },
        { label: "提交人", value: selected.submitterUserId }, { label: "指定审核人", value: selected.assignedToUserId },
        { label: "实际审核人", value: selected.reviewerUserId }, { label: "提交时间", value: selected.createdAt },
        { label: "状态更新时间", value: selected.updatedAt }, { label: "冻结证明", value: selected.frozenProof },
        { label: "事务结果", value: selected.appliedSourceResult }
      ]} />
    </article> : null}
    </TabPanel>
    <ConfirmDialog open={approveOpen && Boolean(selected)} title="确认从配置集移除文件"
      description={`将从配置集中移除「${selected?.frozenProof.members.find((member) => member.fileId === selected.fileId)?.sourceName ?? "所选文件"}」及其 ${selected?.frozenProof.cohort.filter((entry) => entry.fileId === selected.fileId).length ?? 0} 项参数来源，保留其余 ${(selected?.frozenProof.members.length ?? 1) - 1} 个成员，并更新保留参数的来源关联。`}
      confirmLabel="批准移除" tone="danger" pending={busy} confirmDisabled={!valid || blocked}
      error={error} onCancel={() => setApproveOpen(false)} onConfirm={() => void decide("approve")} />
    <ConfirmDialog open={rejectOpen && Boolean(selected)} title={`驳回「${sourceName}」的移除申请`}
      description="本次申请不会移除配置文件。请说明需要调整的内容或补充的依据。" confirmLabel="驳回申请"
      pending={busy} confirmDisabled={!rejectReason.trim() || blocked || !valid || !assignedReviewer || mineOnly} error={error}
      onCancel={() => setRejectOpen(false)}
      extra={<div className="review-inspector__field"><Label htmlFor={`${tabsId}-reject-reason`}>驳回原因</Label><Textarea id={`${tabsId}-reject-reason`} required rows={4} value={rejectReason} disabled={busy}
        placeholder="说明需要调整的内容或补充的依据" onChange={(event) => setRejectReason(event.target.value)} />
        {blocked ? <button type="button" className="button subtle" disabled={busy} onClick={() => void refreshDecision()}>刷新请求状态</button> : null}</div>}
      onConfirm={() => void decide("reject", rejectReason)} />
    <ConfirmDialog open={withdrawOpen && Boolean(selected)} title="确认撤回移除申请"
      description={`将终止「${sourceName}」的本次审核，配置文件尚未移除。后续需要重新提交审核。`}
      confirmLabel="撤回申请" pending={busy} error={error} onCancel={() => setWithdrawOpen(false)}
      onConfirm={() => void decide("withdraw")} />
    {!detailOnly ? <div role="tabpanel" id={`${tabsId}-${view === "pending" ? "history" : "pending"}-panel`}
      aria-labelledby={`${tabsId}-${view === "pending" ? "history" : "pending"}-tab`} hidden /> : null}
  </section>;
}
