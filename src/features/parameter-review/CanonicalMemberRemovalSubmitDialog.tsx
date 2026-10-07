import { useEffect, useMemo, useState } from "react";
import type { DtsConfigSetMemberFile } from "@/application/ports/DtsStructuredRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";

export function CanonicalMemberRemovalSubmitDialog({ projectId, configSetId, configSetName, member,
  members, currentUserId, repository, onDismiss, onSubmitted, governanceClient }: {
  projectId: string;
  configSetId: string;
  configSetName: string;
  member: DtsConfigSetMemberFile;
  members: readonly DtsConfigSetMemberFile[];
  currentUserId: string;
  repository?: ParameterCatalogRepository;
  onDismiss: () => void;
  onSubmitted: (requestId: string) => void;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void client.getProjectWorkflowRoleBindings(projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载项目软件审核人失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, currentUserId, projectId]);

  const submit = async () => {
    if (busy || loading || !reviewerId || !reason.trim() || !repository?.submitMemberRemovalRequest) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await repository.getCatalog();
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 Catalog release 不可用，已阻止提交。");
      const { item } = await repository.submitMemberRemovalRequest(projectId, {
        configSetId, fileId: member.fileId, reason: reason.trim(), assignedToUserId: reviewerId
      }, { catalogReleaseId, idempotencyKey: crypto.randomUUID() });
      if (item.status !== "pending" || item.frozenProof.proofDigest !== item.proofDigest
        || item.assignedToUserId !== reviewerId || item.submitterUserId !== currentUserId) {
        throw new Error("服务端冻结证明不完整；请从提交记录刷新核对。");
      }
      onSubmitted(item.id);
    } catch (cause) {
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新配置集后重试。")}`
        : presentError(cause, "提交成员删除审核失败。"));
    } finally { setBusy(false); }
  };

  const ordered = [...members].sort((left, right) => left.sortOrder - right.sortOrder || left.fileId.localeCompare(right.fileId));
  return <ModalDialog open className="submission-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>提交 JSON 成员删除审核</h2>
      <p id={descriptionId}>配置集「{configSetName}」的当前成员概览。提交后服务端会重新核对来源，并冻结完整成员与 Binding 证明；审核通过前不移除文件。</p>
      <ol aria-label="提交前成员概览">{ordered.map((entry) => <li key={entry.fileId}>
        {entry.fileName} — {entry.fileId === member.fileId ? "拟移除" : "保留"}；角色 {entry.role}，顺序 {entry.sortOrder}，版本 <code>{entry.currentVersionId ?? "待服务端核对"}</code>
      </li>)}</ol>
      <label>修改原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      <label>指定软件审核人<select value={reviewerId} disabled={busy || loading}
        onChange={(event) => setReviewerId(event.target.value)}>
        {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
          : <option value="">没有可用的另一名软件审核人</option>}
      </select></label>
      {loading ? <p role="status">正在加载可指派审核人…</p> : null}
      {!repository?.submitMemberRemovalRequest ? <p role="alert">成员删除审核接口不可用，已阻止直接移除。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onDismiss}>取消</button>
        <button type="button" disabled={busy || loading || !reviewerId || !reason.trim() || !repository?.submitMemberRemovalRequest}
          onClick={() => void submit()}>{busy ? "提交中…" : "提交冻结证明审核"}</button></div>
    </>}
  </ModalDialog>;
}
