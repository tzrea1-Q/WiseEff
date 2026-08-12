import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, DatabaseZap, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry, KnowledgeIndexHealth, KnowledgeIndexStatusItem } from "@/domain/knowledge/types";
import {
  knowledgeContentFormLabels,
  knowledgeIndexStateLabels,
  knowledgeRetrievalModeLabels,
  knowledgeStatusLabels
} from "@/domain/knowledge/types";
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
 * Knowledge governance: archived-entry management, manage-gated hard delete,
 * and retrieval index health (per-entry status, retry, rebuild-all). The
 * agent-draft publish queue arrives with Phase 3 of the knowledge plan.
 */
export function KnowledgeAdminPage({ repository, canManage }: KnowledgeAdminPageProps) {
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [restorePendingId, setRestorePendingId] = useState<string | null>(null);
  const [indexHealth, setIndexHealth] = useState<KnowledgeIndexHealth | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState("");
  const [indexActionPendingId, setIndexActionPendingId] = useState<string | null>(null);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState("");

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

  const loadIndexHealth = useCallback(async () => {
    if (!canManage) {
      return;
    }
    setIndexLoading(true);
    setIndexError("");
    try {
      setIndexHealth(await repository.getIndexHealth());
    } catch (error) {
      setIndexError(error instanceof Error && error.message ? error.message : "索引健康加载失败,请稍后重试。");
    } finally {
      setIndexLoading(false);
    }
  }, [repository, canManage]);

  useEffect(() => {
    void loadArchived();
    void loadIndexHealth();
  }, [loadArchived, loadIndexHealth]);

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

  const retryIndex = async (item: KnowledgeIndexStatusItem) => {
    setIndexActionPendingId(item.entryId);
    setIndexError("");
    try {
      await repository.retryEntryIndex(item.entryId);
      await loadIndexHealth();
    } catch (error) {
      setIndexError(error instanceof Error && error.message ? error.message : "重试入队失败,请稍后重试。");
    } finally {
      setIndexActionPendingId(null);
    }
  };

  const rebuildIndex = async () => {
    setRebuildPending(true);
    setIndexError("");
    setRebuildNotice("");
    try {
      const result = await repository.rebuildIndex();
      setRebuildNotice(`已重新入队 ${result.enqueued} 条已发布条目,索引由后台 worker 逐条重建。`);
      await loadIndexHealth();
    } catch (error) {
      setIndexError(error instanceof Error && error.message ? error.message : "全量重建入队失败,请稍后重试。");
    } finally {
      setRebuildPending(false);
    }
  };

  const indexStateTone: Record<KnowledgeIndexStatusItem["status"], string> = {
    pending: "bg-amber-100 text-amber-800",
    processing: "bg-sky-100 text-sky-800",
    succeeded: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-800"
  };

  const indexColumns: Column<KnowledgeIndexStatusItem>[] = [
    {
      key: "title",
      header: "条目",
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            {knowledgeStatusLabels[item.entryStatus]}
            {item.indexedRevisionNumber !== null ? ` · 已索引修订 #${item.indexedRevisionNumber}` : ""}
          </p>
        </div>
      ),
      sortAccessor: (item) => item.title
    },
    {
      key: "status",
      header: "索引状态",
      render: (item) => (
        <span
          data-index-status={item.status}
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${indexStateTone[item.status]}`}
        >
          {knowledgeIndexStateLabels[item.status]}
        </span>
      ),
      sortAccessor: (item) => item.status,
      widthClass: "w-24"
    },
    {
      key: "chunks",
      header: "分块",
      render: (item) => (
        <span className="text-xs text-muted-foreground">
          {item.chunkCount}
          {item.embeddedChunkCount > 0 ? ` (向量 ${item.embeddedChunkCount})` : ""}
        </span>
      ),
      widthClass: "w-24"
    },
    {
      key: "error",
      header: "失败原因",
      render: (item) =>
        item.error ? (
          <span className="block max-w-72 truncate text-xs text-destructive" title={item.error}>
            {item.error}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
    },
    {
      key: "updatedAt",
      header: "更新时间",
      render: (item) => <span className="text-xs text-muted-foreground">{formatDateTime(item.updatedAt)}</span>,
      sortAccessor: (item) => item.updatedAt,
      widthClass: "w-28"
    }
  ];

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
        description="治理已归档知识条目与检索索引健康:恢复、彻底删除、单条重试或全量重建索引。Agent 草稿发布队列将在后续阶段加入。"
        actions={[]}
      />

      <section className="flex flex-col gap-2" aria-label="检索索引健康">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">检索索引健康</h2>
          <span className="flex items-center gap-2">
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void rebuildIndex()}
                disabled={rebuildPending || indexLoading}
                aria-busy={rebuildPending || undefined}
              >
                <DatabaseZap data-icon="inline-start" />
                全量重建索引
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadIndexHealth()}
              disabled={indexLoading || !canManage}
              aria-busy={indexLoading || undefined}
            >
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          </span>
        </div>

        {indexHealth ? (
          <p
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
            data-retrieval-mode={indexHealth.retrieval.mode}
            aria-label="检索模式"
          >
            当前检索模式:<strong>{knowledgeRetrievalModeLabels[indexHealth.retrieval.mode]}</strong>
            <span className="ml-2 text-xs text-muted-foreground">
              pgvector {indexHealth.retrieval.vectorAvailable ? "可用" : "不可用"} · 嵌入端点
              {indexHealth.retrieval.embeddingConfigured ? "已配置" : "未配置"}
              {indexHealth.retrieval.mode === "fts_only"
                ? " —— 语义检索降级,知识库保持全文检索可用。"
                : ""}
            </span>
          </p>
        ) : null}

        {indexError ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{indexError}</p> : null}
        {rebuildNotice ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{rebuildNotice}</p>
        ) : null}
        {!canManage ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            索引健康与重建操作需要知识管理员权限。
          </p>
        ) : (
          <DataTable
            aria-label="知识索引状态"
            rows={indexHealth?.items ?? []}
            rowKey={(item) => item.entryId}
            columns={indexColumns}
            pageSize={10}
            renderRowActions={(item) => (
              <Button
                variant="outline"
                size="sm"
                disabled={indexActionPendingId !== null}
                aria-busy={indexActionPendingId === item.entryId || undefined}
                onClick={() => void retryIndex(item)}
              >
                <RotateCcw data-icon="inline-start" />
                重试
              </Button>
            )}
            emptyState={
              indexLoading ? (
                <p className="text-sm text-muted-foreground">正在加载索引状态…</p>
              ) : (
                <p className="text-sm text-muted-foreground">还没有索引记录。发布知识条目后会自动进入索引队列。</p>
              )
            }
          />
        )}
      </section>

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
