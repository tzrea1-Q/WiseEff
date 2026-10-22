import { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCanonicalMemberAdditionClient, type MemberAdditionPreview } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

export function WorkbenchSetRootDialog({ projectId, configSetId, fileId, fileName, onDismiss, onApplied, client: supplied }: {
  projectId: string; configSetId: string; fileId: string; fileName: string;
  onDismiss: () => void; onApplied: () => void; client?: ReturnType<typeof createCanonicalMemberAdditionClient>;
}) {
  const client = useMemo(() => supplied ?? createCanonicalMemberAdditionClient(), [supplied]);
  const body = useMemo(() => ({ fileId, role: "base" as const, sortOrder: 0, setAsRoot: true as const }), [fileId]);
  const [preview, setPreview] = useState<MemberAdditionPreview | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  const mutation = useRef<{ proofToken: string; reason: string; clientMutationId: string } | null>(null);
  function showError(cause: unknown) {
    setError(presentError(cause, "无法切换根文件，当前配置已保留。"));
    const items = cause instanceof WiseEffApiError ? cause.details.diagnostics : null;
    setDiagnostics(Array.isArray(items) ? items.flatMap((item: unknown) =>
      item && typeof item === "object" && "message" in item && typeof item.message === "string" ? [item.message] : []) : []);
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setPreview(null); setError(""); setDiagnostics([]); mutation.current = null;
    void client.preview(projectId, configSetId, body).then((value) => { if (active) setPreview(value); })
      .catch((cause) => { if (active) showError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, projectId, configSetId, body, refresh]);
  async function apply() {
    if (busy || !preview || !reason.trim()) return;
    setBusy(true); setError(""); setDiagnostics([]);
    mutation.current ??= { proofToken: preview.proofToken, reason: reason.trim(), clientMutationId: crypto.randomUUID() };
    try { await client.apply(projectId, configSetId, { ...body, ...mutation.current }); onApplied(); }
    catch (cause) {
      if (cause instanceof WiseEffApiError && ["CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code)) {
        mutation.current = null; setPreview(null);
      }
      showError(cause);
    } finally { setBusy(false); }
  }
  return <ModalDialog open onDismiss={busy ? undefined : onDismiss} initialFocusRef={cancel} describedBy
    className="review-dialog submission-dialog" backdropClassName="param-admin-modal-backdrop">
    {({ titleId, descriptionId }) => <>
      <header><div><h2 id={titleId}>设为根文件</h2><p id={descriptionId}>{fileName} 将作为根文件；原根文件改为第一个覆盖层。</p></div></header>
      <div className="review-dialog__body" aria-busy={busy || loading}>
        {loading ? <p role="status">正在验证配置与参数影响…</p> : null}
        {preview ? <>
          <p>入口：{preview.entryFile}；覆盖顺序：{preview.overlayOrder.join(" → ") || "无"}。</p>
          <p>参数变化：{preview.impact.parameterChanges}；新增节点：{preview.impact.nodeAdditions}；移除节点：{preview.impact.nodeRemovals}。</p>
          {preview.impact.restoredParameters ? <p>恢复 {preview.impact.restoredParameters} 个已删除参数，保留原身份及历史。</p> : null}
          <p>保留 {preview.impact.retainedBindings} 个参数关联；{preview.impact.sourceReplacements} 个参数切换来源，身份及历史保留。</p>
          {preview.diagnostics.map((item, index) => <p key={index}>{item.message}</p>)}
          <p>确认后由当前管理员直接提交，并记录实际操作人。</p>
        </> : null}
        <label>切换原因<Input aria-label="切换原因" value={reason} maxLength={2000} disabled={busy || Boolean(mutation.current)} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <div role="alert"><p>{error}</p>{!mutation.current ? <Button variant="outline" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>重新预览</Button> : null}</div> : null}
        {diagnostics.length ? <ul aria-label="来源校验诊断">{diagnostics.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
      </div>
      <footer className="review-dialog__footer"><Button ref={cancel} variant="outline" disabled={busy} onClick={onDismiss}>取消</Button>
        <Button disabled={busy || loading || !preview || !reason.trim()} onClick={() => void apply()}>{busy ? "正在切换…" : mutation.current ? "重试同一操作" : "确认设为根文件"}</Button></footer>
    </>}
  </ModalDialog>;
}
