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
  onRequestsChanged, users = [] }: {
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
  users?: Array<{ id: string; name: string }>;
}) {
  const [view, setView] = useState<View>(externalView ?? "pending");
  const tabsId = useId();
  const [items, setItems] = useState<MemberRequest[]>([]);
  const [selected, setSelected] = useState<MemberRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestedRef = useRef(initialRequestId ?? null);
  const mountedRef = useRef(false);
  const scopeRef = useRef({ projectId, currentUserId });
  const currentScope = () => mountedRef.current && scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;
  const userName = (id: string | null | undefined) => users.find((user) => user.id === id)?.name ?? id ?? "未指派";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { scopeRef.current = { projectId, currentUserId }; }, [projectId, currentUserId]);

  useEffect(() => {
    setRejectOpen(false);
    setRejectReason("");
  }, [selected?.id, projectId, currentUserId, view]);

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
      requestedRef.current = null;
    }).catch((cause) => {
      if (!cancelled) {
        setItems([]);
        setSelected(null);
        setError(presentError(cause, "加载成员删除请求失败，请刷新重试。"));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, repository, currentUserId, detailOnly, mineOnly, initialRequestId, view, reload]);

  if (!repository?.listMemberRemovalRequests || !repository.getMemberRemovalRequest) return null;
  const valid = Boolean(selected && proofMatchesRequest(selected));
  const assignedReviewer = Boolean(selected && canReview && currentUserId
    && selected.assignedToUserId === currentUserId && selected.submitterUserId !== currentUserId);
  const submitter = Boolean(selected && currentUserId === selected.submitterUserId);
  const refresh = () => {
    requestedRef.current = selected?.id ?? null;
    setBlocked(false);
    setReload((value) => value + 1);
  };
  const select = async (id: string) => {
    if (busy) return;
    setError(null);
    setBlocked(false);
    try {
      const detail = (await repository.getMemberRemovalRequest!(projectId, id)).item;
      if (!currentScope()) return;
      if (detail.id !== id || detail.projectId !== projectId) throw new Error("请求详情与当前选择不一致，已阻止显示。");
      setSelected(detail);
      onSelectRequest?.(id);
    } catch (cause) {
      if (currentScope()) setError(presentError(cause, "读取成员删除证明失败。"));
    }
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
      onRequestsChanged?.();
      requestedRef.current = id;
      setView("history");
    } catch (cause) {
      if (!currentScope()) return;
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
      <p>逐项核对服务端冻结的成员与存活 Binding 来源；批准由服务端作为一次事务提交。</p></header>
    <ViewSwitch variant="tabs" ariaLabel="成员删除视角" value={view} onValueChange={(value) => setView(value as View)}
      items={[
        { value: "pending", label: "待审核", id: `${tabsId}-pending-tab`, panelId: `${tabsId}-pending-panel`, disabled: busy },
        { value: "history", label: "历史", id: `${tabsId}-history-tab`, panelId: `${tabsId}-history-panel`, disabled: busy }
      ]} /></> : null}
    <TabPanel role={detailOnly ? undefined : "tabpanel"} id={detailOnly ? undefined : `${tabsId}-${view}-panel`} aria-labelledby={detailOnly ? undefined : `${tabsId}-${view}-tab`}>
    <button className="button subtle" type="button" onClick={refresh} disabled={busy}>刷新成员删除结果</button>
    {loading ? <p role="status">正在加载成员删除请求…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!detailOnly && !loading && !error && !items.length && !selected ? <p role="status">当前没有成员删除请求。</p> : null}
    {!detailOnly && items.length ? <div className="table-wrap"><table aria-label="成员删除请求列表">
      <thead><tr><th>源文件</th><th>成员</th><th>Binding</th><th>状态</th><th>原因</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><button className="button subtle" type="button" disabled={busy}
        aria-current={selected?.id === item.id ? "true" : undefined}
        onClick={() => void select(item.id)}>{item.frozenProof.members.find((member) => member.fileId === item.fileId)?.sourceName ?? item.fileId}</button></td>
        <td>{item.frozenProof.members.length}</td><td>{item.frozenProof.cohort.length}</td>
        <td>{canonicalStatusLabels[item.status]}</td><td>{item.reason}</td></tr>)}</tbody>
    </table></div> : null}
    {selected ? <article aria-label="JSON 成员删除请求详情">
      <header>
        <p>JSON 成员删除</p><h3>{selected.reason}</h3>
        <span className="status-chip">{canonicalStatusLabels[selected.status]}</span>
        <p>{userName(selected.submitterUserId)} → {userName(selected.assignedToUserId)}</p>
        <time dateTime={selected.createdAt} title={formatAbsolute(selected.createdAt)}>{formatRelativeOrAbsolute(selected.createdAt)}</time>
        {selected.reviewerUserId ? <p>实际审核人：{userName(selected.reviewerUserId)}</p> : null}
        {selected.reviewerNote ? <p>审核意见：{selected.reviewerNote}</p> : null}
      </header>
      <section aria-label="变更摘要"><h4>变更摘要</h4>
        <p>从配置集中移除 {selected.frozenProof.members.find((member) => member.fileId === selected.fileId)?.sourceName ?? selected.fileId}，保留其余 {selected.frozenProof.members.length - 1} 个成员。</p>
      </section>
      {!valid ? <p role="alert">冻结成员、Binding 来源或证明摘要不完整，已阻止审核。</p> : null}
      <section aria-label="前后对比"><h4>前后对比</h4>
        <p role="note">以下成员配置固定于提交时，不随当前文件变化。</p>
        <p>变更前</p><TabPanel aria-label="冻结成员变更前"><pre>{JSON.stringify(selected.frozenProof.members.map(({ sourceName, format, role, sortOrder, sizeBytes }) => ({ sourceName, format, role, sortOrder, sizeBytes })), null, 2)}</pre></TabPanel>
        <p>变更后</p><TabPanel aria-label="冻结成员变更后"><pre>{JSON.stringify(selected.frozenProof.members.filter((member) => member.fileId !== selected.fileId).map(({ sourceName, format, role, sortOrder, sizeBytes }) => ({ sourceName, format, role, sortOrder, sizeBytes })), null, 2)}</pre></TabPanel>
      </section>
      <section aria-label="影响范围"><h4>影响范围</h4>
      <p>有序成员（{selected.frozenProof.members.length}）</p>
      <ol aria-label="冻结成员列表">{selected.frozenProof.members.map((member, index) => <li key={`${index}:${member.fileId}`}>
        {member.sourceName} — {member.fileId === selected.fileId ? "待移除" : "存活"}；角色 {member.role}，顺序 {member.sortOrder}
      </li>)}</ol>
      <p>完整 Binding cohort（{selected.frozenProof.cohort.length}）</p>
      <ol aria-label="冻结 Binding cohort">{selected.frozenProof.cohort.map((entry, index) => <li key={`${index}:${entry.bindingId}`}>
        <strong>Binding {index + 1}：{entry.fileId === selected.fileId ? "待移除成员" : "存活成员"}</strong>
        <p>{selected.frozenProof.members.find((member) => member.fileId === entry.fileId)?.sourceName} · {JSON.stringify(entry.locator)}</p>
      </li>)}</ol>
      </section>
      <footer className="dialog-actions">
      {selected.status === "pending" && valid && !blocked ? <>
        {assignedReviewer && !mineOnly ? <><button className="button primary" type="button" disabled={busy} onClick={() => void decide("approve")}>批准成员删除</button>
          <button className="button subtle" type="button" disabled={busy} onClick={() => setRejectOpen(true)}>驳回成员删除</button></> : null}
        {submitter ? <button className="button subtle" type="button" disabled={busy} onClick={() => void decide("withdraw")}>撤回成员删除</button> : null}
      </> : null}
      {selected.status === "pending" && !assignedReviewer && !submitter ? <p role="note">仅指定的另一名项目软件审核人可以审批此请求。</p> : null}
      {blocked ? <p role="note">结果未确认，刷新并核对请求后才能再次操作。</p> : null}
      </footer>
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
    <ConfirmDialog open={rejectOpen && Boolean(selected)} title="驳回成员删除"
      description="请说明保留成员的原因，方便提交人核对影响范围。" confirmLabel="确认驳回"
      pending={busy} confirmDisabled={!rejectReason.trim()} error={error}
      onCancel={() => { setRejectOpen(false); setRejectReason(""); }}
      extra={<label>驳回原因<textarea required rows={4} value={rejectReason} disabled={busy}
        onChange={(event) => setRejectReason(event.target.value)} /></label>}
      onConfirm={() => void decide("reject", rejectReason)} />
    {!detailOnly ? <div role="tabpanel" id={`${tabsId}-${view === "pending" ? "history" : "pending"}-panel`}
      aria-labelledby={`${tabsId}-${view === "pending" ? "history" : "pending"}-tab`} hidden /> : null}
  </section>;
}
