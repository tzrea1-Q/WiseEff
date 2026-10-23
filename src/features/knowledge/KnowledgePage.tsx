import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Bot, ChevronDown, RefreshCw, SquarePen, Search } from "lucide-react";

import { formatKnowledgePageLabel, knowledgeEntryHref, parseKnowledgeEntryQuery } from "@/domain/knowledge/citations";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { canGovernEntry, collectKnownTags } from "@/domain/knowledge/rules";
import type {
  KnowledgeEntry,
  KnowledgeBatchInput,
  KnowledgeOrigin,
  KnowledgeRetrievalInfo,
  KnowledgeSearchResult,
  KnowledgeStatus
} from "@/domain/knowledge/types";
import {
  knowledgeContentFormLabels,
  knowledgeOriginLabels,
  knowledgeOrigins,
  knowledgeRetrievalModeLabels,
  knowledgeStatusLabels
} from "@/domain/knowledge/types";
import { dispatchXiaozeOpenHandoff } from "@/features/agent/xiaozeOpenHandoff";
import { PageInsightBar, type Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionSkeleton } from "@/components/common/SectionState";
import { SearchField } from "@/components/common/SearchField";
import { presentError } from "@/infrastructure/http/presentError";
import { KnowledgeExtractionBadge, KnowledgeOriginBadge, KnowledgeStatusBadge, KnowledgeTagList, KnowledgeUnsearchableBadge } from "./badges";
import { KnowledgeEntryDetailDialog } from "./KnowledgeEntryDetailDialog";
import type { WorkflowId } from "@/domain/workflowDiscovery";
import {
  KnowledgeEntryEditorDialog,
  type KnowledgeEditorSubmit,
  type KnowledgeDefinitionPickerPage
} from "./KnowledgeEntryEditorDialog";
import { KnowledgeFileUploadDialog, type KnowledgeFileUploadSubmit } from "./KnowledgeFileUploadDialog";
import { KnowledgeImportDialog } from "./KnowledgeImportDialog";
import { KnowledgeRevisionsDialog } from "./KnowledgeRevisionsDialog";
import { KnowledgeBatchDialog, knowledgeBatchLabels } from "./KnowledgeBatchDialog";

export type KnowledgePageProps = {
  visibleWorkflows?: readonly WorkflowId[];
  repository: KnowledgeRepository;
  capability: KnowledgeCapability;
  /** Ask-the-knowledge-base opens Xiaoze — API mode only (mock has no Agent UI). */
  askXiaozeEnabled?: boolean;
  /** Deep-linked entry id (e.g. from a Xiaoze citation /knowledge?entryId=…). */
  initialEntryId?: string | null;
  initialRevisionId?: string | null;
  initialPage?: string | null;
  /** Authenticated CatalogRead search; absent without parameter view permission. */
  searchParameterDefinitions?: (q: string, cursor?: string, catalogReleaseId?: string) => Promise<KnowledgeDefinitionPickerPage>;
  /** Deep link to an exact canonical Definition, never a historical Spec ID. */
  onOpenDefinition?: (definitionId: string) => void;
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
  visibleWorkflows,
  repository,
  capability,
  askXiaozeEnabled = false,
  initialEntryId = null,
  initialRevisionId = null,
  initialPage = null,
  searchParameterDefinitions,
  onOpenDefinition,
  onNavigate
}: KnowledgePageProps) {
  const [searchCitation, setSearchCitation] = useState<{ entryId: string; revisionId: string | null; page: string | null } | null>(null);
  const linkedEntryId = searchCitation?.entryId ?? initialEntryId;
  const linkedRevisionId = searchCitation ? searchCitation.revisionId : initialRevisionId;
  const linkedPage = searchCitation ? searchCitation.page : initialPage;
  const [citation, setCitation] = useState<{ revisionId: string; page: number | null; historical: boolean } | null>(null);
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [citationError, setCitationError] = useState("");
  const [citationLoading, setCitationLoading] = useState(Boolean(initialEntryId));
  const citationRequest = useRef(0);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [pendingSuggestions, setPendingSuggestions] = useState(false);
  const [originFilter, setOriginFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [searchRetrieval, setSearchRetrieval] = useState<KnowledgeRetrievalInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batch, setBatch] = useState<{ action: KnowledgeBatchInput["action"]; entries: KnowledgeEntry[] } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [editorEntry, setEditorEntry] = useState<KnowledgeEntry | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadEntry, setUploadEntry] = useState<KnowledgeEntry | null>(null);
  const [revisionsEntry, setRevisionsEntry] = useState<KnowledgeEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<KnowledgeEntry | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const listRequest = useRef(0);
  const searchRequest = useRef(0);
  const citationResult = useRef<{ entry: KnowledgeEntry } | null>(null);

  const loadEntries = useCallback(async () => {
    const request = ++listRequest.current;
    const citationAtStart = citationResult.current;
    setLoading(true);
    setListError("");
    try {
      const result = await repository.list(pendingSuggestions ? { pendingSuggestions: true } : undefined);
      if (request !== listRequest.current) return;
      // Preserve only a get completed after this list started, never an older cached lookup.
      const citation = citationResult.current !== citationAtStart ? citationResult.current?.entry : null;
      setRows(citation
        ? [citation, ...result.items.filter((entry) => entry.id !== citation.id)]
        : result.items);
    } catch (error) {
      if (request === listRequest.current) setListError(presentError(error, "知识条目加载失败，请稍后重试。"));
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [repository, pendingSuggestions]);

  useEffect(() => {
    setRows([]);
    setCheckedIds([]);
    setBatch(null);
    setSearchInput("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchRetrieval(null);
    setSearchError("");
    setSearching(false);
    setEditorOpen(false);
    setEditorEntry(null);
    setUploadOpen(false);
    setUploadEntry(null);
    setRevisionsEntry(null);
    setDeleteEntry(null);
    setDeleteError("");
    void loadEntries();
    return () => {
      ++listRequest.current;
      ++searchRequest.current;
    };
  }, [loadEntries]);

  // Citation deep link (/knowledge?entryId=…) opens the entry detail directly.
  const loadCitation = useCallback(async () => {
    const request = ++citationRequest.current;
    citationResult.current = null;
    setCitationError("");
    setCitationLoading(Boolean(linkedEntryId));
    setSelectedId(null);
    setCitation(null);
    if (!linkedEntryId) {
      return;
    }
    await repository.get(linkedEntryId).then(async (entry) => {
      if (request !== citationRequest.current) return;
      if (!entry || entry.id !== linkedEntryId) {
        setCitationError("引用的知识条目不存在或不可访问。");
        return;
      }
      if (linkedRevisionId || linkedPage) {
        const revisions = await repository.listRevisions(entry.id);
        if (request !== citationRequest.current) return;
        const revision = linkedRevisionId ? revisions.find((item) => item.id === linkedRevisionId) : revisions.find((item) => item.revisionNumber === entry.headRevisionNumber);
        if (!revision) {
          setCitationError("引用的知识条目不存在或不可访问。");
          return;
        }
        const { page } = parseKnowledgeEntryQuery(new URLSearchParams(linkedPage ? { page: linkedPage } : {}));
        setCitation({ revisionId: revision.id, page: revision.fileId ? page : null, historical: revision.revisionNumber !== entry.headRevisionNumber });
      }
      citationResult.current = { entry };
      setRows((current) => (current.some((item) => item.id === entry.id)
        ? current.map((item) => item.id === entry.id ? entry : item)
        : [entry, ...current]));
      setSelectedId(entry.id);
    }).catch((error: unknown) => {
      if (request === citationRequest.current) setCitationError(presentError(error, "知识条目加载失败，请稍后重试。"));
    }).finally(() => {
      if (request === citationRequest.current) setCitationLoading(false);
    });
  }, [linkedEntryId, linkedRevisionId, linkedPage, repository, searchCitation]);

  useEffect(() => {
    void loadCitation();
    return () => { ++citationRequest.current; };
  }, [loadCitation]);

  const runSearch = async () => {
    const request = ++searchRequest.current;
    const q = searchInput.trim();
    setSearchQuery(q);
    setSearchError("");
    setSearchResults([]);
    setSearchRetrieval(null);
    if (!q) {
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const response = await repository.search(q);
      if (request !== searchRequest.current) return;
      setSearchResults(response.items);
      setSearchRetrieval(response.retrieval);
    } catch (error) {
      if (request === searchRequest.current) setSearchError(presentError(error, "检索失败，请稍后重试。"));
    } finally {
      if (request === searchRequest.current) setSearching(false);
    }
  };

  const clearSearch = () => {
    ++searchRequest.current;
    setSearching(false);
    setSearchError("");
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
        if (originFilter.length > 0 && !originFilter.includes(entry.origin)) return false;
        if (tagFilter.length > 0 && !tagFilter.some((tag) => entry.tags.includes(tag))) return false;
        return true;
      }),
    [rows, statusFilter, originFilter, tagFilter]
  );
  const selectedEntry = selectedId ? rows.find((entry) => entry.id === selectedId) ?? null : null;
  const checkedEntries = filteredRows.filter((entry) => checkedIds.includes(entry.id));
  const canBatch = capability.canEdit || capability.canManage;
  const errorMessage = (searchQuery ? searchError : listError) || citationError;
  const publishedCount = useMemo(() => rows.filter((entry) => entry.status === "published").length, [rows]);
  const draftCount = useMemo(() => rows.filter((entry) => entry.status === "draft").length, [rows]);

  const columns: Column<KnowledgeEntry>[] = [
    ...(canBatch ? [{
      key: "selection", widthClass: "w-12",
      header: <input type="checkbox" aria-label={`全选筛选结果（${filteredRows.length} 条）`}
        checked={filteredRows.length > 0 && checkedEntries.length === filteredRows.length}
        ref={(input) => { if (input) input.indeterminate = checkedEntries.length > 0 && checkedEntries.length < filteredRows.length; }}
        disabled={!filteredRows.length}
        onChange={() => setCheckedIds(checkedEntries.length === filteredRows.length ? [] : filteredRows.map((entry) => entry.id))} />,
      render: (entry: KnowledgeEntry) => <input type="checkbox" aria-label={`选择 ${entry.title}`}
        checked={checkedIds.includes(entry.id)} onClick={(event) => event.stopPropagation()}
        onChange={() => setCheckedIds((current) => current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id])} />
    }] : []),
    {
      key: "title",
      header: "标题",
      render: (entry) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{entry.title}</p>
          {canGovernEntry(entry, capability) && (entry.pendingSuggestionCount ?? 0) > 0
            ? <Badge variant="secondary">待处理建议 {entry.pendingSuggestionCount}</Badge> : null}
          {entry.contentForm === "file" && entry.file?.extractionStatus === "failed" ? <KnowledgeUnsearchableBadge /> : null}
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
      key: "origin",
      header: "来源",
      render: (entry) => <KnowledgeOriginBadge origin={entry.origin} />,
      widthClass: "w-28",
      headerFilter: {
        label: "来源",
        values: [...knowledgeOrigins],
        selectedValues: originFilter,
        renderLabel: (value) => knowledgeOriginLabels[value as KnowledgeOrigin],
        onToggle: (value) => setOriginFilter((current) =>
          current.includes(value) ? current.filter((item) => item !== value) : [...current, value]),
        onClear: () => setOriginFilter([]),
        getValue: (entry: KnowledgeEntry) => entry.origin
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
        ...(input.file ? { file: input.file } : {})
      });
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } else if (input.file) {
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

  const handleOpenPage = async () => {
    if (!selectedEntry || !citation?.page) return;
    // Reserve the tab during the click, before the authenticated fetch can trigger popup blocking.
    const tab = window.open("", "_blank");
    if (!tab) throw new Error("无法打开新标签页，请允许弹出窗口后重试。");
    tab.opener = null;
    try {
      const url = await repository.getFileObjectUrl(selectedEntry.id, citation.revisionId);
      tab.location.href = `${url}#page=${citation.page}`;
    } catch (error) {
      tab.close();
      throw error;
    }
  };

  const requestDelete = (entry: KnowledgeEntry) => {
    setDeleteError("");
    setDeleteEntry(entry);
  };

  const confirmDelete = async () => {
    if (!deleteEntry || deletePending) return;
    setDeletePending(true);
    setDeleteError("");
    try {
      await repository.hardDelete(deleteEntry.id);
      setRows((current) => current.filter((entry) => entry.id !== deleteEntry.id));
      setSearchResults((current) => current.filter((entry) => entry.entryId !== deleteEntry.id));
      citationResult.current = null;
      setSelectedId((current) => current === deleteEntry.id ? null : current);
      setDeleteEntry(null);
      if (initialEntryId === deleteEntry.id) onNavigate?.("/knowledge");
    } catch (error) {
      setDeleteError(presentError(error, "删除失败，请稍后重试。"));
    } finally {
      setDeletePending(false);
    }
  };

  // Reference edits are immediate audited calls; keep the background rows in
  // sync but never swap the editor's `entry` prop (that would reset the form).
  const applyReferenceUpdate = (updated: KnowledgeEntry) => {
    setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    return updated.parameterReferences;
  };
  const parameterReferencePicker = searchParameterDefinitions
    ? {
        search: searchParameterDefinitions,
        onAdd: async (entryId: string, definitionId: string) =>
          applyReferenceUpdate(await repository.addDefinitionReference(entryId, definitionId)),
        onRemove: async (entryId: string, reference: KnowledgeEntry["parameterReferences"][number]) =>
          applyReferenceUpdate(await (reference.kind === "definition"
            ? repository.removeDefinitionReference(entryId, reference.definitionId)
            : repository.removeParameterReference(entryId, reference.specId)))
      }
    : undefined;

  return (
    <div className="knowledge-page flex flex-col gap-5">
      <PageInsightBar
        variant="info"
        headline={loading ? "知识条目统计加载中…" : listError ? "知识条目统计暂不可用" : `已发布 ${publishedCount} 条 · 草稿 ${draftCount} 条`}
        actions={[]}
      />

      {canBatch && !searchQuery && checkedEntries.length > 0 ? <div role="group" aria-label="批量管理" className="flex flex-wrap items-center gap-2">
        <span className="text-sm">已选择 {checkedEntries.length} 条</span>
        {(Object.keys(knowledgeBatchLabels) as KnowledgeBatchInput["action"][]).map((action) =>
          <Button key={action} type="button" variant="outline" size="sm" onClick={() => setBatch({ action, entries: checkedEntries })}>
            {knowledgeBatchLabels[action]}
          </Button>)}
        <Button type="button" variant="ghost" size="sm" onClick={() => setCheckedIds([])}>取消选择</Button>
      </div> : null}

      <AdminListPage label="知识检索" headerActions={<span className="ml-auto flex items-center gap-2">
            {askXiaozeEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatchXiaozeOpenHandoff("knowledge-ask")}
              >
                <Bot data-icon="inline-start" />
                问小泽
              </Button>
            ) : null}
            <Button type="button" variant={capability.canEdit ? "outline" : "default"} size="sm" onClick={() => {
              void loadEntries();
              if (citationError || (linkedEntryId && selectedId === linkedEntryId)) void loadCitation();
            }} disabled={loading || citationLoading} aria-busy={loading || citationLoading || undefined}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
            {capability.canEdit ? (
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <Button ref={createTrigger} type="button" size="sm"><SquarePen data-icon="inline-start" />新建条目<ChevronDown aria-hidden="true" /></Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="row-action-menu__content" align="end"
                    onCloseAutoFocus={(event) => { if (editorOpen || uploadOpen || importOpen) event.preventDefault(); }}>
                    <DropdownMenu.Item className="row-action-menu__item button-size-sm" onSelect={() => { createTrigger.current?.focus(); setEditorEntry(null); setEditorOpen(true); }}>编写条目</DropdownMenu.Item>
                    <DropdownMenu.Item className="row-action-menu__item button-size-sm" onSelect={() => { createTrigger.current?.focus(); setUploadEntry(null); setUploadOpen(true); }}>上传文件</DropdownMenu.Item>
                    <DropdownMenu.Item className="row-action-menu__item button-size-sm" onSelect={() => { createTrigger.current?.focus(); setImportOpen(true); }}>批量导入</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </span>} filterBar={
        <form
          className="flex w-full min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <SearchField
            className="min-w-0 flex-1"
            value={searchInput}
            onValueChange={setSearchInput}
            placeholder="检索已发布知识"
            ariaLabel="检索知识库"
            loading={searching}
          />
          <Button type="submit" variant="outline" size="sm" className="shrink-0" disabled={searching} aria-busy={searching || undefined}>
            检索
          </Button>
          {!searchQuery && canBatch ? <label className="flex shrink-0 items-center gap-2 text-sm">
            <input type="checkbox" checked={pendingSuggestions} onChange={(event) => { setCheckedIds([]); setPendingSuggestions(event.target.checked); }} />
            待处理建议
          </label> : null}
          {searchQuery ? (
            <Button type="button" variant="outline" size="sm" onClick={clearSearch}>
              清除检索
            </Button>
          ) : null}

        </form>}
        notice={errorMessage ? <p role="alert" className="text-destructive">{errorMessage}</p> : undefined}
        tableState={searchQuery ? (
          <div className="flex flex-col gap-2" aria-label="检索结果">
            {!searching && !searchError ? <p className="text-xs text-muted-foreground">
              “{searchQuery}” 命中 {searchResults.length} 条已发布知识（草稿与已归档不参与检索）。
              {searchRetrieval ? (
                <span className="ml-1" data-retrieval-mode={searchRetrieval.mode}>
                  检索模式：{knowledgeRetrievalModeLabels[searchRetrieval.mode]}
                </span>
              ) : null}
            </p> : null}
            <ul className="flex flex-col gap-2">
              {searchResults.map((result) => (
                <li key={result.entryId}>
                  <a
                    href={knowledgeEntryHref({ entryId: result.entryId, revisionId: result.pageStart ? result.revisionId : null, page: result.pageStart })}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (onNavigate) {
                        onNavigate(event.currentTarget.pathname + event.currentTarget.search);
                        if (linkedEntryId === result.entryId && linkedRevisionId === (result.pageStart ? result.revisionId : null)
                          && linkedPage === (result.pageStart ? String(result.pageStart) : null)) void loadCitation();
                      }
                      else setSearchCitation({ entryId: result.entryId, revisionId: result.pageStart ? result.revisionId : null, page: result.pageStart ? String(result.pageStart) : null });
                    }}
                    className="block w-full rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{result.title}</span>
                      <span className="text-xs text-muted-foreground">{knowledgeContentFormLabels[result.contentForm]}</span>
                    </span>
                    <span className="mt-1 flex gap-2 text-xs text-muted-foreground">
                      {result.pageStart != null && result.pageEnd != null ? (
                        <span className="shrink-0">{formatKnowledgePageLabel(result.pageStart, result.pageEnd)}</span>
                      ) : null}
                      <span className="truncate">{result.excerpt}</span>
                    </span>
                  </a>
                </li>
              ))}
              {!searching && !searchError && searchResults.length === 0 ? (
                <li><Empty><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyDescription>没有命中已发布的知识条目。</EmptyDescription></EmptyHeader></Empty></li>
              ) : null}
            </ul>
          </div>
        ) : (
          (loading || citationLoading) && rows.length === 0 ? <SectionSkeleton label="正在加载知识条目" /> : (listError || citationError) && rows.length === 0 ? <></> : undefined
        )}
        table={{ ariaLabel: "知识条目列表", rows: filteredRows, rowKey: (entry) => entry.id, columns,
          onRowClick: (entry) => { setCitation(null); setSelectedId(entry.id); }, selectedRowKeys: checkedEntries.length ? checkedIds : undefined,
          selectedRowKey: selectedId ?? undefined, pageSize: 10, emptyState: <Empty><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyDescription>{rows.length === 0 ? "暂无知识条目。" : "当前筛选条件下没有条目。"}</EmptyDescription></EmptyHeader></Empty> }}
        rowActions={(entry) => ({ label: `${entry.title} 操作`,
          primaryAction: { id: "view", label: "查看", onSelect: () => { setCitation(null); setSelectedId(entry.id); } },
          items: [
            { id: "revisions", label: "修订历史", onSelect: () => setRevisionsEntry(entry) },
            ...(capability.canManage ? [{ id: "delete", label: "彻底删除", destructive: true as const, onRequestConfirmation: () => requestDelete(entry) }] : [])
          ]
        })}
        emptyState={{ message: rows.length === 0 ? "暂无知识条目。" : "当前筛选条件下没有条目。" }}
      />

      {batch ? <KnowledgeBatchDialog {...batch} repository={repository} onClose={() => {
        setBatch(null);
        void loadEntries();
      }} onComplete={(report) => {
        setRows((current) => current.map((entry) => report.results.find((row) => row.entryId === entry.id)?.entry ?? entry));
        setCheckedIds([]);
      }} /> : null}

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
        citation={citation ? { ...citation, openPage: handleOpenPage } : undefined}
        onRequestDelete={selectedEntry && capability.canManage ? requestDelete : undefined}
        onOpenDefinition={onOpenDefinition}
        visibleWorkflows={visibleWorkflows}
        onNavigate={onNavigate}
        onClose={() => { setSelectedId(null); setCitation(null); }}
      />

      <ConfirmDialog
        open={Boolean(deleteEntry)}
        title={`彻底删除「${deleteEntry?.title ?? ""}」`}
        description={`将永久删除该条目及其全部 ${deleteEntry?.headRevisionNumber ?? 0} 个修订，不可恢复。存储中的原始文件保留。删除会写入审计记录。`}
        confirmLabel="彻底删除"
        tone="danger"
        pending={deletePending}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteEntry(null)}
      />

      <KnowledgeEntryEditorDialog
        open={editorOpen}
        entry={editorEntry}
        onSubmit={handleEditorSubmit}
        parameterReferencePicker={editorEntry?.status === "archived" ? undefined : parameterReferencePicker}
        suggestionRepository={editorEntry?.status === "archived" ? undefined : repository}
        onReferenceUpdate={applyReferenceUpdate}
        onClose={() => {
          setEditorOpen(false);
          setEditorEntry(null);
          void loadEntries();
        }}
      />

      {capability.canEdit ? <KnowledgeImportDialog open={importOpen} repository={repository}
        onClose={() => setImportOpen(false)} onComplete={() => { void loadEntries(); }} /> : null}
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
        onViewFile={async (revision) => {
          if (!revisionsEntry) return;
          const tab = window.open("", "_blank");
          if (!tab) throw new Error("无法打开新标签页，请允许弹出窗口后重试。");
          tab.opener = null;
          try {
            tab.location.href = await repository.getFileObjectUrl(revisionsEntry.id, revision.id);
          } catch (error) {
            tab.close();
            throw error;
          }
        }}
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
