import { useEffect, useMemo, useState } from "react";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";

export type KnowledgeEditorSubmit = {
  title: string;
  tags: string[];
  contentMarkdown: string;
  /** Present when editing; undefined when creating. */
  expectedHeadRevisionNumber?: number;
};

export type KnowledgeEntryEditorDialogProps = {
  open: boolean;
  /** null creates a new markdown entry; an entry edits it in place. */
  entry: KnowledgeEntry | null;
  onSubmit: (input: KnowledgeEditorSubmit) => Promise<void>;
  onClose: () => void;
};

export function parseTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Split edit/preview markdown editor (design D17). Saves carry the expected
 * head revision so a concurrent save surfaces as a readable conflict instead
 * of a silent overwrite.
 */
export function KnowledgeEntryEditorDialog({ open, entry, onSubmit, onClose }: KnowledgeEntryEditorDialogProps) {
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<KnowledgeRevisionConflictError | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(entry?.title ?? "");
      setTagsText(entry?.tags.join(", ") ?? "");
      setContent(entry?.contentMarkdown ?? "");
      setError("");
      setConflict(null);
      setPending(false);
    }
  }, [open, entry]);

  const previewHtml = useMemo(() => renderMarkdownPreview(content), [content]);

  const submit = async () => {
    if (!title.trim()) {
      setError("请填写条目标题。");
      return;
    }
    setPending(true);
    setError("");
    setConflict(null);
    try {
      await onSubmit({
        title: title.trim(),
        tags: parseTagsInput(tagsText),
        contentMarkdown: content,
        ...(entry ? { expectedHeadRevisionNumber: entry.headRevisionNumber } : {})
      });
      onClose();
    } catch (submitError) {
      if (submitError instanceof KnowledgeRevisionConflictError) {
        setConflict(submitError);
      } else {
        setError(submitError instanceof Error && submitError.message ? submitError.message : "保存失败,请稍后重试。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={pending ? undefined : onClose}
      className="knowledge-editor-dialog flex max-h-[min(920px,calc(100dvh-48px))] w-[min(1080px,calc(100vw-48px))] flex-col gap-4 overflow-hidden rounded-xl bg-card p-5 shadow-xl"
      backdropClassName="knowledge-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {entry ? "编辑知识条目" : "新建 Markdown 条目"}
            </h2>
            <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
              {entry
                ? `每次保存都会产生新的不可变修订(当前修订 #${entry.headRevisionNumber})。`
                : "新条目以草稿创建;发布后才进入检索。"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="条目标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="条目标题"
              className="h-9 min-w-64 flex-1 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              aria-label="标签(逗号分隔)"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="标签,逗号分隔(可含项目标签)"
              className="h-9 w-72 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
            <textarea
              aria-label="Markdown 内容"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="以 Markdown 撰写知识内容…"
              className="min-h-64 w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div
              aria-label="预览"
              role="region"
              className="knowledge-markdown-preview min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='text-muted-foreground'>预览区</p>" }}
            />
          </div>

          {conflict ? (
            <div className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950" role="alert">
              保存冲突:当前条目已被其他保存更新到修订 #{conflict.currentHeadRevisionNumber}
              (你基于修订 #{conflict.expectedHeadRevisionNumber})。请复制你的改动,刷新条目后重试。
            </div>
          ) : null}
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "保存中…" : entry ? "保存为新修订" : "创建草稿"}
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
