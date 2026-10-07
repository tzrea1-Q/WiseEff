import { useEffect, useRef, useState } from "react";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogMemberRemovalRequestResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { canonicalStatusLabels } from "./canonicalSubmissionTracking";

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
  mineOnly = false, initialRequestId, onSelectRequest }: {
  projectId: string;
  repository?: ParameterCatalogRepository;
  currentUserId?: string;
  canReview?: boolean;
  mineOnly?: boolean;
  initialRequestId?: string;
  onSelectRequest?: (id: string) => void;
}) {
  const [view, setView] = useState<View>("pending");
  const [items, setItems] = useState<MemberRequest[]>([]);
  const [selected, setSelected] = useState<MemberRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestedRef = useRef(initialRequestId ?? null);
  const scopeRef = useRef({ projectId, currentUserId });
  const currentScope = () => scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;

  useEffect(() => { scopeRef.current = { projectId, currentUserId }; }, [projectId, currentUserId]);

  useEffect(() => {
    requestedRef.current = initialRequestId ?? null;
  }, [initialRequestId, projectId]);

  useEffect(() => {
    if (!repository?.listMemberRemovalRequests || !repository.getMemberRemovalRequest) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const requestedId = requestedRef.current;
    void repository.listMemberRemovalRequests(projectId, {
      ...(view === "pending" ? { status: "pending" } : {}), mine: mineOnly
    }).then(async (response) => {
      if (cancelled) return;
      const visible = response.items.filter((item) => view === "pending" ? item.status === "pending" : item.status !== "pending");
      const id = requestedId ?? visible[0]?.id;
      const detail = id ? (await repository.getMemberRemovalRequest!(projectId, id)).item : null;
      if (cancelled) return;
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
  }, [projectId, repository, currentUserId, mineOnly, initialRequestId, view, reload]);

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
      setSelected(detail);
      onSelectRequest?.(id);
    } catch (cause) {
      if (currentScope()) setError(presentError(cause, "读取成员删除证明失败。"));
    }
  };
  const decide = async (decision: "approve" | "reject" | "withdraw") => {
    if (!selected || !valid || busy || blocked || selected.status !== "pending") return;
    if (decision === "withdraw" ? !submitter || !repository.withdrawMemberRemovalRequest
      : !assignedReviewer || !repository.reviewMemberRemovalRequest) return;
    setBusy(true);
    setError(null);
    const id = selected.id;
    try {
      const catalog = await repository.getCatalog();
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 Catalog release 不可用，已阻止操作。");
      const context = { catalogReleaseId, idempotencyKey: crypto.randomUUID() };
      if (decision === "withdraw") {
        await repository.withdrawMemberRemovalRequest!(projectId, id, context);
      } else {
        await repository.reviewMemberRemovalRequest!(projectId, id,
          { decision, memberProofDigest: selected.proofDigest }, context);
      }
      if (!currentScope()) return;
      const latest = (await repository.getMemberRemovalRequest!(projectId, id)).item;
      if (!currentScope()) return;
      if (latest.status !== (decision === "withdraw" ? "withdrawn" : decision === "approve" ? "approved" : "rejected")
        || latest.proofDigest !== selected.proofDigest || !proofMatchesRequest(latest)
        || (decision === "approve" && !latest.appliedSourceResult)) {
        throw new Error("成员删除结果不完整，已阻止展示成功状态。");
      }
      setSelected(latest);
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
        setSelected(latest);
        if (latest.status !== "pending") {
          requestedRef.current = id;
          setView("history");
        }
      } catch { /* A fresh read is required before another decision. */ }
    } finally { if (currentScope()) setBusy(false); }
  };

  return <section className="canonical-project-value-review" aria-label={mineOnly ? "我的 JSON 成员删除" : "JSON 成员删除审核"}>
    <header><h2>{mineOnly ? "我的 JSON 成员删除" : "JSON 成员删除审核"}</h2>
      <p>逐项核对服务端冻结的成员与存活 Binding 来源；批准由服务端作为一次事务提交。</p></header>
    <div role="tablist" aria-label="成员删除视角">
      <button className="button subtle" type="button" role="tab" aria-selected={view === "pending"} disabled={busy}
        onClick={() => setView("pending")}>待审核</button>
      <button className="button subtle" type="button" role="tab" aria-selected={view === "history"} disabled={busy}
        onClick={() => setView("history")}>历史</button>
    </div>
    <button className="button subtle" type="button" onClick={refresh} disabled={busy}>刷新成员删除结果</button>
    {loading ? <p role="status">正在加载成员删除请求…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && !error && !items.length && !selected ? <p role="status">当前没有成员删除请求。</p> : null}
    {items.length ? <div className="table-wrap"><table aria-label="成员删除请求列表">
      <thead><tr><th>源文件</th><th>成员</th><th>Binding</th><th>状态</th><th>原因</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><button className="button subtle" type="button" disabled={busy}
        aria-current={selected?.id === item.id ? "true" : undefined}
        onClick={() => void select(item.id)}>{item.frozenProof.members.find((member) => member.fileId === item.fileId)?.sourceName ?? item.fileId}</button></td>
        <td>{item.frozenProof.members.length}</td><td>{item.frozenProof.cohort.length}</td>
        <td>{canonicalStatusLabels[item.status]}</td><td>{item.reason}</td></tr>)}</tbody>
    </table></div> : null}
    {selected ? <article aria-label="JSON 成员删除请求详情">
      <h3>冻结成员删除证明</h3>
      <dl><div><dt>请求 ID</dt><dd><code>{selected.id}</code></dd></div>
        <div><dt>状态</dt><dd>{canonicalStatusLabels[selected.status]}</dd></div>
        <div><dt>配置集</dt><dd><code>{selected.configSetId}</code></dd></div>
        <div><dt>移除文件</dt><dd><code>{selected.fileId}</code></dd></div>
        <div><dt>冻结版本</dt><dd><code>{selected.fileVersionId}</code></dd></div>
        <div><dt>基线修订</dt><dd><code>{selected.frozenProof.configRevisionId}</code></dd></div>
        <div><dt>证明摘要</dt><dd><code>{selected.proofDigest}</code></dd></div>
        <div><dt>原因</dt><dd>{selected.reason}</dd></div>
        <div><dt>提交人</dt><dd><code>{selected.submitterUserId}</code></dd></div>
        <div><dt>指定审核人</dt><dd><code>{selected.assignedToUserId}</code></dd></div>
        <div><dt>实际审核人</dt><dd><code>{selected.reviewerUserId ?? "—"}</code></dd></div>
        {selected.reviewerNote ? <div><dt>审核意见</dt><dd>{selected.reviewerNote}</dd></div> : null}
        {selected.appliedSourceResult ? <div><dt>事务结果</dt><dd><code>{selected.appliedSourceResult.tombstoneId}</code>；后继修订 <code>{selected.appliedSourceResult.successorConfigRevisionId}</code></dd></div> : null}
      </dl>
      {!valid ? <p role="alert">冻结成员、Binding 来源或证明摘要不完整，已阻止审核。</p> : null}
      <h4>有序成员（{selected.frozenProof.members.length}）</h4>
      <ol aria-label="冻结成员列表">{selected.frozenProof.members.map((member, index) => <li key={`${index}:${member.fileId}`}>
        {member.sourceName} — {member.fileId === selected.fileId ? "待移除" : "存活"}；角色 {member.role}，顺序 {member.sortOrder}，版本 <code>{member.fileVersionId}</code>，校验 <code>{member.checksum}</code>
      </li>)}</ol>
      <h4>完整 Binding cohort（{selected.frozenProof.cohort.length}）</h4>
      <ol aria-label="冻结 Binding cohort">{selected.frozenProof.cohort.map((entry, index) => <li key={`${index}:${entry.bindingId}`}>
        <strong>Binding {index + 1}：{entry.fileId === selected.fileId ? "待移除成员" : "存活成员"}</strong>
        <dl><div><dt>Binding</dt><dd><code>{entry.bindingId}</code></dd></div>
          <div><dt>文件／版本</dt><dd><code>{entry.fileId}</code>／<code>{entry.fileVersionId}</code></dd></div>
          <div><dt>基线值</dt><dd><code>{entry.oldValueId}</code></dd></div>
          <div><dt>来源 pin</dt><dd><code>{entry.sourcePinId}</code></dd></div>
          <div><dt>来源 occurrence</dt><dd><code>{entry.sourceOccurrenceId}</code></dd></div>
          <div><dt>定义／修订</dt><dd><code>{entry.definitionId}</code>／<code>{entry.effectiveRevisionId}</code></dd></div>
          <div><dt>定位</dt><dd><code>{JSON.stringify(entry.locator)}</code></dd></div>
          <div><dt>值摘要</dt><dd><code>{entry.valueDigest}</code></dd></div></dl>
      </li>)}</ol>
      {selected.status === "pending" && valid && !blocked ? <div className="dialog-actions">
        {assignedReviewer && !mineOnly ? <><button className="button" type="button" disabled={busy} onClick={() => void decide("approve")}>批准成员删除</button>
          <button className="button subtle" type="button" disabled={busy} onClick={() => void decide("reject")}>驳回成员删除</button></> : null}
        {submitter ? <button className="button subtle" type="button" disabled={busy} onClick={() => void decide("withdraw")}>撤回成员删除</button> : null}
      </div> : null}
      {selected.status === "pending" && !assignedReviewer && !submitter ? <p role="note">仅指定的另一名项目软件审核人可以审批此请求。</p> : null}
      {blocked ? <p role="note">结果未确认，刷新并核对请求后才能再次操作。</p> : null}
    </article> : null}
  </section>;
}
