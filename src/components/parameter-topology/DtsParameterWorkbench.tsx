import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { SectionEmpty } from "@/components/common/SectionState";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  FileCode,
  Boxes
} from "lucide-react";
import { SearchField } from "@/components/common/SearchField";
import { ViewSwitch } from "@/components/ui/view-switch";
import { filterItems } from "@/lib/search";
import { dtsWorkbenchRowSearchProfile } from "@/lib/search/profiles";

import { useHorizontalDragScroll } from "@/hooks/useHorizontalDragScroll";
import { presentError } from "@/infrastructure/http/presentError";
import { buildModuleTree } from "@/application/parameters/buildModuleTree";
import { buildParameterModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import {
  clearUnsavedParameterWork,
  reportUnsavedParameterWork
} from "@/application/parameters/unsavedParameterWork";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import type {
  BindingHistoryEntry,
  CanonicalDtsDefinitionDetail,
  EffectiveTopologyNode,
  ParameterSpecDetail,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import {
  canonicalizeTreeFilterSelection,
  collectTreeFilterSelectedDescendantIds
} from "@/domain/tree-filter/treeFilter";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import type { BindingEditValidation } from "./BindingDetailPanel";
import {
  DtsBindingDetailDialog,
  type BindingCompareEntry,
  type DtsParameterEdit
} from "./DtsBindingDetailDialog";
import type { PendingBindingDraft } from "./draftTrayTypes";
import { DtsParameterWorkbenchTable } from "./DtsParameterWorkbenchTable";
import { DtsTopologyNavigator } from "./DtsTopologyNavigator";
import { useModuleNodeSelection } from "@/hooks/useModuleNodeSelection";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";

type WorkbenchResultsMode = "parameters" | "dtsSource";

type PrimaryDtsSource = {
  fileName: string;
  versionNumber: number;
  text: string;
};

export type DtsParameterWorkbenchProps = {
  projectId?: string;
  projectName?: string;
  requestedBindingId?: string;
  pendingDrafts?: readonly PendingBindingDraft[];
  requestedEditBindingId?: string;
  editRequestToken?: number;
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
  onStartDtsReload?: (bindingId: string) => void;
  onCreateDraft?: (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
    action?: "set" | "delete";
  }) => Promise<BindingEditValidation>;
  /** Opens node enablement edit for the given logical node id. */
  onEditNodeEnablement?: (logicalNodeId: string) => void;
  /** Loads per-binding revision history when a detail dialog opens. */
  loadBindingHistory?: (bindingId: string) => Promise<BindingHistoryEntry[]>;
  /** Loads cross-project compare peers when a detail dialog opens. */
  loadBindingCompare?: (bindingId: string) => Promise<BindingCompareEntry[]>;
  /** Loads parameter-spec meaning/example fields when a detail dialog opens. */
  loadParameterSpec?: (
    definitionId: string,
    effectiveRevisionId: string,
    propertyKey: string
  ) => Promise<ParameterSpecDetail | CanonicalDtsDefinitionDetail>;
  /** Latest catalog revision is read for display only, never for project validation. */
  loadLatestParameterSpec?: (definitionId: string, propertyKey: string) => Promise<CanonicalDtsDefinitionDetail>;
  /** Optional mature-workbench current-edits tray rendered inside the DTS region. */
  currentEdits?: ReactNode;
  /**
   * Mapping / revision blockers and related status. Omit when empty so the workbench
   * does not reserve a blank governance shell.
   */
  governanceContent?: ReactNode;
  notice?: ReactNode;
  /**
   * Soft notices rendered below the main workbench body (e.g. collapsed dangling
   * overlay self-anchor summary). Kept out of the top governance strip.
   */
  footerContent?: ReactNode;
  /** Secondary toolbar actions (e.g. revision validate) kept out of the governance panel. */
  toolbarActions?: ReactNode;
  expandAllNodesByDefault?: boolean;
  /** Called when the user asks to export the currently visible rows (semantic export). */
  onExportRows?: (rows: DtsParameterWorkbenchRow[]) => void;
  /** Loads the project's primary DTS source when entering tech view. */
  loadPrimaryDtsSource?: (sourceFileName?: string) => Promise<PrimaryDtsSource>;
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

function nodePath(roots: DtsWorkbenchTreeNode[], nodeId: string): string[] {
  for (const node of roots) {
    if (node.id === nodeId) return [node.label];
    const childPath = nodePath(node.children, nodeId);
    if (childPath.length) return [node.label, ...childPath];
  }
  return [];
}

export function DtsParameterWorkbench({
  projectId,
  projectName,
  requestedBindingId,
  pendingDrafts = [],
  requestedEditBindingId,
  editRequestToken,
  configSetId,
  revisionId,
  layoutMode = "desktop",
  sourceRows: _sourceRows,
  effectiveRows,
  sourceNodes: _sourceNodes,
  effectiveNodes,
  moduleRegistry,
  draftBindingIds,
  selectedBindingIds: controlledSelectedBindingIds,
  onSelectedBindingIdsChange,
  canEdit,
  onSelectBinding,
  onStartDtsReload,
  onCreateDraft,
  onEditNodeEnablement,
  loadBindingHistory,
  loadBindingCompare,
  loadParameterSpec,
  loadLatestParameterSpec,
  currentEdits,
  governanceContent,
  notice,
  footerContent,
  toolbarActions,
  expandAllNodesByDefault: _expandAllNodesByDefault = false,
  onExportRows,
  loadPrimaryDtsSource
}: DtsParameterWorkbenchProps) {
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string[]>([]);
  const [resultsMode, setResultsMode] = useState<WorkbenchResultsMode>("parameters");
  const resultsId = useId();
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [uncontrolledSelectedBindingIds, setUncontrolledSelectedBindingIds] = useState<Set<string>>(new Set());
  const selectedBindingIds = controlledSelectedBindingIds ?? uncontrolledSelectedBindingIds;
  const setSelectedBindingIds = onSelectedBindingIdsChange ?? setUncontrolledSelectedBindingIds;
  const [localDraftBag, setLocalDraftBag] = useState<Record<string, DtsParameterEdit & { saved?: boolean }>>({});
  const previousDraftBindingIds = useRef(draftBindingIds);
  useEffect(() => {
    const previous = previousDraftBindingIds.current;
    previousDraftBindingIds.current = draftBindingIds;
    setLocalDraftBag(current => {
      const expired = Object.keys(current).filter(id => current[id].saved && (draftBindingIds.has(id) || previous.has(id)));
      if (!expired.length) return current;
      const next = { ...current };
      expired.forEach(id => { delete next[id]; });
      return next;
    });
  }, [draftBindingIds]);
  const localChangeCount = Object.values(localDraftBag).filter((draft) => !draft.saved).length;
  useEffect(() => {
    reportUnsavedParameterWork("workbench-local-draft-bag", localChangeCount);
    return () => {
      clearUnsavedParameterWork("workbench-local-draft-bag");
    };
  }, [localChangeCount]);
  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    setLocalDraftBag({});
    setSelectedBindingId(null);
    setQuery("");
    setModuleFilter([]);
  }, [projectId]);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const pendingFocusRestoreRef = useRef<HTMLElement | null>(null);
  const listScrollXRef = useRef<HTMLDivElement | null>(null);
  const listScrollRailRef = useRef<HTMLDivElement | null>(null);
  const listScrollSyncing = useRef(false);
  useHorizontalDragScroll(listScrollXRef);

  const currentRows = effectiveRows;
  const handledRequest = useRef<string | null>(null);
  const moduleTree = useMemo(
    () => buildModuleTree({ rows: currentRows, modules: moduleRegistry?.modules, groupByDevice: true }),
    [currentRows, moduleRegistry],
  );
  const tree = moduleTree;
  const [selectedNodeId, setSelectedNodeId] = useModuleNodeSelection((nodeId) => treeContainsNode(tree, nodeId));
  const selectedNodeExists = selectedNodeId ? treeContainsNode(tree, selectedNodeId) : true;
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;

  useEffect(() => {
    const key = `${projectId ?? ""}:${requestedBindingId ?? ""}`;
    if (!requestedBindingId || handledRequest.current === key
      || !currentRows.some((row) => row.bindingId === requestedBindingId)) return;
    handledRequest.current = key;
    setQuery("");
    setModuleFilter([]);
    setSelectedNodeId(null);
    setResultsMode("parameters");
    setSelectedBindingId(requestedBindingId);
    onSelectBinding(requestedBindingId);
  }, [currentRows, onSelectBinding, projectId, requestedBindingId, setSelectedNodeId]);

  const handledEditRequest = useRef<string | null>(null);
  useEffect(() => {
    const key = `${projectId}:${requestedEditBindingId}:${editRequestToken}`;
    if (!requestedEditBindingId || handledEditRequest.current === key || !currentRows.some(row => row.bindingId === requestedEditBindingId)) return;
    handledEditRequest.current = key;
    setSelectedBindingId(requestedEditBindingId);
    setResultsMode("parameters");
  }, [currentRows, editRequestToken, projectId, requestedEditBindingId]);

  const [dtsSourceStatus, setDtsSourceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dtsSource, setDtsSource] = useState<PrimaryDtsSource | null>(null);
  const [sourceFocusLine, setSourceFocusLine] = useState<number | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | undefined>();
  useEffect(() => { setSourceFocusLine(null); }, [effectiveSelectedNodeId]);
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
    void loadPrimaryDtsSource(sourceFileName)
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
          setDtsSourceErrorMessage(presentError(error, "无法加载 DTS 源码，请稍后重试。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dtsSourceLoadToken, loadPrimaryDtsSource, resultsMode, sourceFileName]);

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
      ? smallestPositiveSourceLine(currentRows.filter(row => row.sourceFileName === dtsSource?.fileName), subtreeBindingIds)
      : null,
    [currentRows, dtsSource?.fileName, resultsMode, subtreeBindingIds]
  );
  const moduleJumpStatus = useMemo(() => {
    if (resultsMode !== "dtsSource" || subtreeBindingIds === null) return null;
    if (moduleFocusLine !== null) return null;
    return "当前模块暂无源码行定位";
  }, [moduleFocusLine, resultsMode, subtreeBindingIds]);
  const scopedRows = useMemo(
    () => {
      const searched =
        resultsMode === "dtsSource"
          ? currentRows
          : filterItems(currentRows, query, dtsWorkbenchRowSearchProfile);
      return searched.filter((row) => subtreeBindingIds === null || subtreeBindingIds.has(row.bindingId));
    },
    [currentRows, query, resultsMode, subtreeBindingIds]
  );
  const moduleFilterNodes = useMemo(
    () =>
      buildParameterModuleFilterNodes(
        scopedRows.map((row) => ({
          moduleId: row.moduleId,
          moduleName: row.moduleName,
          modulePath: row.modulePath
        })),
        moduleRegistry?.modules
      ),
    [moduleRegistry, scopedRows]
  );
  const activeModuleFilter = useMemo(
    () => {
      const nodeIds = new Set(moduleFilterNodes.map((node) => node.id));
      return canonicalizeTreeFilterSelection(moduleFilterNodes, moduleFilter).filter((id) => nodeIds.has(id));
    },
    [moduleFilter, moduleFilterNodes]
  );
  const visibleRows = useMemo(() => {
    if (activeModuleFilter.length === 0) return scopedRows;
    const selected = collectTreeFilterSelectedDescendantIds(moduleFilterNodes, activeModuleFilter);
    return scopedRows.filter((row) => selected.has(row.moduleId));
  }, [activeModuleFilter, moduleFilterNodes, scopedRows]);
  const scopeLabel = effectiveSelectedNodeId ? nodePath(tree, effectiveSelectedNodeId).join(" / ") : "全部模块";

  useEffect(() => {
    const scroller = listScrollXRef.current;
    const rail = listScrollRailRef.current;
    if (!scroller || !rail) return;

    const spacer = rail.firstElementChild as HTMLElement | null;
    const syncSpacer = () => {
      if (spacer && scroller) {
        const targetWidth = Math.max(scroller.scrollWidth, 840);
        spacer.style.width = `${targetWidth}px`;
      }
    };
    syncSpacer();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncSpacer) : null;
    resizeObserver?.observe(scroller);
    if (scroller.firstElementChild) {
      resizeObserver?.observe(scroller.firstElementChild);
    }

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
      resizeObserver?.disconnect();
      scroller.removeEventListener("scroll", onScrollerScroll);
      rail.removeEventListener("scroll", onRailScroll);
    };
  }, [layoutMode, visibleRows.length]);

  const rowsByBindingId = useMemo(
    () => new Map(currentRows.map((row) => [row.bindingId, row])),
    [currentRows]
  );

  const effectiveNodesByLogicalId = useMemo(
    () => new Map(effectiveNodes.map((node) => [node.logicalNodeId, node])),
    [effectiveNodes]
  );

  const selectedLogicalNodeId = useMemo(() => {
    if (selectedBindingId) {
      return rowsByBindingId.get(selectedBindingId)?.logicalNodeId ?? null;
    }
    if (!subtreeBindingIds) return null;
    const logicalIds = new Set(
      currentRows
        .filter((row) => subtreeBindingIds.has(row.bindingId) && row.logicalNodeId)
        .map((row) => row.logicalNodeId as string)
    );
    return logicalIds.size === 1 ? [...logicalIds][0] : null;
  }, [currentRows, rowsByBindingId, selectedBindingId, subtreeBindingIds]);

  const selectedEnablementNode = selectedLogicalNodeId
    ? effectiveNodesByLogicalId.get(selectedLogicalNodeId) ?? null
    : null;

  const persistedDrafts = new Map(pendingDrafts.map(draft => [draft.projectParameterBindingId, draft]));
  const baseEdit = (bindingId: string): DtsParameterEdit => {
    const persisted = persistedDrafts.get(bindingId);
    return persisted
      ? { rawValue: formatDtsRawValueForUi(persisted.rawText), reason: persisted.reason, action: persisted.action }
      : { rawValue: formatDtsRawValueForUi(rowsByBindingId.get(bindingId)?.rawValue), reason: "", action: "set" };
  };
  const currentEdit = (bindingId: string): DtsParameterEdit => {
    const local = localDraftBag[bindingId];
    return local && (!local.saved || !persistedDrafts.has(bindingId)) ? local : baseEdit(bindingId);
  };
  const updateEdit = (bindingId: string, next: DtsParameterEdit) => {
    const base = baseEdit(bindingId);
    setLocalDraftBag(current => {
      const result = { ...current };
      if (next.rawValue === base.rawValue && next.reason === base.reason && (next.action ?? "set") === (base.action ?? "set")) delete result[bindingId];
      else result[bindingId] = next;
      return result;
    });
  };

  const selectBinding = (bindingId: string) => {
    detailOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedBindingId(bindingId);
    onSelectBinding(bindingId);
  };

  const useCompareAsDraft = (input: { rawValue: string; reason: string }) => {
    if (!selectedBindingId) return;
    updateEdit(selectedBindingId, {
      rawValue: input.rawValue,
      reason: input.reason,
      action: "set"
    });
  };

  const selectedRow = selectedBindingId
    ? currentRows.find((row) => row.bindingId === selectedBindingId) ?? null
    : null;

  const [historyEntries, setHistoryEntries] = useState<BindingHistoryEntry[]>([]);
  const [compareEntries, setCompareEntries] = useState<BindingCompareEntry[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [compareStatus, setCompareStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);
  const [compareErrorMessage, setCompareErrorMessage] = useState<string | null>(null);
  const [historyRetryToken, setHistoryRetryToken] = useState(0);
  const [compareRetryToken, setCompareRetryToken] = useState(0);
  const [specDetail, setSpecDetail] = useState<ParameterSpecDetail | CanonicalDtsDefinitionDetail | null>(null);
  const [specDetailStatus, setSpecDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [specDetailErrorMessage, setSpecDetailErrorMessage] = useState<string | null>(null);
  const [specDetailRetryToken, setSpecDetailRetryToken] = useState(0);
  const [latestDefinition, setLatestDefinition] = useState<CanonicalDtsDefinitionDetail | null>(null);
  const [latestStatus, setLatestStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!selectedBindingId || !loadBindingHistory) {
      setHistoryEntries([]);
      setHistoryStatus("idle");
      setHistoryErrorMessage(null);
      return undefined;
    }
    let cancelled = false;
    const requestBindingId = selectedBindingId;
    setHistoryEntries([]);
    setHistoryStatus("loading");
    setHistoryErrorMessage(null);
    loadBindingHistory(requestBindingId)
      .then((entries) => {
        if (!cancelled) {
          setHistoryEntries(entries);
          setHistoryStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHistoryEntries([]);
          setHistoryStatus("error");
          setHistoryErrorMessage(presentError(error, "历史加载失败，请稍后重试。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBindingId, loadBindingHistory, historyRetryToken]);

  useEffect(() => {
    if (!selectedBindingId || !loadBindingCompare) {
      setCompareEntries([]);
      setCompareStatus("idle");
      setCompareErrorMessage(null);
      return undefined;
    }
    let cancelled = false;
    const requestBindingId = selectedBindingId;
    setCompareEntries([]);
    setCompareStatus("loading");
    setCompareErrorMessage(null);
    loadBindingCompare(requestBindingId)
      .then((entries) => {
        if (!cancelled) {
          setCompareEntries(entries);
          setCompareStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCompareEntries([]);
          setCompareStatus("error");
          setCompareErrorMessage(presentError(error, "对比加载失败，请稍后重试。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBindingId, loadBindingCompare, compareRetryToken]);

  useEffect(() => {
    if (!selectedRow?.definitionId || !loadLatestParameterSpec) {
      setLatestDefinition(null);
      setLatestStatus("idle");
      return undefined;
    }
    let cancelled = false;
    setLatestDefinition(null);
    setLatestStatus("loading");
    void loadLatestParameterSpec(selectedRow.definitionId, selectedRow.propertyKey)
      .then((detail) => {
        if (cancelled) return;
        if (detail.definitionId !== selectedRow.definitionId || detail.propertyKey !== selectedRow.propertyKey) {
          setLatestStatus("error");
          return;
        }
        setLatestDefinition(detail);
        setLatestStatus("ready");
      })
      .catch(() => { if (!cancelled) setLatestStatus("error"); });
    return () => { cancelled = true; };
  }, [selectedRow?.definitionId, selectedRow?.propertyKey, loadLatestParameterSpec, specDetailRetryToken]);

  useEffect(() => {
    if (!selectedRow || !loadParameterSpec) {
      setSpecDetail(null);
      setSpecDetailStatus("idle");
      setSpecDetailErrorMessage(null);
      return undefined;
    }
    let cancelled = false;
    const requestDefinitionId = selectedRow.definitionId ?? selectedRow.parameterSpecId;
    const requestRevisionId = selectedRow.effectiveRevisionId ?? selectedRow.parameterSpecVersionId;
    setSpecDetail(null);
    setSpecDetailStatus("loading");
    setSpecDetailErrorMessage(null);
    void Promise.resolve(loadParameterSpec(requestDefinitionId, requestRevisionId, selectedRow.propertyKey))
      .then((detail) => {
        if (!cancelled) {
          setSpecDetail(detail);
          setSpecDetailStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSpecDetail(null);
          setSpecDetailStatus("error");
          setSpecDetailErrorMessage(presentError(error, "规格详情加载失败，请稍后重试。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRow, loadParameterSpec, specDetailRetryToken]);

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

  return (
    <section
      aria-label="DTS 参数工作台"
      className={`dts-parameter-workbench dts-parameter-workbench--${layoutMode}`}
      data-project-id={projectId}
      data-config-set-id={configSetId}
      data-revision-id={revisionId}
    >
      {/* The shell TopBar owns the page title; the workbench starts at the toolbar. */}
      <NavigatorWorkbench pageKey="parameters" navigatorLabel="模块导航" resizableNavigator
        taskLabel={resultsMode === "parameters" ? "DTS 参数列表" : "DTS 源码结果"}
        taskClassName="dts-workbench-list"
        panelId={`${resultsId}-${resultsMode}-panel`} tabId={`${resultsId}-${resultsMode}-tab`}
        taskState={resultsMode === "parameters" ? undefined
          : dtsSourceStatus === "loading" ? { kind: "loading", message: "正在加载 DTS 源码…" }
          : dtsSourceStatus === "error" ? { kind: "error", message: "无法加载 DTS 源码。", detail: dtsSourceErrorMessage ?? undefined, onRetry: loadDtsSource }
          : !dtsSource ? { kind: "empty", message: "暂无 DTS 源码。" } : undefined}
        toolbar={(primaryAction) => <>
        <label className="dts-parameter-workbench__search">
          <span>{resultsMode === "dtsSource" ? "查找源码" : "搜索参数"}</span>
          <SearchField
            value={query}
            onValueChange={setQuery}
            ariaLabel={resultsMode === "dtsSource" ? "在 DTS 源码中查找" : "搜索 DTS 参数"}
            placeholder={resultsMode === "dtsSource" ? "在 DTS 文本中查找" : "参数名、模块、器件、路径或值"}
            onKeyDown={(event) => {
              if (resultsMode === "dtsSource" && event.key === "Enter") {
                event.preventDefault();
                setFindNextToken((current) => current + 1);
              }
            }}
          />
        </label>
        {resultsMode === "dtsSource" ? (
          <p role="status" aria-label="源码查找状态" aria-live="polite" className="dts-parameter-workbench__result-count">
            {moduleJumpStatus
              ?? (dtsFindQuery.trim()
                ? `匹配 ${findStatus.activeIndex} / ${findStatus.matchCount}`
                : null)}
          </p>
        ) : null}
        <div className="dts-parameter-workbench__toolbar-actions">
          <div className="dts-parameter-workbench__header-actions">
            <ViewSwitch
              variant="tabs"
              ariaLabel="结果模式"
              value={resultsMode}
              onValueChange={(value) => value === "parameters" ? setResultsMode("parameters") : enterDtsSourceMode()}
              items={[
                { value: "parameters", label: <><Boxes size={15} strokeWidth={1.9} aria-hidden="true" />参数列表</>,
                  id: `${resultsId}-parameters-tab`, panelId: `${resultsId}-parameters-panel` },
                { value: "dtsSource", label: <><FileCode size={15} strokeWidth={1.9} aria-hidden="true" />DTS 源码</>,
                  id: `${resultsId}-dtsSource-tab`, panelId: `${resultsId}-dtsSource-panel` }
              ]}
            />
          </div>
          {toolbarActions}
          {primaryAction}
        </div>
        </>}
        primaryAction={resultsMode === "dtsSource" ? (
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
        context={<>
          <div className="parameter-workbench-context" aria-label="当前参数范围">
            <div><span title={scopeLabel}>{scopeLabel}</span><span role="status">{visibleRows.length} / {currentRows.length} 个参数</span>{activeModuleFilter.length ? <span>已筛选 {activeModuleFilter.length} 个模块</span> : null}</div>
            <div>{localChangeCount ? <button className="button subtle" type="button" onClick={() => selectBinding(Object.entries(localDraftBag).find(([, draft]) => !draft.saved)![0])}>继续未保存修改（{localChangeCount}）</button> : null}{query || effectiveSelectedNodeId || activeModuleFilter.length ? <button className="button subtle" type="button" onClick={() => { setQuery(""); setModuleFilter([]); setSelectedNodeId(null); }}>清除筛选</button> : null}</div>
          </div>
        {currentEdits ? <div
          className="dts-parameter-workbench__current-edits dts-draft-tray"
          role="region"
          aria-label="本轮已修改"
        >
          {currentEdits}
        </div> : null}
        </>}
        notice={notice || governanceContent ? <>{notice}{governanceContent}</> : undefined}
        navigator={<>
            {canEdit && onEditNodeEnablement && selectedEnablementNode ? (
              <button
                type="button"
                className="button subtle dts-parameter-workbench__enablement-action"
                aria-label={`节点启用：${selectedEnablementNode.locator}`}
                onClick={() => onEditNodeEnablement(selectedEnablementNode.logicalNodeId)}
              >
                {selectedEnablementNode.name}{selectedEnablementNode.unitAddress ? `@${selectedEnablementNode.unitAddress}` : ""} · 节点启用状态
                <small>影响 {currentRows.filter(row => row.logicalNodeId === selectedEnablementNode.logicalNodeId).length} 个参数</small>
              </button>
            ) : null}
          <DtsTopologyNavigator
            view="effective"
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            defaultExpandDepth={2}
            labelKind="text"
            emptyMessage="暂无模块分组"
            ariaLabel="业务模块树"
            onSelectNode={(nodeId) => { setSourceFocusLine(null); setSelectedNodeId((current) => current === nodeId ? null : nodeId); }}
          />
        </>}
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
                    moduleFilterSelected={activeModuleFilter}
                    moduleFilterNodes={moduleFilterNodes}
                    onModuleFilterChange={setModuleFilter}
                    onModuleFilterClear={() => setModuleFilter([])}
                    selectedBindingId={selectedBindingId}
                    draftBindingIds={draftBindingIds}
                    selectedBindingIds={selectedBindingIds}
                    canEdit={canEdit}
                    onSelectBinding={selectBinding}
                    onSelectedBindingIdsChange={setSelectedBindingIds}
                  />
                  {visibleRows.length === 0 ? (
                    <SectionEmpty message="当前筛选范围内没有参数。" />
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
          ) : dtsSource ? (
            <ProjectPrimaryDtsViewer
              fileName={dtsSource.fileName}
              versionNumber={dtsSource.versionNumber}
              text={dtsSource.text}
              focusLine={sourceFocusLine ?? moduleFocusLine}
              findQuery={dtsFindQuery}
              findNextToken={findNextToken}
              onFindStatusChange={onFindStatusChange}
            />
          ) : null}
      </NavigatorWorkbench>
      {footerContent ? (
        <div className="dts-parameter-workbench__footer">
          {footerContent}
        </div>
      ) : null}
      {selectedRow ? (
        <DtsBindingDetailDialog
          key={selectedRow.bindingId}
          row={selectedRow}
          canEdit={canEdit && Boolean(onCreateDraft)}
          historyEntries={historyEntries}
          compareEntries={compareEntries}
          historyStatus={historyStatus}
          historyErrorMessage={historyErrorMessage}
          compareStatus={compareStatus}
          compareErrorMessage={compareErrorMessage}
          onRetryHistory={() => setHistoryRetryToken((token) => token + 1)}
          onRetryCompare={() => setCompareRetryToken((token) => token + 1)}
          baseProjectId={projectId ?? "current"}
          baseProjectName={projectName || projectId || "当前项目"}
          specDetail={specDetail}
          latestDefinition={latestDefinition?.definitionId === (selectedRow.definitionId ?? selectedRow.parameterSpecId) ? latestDefinition : null}
          latestStatus={latestStatus}
          specDetailStatus={specDetailStatus}
          specDetailErrorMessage={specDetailErrorMessage}
          onRetrySpecDetail={() => setSpecDetailRetryToken((token) => token + 1)}
          onClose={closeDetail}
          draft={currentEdit(selectedRow.bindingId)}
          hasLocalChanges={Boolean(localDraftBag[selectedRow.bindingId] && !localDraftBag[selectedRow.bindingId].saved)}
          hasSavedDraft={draftBindingIds.has(selectedRow.bindingId) || Boolean(localDraftBag[selectedRow.bindingId]?.saved)}
          onDraftChange={onCreateDraft ? next => updateEdit(selectedRow.bindingId, next) : undefined}
          onResetDraft={() => setLocalDraftBag(current => { const next = { ...current }; delete next[selectedRow.bindingId]; return next; })}
          onSaveDraft={onCreateDraft ? async input => {
            const result = await onCreateDraft(input);
            if (result.valid) setLocalDraftBag(current => {
              const local = current[input.bindingId];
              if (!local || local.rawValue !== input.rawValue || local.reason.trim() !== input.reason || (local.action ?? "set") !== (input.action ?? "set")) return current;
              return { ...current, [input.bindingId]: { ...input, saved: true } };
            });
            return result;
          } : undefined}
          onUseCompareAsDraft={onCreateDraft ? useCompareAsDraft : undefined}
          onStartDtsReload={onStartDtsReload ? () => onStartDtsReload(selectedRow.bindingId) : undefined}
          onOpenSource={loadPrimaryDtsSource && selectedRow.sourceFileName ? () => {
            setSourceFileName(selectedRow.sourceFileName!);
            setSourceFocusLine(selectedRow.sourceLine);
            closeDetail();
            setResultsMode("dtsSource");
            loadDtsSource();
          } : undefined}
        />
      ) : null}
    </section>
  );
}
