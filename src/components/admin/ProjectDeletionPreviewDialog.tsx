import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import type { ProjectDeletionPreview } from "@/domain/parameters/projectDeletionPreview";
import { presentError } from "@/infrastructure/http/presentError";

export function ProjectDeletionPreviewDialog({ projectId, loadPreview, onClose }: {
  projectId: string;
  loadPreview: (projectId: string) => Promise<ProjectDeletionPreview>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ProjectDeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    loadPreview(projectId).then((item) => { if (active) setPreview(item); })
      .catch((cause: unknown) => { if (active) setError(presentError(cause, "删除影响预览加载失败，请重试。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, loadPreview, refresh]);

  const sections = [["delete", "项目专属数据：计划清理"], ["detach", "保留对象：需解除项目关联"], ["retain", "保留资源"]] as const;
  return <ModalDialog open onDismiss={onClose} describedBy className="submission-dialog project-admin-form-dialog">
    {({ titleId, descriptionId }) => <>
      <div className="submission-dialog-head param-admin-editor-dialog-head">
        <div><h2 id={titleId}>项目删除影响预览{preview ? ` · ${preview.projectName}` : ""}</h2>
          <p id={descriptionId}>此检查只读取数据。实际删除功能由后续任务交付。</p></div>
      </div>
      <div className="project-admin-form-body overflow-y-auto" aria-busy={loading}>
        {loading ? <p role="status">正在检查项目数据、共享引用与阻塞…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {preview ? <>
          <p>项目：{preview.projectName}（{preview.projectId}）</p>
          <p>存储对象：独占 {preview.storage.exclusiveObjects} 个，共享保留 {preview.storage.sharedObjects} 个；合计 {preview.storage.totalBytes.toLocaleString()} 字节。</p>
          <section aria-label="删除阻塞"><h3>当前阻塞</h3>
            {preview.blockers.length ? <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>
              <strong>{blocker.message}（{blocker.count}）</strong><p>{blocker.action}</p>
            </li>)}</ul> : <p>当前快照未发现已列明的运行或保留阻塞；这不代表已授权删除。</p>}
          </section>
          {sections.map(([disposition, title]) => <section key={disposition} aria-label={title}>
            <h3>{title}</h3><dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
              {preview.inventory.filter((row) => row.disposition === disposition).map((row) =>
                <div className="contents" key={row.key}><dt>{row.label}</dt><dd className="tabular-nums">{row.count}</dd></div>)}
            </dl>
          </section>)}
          <ul>{preview.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          <p className="text-sm text-muted-foreground">预览时间：{new Date(preview.generatedAt).toLocaleString()}。数据变化后请刷新。</p>
        </> : null}
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="outline" disabled={loading} onClick={() => {
          setLoading(true); setError(""); setPreview(null); setRefresh((value) => value + 1);
        }}>
          {error ? "重试预览" : "刷新预览"}</Button>
        <Button type="button" onClick={onClose}>关闭预览</Button>
      </div>
    </>}
  </ModalDialog>;
}
