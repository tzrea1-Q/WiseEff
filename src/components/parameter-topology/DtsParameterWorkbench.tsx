import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildDtsTopologyTree,
  type DtsWorkbenchTreeNode
} from "@/application/parameters/buildDtsTopologyTree";
import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
  TopologyView
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

export type DtsParameterWorkbenchProps = {
  sourceRows: DtsParameterWorkbenchRow[];
  effectiveRows: DtsParameterWorkbenchRow[];
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  draftBindingIds: ReadonlySet<string>;
  canEdit: boolean;
  initialView?: TopologyView;
  onSelectBinding: (bindingId: string) => void;
  onEditBinding?: (bindingId: string) => void;
  onCreateDraft?: (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }) => Promise<BindingEditValidation>;
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

export function DtsParameterWorkbench({
  sourceRows,
  effectiveRows,
  sourceNodes,
  effectiveNodes,
  draftBindingIds,
  canEdit,
  initialView = "effective",
  onSelectBinding,
  onEditBinding,
  onCreateDraft
}: DtsParameterWorkbenchProps) {
  const [view, setView] = useState<TopologyView>(initialView);
  const [query, setQuery] = useState("");
  const [governanceFilter, setGovernanceFilter] = useState<GovernanceFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [detailIntent, setDetailIntent] = useState<"view" | "edit">("view");
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const pendingFocusRestoreRef = useRef<HTMLElement | null>(null);

  const currentRows = view === "source" ? sourceRows : effectiveRows;
  const tree = useMemo(
    () => buildDtsTopologyTree({ view, sourceNodes, effectiveNodes, rows: currentRows }),
    [currentRows, effectiveNodes, sourceNodes, view]
  );
  const selectedNodeExists = useMemo(() => {
    if (!selectedNodeId) return true;
    const pending = [...tree];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.id === selectedNodeId) return true;
      pending.push(...node.children);
    }
    return false;
  }, [selectedNodeId, tree]);
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;

  useEffect(() => {
    if (selectedNodeId && !selectedNodeExists) setSelectedNodeId(null);
  }, [selectedNodeExists, selectedNodeId]);

  const subtreeBindingIds = useMemo(
    () => selectedSubtreeBindingIds(tree, effectiveSelectedNodeId),
    [effectiveSelectedNodeId, tree]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () => currentRows.filter((row) => {
      if (normalizedQuery && !row.searchText.includes(normalizedQuery)) return false;
      if (governanceFilter !== "all" && row.governanceState !== governanceFilter) return false;
      return subtreeBindingIds === null || subtreeBindingIds.has(row.bindingId);
    }),
    [currentRows, governanceFilter, normalizedQuery, subtreeBindingIds]
  );

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

  const switchView = (nextView: TopologyView) => {
    if (nextView === view) return;
    setView(nextView);
    setSelectedNodeId(null);
  };

  const clearFilters = () => {
    setQuery("");
    setGovernanceFilter("all");
    setSelectedNodeId(null);
  };

  const selectedRow = selectedBindingId
    ? currentRows.find((row) => row.bindingId === selectedBindingId) ?? null
    : null;

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
      className="dts-parameter-workbench"
    >
      <header className="dts-parameter-workbench__header">
        <div>
          <p className="eyebrow">Parameter workbench</p>
          <h2>DTS 参数工作台</h2>
          <p>按拓扑定位器件上下文，在稳定语义绑定上检索、治理和编辑项目参数。</p>
        </div>
        <div
          role="group"
          className="dts-parameter-workbench__view-switch"
          aria-label="DTS 视图"
        >
          <button
            type="button"
            className={view === "effective" ? "is-active" : ""}
            aria-pressed={view === "effective"}
            onClick={() => switchView("effective")}
          >
            生效 DTS
          </button>
          <button
            type="button"
            className={view === "source" ? "is-active" : ""}
            aria-pressed={view === "source"}
            onClick={() => switchView("source")}
          >
            源 DTS
          </button>
        </div>
      </header>

      <div className="dts-parameter-workbench__toolbar">
        <label className="dts-parameter-workbench__search">
          <span>搜索 DTS 参数</span>
          <input
            type="search"
            aria-label="搜索 DTS 参数"
            value={query}
            placeholder="属性、器件、地址、路径或值"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="dts-parameter-workbench__governance-filter">
          <span>治理状态</span>
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
        <button type="button" className="button subtle" onClick={clearFilters}>
          清除全部筛选
        </button>
        <p role="status" aria-live="polite" className="dts-parameter-workbench__result-count">
          显示 {visibleRows.length} / {currentRows.length} 个参数
        </p>
      </div>

      <div className="dts-parameter-workbench__body">
        <div className="dts-parameter-workbench__navigator">
          <h3 className="dts-parameter-workbench__navigator-title">DTS 拓扑导航</h3>
          <DtsTopologyNavigator
            view={view}
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            onSelectNode={(nodeId) => setSelectedNodeId((current) => current === nodeId ? null : nodeId)}
          />
        </div>
        <div className="dts-parameter-workbench__results">
          <DtsParameterWorkbenchTable
            rows={visibleRows}
            selectedBindingId={selectedBindingId}
            draftBindingIds={draftBindingIds}
            canEdit={canEdit}
            onSelectBinding={selectBinding}
            onEditBinding={onEditBinding && onCreateDraft ? editBinding : undefined}
          />
          {visibleRows.length === 0 ? (
            <p className="dts-parameter-workbench__empty">当前筛选范围内没有参数。</p>
          ) : null}
        </div>
      </div>
      {selectedRow ? (
        <DtsBindingDetailDialog
          row={selectedRow}
          canEdit={canEdit && Boolean(onCreateDraft)}
          focusEditorOnOpen={detailIntent === "edit"}
          onClose={closeDetail}
          onCreateDraft={onCreateDraft ?? (() => Promise.reject(new Error("当前未配置语义草稿创建能力")))}
        />
      ) : null}
    </section>
  );
}
