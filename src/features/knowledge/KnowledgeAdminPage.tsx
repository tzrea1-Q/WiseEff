import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseZap, ExternalLink, RefreshCw } from "lucide-react";

import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { canGovernEntry } from "@/domain/knowledge/rules";
import type { KnowledgeEntry, KnowledgeIndexHealth, KnowledgeIndexStatusItem } from "@/domain/knowledge/types";
import {
  knowledgeContentFormLabels,
  knowledgeIndexStateLabels,
  knowledgeRetrievalModeLabels,
  knowledgeStatusLabels
} from "@/domain/knowledge/types";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { useCollectionTab } from "@/hooks/useCollectionTab";
import { PageInsightBar, type Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import { KnowledgeTagList, KnowledgeUnsearchableBadge } from "./badges";

const collectionTabs = ["drafts", "index", "archived"] as const;

export type KnowledgeAdminPageProps = {
  repository: KnowledgeRepository;
  capability: KnowledgeCapability;
  /** Opens review deep links (/knowledge?entryId=… and /logs?logId=…). */
  onNavigate?: (path: string) => void;
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
 * Knowledge governance: the agent-draft publish queue (review, publish,
 * archive-reject), archived-entry management, manage-gated hard delete, and
 * retrieval index health (per-entry status, retry, rebuild-all).
 */
export function KnowledgeAdminPage({ repository, capability, onNavigate }: KnowledgeAdminPageProps) {
  const canManage = capability.canManage;
  const [collection, selectCollection] = useCollectionTab(collectionTabs, "drafts");
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [restorePendingId, setRestorePendingId] = useState<string | null>(null);
  const [indexHealth, setIndexHealth] = useState<KnowledgeIndexHealth | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState("");
  const [indexActionPendingId, setIndexActionPendingId] = useState<string | null>(null);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState("");
  const [rescanPending, setRescanPending] = useState(false);
  const [agentDrafts, setAgentDrafts] = useState<KnowledgeEntry[]>([]);
  const [agentDraftsLoading, setAgentDraftsLoading] = useState(true);
  const [agentDraftError, setAgentDraftError] = useState("");
  const [agentActionPendingId, setAgentActionPendingId] = useState<string | null>(null);

  const loadArchived = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await repository.list({ status: "archived" });
      setRows(result.items);
    } catch (error) {
      setErrorMessage(presentError(error, "已归档条目加载失败，请稍后重试。"));
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
      setIndexError(presentError(error, "索引健康加载失败，请稍后重试。"));
    } finally {
      setIndexLoading(false);
    }
  }, [repository, canManage]);

  const loadAgentDrafts = useCallback(async () => {
    setAgentDraftsLoading(true);
    setAgentDraftError("");
    try {
      const result = await repository.list({ status: "draft", sourceType: "agent" });
      setAgentDrafts(result.items);
    } catch (error) {
      setAgentDraftError(presentError(error, "Agent 草稿加载失败，请稍后重试。"));
    } finally {
      setAgentDraftsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadAgentDrafts();
    void loadArchived();
    void loadIndexHealth();
  }, [loadAgentDrafts, loadArchived, loadIndexHealth]);

  const archivedCount = useMemo(() => rows.length, [rows]);

  const publishAgentDraft = async (entry: KnowledgeEntry) => {
    setAgentActionPendingId(entry.id);
    setAgentDraftError("");
    try {
      await repository.publish(entry.id);
      setAgentDrafts((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setAgentDraftError(presentError(error, "发布失败，请稍后重试。"));
    } finally {
      setAgentActionPendingId(null);
    }
  };

  const rejectAgentDraft = async (entry: KnowledgeEntry) => {
    await repository.rejectAgentDraft(entry.id);
    setAgentDrafts((current) => current.filter((item) => item.id !== entry.id));
    await loadArchived();
  };

  const agentDraftColumns: Column<KnowledgeEntry>[] = [
    {
      key: "title",
      header: "草稿",
      render: (entry) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{entry.title}</p>
          <p className="text-xs text-muted-foreground">创建人 {entry.createdByUserId ?? "已注销用户"} · 修订 #{entry.headRevisionNumber}</p>
        </div>
      ),
      sortAccessor: (entry) => entry.title
    },
    {
      key: "session",
      header: "会话来源",
      render: (entry) => (
        <span className="block max-w-44 truncate text-xs text-muted-foreground" title={entry.sourceSessionId ?? undefined}>
          {entry.sourceSessionId ?? "—"}
        </span>
      ),
      widthClass: "w-40"
    },
    {
      key: "sourceLog",
      header: "来源分析",
      render: (entry) =>
        entry.sourceLogDeleted ? <span className="text-xs text-muted-foreground">来源已删除</span> : entry.sourceLogId ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={() => onNavigate?.(`/logs?logId=${encodeURIComponent(entry.sourceLogId!)}`)}
          >
            <ExternalLink data-icon="inline-start" />
            查看日志分析
          </Button>
        ) : entry.sourceReloadRunId ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={() => onNavigate?.(`/dts-reload?runId=${encodeURIComponent(entry.sourceReloadRunId!)}`)}
          >
            <ExternalLink data-icon="inline-start" />
            查看重载运行
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      widthClass: "w-32"
    },
    {
      key: "createdAt",
      header: "创建时间",
      render: (entry) => <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>,
      sortAccessor: (entry) => entry.createdAt,
      widthClass: "w-28"
    }
  ];

  const restoreEntry = async (entry: KnowledgeEntry) => {
    setRestorePendingId(entry.id);
    setErrorMessage("");
    try {
      await repository.restore(entry.id);
      setRows((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setErrorMessage(presentError(error, "恢复失败，请稍后重试。"));
    } finally {
      setRestorePendingId(null);
    }
  };

  const deleteEntry = async (entry: KnowledgeEntry) => {
    await repository.hardDelete(entry.id);
    setRows((current) => current.filter((item) => item.id !== entry.id));
  };

  const retryIndex = async (item: KnowledgeIndexStatusItem) => {
    setIndexActionPendingId(item.entryId);
    setIndexError("");
    try {
      await repository.retryEntryIndex(item.entryId);
      await loadIndexHealth();
    } catch (error) {
      setIndexError(presentError(error, "重试入队失败，请稍后重试。"));
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
      setIndexError(presentError(error, "全量重建入队失败，请稍后重试。"));
    } finally {
      setRebuildPending(false);
    }
  };

  const rescanReferenceSuggestions = async () => {
    setRescanPending(true);
    setIndexError("");
    setRebuildNotice("");
    try {
      const result = await repository.rescanReferenceSuggestions();
      setRebuildNotice(`已入队 ${result.enqueued} 条未归档条目，后台将重新检测建议关联，保留已接受和已忽略的决定。`);
      await loadIndexHealth();
    } catch (error) {
      setIndexError(presentError(error, "重新检测建议关联入队失败，请稍后重试。"));
    } finally {
      setRescanPending(false);
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
          {item.entryStatus === "published" && (item.status === "succeeded" || item.status === "failed") && item.chunkCount === 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <KnowledgeUnsearchableBadge />
              <span className="text-xs text-[var(--warning)]">无已索引分块，请检查文件是否包含可提取文本并替换文件。</span>
            </div>
          ) : null}
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
            {presentErrorMessage(item.error, "索引失败，请稍后重试或联系管理员。")}
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
          <p className="text-xs text-muted-foreground">修订 #{entry.headRevisionNumber} · {entry.createdByUserId ?? "已注销用户"}</p>
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
    <div className="knowledge-admin-page flex flex-col gap-5">
      <PageInsightBar
        variant={agentDrafts.length > 0 ? "warn" : "info"}
        headline={`待审阅 Agent 草稿 ${agentDrafts.length} 条 · 已归档 ${archivedCount} 条`}
        description="知识治理:审阅 Agent 沉淀的知识草稿(发布或拒绝归档),管理已归档条目与检索索引健康。草稿在发布前不进入检索。"
        actions={[]}
      />

      <ViewSwitch variant="tabs" ariaLabel="知识治理集合" value={collection} onValueChange={selectCollection}
        items={[
          { value: "drafts", label: "Agent 草稿发布队列", id: "knowledge-tab-drafts", panelId: "knowledge-panel-drafts" },
          { value: "index", label: "检索索引健康", id: "knowledge-tab-index", panelId: "knowledge-panel-index" },
          { value: "archived", label: "已归档条目", id: "knowledge-tab-archived", panelId: "knowledge-panel-archived" }
        ]} />
      <TabPanel id={`knowledge-panel-${collection}`} aria-labelledby={`knowledge-tab-${collection}`}>
        {collection === "drafts" ? (
          <AdminListPage label="Agent 草稿发布队列"
            headerActions={<Button size="sm" onClick={() => void loadAgentDrafts()} disabled={agentDraftsLoading} aria-busy={agentDraftsLoading || undefined}><RefreshCw data-icon="inline-start" />刷新</Button>}
            filterBar={<p className="text-sm text-muted-foreground">小泽经审批创建的知识草稿在此审阅:knowledge:edit 可发布本人会话沉淀的草稿,knowledge:manage 可发布任意草稿;拒绝会将草稿归档。</p>}
            notice={agentDraftError ? <p role="alert" className="text-destructive">{agentDraftError}</p> : null}
            table={{ "aria-label": "Agent 知识草稿队列", rows: agentDrafts, rowKey: (entry) => entry.id, columns: agentDraftColumns, pageSize: 10 }}
            rowActions={(entry) => ({
              label: entry.title,
              primaryAction: { id: "review", label: "审阅", onSelect: () => onNavigate?.(`/knowledge?entryId=${encodeURIComponent(entry.id)}`) },
              items: [
                { id: "publish", label: "发布", disabled: !canGovernEntry(entry, capability) || agentActionPendingId !== null, onSelect: () => publishAgentDraft(entry) },
                { id: "reject", label: "拒绝归档", disabled: !canGovernEntry(entry, capability) || agentActionPendingId !== null, destructive: true,
                  confirmation: { title: `拒绝并归档「${entry.title}」`, description: "该 Agent 草稿将被归档,不会发布进入检索。归档后可在「已归档条目」标签中查看;操作会写入审计记录。", confirmLabel: "拒绝归档" },
                  onSelect: () => rejectAgentDraft(entry) }
              ]
            })}
            emptyState={{ message: agentDraftsLoading ? "正在加载 Agent 草稿…" : "当前没有待审阅的 Agent 知识草稿。", actionLabel: "刷新", onAction: () => void loadAgentDrafts() }} />
        ) : collection === "index" ? (
          !canManage ? <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">索引健康与重建操作需要知识管理员权限。</p> :
          <AdminListPage label="检索索引健康"
            headerActions={<>
              <Button variant="outline" size="sm" onClick={() => void rescanReferenceSuggestions()} disabled={rescanPending || rebuildPending || indexLoading} aria-busy={rescanPending || undefined}><RefreshCw data-icon="inline-start" />重新检测建议关联</Button>
              <Button variant="outline" size="sm" onClick={() => void rebuildIndex()} disabled={rescanPending || rebuildPending || indexLoading} aria-busy={rebuildPending || undefined}><DatabaseZap data-icon="inline-start" />全量重建索引</Button>
              <Button size="sm" onClick={() => void loadIndexHealth()} disabled={indexLoading} aria-busy={indexLoading || undefined}><RefreshCw data-icon="inline-start" />刷新</Button>
            </>}
            filterBar={indexHealth ? <p data-retrieval-mode={indexHealth.retrieval.mode} aria-label="检索模式" className="text-sm text-foreground">
              当前检索模式:<strong>{knowledgeRetrievalModeLabels[indexHealth.retrieval.mode]}</strong>
              <span className="ml-2 text-xs text-muted-foreground">pgvector {indexHealth.retrieval.vectorAvailable ? "可用" : "不可用"} · 嵌入端点{indexHealth.retrieval.embeddingConfigured ? "已配置" : "未配置"}{indexHealth.retrieval.mode === "fts_only" ? " —— 语义检索降级,知识库保持全文检索可用。" : ""}</span>
            </p> : <span className="text-sm text-muted-foreground">检索索引状态</span>}
            notice={<>{indexError ? <p role="alert" className="text-destructive">{indexError}</p> : null}{rebuildNotice ? <p role="status">{rebuildNotice}</p> : null}</>}
            table={{ "aria-label": "知识索引状态", rows: indexHealth?.items ?? [], rowKey: (item) => item.entryId, columns: indexColumns, pageSize: 10 }}
            rowActions={(item) => ({ label: item.title, primaryAction: { id: "retry", label: "重试", disabled: indexActionPendingId !== null, onSelect: () => retryIndex(item) }, items: [] })}
            emptyState={{ message: indexLoading ? "正在加载索引状态…" : "还没有索引记录。发布知识条目后会自动进入索引队列。", actionLabel: "刷新", onAction: () => void loadIndexHealth() }} />
        ) : (
          <AdminListPage label="已归档条目管理"
            headerActions={<Button size="sm" onClick={() => void loadArchived()} disabled={loading} aria-busy={loading || undefined}><RefreshCw data-icon="inline-start" />刷新</Button>}
            filterBar={<span className="text-sm text-muted-foreground">已归档 {archivedCount} 条</span>}
            notice={<>{errorMessage ? <p role="alert" className="text-destructive">{errorMessage}</p> : null}{!canManage ? <p>当前账号没有知识治理权限;彻底删除等治理操作需要知识管理员执行。</p> : null}</>}
            table={{ "aria-label": "已归档知识条目", rows, rowKey: (entry) => entry.id, columns, pageSize: 10 }}
            rowActions={(entry) => ({ label: entry.title,
              primaryAction: { id: "restore", label: "恢复", disabled: restorePendingId !== null, onSelect: () => restoreEntry(entry) },
              items: canManage ? [{ id: "delete", label: "彻底删除", destructive: true,
                confirmation: { title: `彻底删除「${entry.title}」`, description: `将永久删除该条目及其全部 ${entry.headRevisionNumber} 个修订,不可恢复。删除会写入审计记录。`, confirmLabel: "彻底删除", acknowledgement: "我确认删除该条目与全部修订历史。" },
                onSelect: () => deleteEntry(entry) }] : []
            })}
            emptyState={{ message: loading ? "正在加载已归档条目…" : "暂无已归档条目。", actionLabel: "刷新", onAction: () => void loadArchived() }} />
        )}
      </TabPanel>
    </div>
  );
}
