import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  Network,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Boxes
} from "lucide-react";

import {
  buildDtsTopologyTree,
  type DtsWorkbenchTreeNode
} from "@/application/parameters/buildDtsTopologyTree";
import { buildModuleTree } from "@/application/parameters/buildModuleTree";
import type { ModuleImportance } from "@/domain/parameter-topology/moduleRegistry";
import type {
  BindingHistoryEntry,
  EffectiveTopologyNode,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";
import type {
  DtsParameterWorkbenchRow,
  DtsWorkbenchGovernanceState
} from "@/domain/parameter-topology/workbenchTypes";

import type { BindingEditValidation } from "./BindingDetailPanel";
import { DtsBindingDetailDialog } from "./DtsBindingDetailDialog";
import { DtsParameterWorkbenchTable } from "./DtsParameterWorkbenchTable";
import { DtsTopologyNavigator } from "./DtsTopologyNavigator";

type GovernanceFilter = "all" | DtsWorkbenchGovernanceState;
type ImportanceFilter = "all" | ModuleImportance;
type NavigatorMode = "module" | "topology";

export type DtsParameterWorkbenchProps = {
  projectId?: string;
  configSetId?: string;
  revisionId?: string;
  layoutMode?: "desktop" | "tablet" | "mobile";
  /** Kept for API compatibility; browse UI is effective-only and surfaces source via provenance. */
  sourceRows: DtsParameterWorkbenchRow[];
  effectiveRows: DtsParameterWorkbenchRow[];
  /** Kept for API compatibility; topology tech view still uses effective nodes. */
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
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
  /** Optional mature-workbench current-edits tray rendered inside the DTS region. */
  currentEdits?: ReactNode;
  /** Validation and mapping governance controls remain in the same semantic region. */
  governanceContent?: ReactNode;
  expandAllNodesByDefault?: boolean;
  /** Called when the user asks to export the currently visible rows (semantic export). */
  onExportRows?: (rows: DtsParameterWorkbenchRow[]) => void;
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
  effectiveNodes,
  draftBindingIds,
  selectedBindingIds: controlledSelectedBindingIds,
  onSelectedBindingIdsChange,
  canEdit,
  onSelectBinding,
  onEditBinding,
  onCreateDraft,
  loadBindingHistory,
  currentEdits,
  governanceContent,
  expandAllNodesByDefault = false,
  onExportRows
}: DtsParameterWorkbenchProps) {
  const [query, setQuery] = useState("");
  const [governanceFilter, setGovernanceFilter] = useState<GovernanceFilter>("all");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>("all");
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>("module");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [uncontrolledSelectedBindingIds, setUncontrolledSelectedBindingIds] = useState<Set<string>>(new Set());
  const selectedBindingIds = controlledSelectedBindingIds ?? uncontrolledSelectedBindingIds;
  const setSelectedBindingIds = onSelectedBindingIdsChange ?? setUncontrolledSelectedBindingIds;
  const [detailIntent, setDetailIntent] = useState<"view" | "edit">("view");
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const pendingFocusRestoreRef = useRef<HTMLElement | null>(null);
  const listScrollXRef = useRef<HTMLDivElement | null>(null);
  const listScrollRailRef = useRef<HTMLDivElement | null>(null);
  const listScrollSyncing = useRef(false);

  const currentRows = effectiveRows;
  const moduleTree = useMemo(() => buildModuleTree({ rows: currentRows }), [currentRows]);
  const topologyTree = useMemo(
    () => buildDtsTopologyTree({
      view: "effective",
      sourceNodes: [],
      effectiveNodes,
      rows: currentRows
    }),
    [currentRows, effectiveNodes]
  );
  const tree = navigatorMode === "module" ? moduleTree : topologyTree;
  const selectedNodeExists = selectedNodeId ? treeContainsNode(tree, selectedNodeId) : true;
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;

  useEffect(() => {
    if (selectedNodeId && !selectedNodeExists) setSelectedNodeId(null);
  }, [selectedNodeExists, selectedNodeId]);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedBindingId(null);
    setSelectedBindingIds(new Set());
  }, [navigatorMode, setSelectedBindingIds]);

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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () => currentRows.filter((row) => {
      if (normalizedQuery && !row.searchText.includes(normalizedQuery)) return false;
      if (governanceFilter !== "all" && row.governanceState !== governanceFilter) return false;
      if (importanceFilter !== "all" && row.importance !== importanceFilter) return false;
      return subtreeBindingIds === null || subtreeBindingIds.has(row.bindingId);
    }),
    [currentRows, governanceFilter, importanceFilter, normalizedQuery, subtreeBindingIds]
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

  const selectBinding = (bindingId: string) => {
    detailOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedBindingId(bindingId);
    setDetailIntent("view");
    onSelectBinding(bindingId);
  };

  const editBinding = (bindingId: string) => {
    detailOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : detailOpenerRef.current;
    setSelectedBindingId(bindingId);
    setDetailIntent("edit");
    onEditBinding?.(bindingId);
  };

  const clearFilters = () => {
    setQuery("");
    setGovernanceFilter("all");
    setImportanceFilter("all");
    setSelectedNodeId(null);
  };

  const selectedRow = selectedBindingId
    ? currentRows.find((row) => row.bindingId === selectedBindingId) ?? null
    : null;

  const [historyEntries, setHistoryEntries] = useState<BindingHistoryEntry[]>([]);

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
    if (selectedBindingId || !pendingFocusRestoreRef.current) return;
    const opener = pendingFocusRestoreRef.current;
    pendingFocusRestoreRef.current = null;
    queueMicrotask(() => {
      if (opener.isConnected) opener.focus();
    });
  }, [selectedBindingId]);

  const closeDetail = () => {
    pendingFocusRestoreRef.current = detailOpenerRef.current;
    detailOpenerRef.current = null;
    setSelectedBindingId(null);
  };

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
        <div className="dts-parameter-workbench__header-actions" role="group" aria-label="导航模式">
          <button
            type="button"
            className={`button subtle${navigatorMode === "module" ? " is-active" : ""}`}
            aria-pressed={navigatorMode === "module"}
            onClick={() => setNavigatorMode("module")}
          >
            <Boxes size={15} strokeWidth={1.9} aria-hidden="true" />
            模块导航
          </button>
          <button
            type="button"
            className={`button subtle${navigatorMode === "topology" ? " is-active" : ""}`}
            aria-pressed={navigatorMode === "topology"}
            onClick={() => setNavigatorMode("topology")}
          >
            <Network size={15} strokeWidth={1.9} aria-hidden="true" />
            技术视图
          </button>
          {onExportRows ? (
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
          <span><Search size={14} strokeWidth={2} aria-hidden="true" />搜索参数</span>
          <input
            type="search"
            aria-label="搜索 DTS 参数"
            value={query}
            placeholder="参数名、模块、器件、路径或值"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="dts-parameter-workbench__governance-filter">
          <span><SlidersHorizontal size={14} strokeWidth={2} aria-hidden="true" />治理状态</span>
          <select
            aria-label="治理状态"
            value={governanceFilter}
            onChange={(event) => setGovernanceFilter(event.target.value as GovernanceFilter)}
          >
            <option value="all">全部治理状态</option>
            <option value="valid">有效（valid）</option>
            <option value="attention">待处理（attention）</option>
            <option value="blocked">阻断（blocked）</option>
          </select>
        </label>
        <label className="dts-parameter-workbench__importance-filter">
          <span>重要性</span>
          <select
            aria-label="重要性"
            value={importanceFilter}
            onChange={(event) => setImportanceFilter(event.target.value as ImportanceFilter)}
          >
            <option value="all">全部重要性</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </label>
        <button type="button" className="button subtle" onClick={clearFilters}>
          <RotateCcw size={15} strokeWidth={1.9} aria-hidden="true" />
          清除全部筛选
        </button>
        <p role="status" aria-live="polite" className="dts-parameter-workbench__result-count">
          显示 {visibleRows.length} / {currentRows.length} 个参数
          {selectedBindingIds.size > 0 ? ` · 已选 ${selectedBindingIds.size} 项草稿` : ""}
        </p>
      </div>

      <div className="dts-parameter-workbench__body">
        <div
          className="dts-parameter-workbench__navigator dts-workbench-topology"
          role="region"
          aria-label={navigatorMode === "module" ? "模块导航" : "DTS 拓扑导航"}
        >
          <h3 className="dts-parameter-workbench__navigator-title">
            {navigatorMode === "module" ? "模块导航" : "DTS 拓扑导航"}
          </h3>
          <DtsTopologyNavigator
            key={navigatorMode}
            view="effective"
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            expandAllByDefault={expandAllNodesByDefault}
            labelKind={navigatorMode === "module" ? "text" : "code"}
            emptyMessage={navigatorMode === "module" ? "暂无模块分组" : "暂无 DTS 拓扑节点"}
            ariaLabel={navigatorMode === "module" ? "业务模块树" : "生效 DTS 拓扑"}
            onSelectNode={(nodeId) => setSelectedNodeId((current) => current === nodeId ? null : nodeId)}
          />
        </div>
        <div
          className="dts-parameter-workbench__results dts-workbench-list"
          role="region"
          aria-label="DTS 参数列表"
        >
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
        </div>
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
      {selectedRow ? (
        <DtsBindingDetailDialog
          row={selectedRow}
          canEdit={canEdit && Boolean(onCreateDraft)}
          focusEditorOnOpen={detailIntent === "edit"}
          historyEntries={historyEntries}
          onClose={closeDetail}
          onCreateDraft={onCreateDraft ?? (() => Promise.reject(new Error("当前未配置语义草稿创建能力")))}
        />
      ) : null}
    </section>
  );
}
