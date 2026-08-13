import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Download, ExternalLink, History, Pencil, Send, Upload } from "lucide-react";

import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { canArchive, canEditContent, canPublish, canRestore } from "@/domain/knowledge/rules";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { knowledgeSourceTypeLabels } from "@/domain/knowledge/types";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { KnowledgeExtractionBadge, KnowledgeStatusBadge, KnowledgeTagList } from "./badges";
import { KnowledgeParameterReferenceChips } from "./KnowledgeParameterReferenceChips";

export type KnowledgeEntryDetailDialogProps = {
  open: boolean;
  entry: KnowledgeEntry | null;
  capability: KnowledgeCapability;
  onEdit: (entry: KnowledgeEntry) => void;
  onReplaceFile: (entry: KnowledgeEntry) => void;
  onShowRevisions: (entry: KnowledgeEntry) => void;
  onPublish: (entry: KnowledgeEntry) => Promise<void>;
  onArchive: (entry: KnowledgeEntry) => Promise<void>;
  onRestore: (entry: KnowledgeEntry) => Promise<void>;
  onDownloadFile: (entry: KnowledgeEntry) => Promise<void>;
  /** Deep link into the definition surface (/parameter-admin?spec=…). */
  onOpenParameterSpec?: (specId: string) => void;
  /** Router navigation for distillation source links; absent hides them. */
  onNavigate?: (path: string) => void;
  onClose: () => void;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function KnowledgeEntryDetailDialog({
  open,
  entry,
  capability,
  onEdit,
  onReplaceFile,
  onShowRevisions,
  onPublish,
  onArchive,
  onRestore,
  onDownloadFile,
  onOpenParameterSpec,
  onNavigate,
  onClose
}: KnowledgeEntryDetailDialogProps) {
  const [pendingAction, setPendingAction] = useState<"publish" | "archive" | "restore" | "download" | null>(null);
  const [error, setError] = useState("");
  const previewHtml = useMemo(
    () => (entry?.contentMarkdown ? renderMarkdownPreview(entry.contentMarkdown) : ""),
    [entry?.contentMarkdown]
  );

  if (!entry) {
    return null;
  }

  const runAction = async (kind: "publish" | "archive" | "restore" | "download", action: () => Promise<void>) => {
    setPendingAction(kind);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error && actionError.message ? actionError.message : "操作失败,请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      className="knowledge-detail-dialog flex max-h-[min(880px,calc(100dvh-48px))] w-[min(880px,calc(100vw-48px))] flex-col gap-4 overflow-hidden rounded-xl bg-card p-5 shadow-xl"
      backdropClassName="knowledge-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-foreground">
                <span className="truncate">{entry.title}</span>
                <KnowledgeStatusBadge status={entry.status} />
              </h2>
              <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                修订 #{entry.headRevisionNumber} · 来源 {knowledgeSourceTypeLabels[entry.sourceType]} ·{" "}
                {entry.createdByUserId} 创建 · 更新于 {formatDateTime(entry.updatedAt)}
                {entry.status === "published" ? ` · 发布于 ${formatDateTime(entry.publishedAt)}` : ""}
                {entry.status === "archived" ? ` · 归档于 ${formatDateTime(entry.archivedAt)}` : ""}
              </p>
              <div className="mt-2">
                <KnowledgeTagList tags={entry.tags} />
              </div>
              {entry.parameterReferences.length > 0 ? (
                <div className="mt-2" aria-label="关联参数定义" data-testid="knowledge-parameter-references">
                  <KnowledgeParameterReferenceChips
                    references={entry.parameterReferences}
                    onOpenSpec={onOpenParameterSpec}
                  />
                </div>
              ) : null}
              {onNavigate && (entry.sourceLogId || entry.sourceReloadRunId) ? (
                <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="蒸馏来源">
                  {entry.sourceLogId ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() => onNavigate(`/logs?logId=${encodeURIComponent(entry.sourceLogId!)}`)}
                    >
                      <ExternalLink data-icon="inline-start" />
                      查看日志分析
                    </Button>
                  ) : null}
                  {entry.sourceReloadRunId ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() => onNavigate(`/dts-reload?runId=${encodeURIComponent(entry.sourceReloadRunId!)}`)}
                    >
                      <ExternalLink data-icon="inline-start" />
                      查看重载运行
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            {canEditContent(entry, capability) && entry.contentForm === "markdown" ? (
              <Button variant="outline" size="sm" onClick={() => onEdit(entry)}>
                <Pencil data-icon="inline-start" />
                编辑
              </Button>
            ) : null}
            {canEditContent(entry, capability) && entry.contentForm === "file" ? (
              <Button variant="outline" size="sm" onClick={() => onReplaceFile(entry)}>
                <Upload data-icon="inline-start" />
                替换文件
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onShowRevisions(entry)}>
              <History data-icon="inline-start" />
              修订历史
            </Button>
            {canPublish(entry, capability) ? (
              <Button
                size="sm"
                disabled={pendingAction !== null}
                aria-busy={pendingAction === "publish" || undefined}
                onClick={() => void runAction("publish", () => onPublish(entry))}
              >
                <Send data-icon="inline-start" />
                发布
              </Button>
            ) : null}
            {canArchive(entry, capability) ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                aria-busy={pendingAction === "archive" || undefined}
                onClick={() => void runAction("archive", () => onArchive(entry))}
              >
                <Archive data-icon="inline-start" />
                归档
              </Button>
            ) : null}
            {canRestore(entry, capability) ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                aria-busy={pendingAction === "restore" || undefined}
                onClick={() => void runAction("restore", () => onRestore(entry))}
              >
                <ArchiveRestore data-icon="inline-start" />
                恢复为已发布
              </Button>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {entry.contentForm === "markdown" ? (
              <div
                aria-label="条目内容"
                role="region"
                className="knowledge-markdown-preview text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='text-muted-foreground'>(空内容)</p>" }}
              />
            ) : entry.file ? (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{entry.file.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.file.contentType} · {formatSize(entry.file.sizeBytes)}
                  </span>
                  <KnowledgeExtractionBadge status={entry.file.extractionStatus} error={entry.file.extractionError} />
                </div>
                {entry.file.extractionStatus === "failed" && entry.file.extractionError ? (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-900">
                    提取失败:{entry.file.extractionError}
                  </p>
                ) : null}
                {entry.file.extractionStatus === "succeeded" ? (
                  <p className="text-xs text-muted-foreground">正文已提取;条目发布后可通过全文检索命中。</p>
                ) : null}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingAction !== null}
                    aria-busy={pendingAction === "download" || undefined}
                    onClick={() => void runAction("download", () => onDownloadFile(entry))}
                  >
                    <Download data-icon="inline-start" />
                    下载文件
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">该条目没有文件内容。</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
