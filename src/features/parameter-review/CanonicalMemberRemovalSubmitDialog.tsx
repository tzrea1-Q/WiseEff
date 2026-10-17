import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReviewProvenance } from "./ReviewProvenance";
import type { DtsConfigSetMemberFile } from "@/application/ports/DtsStructuredRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";

export function CanonicalMemberRemovalSubmitDialog({ projectId, configSetId, configSetName, member,
  members, currentUserId, repository, onDismiss, onSubmitted, onReloadMembers, governanceClient }: {
  projectId: string;
  configSetId: string;
  configSetName: string;
  member: DtsConfigSetMemberFile;
  members: readonly DtsConfigSetMemberFile[];
  currentUserId: string;
  repository?: ParameterCatalogRepository;
  onDismiss: () => void;
  onSubmitted: (requestId: string) => void;
  onReloadMembers?: () => Promise<readonly DtsConfigSetMemberFile[]>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [currentMembers, setCurrentMembers] = useState(members);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submission = useRef<{ body: Parameters<NonNullable<ParameterCatalogRepository["submitMemberRemovalRequest"]>>[1];
    context: { catalogReleaseId: string; idempotencyKey: string } } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client.getProjectWorkflowRoleBindings(projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId((current) => eligible.some((reviewer) => reviewer.userId === current) ? current : eligible.length === 1 ? eligible[0]!.userId : "");
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载项目软件审核人失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, currentUserId, projectId, refresh]);

  const submit = async () => {
    if (busy || loading || stale || !currentMembers.some((entry) => entry.fileId === member.fileId)
      || !reviewerId || !reason.trim() || !repository?.submitMemberRemovalRequest) return;
    setBusy(true);
    setError(null);
    try {
      if (!submission.current) {
        const catalogReleaseId = (await repository.getCatalog()).item?.catalogReleaseId;
        if (!catalogReleaseId) throw new Error("当前发布信息不可用，暂不能提交。");
        submission.current = { body: { configSetId, fileId: member.fileId, reason: reason.trim(), assignedToUserId: reviewerId },
          context: { catalogReleaseId, idempotencyKey: crypto.randomUUID() } };
      }
      setUncertain(true);
      const { item } = await repository.submitMemberRemovalRequest(projectId, submission.current.body, submission.current.context);
      if (item.status !== "pending" || item.frozenProof.proofDigest !== item.proofDigest
        || item.assignedToUserId !== reviewerId || item.submitterUserId !== currentUserId) {
        throw new Error("服务端冻结证明不完整；请从提交记录刷新核对。");
      }
      onSubmitted(item.id);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && ["CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(cause.code)) {
        setUncertain(false);
        submission.current = null;
      }
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setStale(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新配置集后重试。")}`
        : presentError(cause, submission.current ? "提交结果尚未确认，填写内容已保留。请重试同一提交。" : "提交前核对失败，填写内容已保留。"));
    } finally { setBusy(false); }
  };

  const ordered = [...currentMembers].sort((left, right) => left.sortOrder - right.sortOrder || left.fileId.localeCompare(right.fileId));
  const targetExists = currentMembers.some((entry) => entry.fileId === member.fileId);
  const reloadMembers = async () => {
    if (!onReloadMembers || busy || loading) return;
    setLoading(true);
    try {
      setCurrentMembers(await onReloadMembers());
      setStale(false);
      setError(null);
    } catch (cause) { setError(presentError(cause, "重新核对成员失败，请重试。")); }
    finally { setLoading(false); }
  };
  return <ModalDialog open className="submission-dialog review-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>申请从配置集移除文件</h2>
      <div className="review-dialog__body">
      <p id={descriptionId}>将从「{configSetName}」移除「{member.fileName}」，保留其余 {Math.max(0, ordered.length - 1)} 个文件。审核通过前不会应用，也不会删除源文件本体。</p>
      <details><summary>查看 {ordered.length} 个配置文件</summary><ol aria-label="提交前成员概览">{ordered.map((entry) => <li key={entry.fileId}>
        {entry.fileName} · {entry.fileId === member.fileId ? "拟移除" : "保留"} · {entry.role === "base" ? "基础文件" : entry.role === "overlay" ? "覆盖文件" : entry.role} · 顺序 {entry.sortOrder}
      </li>)}</ol></details>
      {!targetExists ? <p role="alert">目标文件已不在配置集中，请返回核对。</p> : null}
      <div className="review-inspector__field"><Label htmlFor="member-removal-reason">移除原因</Label><Textarea id="member-removal-reason" required rows={3} placeholder="说明移除文件的原因与影响" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || uncertain} /></div>
      <div className="review-inspector__field"><Label htmlFor="member-removal-reviewer">指定软件审核人</Label><SelectControl id="member-removal-reviewer" value={reviewerId} placeholder="选择软件审核人" disabled={busy || loading || uncertain} ariaLabel="指定软件审核人" ariaRequired
        onValueChange={setReviewerId}
        options={reviewers.length ? reviewers.map((reviewer) => ({ value: reviewer.userId, label: reviewer.name }))
          : [{ value: "", label: loading ? "正在加载审核人…" : "没有可用的另一名软件审核人" }]} /></div>
      {loading ? <p role="status">正在加载可指派审核人…</p> : null}
      {!repository?.submitMemberRemovalRequest ? <p role="alert">成员删除审核接口不可用，已阻止直接移除。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && !reviewers.length ? <button type="button" className="button subtle" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>重新加载审核人</button> : null}
      {stale && onReloadMembers ? <button type="button" className="button subtle" disabled={busy || loading} onClick={() => void reloadMembers()}>重新核对配置成员</button> : null}
      <ReviewProvenance entries={[{ label: "配置集 ID", value: configSetId }, { label: "文件 ID", value: member.fileId }, { label: "当前成员", value: currentMembers }]} />
      </div>
      <div className="dialog-actions review-dialog__footer"><button className="button subtle" type="button" disabled={busy} onClick={onDismiss}>取消</button>
        <button className="button primary" type="button" disabled={busy || loading || stale || !targetExists || !reviewerId || !reason.trim() || !repository?.submitMemberRemovalRequest}
          onClick={() => void submit()}>{busy ? "提交中…" : uncertain ? "重试同一提交" : "提交移除审核"}</button></div>
    </>}
  </ModalDialog>;
}
