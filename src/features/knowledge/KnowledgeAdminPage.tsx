import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, RefreshCw, Trash2 } from "lucide-react";

import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { knowledgeContentFormLabels } from "@/domain/knowledge/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DataTable, PageInsightBar, type Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { KnowledgeTagList } from "./badges";

export type KnowledgeAdminPageProps = {
  repository: KnowledgeRepository;
  canManage: boolean;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

/**
 * Phase 1 admin skeleton: archived-entry management and manage-gated hard
 * delete. The agent-draft publish queue and index health/rebuild arrive with
 * Phases 2/3 of the knowledge plan.
 */
export function KnowledgeAdminPage({ repository, canManage }: KnowledgeAdminPageProps) {
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [restorePendingId, setRestorePendingId] = useState<string | null>(null);

  const loadArchived = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await repository.list({ status: "archived" });
      setRows(result.items);
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message ? error.message : "已归档条目加载失败,请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);

  const archivedCount = useMemo(() => rows.length, [rows]);

  const restoreEntry = async (entry: KnowledgeEntry) => {
    setRestorePendingId(entry.id);
    setErrorMessage("");
    try {
      await repository.restore(entry.id);
      setRows((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message ? error.message : "恢复失败,请稍后重试。");
    } finally {
      setRestorePendingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError("");
    try {
      await repository.hardDelete(deleteTarget.id);
      setRows((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error && error.message ? error.message : "删除失败,请稍后重试。");
    } finally {
      setDeletePending(false);
    }
  };

  const columns: Column<KnowledgeEntry>[] = [
    {
      key: "title",
      header: "标题",
      render: (entry) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{entry.title}</p>
          <p className="text-xs text-muted-foreground">修订 #{entry.headRevisionNumber} · {entry.createdByUserId}</p>
        </div>
      ),
      sortAccessor: (entry) => entry.title
    },
    {
      key: "contentForm",
      header: "形式",
      render: (entry) => (
        <span className="text-xs text-muted-foreground">{knowledgeContentFormLabels[entry.contentForm]}</span>
      ),
      widthClass: "w-20"
    },
    {
      key: "tags",
      header: "标签",
      render: (entry) => <KnowledgeTagList tags={entry.tags} />
    },
    {
      key: "archivedAt",
      header: "归档时间",
      render: (entry) => <span className="text-xs text-muted-foreground">{formatDateTime(entry.archivedAt)}</span>,
      sortAccessor: (entry) => entry.archivedAt ?? "",
      widthClass: "w-28"
    }
  ];

  return (
    <div className="knowledge-admin-page flex flex-col gap-5 p-6">
      <PageInsightBar
        variant={archivedCount > 0 ? "warn" : "info"}
        headline={`已归档 ${archivedCount} 条`}
        description="治理已归档知识条目:恢复回已发布,或在确认后彻底删除。Agent 草稿发布队列与索引健康将在后续阶段加入。"
        actions={[]}
      />

      <section className="flex flex-col gap-2" aria-label="已归档条目管理">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">已归档条目</h2>
          <Button variant="outline" size="sm" onClick={() => void loadArchived()} disabled={loading} aria-busy={loading || undefined}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </div>

        {errorMessage ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p> : null}
        {!canManage ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            当前账号没有知识治理权限;彻底删除等治理操作需要知识管理员执行。
          </p>
        ) : null}

        <DataTable
          aria-label="已归档知识条目"
          rows={rows}
          rowKey={(entry) => entry.id}
          columns={columns}
          pageSize={10}
          renderRowActions={(entry) => (
            <span className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={restorePendingId !== null}
                aria-busy={restorePendingId === entry.id || undefined}
                onClick={() => void restoreEntry(entry)}
              >
                <ArchiveRestore data-icon="inline-start" />
                恢复
              </Button>
              {canManage ? (
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(entry)}>
                  <Trash2 data-icon="inline-start" />
                  彻底删除
                </Button>
              ) : null}
            </span>
          )}
          emptyState={
            loading ? (
              <p className="text-sm text-muted-foreground">正在加载已归档条目…</p>
            ) : (
              <p className="text-sm text-muted-foreground">暂无已归档条目。</p>
            )
          }
        />
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`彻底删除「${deleteTarget?.title ?? ""}」`}
        description={
          <p>
            将永久删除该条目及其全部 {deleteTarget?.headRevisionNumber ?? 0} 个修订,不可恢复。删除会写入审计记录。
          </p>
        }
        confirmLabel="彻底删除"
        tone="danger"
        pending={deletePending}
        pendingLabel="删除中…"
        acknowledgement="我确认删除该条目与全部修订历史。"
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError("");
        }}
      />
    </div>
  );
}
