import { useEffect, useState } from "react";
import { historicalIdentityLabel } from "@/domain/identity/historicalAttribution";
import { History } from "lucide-react";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry, KnowledgeRevision } from "@/domain/knowledge/types";
import { presentError } from "@/infrastructure/http/presentError";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";

export type KnowledgeRevisionsDialogProps = {
  open: boolean;
  entry: KnowledgeEntry | null;
  loadRevisions: (entryId: string) => Promise<KnowledgeRevision[]>;
  onViewFile: (revision: KnowledgeRevision) => Promise<void>;
  /** Restoring creates a new head revision from the selected one. */
  onRestore: (revision: KnowledgeRevision, expectedHeadRevisionNumber: number) => Promise<void>;
  canRestore: boolean;
  onClose: () => void;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function snippet(value: string | null) {
  if (!value) return "（文件修订）";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat || "（空内容）";
}

export function KnowledgeRevisionsDialog({
  open,
  entry,
  loadRevisions,
  onViewFile,
  onRestore,
  canRestore,
  onClose
}: KnowledgeRevisionsDialogProps) {
  const [revisions, setRevisions] = useState<KnowledgeRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<KnowledgeRevision | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [viewedRevision, setViewedRevision] = useState<KnowledgeRevision | null>(null);
  const [viewedFileRevisionId, setViewedFileRevisionId] = useState<string | null>(null);
  const [filePending, setFilePending] = useState(false);

  useEffect(() => {
    if (!open || !entry) {
      return;
    }
    let cancelled = false;
    setViewedRevision(null);
    setViewedFileRevisionId(null);
    setRestoreTarget(null);
    setRestoreError("");
    setLoading(true);
    setError("");
    loadRevisions(entry.id)
      .then((items) => {
        if (!cancelled) setRevisions(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(presentError(loadError, "修订历史加载失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, loadRevisions]);

  const confirmRestore = async () => {
    if (!entry || !restoreTarget) return;
    setRestorePending(true);
    setRestoreError("");
    try {
      await onRestore(restoreTarget, entry.headRevisionNumber);
      setRestoreTarget(null);
      onClose();
    } catch (restoreFailure) {
      if (restoreFailure instanceof KnowledgeRevisionConflictError) {
        setRestoreError(`条目已被更新到修订 #${restoreFailure.currentHeadRevisionNumber}，请刷新后重试。`);
      } else {
        setRestoreError(presentError(restoreFailure, "恢复失败，请稍后重试。"));
      }
    } finally {
      setRestorePending(false);
    }
  };

  return (
    <>
      <ModalDialog
        open={open}
        onDismiss={onClose}
        className="knowledge-revisions-dialog flex max-h-[min(720px,calc(100dvh-48px))] w-[min(720px,calc(100vw-48px))] flex-col gap-3 overflow-hidden rounded-xl bg-card p-5 shadow-xl"
        backdropClassName="knowledge-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                修订历史{entry ? ` · ${entry.title}` : ""}
              </h2>
              <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
                每次保存都会追加一条不可变修订；恢复历史修订会生成新的修订，不会改写历史。
              </p>
            </div>

            {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

            {viewedRevision ? <div className="min-h-0 flex-1 overflow-auto" aria-label={`修订 #${viewedRevision.revisionNumber} 完整内容`}>
              <h3 className="font-medium">{viewedRevision.title} · 修订 #{viewedRevision.revisionNumber}</h3>
              <p className="text-sm text-muted-foreground">标签：{viewedRevision.tags.join("、") || "无"}</p>
              {viewedRevision.fileId ? <Button variant="outline" size="sm" disabled={filePending} onClick={async () => {
                setFilePending(true);
                setRestoreError("");
                try {
                  await onViewFile(viewedRevision);
                  setViewedFileRevisionId(viewedRevision.id);
                } catch (failure) {
                  setRestoreError(presentError(failure, "打开文件失败，请重试。"));
                } finally {
                  setFilePending(false);
                }
              }}>打开完整文件</Button> : <pre className="whitespace-pre-wrap break-words text-sm">{viewedRevision.contentMarkdown || "（空内容）"}</pre>}
              {restoreError ? <p role="alert" className="text-sm text-destructive">{restoreError}</p> : null}
            </div> : <ul aria-label="修订列表" className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {loading ? <li className="text-sm text-muted-foreground">正在加载修订…</li> : null}
              {!loading && revisions.length === 0 ? <li><Empty><EmptyHeader><EmptyMedia variant="icon"><History /></EmptyMedia><EmptyDescription>暂无修订。</EmptyDescription></EmptyHeader></Empty></li> : null}
              {revisions.map((revision) => {
                const isHead = entry?.headRevisionNumber === revision.revisionNumber;
                return (
                  <li
                    key={revision.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        修订 #{revision.revisionNumber}
                        {isHead ? <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">当前</span> : null}
                        {revision.restoredFromRevisionId ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">恢复而来</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{snippet(revision.contentMarkdown)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {historicalIdentityLabel(revision.historicalAttribution?.actors.author_user_id)} · {formatDateTime(revision.createdAt)}
                      </p>
                    </div>
                      <Button variant="outline" size="sm" onClick={() => { setViewedRevision(revision); setViewedFileRevisionId(null); setRestoreError(""); }}>
                        查看修订 #{revision.revisionNumber}
                      </Button>
                  </li>
                );
              })}
            </ul>}

            <div className="flex justify-end gap-2">
              {viewedRevision ? <Button variant="outline" size="sm" disabled={filePending} onClick={() => setViewedRevision(null)}>返回修订列表</Button> : null}
              {viewedRevision && canRestore && viewedRevision.revisionNumber !== entry?.headRevisionNumber && entry?.status !== "archived" ? (
                <Button size="sm" disabled={Boolean(viewedRevision.fileId) && viewedFileRevisionId !== viewedRevision.id} onClick={() => setRestoreTarget(viewedRevision)}>恢复此版本</Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
          </>
        )}
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title={`恢复修订 #${restoreTarget?.revisionNumber ?? ""}`}
        description={
          <p>
            将把修订 #{restoreTarget?.revisionNumber} 的内容恢复为新的修订 #
            {(entry?.headRevisionNumber ?? 0) + 1}。历史修订不会被改写，条目状态保持不变。
          </p>
        }
        confirmLabel="恢复为新修订"
        pending={restorePending}
        pendingLabel="恢复中…"
        error={restoreError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => {
          setRestoreTarget(null);
          setRestoreError("");
        }}
      />
    </>
  );
}
