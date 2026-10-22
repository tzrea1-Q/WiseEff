import { useCallback, useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { SkillDeletionPreview, SkillDeletionStatus, SkillWorkspaceRepository } from "./types";

export function SkillDeletionDialog({ skillId, repository, initialStatus, onDismiss, onDeleted, onArchive, onNavigate }: {
  skillId: string; repository: Partial<SkillWorkspaceRepository>; initialStatus?: SkillDeletionStatus;
  onDismiss: () => void; onDeleted: (status: SkillDeletionStatus) => void; onArchive?: () => Promise<void>; onNavigate: (path: string) => void;
}) {
  const [preview, setPreview] = useState<SkillDeletionPreview>();
  const [receipt, setReceipt] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    setPending(true); setError("");
    try {
      if (!repository.previewSkillDeletion) throw new Error("unavailable");
      setPreview(await repository.previewSkillDeletion(skillId));
    } catch { setError("无法加载删除预览，请重试。"); } finally { setPending(false); }
  }, [repository, skillId]);
  useEffect(() => { if (!initialStatus) void load(); }, [initialStatus, load]);
  const purge = async () => {
    const version = receipt?.version ?? preview?.version;
    if (!version || pending) return;
    setPending(true); setError("");
    try {
      if (!repository.purgeSkill) throw new Error("unavailable");
      const item = await repository.purgeSkill(skillId, version); setReceipt(item); onDeleted(item);
    } catch (cause) { setError(cause instanceof WiseEffApiError ? `${cause.message} 请重试或刷新预览。` : "删除未完成，请重试；已提交的删除会安全续接。"); }
    finally { setPending(false); }
  };
  return <ModalDialog open describedBy initialFocusRef={closeRef} onDismiss={pending ? undefined : onDismiss} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <form onSubmit={event => { event.preventDefault(); void purge(); }}>
      <h2 id={titleId}>彻底删除技能</h2>
      <p id={descriptionId}>{receipt ? receipt.name : preview?.name ?? "正在读取技能"}：彻底删除前须先归档，删除后无法恢复。</p>
      {receipt ? <div role="status"><p>{receipt.objects === "pending" ? `数据库已删除；仍有 ${receipt.pendingObjects} 个对象待清理。可关闭后从技能列表继续。` : "数据库及独占对象已清理完成。共享对象保留。"}</p>
        <p>名称和技能标识已释放。保留共享对象 {receipt.retainedObjects} 个。</p></div> : preview ? <>
        {(["delete", "retain"] as const).map(disposition => <div key={disposition}>
          <h3>{disposition === "delete" ? "删除" : "保留"}</h3>
          <ul className="grid gap-1 text-sm">{preview.inventory.filter(item => item.disposition === disposition && item.count &&
            !["skill", "source-files", "source-chunks", "source-statements", "artifacts", "case-runs"].includes(item.key))
            .map(item => <li key={item.key}>{item.label}：{item.count}</li>)}</ul>
        </div>)}
        <p>存储对象 {preview.objects.total} 个：独占 {preview.objects.exclusive} 个，共享保留 {preview.objects.shared} 个。</p>
        {preview.blockers.length ? <ul role="alert">{preview.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul> : null}
      </> : <p role="status">{pending ? "正在加载预览…" : "预览尚未加载。"}</p>}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <div className="dialog-actions"><Button ref={closeRef} type="button" variant="outline" disabled={pending} onClick={onDismiss}>{receipt ? "关闭" : "取消"}</Button>
        {!receipt ? <Button type="button" variant="outline" disabled={pending} onClick={() => void load()}>刷新预览</Button> : null}
        {receipt?.objects === "pending" ? <Button type="submit" disabled={pending}>{pending ? "清理中…" : "重试对象清理"}</Button>
          : !receipt && preview?.canDelete ? <Button type="submit" variant="destructive" disabled={pending}>{pending ? "删除中…" : "彻底删除"}</Button> : null}
        {!receipt && preview && !preview.canDelete && preview.status === "active" ? <Button type="button" disabled={pending} onClick={() => {
          if (!onArchive) { onNavigate("/log-admin?tab=skills"); return; }
          setPending(true); setError(""); void onArchive().then(onDismiss).catch(() => setError("归档失败，请重试。" )).finally(() => setPending(false));
        }}>{onArchive ? "归档技能" : "前往技能列表归档"}</Button> : null}
      </div>
    </form>}
  </ModalDialog>;
}
