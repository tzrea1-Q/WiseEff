import { useEffect, useState } from "react";
import type { LogDeletionPreview, LogDeletionStatus } from "@/domain/logs/deletionPreview";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";

export function LogDeletionPreviewDialog({ logId, loadPreview, onClose, purge, loadStatus, onDeleted, initialStatus }: {
  logId: string; loadPreview: (logId: string) => Promise<LogDeletionPreview>; onClose: () => void;
  purge?: (logId: string, version: string) => Promise<LogDeletionStatus>;
  loadStatus?: (logId: string) => Promise<LogDeletionStatus>;
  onDeleted?: (status: LogDeletionStatus) => void;
  initialStatus?: LogDeletionStatus;
}) {
  const [preview, setPreview] = useState<LogDeletionPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initialStatus);
  const [refresh, setRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(initialStatus ?? null);
  useEffect(() => {
    if (initialStatus || result) return;
    let active = true;
    void loadPreview(logId).then((item) => {
      if (item.logId !== logId) throw new Error("预览记录不匹配，请重新获取。");
      if (active) setPreview(item);
    }).catch((cause: unknown) => {
      if (active) setError(presentError(cause, "删除影响预览加载失败，请重试。"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [logId, loadPreview, refresh, initialStatus, result]);
  const remove = async () => {
    if (!purge || !result && !preview) return;
    setSubmitting(true); setError("");
    try {
      let item: LogDeletionStatus;
      try { item = await purge(logId, result?.version ?? preview!.version); }
      catch (cause) {
        // A committed DELETE can lose its HTTP response. The durable receipt is
        // the authority; another DELETE always uses the original confirmation.
        if (!loadStatus) throw cause;
        try { item = await loadStatus(logId); } catch { throw cause; }
      }
      if (item.logId !== logId) throw new Error("删除回执记录不匹配。");
      setResult(item); setPreview(null); onDeleted?.(item);
    } catch (cause) { setError(presentError(cause, "删除未完成，请重新获取预览后确认。")); }
    finally { setSubmitting(false); }
  };
  const retained = preview?.inventory.filter((item) => item.disposition === "retain") ?? [];
  return <ModalDialog open onDismiss={submitting ? undefined : onClose} className="submission-dialog" describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId} className="text-lg font-semibold">{result ? "日志删除结果" : "日志删除影响预览"}</h2>
      <p id={descriptionId} className="text-sm text-muted-foreground">{result ? "数据库删除与存储清理分别记录；可安全重试尚未完成的清理。" : "确认后永久清理所选日志，无法恢复。独立知识正文、已保存引用及其历史、技能和共享源码快照保留。"}</p>
      <div className="min-h-0 space-y-4 overflow-y-auto" aria-busy={loading || submitting}>
      {loading ? <p role="status">正在检查日志及关联数据…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {result ? <div role="status" className="space-y-2 text-sm">
        <p>日志数据库数据已永久删除。</p>
        <p>{result.objects === "complete" ? "存储清理完成。" : `尚有 ${result.pendingObjects} 个存储对象待清理；数据库删除已提交，可重试或稍后从本页继续。`}</p>
      </div> : null}
      {preview ? <div className="space-y-4">
        <p className="break-all text-sm">{preview.fileName} · {preview.logId}</p>
        <details><summary>明细</summary>
        <section aria-label="日志专属数据">
          <h3 className="font-medium">日志专属数据</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {preview.inventory.filter((item) => item.disposition === "delete").map((item) =>
              <div key={item.key} className="flex justify-between gap-3"><dt>{item.label}</dt><dd>{item.count}</dd></div>)}
          </dl>
        </section>
        <section aria-label="存储对象范围" className="text-sm">
          <h3 className="font-medium">存储对象范围</h3>
          <p>对象总数 {preview.objects.total} · 独占对象 {preview.objects.exclusive} · 共享对象 {preview.objects.shared}（保留）</p>
        </section>
        <section aria-label="独立保留范围" className="text-sm">
          <h3 className="font-medium">独立保留范围</h3>
          {retained.some((item) => item.count > 0) ? <dl>{retained.map((item) => <div className="flex justify-between gap-3" key={item.key}>
            <dt>{item.label}</dt><dd>{item.count}</dd></div>)}</dl> : <p>没有关联的保留记录。</p>}
        </section>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{preview.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
        <section aria-label="处理条件" className="text-sm">
          <h3 className="font-medium">处理条件</h3>
          {preview.conditions.some((item) => item.count > 0) ? <ul className="list-disc space-y-1 pl-5">
            {preview.conditions.filter((item) => item.count > 0).map((item) => <li key={item.code}>{item.count} 项：{item.message}</li>)}
          </ul> : <p>没有排队或进行中的日志分析、投递任务。</p>}
        </section>
        <p className="text-xs text-muted-foreground">预览时间：{new Date(preview.generatedAt).toLocaleString()}</p>
      </div> : null}
      </div>
      <div className="dialog-actions">
        {!result ? <Button variant="outline" disabled={loading || submitting} onClick={() => {
          setPreview(null); setError(""); setLoading(true); setRefresh((value) => value + 1);
        }}>{error ? "重试" : "重新获取"}</Button> : null}
        {purge && (!result || result.objects === "pending") ? <Button variant="destructive" disabled={loading || submitting || !result && !preview}
          onClick={() => void remove()}>{submitting ? "正在清理…" : result ? "重试存储清理" : "彻底删除"}</Button> : null}
        <Button disabled={submitting} onClick={onClose}>关闭</Button>
      </div>
    </>}
  </ModalDialog>;
}
