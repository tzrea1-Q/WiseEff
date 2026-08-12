import { useEffect, useState } from "react";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { parseTagsInput } from "./KnowledgeEntryEditorDialog";

export type KnowledgeFileUploadSubmit = {
  title: string;
  tags: string[];
  file: File;
  expectedHeadRevisionNumber?: number;
};

export type KnowledgeFileUploadDialogProps = {
  open: boolean;
  /** null uploads a new file entry; an entry replaces its binary. */
  entry: KnowledgeEntry | null;
  onSubmit: (input: KnowledgeFileUploadSubmit) => Promise<void>;
  onClose: () => void;
};

const ACCEPTED = ".pdf,.docx,.doc,.txt,.md";

/** File uploads create file-form entries directly (design D12); the binary is replaceable, never editable. */
export function KnowledgeFileUploadDialog({ open, entry, onSubmit, onClose }: KnowledgeFileUploadDialogProps) {
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(entry?.title ?? "");
      setTagsText(entry?.tags.join(", ") ?? "");
      setFile(null);
      setError("");
      setPending(false);
    }
  }, [open, entry]);

  const submit = async () => {
    if (!entry && !title.trim()) {
      setError("请填写条目标题。");
      return;
    }
    if (!file) {
      setError("请选择要上传的文件。");
      return;
    }
    setPending(true);
    setError("");
    try {
      await onSubmit({
        title: title.trim() || entry?.title || file.name,
        tags: parseTagsInput(tagsText),
        file,
        ...(entry ? { expectedHeadRevisionNumber: entry.headRevisionNumber } : {})
      });
      onClose();
    } catch (submitError) {
      if (submitError instanceof KnowledgeRevisionConflictError) {
        setError(
          `保存冲突:条目已被更新到修订 #${submitError.currentHeadRevisionNumber},请刷新后重试。`
        );
      } else {
        setError(submitError instanceof Error && submitError.message ? submitError.message : "上传失败,请稍后重试。");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={pending ? undefined : onClose}
      className="knowledge-upload-dialog flex w-[min(560px,calc(100vw-48px))] flex-col gap-4 rounded-xl bg-card p-5 shadow-xl"
      backdropClassName="knowledge-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {entry ? "替换文件" : "上传文件条目"}
            </h2>
            <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
              {entry
                ? "替换会产生新的不可变修订;旧文件保留在历史修订中。"
                : "支持 PDF、Word(.docx)与纯文本;服务端会提取正文用于检索,提取状态会显示在条目上。"}
            </p>
          </div>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            条目标题
            <input
              aria-label="条目标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={entry ? entry.title : "如:MT5788 无线充手册"}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            标签(逗号分隔)
            <input
              aria-label="标签(逗号分隔)"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="如:project-aurora, 硬件手册"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            文件
            <input
              aria-label="选择文件"
              type="file"
              accept={ACCEPTED}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="rounded-md border border-border bg-background p-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs"
            />
          </label>

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
              {pending ? "上传中…" : entry ? "替换并生成新修订" : "上传并创建草稿"}
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
