import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, FilePlus2, RefreshCw, SquarePen } from "lucide-react";

import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { canGovernEntry, collectKnownTags } from "@/domain/knowledge/rules";
import type {
  KnowledgeEntry,
  KnowledgeRetrievalInfo,
  KnowledgeSearchResult,
  KnowledgeStatus
} from "@/domain/knowledge/types";
import {
  knowledgeContentFormLabels,
  knowledgeRetrievalModeLabels,
  knowledgeStatusLabels
} from "@/domain/knowledge/types";
import { dispatchXiaozeOpenHandoff } from "@/features/agent/xiaozeOpenHandoff";
import { DataTable, PageInsightBar, type Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { KnowledgeExtractionBadge, KnowledgeStatusBadge, KnowledgeTagList } from "./badges";
import { KnowledgeEntryDetailDialog } from "./KnowledgeEntryDetailDialog";
import {
  KnowledgeEntryEditorDialog,
  type KnowledgeEditorSubmit,
  type KnowledgeSpecPickerOption
} from "./KnowledgeEntryEditorDialog";
import { KnowledgeFileUploadDialog, type KnowledgeFileUploadSubmit } from "./KnowledgeFileUploadDialog";
import { KnowledgeRevisionsDialog } from "./KnowledgeRevisionsDialog";

export type KnowledgePageProps = {
  repository: KnowledgeRepository;
  capability: KnowledgeCapability;
  /** Ask-the-knowledge-base opens Xiaoze — API mode only (mock has no Agent UI). */
  askXiaozeEnabled?: boolean;
  /** Deep-linked entry id (e.g. from a Xiaoze citation /knowledge?entryId=…). */
  initialEntryId?: string | null;
  /**
   * Definition search for the reference picker (parameter-specs read API);
   * absent (no `parameter:view` / no topology adapter) hides the picker.
   */
  searchParameterSpecs?: (q: string) => Promise<KnowledgeSpecPickerOption[]>;
  /** Deep link into the definition surface (/parameter-admin?spec=…). */
  onOpenParameterSpec?: (specId: string) => void;
  /** Router navigation for distillation source links (log / reload run). */
  onNavigate?: (path: string) => void;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function KnowledgePage({
  repository,
  capability,
  askXiaozeEnabled = false,
  initialEntryId = null,
  searchParameterSpecs,
  onOpenParameterSpec,
  onNavigate
}: KnowledgePageProps) {
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [searchRetrieval, setSearchRetrieval] = useState<KnowledgeRetrievalInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorEntry, setEditorEntry] = useState<KnowledgeEntry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEntry, setUploadEntry] = useState<KnowledgeEntry | null>(null);
  const [revisionsEntry, setRevisionsEntry] = useState<KnowledgeEntry | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await repository.list();
      setRows(result.items);
    } catch (error) {
      setErrorMessage(presentError(error, "知识条目加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // Citation deep link (/knowledge?entryId=…) opens the entry detail directly.
  useEffect(() => {
    if (!initialEntryId) {
      return;
    }
    let cancelled = false;
    void repository.get(initialEntryId).then((entry) => {
      if (cancelled || !entry) return;
      setRows((current) => (current.some((item) => item.id === entry.id) ? current : [entry, ...current]));
      setSelectedId(entry.id);
    });
    return () => {
      cancelled = true;
    };
  }, [initialEntryId, repository]);

  const runSearch = async () => {
    const q = searchInput.trim();
    setSearchQuery(q);
    if (!q) {
      setSearchResults([]);
      setSearchRetrieval(null);
      return;
    }
    setSearching(true);
    setErrorMessage("");
    try {
      const response = await repository.search(q);
      setSearchResults(response.items);
      setSearchRetrieval(response.retrieval);
    } catch (error) {
      setErrorMessage(presentError(error, "检索失败，请稍后重试。"));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchRetrieval(null);
  };

  const refreshEntry = async (entryId: string) => {
    const fresh = await repository.get(entryId);
    if (fresh) {
      setRows((current) => {
        const exists = current.some((item) => item.id === entryId);
        return exists ? current.map((item) => (item.id === entryId ? fresh : item)) : [fresh, ...current];
      });
    } else {
      setRows((current) => current.filter((item) => item.id !== entryId));
    }
    return fresh;
  };

  const knownTags = useMemo(() => collectKnownTags(rows), [rows]);
  const filteredRows = useMemo(
    () =>
      rows.filter((entry) => {
        if (statusFilter.length > 0 && !statusFilter.includes(entry.status)) return false;
        if (tagFilter.length > 0 && !tagFilter.some((tag) => entry.tags.includes(tag))) return false;
        return true;
      }),
    [rows, statusFilter, tagFilter]
  );
  const selectedEntry = selectedId ? rows.find((entry) => entry.id === selectedId) ?? null : null;
  const publishedCount = useMemo(() => rows.filter((entry) => entry.status === "published").length, [rows]);
  const draftCount = useMemo(() => rows.filter((entry) => entry.status === "draft").length, [rows]);

  const columns: Column<KnowledgeEntry>[] = [
    {
      key: "title",
      header: "标题",
      render: (entry) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{entry.title}</p>
          <p className="text-xs text-muted-foreground">修订 #{entry.headRevisionNumber}</p>
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
      sortAccessor: (entry) => entry.contentForm,
      widthClass: "w-20"
    },
    {
      key: "status",
      header: "状态",
      render: (entry) => <KnowledgeStatusBadge status={entry.status} />,
      sortAccessor: (entry) => entry.status,
      widthClass: "w-24",
      headerFilter: {
        label: "状态",
        values: ["draft", "published", "archived"],
        selectedValues: statusFilter,
        renderLabel: (value) => knowledgeStatusLabels[value as KnowledgeStatus],
        onToggle: (value) =>
          setStatusFilter((current) =>
            current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
          ),
        onClear: () => setStatusFilter([]),
        getValue: (entry: KnowledgeEntry) => entry.status
      }
    },
    {
      key: "tags",
      header: "标签",
      render: (entry) => <KnowledgeTagList tags={entry.tags} />,
      headerFilter: {
        label: "标签",
        values: knownTags,
        selectedValues: tagFilter,
        onToggle: (value) =>
          setTagFilter((current) =>
            current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
          ),
        onClear: () => setTagFilter([]),
        getValue: (entry: KnowledgeEntry) => entry.tags.join(" ")
      }
    },
    {
      key: "extraction",
      header: "提取状态",
      render: (entry) =>
        entry.contentForm === "file" && entry.file ? (
          <KnowledgeExtractionBadge status={entry.file.extractionStatus} error={entry.file.extractionError} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      widthClass: "w-24"
    },
    {
      key: "updatedAt",
      header: "更新时间",
      render: (entry) => <span className="text-xs text-muted-foreground">{formatDateTime(entry.updatedAt)}</span>,
      sortAccessor: (entry) => entry.updatedAt,
      widthClass: "w-28"
    }
  ];

  const handleEditorSubmit = async (input: KnowledgeEditorSubmit) => {
    if (editorEntry && input.expectedHeadRevisionNumber !== undefined) {
      const updated = await repository.update(editorEntry.id, {
        expectedHeadRevisionNumber: input.expectedHeadRevisionNumber,
        title: input.title,
        tags: input.tags,
        contentMarkdown: input.contentMarkdown
      });
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } else {
      const created = await repository.createMarkdown({
        title: input.title,
        tags: input.tags,
        contentMarkdown: input.contentMarkdown
      });
      setRows((current) => [created, ...current]);
      setSelectedId(created.id);
    }
  };

  const handleUploadSubmit = async (input: KnowledgeFileUploadSubmit) => {
    if (uploadEntry && input.expectedHeadRevisionNumber !== undefined) {
      const updated = await repository.update(uploadEntry.id, {
        expectedHeadRevisionNumber: input.expectedHeadRevisionNumber,
        title: input.title,
        tags: input.tags,
        file: input.file
      });
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } else {
      const created = await repository.createFile({ title: input.title, tags: input.tags, file: input.file });
      setRows((current) => [created, ...current]);
      setSelectedId(created.id);
    }
  };

  const handleDownload = async (entry: KnowledgeEntry) => {
    const url = await repository.getFileObjectUrl(entry.id);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.file?.fileName ?? entry.title;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  // Reference edits are immediate audited calls; keep the background rows in
  // sync but never swap the editor's `entry` prop (that would reset the form).
  const applyReferenceUpdate = (updated: KnowledgeEntry) => {
    setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    return updated.parameterReferences;
  };
  const parameterReferencePicker = searchParameterSpecs
    ? {
        search: searchParameterSpecs,
        onAdd: async (entryId: string, specId: string) =>
          applyReferenceUpdate(await repository.addParameterReference(entryId, specId)),
        onRemove: async (entryId: string, specId: string) =>
          applyReferenceUpdate(await repository.removeParameterReference(entryId, specId))
      }
    : undefined;

  return (
    <div className="knowledge-page flex flex-col gap-5 p-6">
      <PageInsightBar
        variant="info"
        headline={`已发布 ${publishedCount} 条 · 草稿 ${draftCount} 条`}
        description="组织级工程知识库:调参经验、故障案例、硬件手册与流程规范。发布是进入检索的唯一门槛。"
        actions={
          capability.canEdit
            ? [
                {
                  label: "新建 Markdown 条目",
                  onClick: () => {
                    setEditorEntry(null);
                    setEditorOpen(true);
                  },
                  variant: "primary"
                }
              ]
            : []
        }
      />

      <section className="flex flex-col gap-2" aria-label="知识检索">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="检索已发布知识(支持中文与英文全文)"
            aria-label="检索知识库"
            className="h-9 w-96 max-w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={searching} aria-busy={searching || undefined}>
            检索
          </Button>
          {searchQuery ? (
            <Button type="button" variant="outline" size="sm" onClick={clearSearch}>
              清除检索
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {askXiaozeEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatchXiaozeOpenHandoff("knowledge-ask")}
              >
                <Bot data-icon="inline-start" />
                问知识库(小泽)
              </Button>
            ) : null}
            {capability.canEdit ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditorEntry(null);
                    setEditorOpen(true);
                  }}
                >
                  <SquarePen data-icon="inline-start" />
                  新建条目
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUploadEntry(null);
                    setUploadOpen(true);
                  }}
                >
                  <FilePlus2 data-icon="inline-start" />
                  上传文件条目
                </Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void loadEntries()} disabled={loading} aria-busy={loading || undefined}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          </span>
        </form>

        {errorMessage ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p> : null}

        {searchQuery ? (
          <div className="flex flex-col gap-2" aria-label="检索结果">
            <p className="text-xs text-muted-foreground">
              “{searchQuery}” 命中 {searchResults.length} 条已发布知识(草稿与已归档不参与检索)。
              {searchRetrieval ? (
                <span className="ml-1" data-retrieval-mode={searchRetrieval.mode}>
                  检索模式:{knowledgeRetrievalModeLabels[searchRetrieval.mode]}
                </span>
              ) : null}
            </p>
            <ul className="flex flex-col gap-2">
              {searchResults.map((result) => (
                <li key={result.entryId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(result.entryId)}
                    className="w-full rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{result.title}</span>
                      <span className="text-xs text-muted-foreground">{knowledgeContentFormLabels[result.contentForm]}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{result.excerpt}</span>
                  </button>
                </li>
              ))}
              {!searching && searchResults.length === 0 ? (
                <li className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  没有命中已发布的知识条目。
                </li>
              ) : null}
            </ul>
          </div>
        ) : (
          <DataTable
            aria-label="知识条目列表"
            rows={filteredRows}
            rowKey={(entry) => entry.id}
            columns={columns}
            onRowClick={(entry) => setSelectedId(entry.id)}
            selectedRowKey={selectedId ?? undefined}
            pageSize={10}
            emptyState={
              loading ? (
                <p className="text-sm text-muted-foreground">正在加载知识条目…</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {rows.length === 0 ? "知识库还是空的。创建第一条调参经验或上传一份硬件手册。" : "当前筛选条件下没有条目。"}
                </p>
              )
            }
          />
        )}
      </section>

      <KnowledgeEntryDetailDialog
        open={Boolean(selectedEntry)}
        entry={selectedEntry}
        capability={capability}
        onEdit={(entry) => {
          setEditorEntry(entry);
          setEditorOpen(true);
        }}
        onReplaceFile={(entry) => {
          setUploadEntry(entry);
          setUploadOpen(true);
        }}
        onShowRevisions={(entry) => setRevisionsEntry(entry)}
        onPublish={async (entry) => {
          const updated = await repository.publish(entry.id);
          setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }}
        onArchive={async (entry) => {
          const updated = await repository.archive(entry.id);
          setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }}
        onRestore={async (entry) => {
          const updated = await repository.restore(entry.id);
          setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        }}
        onDownloadFile={handleDownload}
        onOpenParameterSpec={onOpenParameterSpec}
        onNavigate={onNavigate}
        onClose={() => setSelectedId(null)}
      />

      <KnowledgeEntryEditorDialog
        open={editorOpen}
        entry={editorEntry}
        onSubmit={handleEditorSubmit}
        parameterReferencePicker={parameterReferencePicker}
        onClose={() => {
          setEditorOpen(false);
          setEditorEntry(null);
        }}
      />

      <KnowledgeFileUploadDialog
        open={uploadOpen}
        entry={uploadEntry}
        onSubmit={handleUploadSubmit}
        onClose={() => {
          setUploadOpen(false);
          setUploadEntry(null);
        }}
      />

      <KnowledgeRevisionsDialog
        open={Boolean(revisionsEntry)}
        entry={revisionsEntry}
        loadRevisions={(entryId) => repository.listRevisions(entryId)}
        canRestore={Boolean(revisionsEntry && canGovernEntry(revisionsEntry, capability))}
        onRestore={async (revision, expectedHeadRevisionNumber) => {
          if (!revisionsEntry) return;
          await repository.restoreRevision(revisionsEntry.id, revision.id, expectedHeadRevisionNumber);
          await refreshEntry(revisionsEntry.id);
        }}
        onClose={() => setRevisionsEntry(null)}
      />
    </div>
  );
}
