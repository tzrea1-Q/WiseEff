import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  Network,
  Search,
  Boxes
} from "lucide-react";

import { buildModuleTree } from "@/application/parameters/buildModuleTree";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import type {
  BindingHistoryEntry,
  EffectiveTopologyNode,
  ParameterSpecDetail,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import type { BindingEditValidation } from "./BindingDetailPanel";
import {
  DtsBindingDetailDialog,
  type BindingCompareEntry
} from "./DtsBindingDetailDialog";
import {
  DtsBindingDraftDialog,
  type LocalBindingDraftBag
} from "./DtsBindingDraftDialog";
import { DtsParameterWorkbenchTable } from "./DtsParameterWorkbenchTable";
import { DtsTopologyNavigator } from "./DtsTopologyNavigator";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";

type WorkbenchResultsMode = "parameters" | "dtsSource";

type PrimaryDtsSource = {
  fileName: string;
  versionNumber: number;
  text: string;
};

export type DtsParameterWorkbenchProps = {
  projectId?: string;
  configSetId?: string;
  revisionId?: string;
  layoutMode?: "desktop" | "tablet" | "mobile";
  /** Kept for API compatibility; browse UI is effective-only and surfaces source via provenance. */
  sourceRows: DtsParameterWorkbenchRow[];
  effectiveRows: DtsParameterWorkbenchRow[];
  /** Kept for API compatibility; parent workspace may still pass topology nodes. */
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  /** Admin module registry — used to nest the module navigator by parentId. */
  moduleRegistry?: ParameterModuleRegistry;
  draftBindingIds: ReadonlySet<string>;
  /** Optional controlled draft multi-select (for selective submit in the draft tray). */
  selectedBindingIds?: ReadonlySet<string>;
  onSelectedBindingIdsChange?: (next: Set<string>) => void;
  canEdit: boolean;
  onSelectBinding: (bindingId: string) => void;
  onEditBinding?: (bindingId: string) => void;
  onCreateDraft?: (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }) => Promise<BindingEditValidation>;
  /** Loads per-binding revision history when a detail dialog opens. */
  loadBindingHistory?: (bindingId: string) => Promise<BindingHistoryEntry[]>;
  /** Loads cross-project compare peers when a detail dialog opens. */
  loadBindingCompare?: (bindingId: string) => Promise<BindingCompareEntry[]>;
  /** Loads parameter-spec meaning/example fields when a detail dialog opens. */
  loadParameterSpec?: (parameterSpecId: string) => Promise<ParameterSpecDetail>;
  /** Optional mature-workbench current-edits tray rendered inside the DTS region. */
  currentEdits?: ReactNode;
  /**
   * Mapping / revision blockers and related status. Omit when empty so the workbench
   * does not reserve a blank governance shell.
   */
  governanceContent?: ReactNode;
  /** Secondary toolbar actions (e.g. revision validate) kept out of the governance panel. */
  toolbarActions?: ReactNode;
  expandAllNodesByDefault?: boolean;
  /** Called when the user asks to export the currently visible rows (semantic export). */
  onExportRows?: (rows: DtsParameterWorkbenchRow[]) => void;
  /** Loads the project's primary DTS source when entering tech view. */
  loadPrimaryDtsSource?: () => Promise<PrimaryDtsSource>;
};

function selectedSubtreeBindingIds(
  roots: DtsWorkbenchTreeNode[],
  selectedNodeId: string | null
): Set<string> | null {
  if (!selectedNodeId) return null;
  const pending = [...roots];
  let selected: DtsWorkbenchTreeNode | undefined;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.id === selectedNodeId) {
      selected = node;
      break;
    }
    pending.push(...node.children);
  }
  if (!selected) return null;

  const bindingIds = new Set<string>();
  const subtree = [selected];
  while (subtree.length > 0) {
    const node = subtree.pop()!;
    for (const bindingId of node.bindingIds) bindingIds.add(bindingId);
    subtree.push(...node.children);
  }
  return bindingIds;
}

function smallestPositiveSourceLine(
  rows: DtsParameterWorkbenchRow[],
  bindingIds: Set<string> | null
): number | null {
  if (!bindingIds) return null;
  let smallest: number | null = null;
  for (const row of rows) {
    if (!bindingIds.has(row.bindingId)) continue;
    const line = row.sourceLine;
    if (typeof line !== "number" || line < 1) continue;
    if (smallest === null || line < smallest) smallest = line;
  }
  return smallest;
}

function treeContainsNode(roots: DtsWorkbenchTreeNode[], nodeId: string): boolean {
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.id === nodeId) return true;
    pending.push(...node.children);
  }
  return false;
}

export function DtsParameterWorkbench({
  projectId,
  configSetId,
  revisionId,
  layoutMode = "desktop",
  sourceRows: _sourceRows,
  effectiveRows,
  sourceNodes: _sourceNodes,
  effectiveNodes: _effectiveNodes,
  moduleRegistry,
  draftBindingIds,
  selectedBindingIds: controlledSelectedBindingIds,
  onSelectedBindingIdsChange,
  canEdit,
  onSelectBinding,
  onEditBinding,
  onCreateDraft,
  loadBindingHistory,
  loadBindingCompare,
  loadParameterSpec,
  currentEdits,
  governanceContent,
  toolbarActions,
  expandAllNodesByDefault: _expandAllNodesByDefault = false,
  onExportRows,
  loadPrimaryDtsSource
}: DtsParameterWorkbenchProps) {
  const [query, setQuery] = useState("");
  const [resultsMode, setResultsMode] = useState<WorkbenchResultsMode>("parameters");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [uncontrolledSelectedBindingIds, setUncontrolledSelectedBindingIds] = useState<Set<string>>(new Set());
  const selectedBindingIds = controlledSelectedBindingIds ?? uncontrolledSelectedBindingIds;
  const setSelectedBindingIds = onSelectedBindingIdsChange ?? setUncontrolledSelectedBindingIds;
  const [detailIntent, setDetailIntent] = useState<"view" | "edit">("view");
  const [localDraftBag, setLocalDraftBag] = useState<LocalBindingDraftBag>({});
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const [focusedDraftBindingId, setFocusedDraftBindingId] = useState<string | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const pendingFocusRestoreRef = useRef<HTMLElement | null>(null);
  const listScrollXRef = useRef<HTMLDivElement | null>(null);
  const listScrollRailRef = useRef<HTMLDivElement | null>(null);
  const listScrollSyncing = useRef(false);

  const currentRows = effectiveRows;
  const moduleTree = useMemo(
    () => buildModuleTree({ rows: currentRows, modules: moduleRegistry?.modules }),
    [currentRows, moduleRegistry],
  );
  const tree = moduleTree;
  const selectedNodeExists = selectedNodeId ? treeContainsNode(tree, selectedNodeId) : true;
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;

  useEffect(() => {
    if (selectedNodeId && !selectedNodeExists) setSelectedNodeId(null);
  }, [selectedNodeExists, selectedNodeId]);

  const [dtsSourceStatus, setDtsSourceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dtsSource, setDtsSource] = useState<PrimaryDtsSource | null>(null);
  const [dtsSourceErrorMessage, setDtsSourceErrorMessage] = useState<string | null>(null);
  const [dtsSourceLoadToken, setDtsSourceLoadToken] = useState(0);
  const [findNextToken, setFindNextToken] = useState(0);
  const [findStatus, setFindStatus] = useState({ matchCount: 0, activeIndex: 0 });
  const onFindStatusChangeRef = useRef<(status: { matchCount: number; activeIndex: number }) => void>(() => {});
  onFindStatusChangeRef.current = (status) => setFindStatus(status);
  const onFindStatusChange = useCallback((status: { matchCount: number; activeIndex: number }) => {
    onFindStatusChangeRef.current(status);
  }, []);

  const loadDtsSource = useCallback(() => {
    if (!loadPrimaryDtsSource) {
      setDtsSourceStatus("error");
      setDtsSource(null);
      setDtsSourceErrorMessage(null);
      return;
    }
    setDtsSourceStatus("loading");
    setDtsSourceErrorMessage(null);
    setDtsSourceLoadToken((current) => current + 1);
  }, [loadPrimaryDtsSource]);

  useEffect(() => {
    if (resultsMode !== "dtsSource" || dtsSourceLoadToken === 0 || !loadPrimaryDtsSource) {
      return undefined;
    }
    let cancelled = false;
    void loadPrimaryDtsSource()
      .then((source) => {
        if (!cancelled) {
          setDtsSource(source);
          setDtsSourceStatus("ready");
          setDtsSourceErrorMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDtsSource(null);
          setDtsSourceStatus("error");
          setDtsSourceErrorMessage(
            error instanceof Error ? error.message : "无法加载 DTS 源码。"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dtsSourceLoadToken, loadPrimaryDtsSource, resultsMode]);

  const enterDtsSourceMode = () => {
    setResultsMode("dtsSource");
    if (dtsSourceStatus !== "ready" || !dtsSource) {
      loadDtsSource();
    }
  };

  useEffect(() => {
    if (controlledSelectedBindingIds) return;
    setUncontrolledSelectedBindingIds((current) => {
      if (current.size === 0) return current;
      const next = new Set([...current].filter((id) => draftBindingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [controlledSelectedBindingIds, draftBindingIds]);

  useEffect(() => {
    if (!controlledSelectedBindingIds || !onSelectedBindingIdsChange) return;
    if (controlledSelectedBindingIds.size === 0) return;
    const next = new Set([...controlledSelectedBindingIds].filter((id) => draftBindingIds.has(id)));
    if (next.size !== controlledSelectedBindingIds.size) {
      onSelectedBindingIdsChange(next);
    }
  }, [controlledSelectedBindingIds, draftBindingIds, onSelectedBindingIdsChange]);

  const subtreeBindingIds = useMemo(
    () => selectedSubtreeBindingIds(tree, effectiveSelectedNodeId),
    [effectiveSelectedNodeId, tree]
  );
  const moduleFocusLine = useMemo(
    () => resultsMode === "dtsSource"
      ? smallestPositiveSourceLine(currentRows, subtreeBindingIds)
      : null,
    [currentRows, resultsMode, subtreeBindingIds]
  );
  const moduleJumpStatus = useMemo(() => {
    if (resultsMode !== "dtsSource" || subtreeBindingIds === null) return null;
    if (moduleFocusLine !== null) return null;
    return "当前模块暂无源码行定位";
  }, [moduleFocusLine, resultsMode, subtreeBindingIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () => currentRows.filter((row) => {
      if (normalizedQuery && !row.searchText.includes(normalizedQuery)) return false;
      return subtreeBindingIds === null || subtreeBindingIds.has(row.bindingId);
    }),
    [currentRows, normalizedQuery, subtreeBindingIds]
  );

  useEffect(() => {
    const scroller = listScrollXRef.current;
    const rail = listScrollRailRef.current;
    if (!scroller || !rail) return;

    const syncFrom = (source: HTMLDivElement, target: HTMLDivElement) => {
      if (listScrollSyncing.current) return;
      listScrollSyncing.current = true;
      target.scrollLeft = source.scrollLeft;
      listScrollSyncing.current = false;
    };

    const onScrollerScroll = () => syncFrom(scroller, rail);
    const onRailScroll = () => syncFrom(rail, scroller);
    scroller.addEventListener("scroll", onScrollerScroll, { passive: true });
    rail.addEventListener("scroll", onRailScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScrollerScroll);
      rail.removeEventListener("scroll", onRailScroll);
    };
  }, [layoutMode, visibleRows.length]);

  const rowsByBindingId = useMemo(
    () => new Map(currentRows.map((row) => [row.bindingId, row])),
    [currentRows]
  );

  const upsertLocalDraft = (
    bindingId: string,
    seed?: { rawValue?: string; reason?: string; overwrite?: boolean }
  ) => {
    setLocalDraftBag((current) => {
      const existing = current[bindingId];
      if (existing && !seed?.overwrite) return current;
      const fallbackRaw = rowsByBindingId.get(bindingId)?.rawValue ?? "";
      const nextRaw = seed?.rawValue ?? existing?.rawValue ?? fallbackRaw;
      return {
        ...current,
        [bindingId]: {
          rawValue: formatDtsRawValueForUi(nextRaw) || nextRaw,
          reason: seed?.reason ?? existing?.reason ?? ""
        }
      };
    });
  };

  const openDraftDialog = (bindingId: string, seed?: { rawValue?: string; reason?: string; overwrite?: boolean }) => {
    const row = rowsByBindingId.get(bindingId);
    if (!row) return;
    const seededRaw = seed?.rawValue ?? row.rawValue;
    upsertLocalDraft(bindingId, {
      rawValue: formatDtsRawValueForUi(seededRaw) || seededRaw,
      reason: seed?.reason,
      overwrite: seed?.overwrite
    });
    setFocusedDraftBindingId(bindingId);
    setDraftDialogOpen(true);
    setSelectedBindingId(null);
  };

  const selectBinding = (bindingId: string) => {
    detailOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedBindingId(bindingId);
    setDetailIntent("view");
    setDraftDialogOpen(false);
    onSelectBinding(bindingId);
  };

  const editBinding = (bindingId: string) => {
    detailOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : detailOpenerRef.current;
    openDraftDialog(bindingId);
    setDetailIntent("edit");
    onEditBinding?.(bindingId);
  };

  const addBindingToDraft = (bindingId: string) => {
    openDraftDialog(bindingId);
    setDetailIntent("edit");
  };

  const useCompareAsDraft = (input: { rawValue: string; reason: string }) => {
    if (!selectedBindingId) return;
    openDraftDialog(selectedBindingId, {
      rawValue: input.rawValue,
      reason: input.reason,
      overwrite: true
    });
    setDetailIntent("edit");
  };

  const selectedRow = selectedBindingId
    ? currentRows.find((row) => row.bindingId === selectedBindingId) ?? null
    : null;

  const [historyEntries, setHistoryEntries] = useState<BindingHistoryEntry[]>([]);
  const [compareEntries, setCompareEntries] = useState<BindingCompareEntry[]>([]);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetail | null>(null);
  const [specDetailStatus, setSpecDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!selectedBindingId || !loadBindingHistory) {
      setHistoryEntries([]);
      return undefined;
    }
    let cancelled = false;
    const requestBindingId = selectedBindingId;
    setHistoryEntries([]);
    loadBindingHistory(requestBindingId)
      .then((entries) => {
        if (!cancelled) setHistoryEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setHistoryEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBindingId, loadBindingHistory]);

  useEffect(() => {
    if (!selectedBindingId || !loadBindingCompare) {
      setCompareEntries([]);
      return undefined;
    }
    let cancelled = false;
    const requestBindingId = selectedBindingId;
    setCompareEntries([]);
    loadBindingCompare(requestBindingId)
      .then((entries) => {
        if (!cancelled) setCompareEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setCompareEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBindingId, loadBindingCompare]);

  useEffect(() => {
    if (!selectedRow || detailIntent !== "view" || !loadParameterSpec) {
      setSpecDetail(null);
      setSpecDetailStatus("idle");
      return undefined;
    }
    let cancelled = false;
    const requestSpecId = selectedRow.parameterSpecId;
    setSpecDetail(null);
    setSpecDetailStatus("loading");
    void Promise.resolve(loadParameterSpec(requestSpecId))
      .then((detail) => {
        if (!cancelled) {
          setSpecDetail(detail);
          setSpecDetailStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpecDetail(null);
          setSpecDetailStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRow, detailIntent, loadParameterSpec]);

  useEffect(() => {
    if (selectedBindingId || draftDialogOpen || !pendingFocusRestoreRef.current) return;
    const opener = pendingFocusRestoreRef.current;
    pendingFocusRestoreRef.current = null;
    queueMicrotask(() => {
      if (opener.isConnected) opener.focus();
    });
  }, [draftDialogOpen, selectedBindingId]);

  const closeDetail = () => {
    pendingFocusRestoreRef.current = detailOpenerRef.current;
    detailOpenerRef.current = null;
    setSelectedBindingId(null);
  };

  const closeDraftDialog = () => {
    pendingFocusRestoreRef.current = detailOpenerRef.current;
    detailOpenerRef.current = null;
    setDraftDialogOpen(false);
    setFocusedDraftBindingId(null);
  };

  const downloadDtsSource = () => {
    if (!dtsSource) return;
    const blob = new Blob([dtsSource.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = dtsSource.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const dtsFindQuery = resultsMode === "dtsSource" ? query : "";

  useEffect(() => {
    if (draftDialogOpen && Object.keys(localDraftBag).length === 0) {
      setDraftDialogOpen(false);
      setFocusedDraftBindingId(null);
    }
  }, [draftDialogOpen, localDraftBag]);

  return (
    <section
      role="region"
      aria-label="DTS 参数工作台"
      className={`dts-parameter-workbench dts-parameter-workbench--${layoutMode}`}
      data-project-id={projectId}
      data-config-set-id={configSetId}
      data-revision-id={revisionId}
    >
      <header className="dts-parameter-workbench__header">
        <div>
          <p className="eyebrow">Parameter workbench</p>
          <h2>项目参数工作台</h2>
          <p>按业务模块定位参数；器件/驱动与源出处保留在行内与详情中。</p>
        </div>
        <div className="dts-parameter-workbench__header-actions" role="group" aria-label="结果模式">
          <button
            type="button"
            className={`button subtle${resultsMode === "parameters" ? " is-active" : ""}`}
            aria-pressed={resultsMode === "parameters"}
            onClick={() => setResultsMode("parameters")}
          >
            <Boxes size={15} strokeWidth={1.9} aria-hidden="true" />
            模块导航
          </button>
          <button
            type="button"
            className={`button subtle${resultsMode === "dtsSource" ? " is-active" : ""}`}
            aria-pressed={resultsMode === "dtsSource"}
            onClick={enterDtsSourceMode}
          >
            <Network size={15} strokeWidth={1.9} aria-hidden="true" />
            技术视图
          </button>
          {resultsMode === "dtsSource" ? (
            <button
              type="button"
              className="button subtle"
              disabled={dtsSourceStatus !== "ready" || !dtsSource}
              onClick={downloadDtsSource}
            >
              <Download size={15} strokeWidth={1.9} aria-hidden="true" />
              下载 DTS
            </button>
          ) : onExportRows ? (
            <button
              type="button"
              className="button subtle"
              disabled={visibleRows.length === 0}
              onClick={() => onExportRows(visibleRows)}
            >
              <Download size={15} strokeWidth={1.9} aria-hidden="true" />
              导出当前结果
            </button>
          ) : null}
        </div>
      </header>

      <div className="dts-parameter-workbench__toolbar">
        <label className="dts-parameter-workbench__search">
          <span>
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            {resultsMode === "dtsSource" ? "查找源码" : "搜索参数"}
          </span>
          <input
            type="search"
            aria-label={resultsMode === "dtsSource" ? "在 DTS 源码中查找" : "搜索 DTS 参数"}
            value={query}
            placeholder={resultsMode === "dtsSource" ? "在 DTS 文本中查找" : "参数名、模块、器件、路径或值"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (resultsMode === "dtsSource" && event.key === "Enter") {
                event.preventDefault();
                setFindNextToken((current) => current + 1);
              }
            }}
          />
        </label>
        <p role="status" aria-live="polite" className="dts-parameter-workbench__result-count">
          {resultsMode === "dtsSource" ? (
            moduleJumpStatus
              ?? (dtsFindQuery.trim()
                ? `匹配 ${findStatus.activeIndex} / ${findStatus.matchCount}`
                : "DTS 源码查看")
          ) : (
            <>
              显示 {visibleRows.length} / {currentRows.length} 个参数
              {selectedBindingIds.size > 0 ? ` · 已选 ${selectedBindingIds.size} 项草稿` : ""}
            </>
          )}
        </p>
        {toolbarActions ? (
          <div className="dts-parameter-workbench__toolbar-actions">
            {toolbarActions}
          </div>
        ) : null}
      </div>

      {currentEdits ? (
        <div
          className="dts-parameter-workbench__current-edits dts-draft-tray"
          role="region"
          aria-label="本轮已修改"
        >
          {currentEdits}
        </div>
      ) : null}
      {governanceContent ? (
        <div className="dts-parameter-workbench__governance-content">
          {governanceContent}
        </div>
      ) : null}

      <div className="dts-parameter-workbench__body">
        <div
          className="dts-parameter-workbench__navigator dts-workbench-topology"
          role="region"
          aria-label="模块导航"
        >
          <h3 className="dts-parameter-workbench__navigator-title">
            模块导航
          </h3>
          <DtsTopologyNavigator
            view="effective"
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            defaultExpandDepth={2}
            labelKind="text"
            emptyMessage="暂无模块分组"
            ariaLabel="业务模块树"
            onSelectNode={(nodeId) => setSelectedNodeId((current) => current === nodeId ? null : nodeId)}
          />
        </div>
        <div
          className="dts-parameter-workbench__results dts-workbench-list"
          role="region"
          aria-label={resultsMode === "parameters" ? "DTS 参数列表" : "技术视图结果"}
        >
          {resultsMode === "parameters" ? (
            <>
              <div
                ref={listScrollXRef}
                className="dts-workbench-list__scroll-x"
              >
                <div className="dts-workbench-list__scroll-y">
                  <DtsParameterWorkbenchTable
                    rows={visibleRows}
                    selectedBindingId={selectedBindingId}
                    draftBindingIds={draftBindingIds}
                    selectedBindingIds={selectedBindingIds}
                    canEdit={canEdit}
                    onSelectBinding={selectBinding}
                    onEditBinding={onEditBinding && onCreateDraft ? editBinding : undefined}
                    onSelectedBindingIdsChange={setSelectedBindingIds}
                  />
                  {visibleRows.length === 0 ? (
                    <p className="dts-parameter-workbench__empty">当前筛选范围内没有参数。</p>
                  ) : null}
                </div>
              </div>
              <div
                ref={listScrollRailRef}
                className="dts-workbench-list__h-rail"
                aria-hidden="true"
              >
                <div className="dts-workbench-list__h-rail-spacer" />
              </div>
            </>
          ) : dtsSourceStatus === "loading" ? (
            <p className="dts-parameter-workbench__empty" role="status">正在加载 DTS 源码…</p>
          ) : dtsSourceStatus === "error" ? (
            <div className="dts-parameter-workbench__dts-source-error">
              <p role="alert">无法加载 DTS 源码。</p>
              {dtsSourceErrorMessage ? (
                <p className="dts-parameter-workbench__dts-source-error-detail">{dtsSourceErrorMessage}</p>
              ) : null}
              <button type="button" className="button subtle" onClick={loadDtsSource}>
                重试
              </button>
            </div>
          ) : dtsSource ? (
            <ProjectPrimaryDtsViewer
              fileName={dtsSource.fileName}
              versionNumber={dtsSource.versionNumber}
              text={dtsSource.text}
              focusLine={moduleFocusLine}
              findQuery={dtsFindQuery}
              findNextToken={findNextToken}
              onFindStatusChange={onFindStatusChange}
            />
          ) : (
            <p className="dts-parameter-workbench__empty" role="status">暂无 DTS 源码。</p>
          )}
        </div>
      </div>
      {selectedRow && detailIntent === "view" ? (
        <DtsBindingDetailDialog
          row={selectedRow}
          canEdit={canEdit && Boolean(onCreateDraft)}
          historyEntries={historyEntries}
          compareEntries={compareEntries}
          baseProjectId={projectId ?? "current"}
          baseProjectName="当前项目"
          specDetail={specDetail}
          specDetailStatus={specDetailStatus}
          onClose={closeDetail}
          onAddToDraft={canEdit && onCreateDraft ? addBindingToDraft : undefined}
          onUseCompareAsDraft={canEdit && onCreateDraft ? useCompareAsDraft : undefined}
        />
      ) : null}
      {draftDialogOpen && Object.keys(localDraftBag).length > 0 ? (
        <DtsBindingDraftDialog
          rowsByBindingId={rowsByBindingId}
          draftBag={localDraftBag}
          focusedBindingId={focusedDraftBindingId}
          canEdit={canEdit && Boolean(onCreateDraft)}
          onClose={closeDraftDialog}
          onUpdateDraft={(bindingId, patch) => {
            setLocalDraftBag((current) => ({
              ...current,
              [bindingId]: {
                rawValue: patch.rawValue ?? current[bindingId]?.rawValue ?? "",
                reason: patch.reason ?? current[bindingId]?.reason ?? ""
              }
            }));
          }}
          onRemoveDraft={(bindingId) => {
            setLocalDraftBag((current) => {
              const next = { ...current };
              delete next[bindingId];
              return next;
            });
          }}
          onClearAll={() => setLocalDraftBag({})}
          onCreateDraft={onCreateDraft ?? (() => Promise.reject(new Error("当前未配置语义草稿创建能力")))}
        />
      ) : null}
    </section>
  );
}
