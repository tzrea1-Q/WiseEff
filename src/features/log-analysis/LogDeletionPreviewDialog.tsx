import { useEffect, useState } from "react";
import type { LogDeletionPreview } from "@/domain/logs/deletionPreview";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";

export function LogDeletionPreviewDialog({ logId, loadPreview, onClose }: {
  logId: string; loadPreview: (logId: string) => Promise<LogDeletionPreview>; onClose: () => void;
}) {
  const [preview, setPreview] = useState<LogDeletionPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void loadPreview(logId).then((item) => {
      if (item.logId !== logId) throw new Error("预览记录不匹配，请重新获取。");
      if (active) setPreview(item);
    }).catch((cause: unknown) => {
      if (active) setError(presentError(cause, "删除影响预览加载失败，请重试。"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [logId, loadPreview, refresh]);
  const retained = preview?.inventory.filter((item) => item.disposition === "retain") ?? [];
  return <ModalDialog open onDismiss={onClose} className="submission-dialog" describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId} className="text-lg font-semibold">日志删除影响预览</h2>
      <p id={descriptionId} className="text-sm text-muted-foreground">检查所选日志的永久清理范围；当前操作只读。</p>
      <div className="min-h-0 space-y-4 overflow-y-auto" aria-busy={loading}>
      {loading ? <p role="status">正在检查日志及关联数据…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {preview ? <div className="space-y-4">
        <p className="break-all text-sm">{preview.fileName} · {preview.logId}</p>
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
        <section aria-label="处理条件" className="text-sm">
          <h3 className="font-medium">处理条件</h3>
          {preview.conditions.some((item) => item.count > 0) ? <ul className="list-disc space-y-1 pl-5">
            {preview.conditions.filter((item) => item.count > 0).map((item) => <li key={item.code}>{item.count} 项：{item.message}</li>)}
          </ul> : <p>没有排队或进行中的日志分析、投递任务。</p>}
        </section>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{preview.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        <p className="text-xs text-muted-foreground">预览时间：{new Date(preview.generatedAt).toLocaleString()}</p>
      </div> : null}
      </div>
      <div className="dialog-actions">
        <Button variant="outline" disabled={loading} onClick={() => {
          setPreview(null); setError(""); setLoading(true); setRefresh((value) => value + 1);
        }}>{error ? "重试" : "重新获取"}</Button>
        <Button onClick={onClose}>关闭</Button>
      </div>
    </>}
  </ModalDialog>;
}
