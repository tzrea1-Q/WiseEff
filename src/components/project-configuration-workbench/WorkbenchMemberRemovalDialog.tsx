import { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createAdministratorMemberRemovalClient, type AdministratorMemberRemovalPreview } from "@/infrastructure/http/administratorMemberRemovalClient";
import { ROLE_LABELS } from "./workbenchShellHelpers";

export function WorkbenchMemberRemovalDialog({ projectId, configSetId, fileId, fileName, onDismiss, onApplied,
  client: provided }: { projectId: string; configSetId: string; fileId: string; fileName: string; onDismiss: () => void;
  onApplied: () => void; client?: ReturnType<typeof createAdministratorMemberRemovalClient> }) {
  const client = useMemo(() => provided ?? createAdministratorMemberRemovalClient(), [provided]);
  const [preview, setPreview] = useState<AdministratorMemberRemovalPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  const mutation = useRef<{ expectedProofToken: string; reason: string; clientMutationId: string } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setPreview(null); setError(""); mutation.current = null;
    void client.preview(projectId, configSetId, fileId).then((item) => { if (active) setPreview(item); })
      .catch((cause) => { if (active) setError(presentError(cause, "无法预览移除影响，请修复配置文件后重试。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, configSetId, fileId, projectId, refresh]);
  const apply = async () => {
    if (busy || !preview || !reason.trim()) return;
    setBusy(true); setError("");
    const body = mutation.current ?? { expectedProofToken: preview.proofToken, reason: reason.trim(), clientMutationId: crypto.randomUUID() };
    mutation.current = body;
    try { await client.apply(projectId, configSetId, fileId, body); onApplied(); }
    catch (cause) {
      if (cause instanceof WiseEffApiError && ["CONFLICT", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code)) {
        mutation.current = null; setPreview(null);
      }
      setError(presentError(cause, "移除结果尚未确认，填写内容已保留；请重试同一操作。"));
    } finally { setBusy(false); }
  };
  return <ModalDialog open onDismiss={busy ? undefined : onDismiss} initialFocusRef={cancel} describedBy className="review-dialog submission-dialog">
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>预览移除影响</h2>
      <p id={descriptionId}>从配置移除 {fileName}。项目文件、历史源版本和已发布基线继续保留。</p>
      <div className="review-dialog__body">
      {loading ? <p role="status">正在验证配置依赖与参数影响…</p> : null}
      {preview ? <>
        <h3>配置组成</h3><ul>{preview.members.map((member) => <li key={member.fileId}>{member.fileId === fileId ? "移除" : "保留"}：{member.sourceName}（{(ROLE_LABELS as Record<string, string>)[member.role] ?? "其他"}）</li>)}</ul>
        <h3>依赖关系</h3>{preview.dependencies.length ? <ul>{preview.dependencies.map((dependency, index) => <li key={index}>{dependency.file} → {dependency.kind === "overlay" ? "覆盖文件" : "引用文件"}：{dependency.target}</li>)}</ul> : <p>无引用或覆盖依赖。</p>}
        <p>移除 {preview.impact.nodeRemovals} 个结构节点、{preview.impact.removedBindings} 个当前参数；保留并同步 {preview.impact.retainedBindings} 个参数的来源。</p>
        {preview.impact.nodeAdditions ? <p>恢复 {preview.impact.nodeAdditions} 个此前被覆盖的结构节点。</p> : null}
        {preview.impact.restoredParameters ? <p>恢复 {preview.impact.restoredParameters} 个已删除参数，保留原身份及历史。</p> : null}
        {preview.impact.exposedBindings ? <p>另有 {preview.impact.exposedBindings} 个参数将在移除覆盖后重新生效，按保留文件的实际值更新。</p> : null}
        {preview.parameterImpacts.length ? <ul aria-label="参数影响">{preview.parameterImpacts.map((item, index) => <li key={index}>{item.propertyName}：{item.toSource ? `${item.fromSource ?? "被覆盖的来源"} → ${item.toSource}` : `从当前配置移除（${item.fromSource}）`}</li>)}</ul> : null}
        <p>确认后由当前管理员直接提交，并记录实际操作人。</p>
      </> : null}
      <Label htmlFor="administrator-member-removal-reason">移除原因</Label>
      <Textarea id="administrator-member-removal-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || Boolean(mutation.current)} maxLength={2000} />
      {error ? <div role="alert"><p>{error}</p>{!mutation.current ? <Button variant="outline" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>重新预览</Button> : null}<p>可取消并返回文件管理，更新依赖文件后重新操作。</p></div> : null}
      </div>
      <footer className="review-dialog__footer"><Button ref={cancel} variant="outline" disabled={busy} onClick={onDismiss}>取消</Button>
        <Button variant="destructive" disabled={busy || loading || !preview || !reason.trim()} onClick={() => void apply()}>{busy ? "移除中…" : mutation.current ? "重试同一操作" : "确认移除"}</Button></footer>
    </>}
  </ModalDialog>;
}
