import { useEffect, useState } from "react";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry, KnowledgeRevision } from "@/domain/knowledge/types";
import { presentError } from "@/infrastructure/http/presentError";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";

export type KnowledgeRevisionsDialogProps = {
  open: boolean;
  entry: KnowledgeEntry | null;
  loadRevisions: (entryId: string) => Promise<KnowledgeRevision[]>;
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
  if (!value) return "(文件修订)";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat || "(空内容)";
}

export function KnowledgeRevisionsDialog({
  open,
  entry,
  loadRevisions,
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

  useEffect(() => {
    if (!open || !entry) {
      return;
    }
    let cancelled = false;
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
        setRestoreError(`条目已被更新到修订 #${restoreFailure.currentHeadRevisionNumber},请刷新后重试。`);
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
                每次保存都会追加一条不可变修订;恢复历史修订会生成新的修订,不会改写历史。
              </p>
            </div>

            {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

            <ul aria-label="修订列表" className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {loading ? <li className="text-sm text-muted-foreground">正在加载修订…</li> : null}
              {!loading && revisions.length === 0 ? <li className="text-sm text-muted-foreground">暂无修订。</li> : null}
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
                        {revision.authorUserId ?? "已注销用户"} · {formatDateTime(revision.createdAt)}
                      </p>
                    </div>
                    {canRestore && !isHead && entry?.status !== "archived" ? (
                      <Button variant="outline" size="sm" onClick={() => setRestoreTarget(revision)}>
                        恢复此版本
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div className="flex justify-end">
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
            {(entry?.headRevisionNumber ?? 0) + 1}。历史修订不会被改写,条目状态保持不变。
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
