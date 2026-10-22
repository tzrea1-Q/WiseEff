import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "@/domain/parameters/projectDeletionPreview";
import { presentError } from "@/infrastructure/http/presentError";
import { formatBytes } from "@/domain/format/formatBytes";

export function ProjectDeletionPreviewDialog({ projectId, loadPreview, purgeProject, initialStatus, onDeleted, onClose }: {
  projectId: string;
  loadPreview: (projectId: string) => Promise<ProjectDeletionPreview>;
  purgeProject?: (projectId: string, stateDigest: string) => Promise<ProjectDeletionStatus>;
  initialStatus?: ProjectDeletionStatus;
  onDeleted?: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ProjectDeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ProjectDeletionStatus | null>(initialStatus ?? null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (initialStatus) { setLoading(false); return; }
    let active = true;
    loadPreview(projectId).then((item) => { if (active) setPreview(item); })
      .catch((cause: unknown) => { if (active) setError(presentError(cause, "删除影响预览加载失败，请重试。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, loadPreview, refresh, initialStatus]);

  const execute = async () => {
    const digest = result?.stateDigest ?? preview?.stateDigest;
    if (!purgeProject || !digest) return;
    setPending(true); setError("");
    try {
      const item = await purgeProject(projectId, digest);
      setResult(item); onDeleted?.();
    } catch (cause) { setError(presentError(cause, "删除结果暂不可确认，请重试原请求；数据库清理状态可在项目清理记录中读取。")); }
    finally { setPending(false); }
  };

  const sections = [["delete", "项目专属数据：计划清理"], ["detach", "保留对象：需解除项目关联"], ["retain", "保留资源"]] as const;
  const count = (key: string) => preview?.inventory.find((row) => row.key === key)?.count ?? 0;
  return <ModalDialog open onDismiss={() => { if (!pending) onClose(); }} describedBy className="submission-dialog project-admin-form-dialog">
    {({ titleId, descriptionId }) => <>
      <div className="submission-dialog-head param-admin-editor-dialog-head">
        <div><h2 id={titleId}>项目删除影响预览{preview ? ` · ${preview.projectName}` : ""}</h2>
          <p id={descriptionId}>永久删除项目配置、参数、历史修订、部署记录及离线迁移归档，无法恢复。共享定义、独立知识正文、日志及设备保留。</p></div>
      </div>
      <div className="project-admin-form-body overflow-y-auto" aria-busy={loading}>
        {loading ? <p role="status">正在检查项目数据、共享引用与阻塞…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {result ? <div role="status" aria-live="polite">
          <p>项目：{result.projectId}</p><p>数据库清理：已完成。</p>
          <p>{result.objects === "complete" ? "对象清理：已完成。项目彻底删除已完成。" : `对象清理：尚有 ${result.pendingObjects} 个对象未完成；请重试清理。`}</p>
        </div> : null}
        {preview && !result ? <>
          <p>项目：{preview.projectName}（{preview.projectId}）</p>
          <p>配置文件 {count("source-files")} 个，参数 {count("canonical-bindings") + count("legacy-bindings")} 项，历史修订 {count("config-revisions") + count("source-versions")} 项，部署记录 {count("deployment-evidence")} 项。</p>
          <p>已记录存储大小：{formatBytes(preview.storage.totalBytes)}。</p>
          <section aria-label="删除阻塞"><h3>当前阻塞</h3>
            {preview.blockers.length ? <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>
              <strong>{blocker.message}（{blocker.count}）</strong><p>{blocker.action}</p>
            </li>)}</ul> : <p>当前没有删除阻塞。</p>}
          </section>
          <details><summary>明细</summary>
          <p>存储对象：独占 {preview.storage.exclusiveObjects} 个，共享保留 {preview.storage.sharedObjects} 个。</p>
          {sections.map(([disposition, title]) => <section key={disposition} aria-label={title}>
            <h3>{title}</h3><dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
              {preview.inventory.filter((row) => row.disposition === disposition).map((row) =>
                <div className="contents" key={row.key}><dt>{row.label}</dt><dd className="tabular-nums">{row.count}</dd></div>)}
            </dl>
          </section>)}
          <ul>{preview.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </details>
          <p className="text-sm text-muted-foreground">预览时间：{new Date(preview.generatedAt).toLocaleString()}。数据变化后请刷新。</p>
        </> : null}
      </div>
      <div className="dialog-actions">
        {!result ? <Button type="button" variant="outline" disabled={loading || pending} onClick={() => {
          setLoading(true); setError(""); setPreview(null); setRefresh((value) => value + 1);
        }}>
          {error ? "重试预览" : "刷新预览"}</Button> : null}
        {purgeProject && (!result || result.objects === "pending") ? <Button type="button" variant="destructive"
          disabled={loading || pending || (!result && !preview?.executionAvailable)} onClick={() => void execute()}>
          {pending ? "正在清理…" : result ? "重试对象清理" : "彻底删除"}</Button> : null}
        <Button type="button" disabled={pending} onClick={onClose}>关闭预览</Button>
      </div>
    </>}
  </ModalDialog>;
}
