import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModuleCreateDialog, type ModuleCreateSaveDraft } from "@/components/admin/ModuleCreateDialog";
import { ModuleEditDialog, type ModuleEditSavePatch } from "@/components/admin/ModuleEditDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { presentError } from "@/infrastructure/http/presentError";
import type {
  DriverNature,
  InstanceCardinality
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ModuleImportance,
  ParameterModule,
  ParameterModuleMapping
} from "@/domain/parameter-topology/moduleRegistry";
import type { ModuleTreeNode } from "@/domain/modules/moduleTree";
import { ModuleAttributionRowActions } from "./ModuleAttributionRowActions";
import { ModuleMoveDialog } from "./ModuleMoveDialog";
import { UnclassifiedRootViewDialog } from "./UnclassifiedRootViewDialog";
import {
  MODULE_KIND_LABEL,
  MODULE_ORIGIN_LABEL,
  buildAttributionTree,
  canEditImportance,
  canViewUnclassifiedRoot,
  defaultExpandedModuleIds,
  isNotYetObservedModule,
  isUnclassifiedRoot,
  mappingsForModule,
  matchingModulesForAttribution,
  MODULE_TREE_QUERY_KEYS,
  readModuleTreeSearch,
  writeModuleTreeSearch,
  siblingModuleNames,
  sortOrderSwapUpdates,
  type AttributionFilters,
  type DriverCoverageSummary
} from "./moduleAttributionTreeUtils";

export type ModuleAttributionTreeProps = {
  modules: readonly ParameterModule[];
  mappings: readonly ParameterModuleMapping[];
  canAdmin?: boolean;
  busy?: boolean;
  /** Parse coverage rollup from listDriverRegistry (moduleId → summary). */
  driverCoverage?: ReadonlyMap<string, DriverCoverageSummary>;
  driverRegistrationByModuleId?: ReadonlyMap<
    string,
    {
      driverNature: DriverNature | null;
      instanceCardinality: InstanceCardinality | null;
      compatibles?: readonly string[];
    }
  >;
  /** Whether the canonical subject placement panel is available on this page. */
  canonicalPlacementAvailable?: boolean;
  onOpenCanonicalPlacement?: () => void;
  selectedModuleId?: string | null;
  onSelectModule?: (moduleId: string | null) => void;
  onVisibleModuleIdsChange?: (ids: readonly string[] | null) => void;
  createRootRequest?: number;
  showRootCreateAction?: boolean;
  search?: string;
  onSearchChange?: (query: string) => void;
  onUpdateModule: (
    moduleId: string,
    patch: {
      name?: string;
      description?: string;
      scope?: string;
      importance?: ModuleImportance;
      sortOrder?: number;
    }
  ) => void | Promise<void>;
  onMove: (moduleId: string, parentId: string | null) => void | Promise<void>;
  onDelete: (moduleId: string) => void | Promise<void>;
  onCreateModule: (input: {
    name: string;
    description?: string;
    scope?: string;
    importance?: ModuleImportance;
    parentId?: string | null;
    kind?: "business";
  }) => void | Promise<void>;
};

function DepthGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span className="module-attribution-tree__guides" aria-hidden="true">
      {Array.from({ length: depth }, (_, index) => (
        <span key={index} className="module-attribution-tree__guide" />
      ))}
    </span>
  );
}

type RowProps = {
  node: ModuleTreeNode;
  depth: number;
  modulesById: ReadonlyMap<string, ParameterModule>;
  modules: readonly ParameterModule[];
  mappings: readonly ParameterModuleMapping[];
  driverCoverage?: ReadonlyMap<string, DriverCoverageSummary>;
  expandedIds: ReadonlySet<string>;
  canAdmin: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onAddChild: (id: string) => void;
  onStartMove: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder?: (moduleId: string, direction: "up" | "down") => void;
  selectedModuleId?: string | null;
  onSelectModule?: (moduleId: string | null) => void;
  focusedModuleId: string | null;
  onFocusModule: (moduleId: string) => void;
  onTreeKeyDown: (event: KeyboardEvent<HTMLLIElement>, node: ModuleTreeNode) => void;
};

function formatCoverageChip(summary: DriverCoverageSummary): {
  label: string;
  uncovered: boolean;
} {
  if (summary.total === 0) {
    return { label: PARAMETER_ADMIN_UI.moduleAttributionCoverageUncovered, uncovered: true };
  }
  if (summary.covered >= summary.total) {
    if (summary.promotedCount > 0) {
      return { label: PARAMETER_ADMIN_UI.moduleAttributionCoveragePromoted, uncovered: false };
    }
    if (summary.shadowedCount > 0) {
      return { label: PARAMETER_ADMIN_UI.moduleAttributionCoverageShadowed, uncovered: false };
    }
    if (summary.overlayCovered > 0) {
      return { label: PARAMETER_ADMIN_UI.moduleAttributionCoverageOverlay, uncovered: false };
    }
    if (summary.platformCovered > 0) {
      return { label: PARAMETER_ADMIN_UI.moduleAttributionCoveragePlatform, uncovered: false };
    }
    return { label: PARAMETER_ADMIN_UI.moduleAttributionCoverageCovered, uncovered: false };
  }
  if (summary.covered === 0) {
    return { label: PARAMETER_ADMIN_UI.moduleAttributionCoverageUncovered, uncovered: true };
  }
  return {
    label: PARAMETER_ADMIN_UI.moduleAttributionCoveragePartial
      .replace("{covered}", String(summary.covered))
      .replace("{total}", String(summary.total)),
    uncovered: true
  };
}

function ModuleAttributionTreeRow({
  node,
  depth,
  modulesById,
  modules,
  mappings,
  driverCoverage,
  expandedIds,
  canAdmin,
  busy,
  onToggle,
  onView,
  onEdit,
  onAddChild,
  onStartMove,
  onDelete,
  onReorder,
  selectedModuleId,
  onSelectModule,
  focusedModuleId,
  onFocusModule,
  onTreeKeyDown
}: RowProps) {
  const module = modulesById.get(node.id);
  if (!module) return null;

  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const compatibleCount = mappingsForModule(mappings, module.id).filter(
    (mapping) => mapping.matchKind === "compatible"
  ).length;
  const coverageSummary =
    module.kind === "driver-group" ? driverCoverage?.get(module.id) : undefined;
  const coverageChip = coverageSummary ? formatCoverageChip(coverageSummary) : null;

  return (
    <li
      className={[
        "module-attribution-tree__item",
        depth > 0 ? "is-child" : "is-root",
        `is-kind-${module.kind}`
      ]
        .filter(Boolean)
        .join(" ")}
      role="treeitem"
      data-module-tree-id={module.id}
      tabIndex={focusedModuleId === module.id ? 0 : -1}
      onFocus={(event) => { if (event.target === event.currentTarget || event.target.closest('[data-module-tree-id]') === event.currentTarget) onFocusModule(module.id); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget) onTreeKeyDown(event, node); }}
      aria-selected={selectedModuleId === module.id}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      style={{ ["--mod-attr-depth" as string]: String(depth) }}
    >
      <div className="module-attribution-tree__row">
        <div className="module-attribution-tree__identity">
          <DepthGuides depth={depth} />
          {hasChildren ? (
            <button
              type="button"
              className="module-attribution-tree__toggle"
              aria-label={isExpanded ? `折叠 ${module.name}` : `展开 ${module.name} 子模块`}
              aria-expanded={isExpanded}
              onClick={(event) => { onToggle(module.id); event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus(); }}
              tabIndex={-1}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="module-attribution-tree__toggle is-spacer" aria-hidden="true" />
          )}

          {onSelectModule ? <button type="button" className="module-attribution-tree__label module-attribution-tree__select"
            title={module.name} aria-label={`查看模块：${module.name}`} aria-pressed={selectedModuleId === module.id}
            tabIndex={-1}
            onClick={(event) => { event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus(); onSelectModule(module.id); }}>{module.name}</button>
            : <span className="module-attribution-tree__label" title={module.name}>{module.name}</span>}

          {/* Root「未分类」name already states the kind — skip the redundant badge. */}
          {!isUnclassifiedRoot(module) ? (
            <span className={`module-attribution-tree__kind is-${module.kind}`}>
              {MODULE_KIND_LABEL[module.kind]}
            </span>
          ) : null}
          {module.origin === "auto" ? (
            <span className="module-attribution-tree__origin">{MODULE_ORIGIN_LABEL.auto}</span>
          ) : null}
          {isNotYetObservedModule(module) ? (
            <span className="module-attribution-tree__not-yet-observed">
              {PARAMETER_ADMIN_UI.driverRegistryNotYetObserved}
            </span>
          ) : null}
        </div>

        <div className="module-attribution-tree__meta">
          <span className="module-attribution-tree__count" aria-label={PARAMETER_ADMIN_UI.definitionCountLabel}>
            {module.definitionCount} 定义
          </span>
          <span className="module-attribution-tree__count" aria-label={PARAMETER_ADMIN_UI.occurrenceCountLabel}>
            · {module.parameterCount} 实测处
          </span>
          {module.kind === "driver-group" && compatibleCount > 0 ? (
            <span className="module-attribution-tree__rules-summary">
              · {compatibleCount} 条 compatible
            </span>
          ) : null}
          {coverageChip ? (
            <span
              className={`module-attribution-tree__coverage-chip${
                coverageChip.uncovered ? " is-uncovered" : ""
              }`}
            >
              · {coverageChip.label}
            </span>
          ) : null}
        </div>

        {(
          <ModuleAttributionRowActions
            module={module}
            modules={modules}
            busy={busy}
            canAdmin={canAdmin}
            canonicalModeEnabled
            tabIndex={focusedModuleId === module.id ? 0 : -1}
            onView={canViewUnclassifiedRoot(module) ? () => onView(module.id) : undefined}
            onEdit={() => onEdit(module.id)}
            onAddChild={() => onAddChild(module.id)}
            onMove={() => onStartMove(module.id)}
            onDelete={() => onDelete(module.id)}
            onReorder={
              onReorder ? (direction) => onReorder(module.id, direction) : undefined
            }
          />
        )}
      </div>

      {hasChildren && isExpanded ? (
        <ul className="module-attribution-tree__group" role="group">
          {node.children.map((child) => (
            <ModuleAttributionTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              modulesById={modulesById}
              modules={modules}
              mappings={mappings}
              driverCoverage={driverCoverage}
              expandedIds={expandedIds}
              canAdmin={canAdmin}
              busy={busy}
              onToggle={onToggle}
              onView={onView}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onStartMove={onStartMove}
              onDelete={onDelete}
              onReorder={onReorder}
              selectedModuleId={selectedModuleId}
              onSelectModule={onSelectModule}
              focusedModuleId={focusedModuleId}
              onFocusModule={onFocusModule}
              onTreeKeyDown={onTreeKeyDown}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Kind-scoped module attribution tree: business → driver-group → node-type.
 */
export function ModuleAttributionTree({
  modules,
  mappings,
  canAdmin = false,
  busy = false,
  driverCoverage,
  driverRegistrationByModuleId,
  canonicalPlacementAvailable = false,
  onOpenCanonicalPlacement,
  selectedModuleId,
  onSelectModule,
  onVisibleModuleIdsChange,
  createRootRequest = 0,
  showRootCreateAction = true,
  search,
  onSearchChange,
  onUpdateModule,
  onMove,
  onDelete,
  onCreateModule,
}: ModuleAttributionTreeProps) {
  const [filters, setLocalFilters] = useState<AttributionFilters>(() => readModuleTreeSearch(search ?? "", modules).filters);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    readModuleTreeSearch(search ?? "", modules).expandedIds
  );
  const treeQuery = useMemo(() => {
    const params = new URLSearchParams(search);
    const query = new URLSearchParams();
    for (const key of MODULE_TREE_QUERY_KEYS) if (params.has(key)) query.set(key, params.get(key)!);
    return query.toString();
  }, [search]);
  const lastAppliedTreeQuery = useRef(treeQuery);
  const lastEmittedTreeQuery = useRef<string | null>(null);
  const knownModuleIds = useRef(new Set(modules.map((module) => module.id)));
  useEffect(() => {
    if (treeQuery === lastAppliedTreeQuery.current) return;
    lastAppliedTreeQuery.current = treeQuery;
    const emitted = lastEmittedTreeQuery.current;
    lastEmittedTreeQuery.current = null;
    if (treeQuery === emitted) return;
    const restored = readModuleTreeSearch(treeQuery, modules);
    setLocalFilters(restored.filters);
    setExpandedIds(restored.expandedIds);
  }, [treeQuery, modules]);
  const publishTreeSearch = (nextFilters: AttributionFilters, nextExpanded: ReadonlySet<string>) => {
    if (search === undefined || !onSearchChange) return;
    const query = writeModuleTreeSearch(nextFilters, nextExpanded);
    lastEmittedTreeQuery.current = query;
    onSearchChange(query);
  };
  const setFilters = (update: (current: AttributionFilters) => AttributionFilters) => {
    const next = update(filters);
    setLocalFilters(next);
    publishTreeSearch(next, expandedIds);
  };
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [viewingUnclassifiedId, setViewingUnclassifiedId] = useState<string | null>(null);
  const [deleteModuleId, setDeleteModuleId] = useState<string | null>(null);
  const [dialogMutationBusy, setDialogMutationBusy] = useState(false);
  const [dialogMutationError, setDialogMutationError] = useState<string | null>(null);
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(selectedModuleId ?? modules[0]?.id ?? null);
  const treeRef = useRef<HTMLUListElement>(null);
  const lastCreateRootRequest = useRef(createRootRequest);
  useEffect(() => {
    if (createRootRequest <= 0 || createRootRequest === lastCreateRootRequest.current) return;
    lastCreateRootRequest.current = createRootRequest;
    if (!canAdmin) return;
    setDialogMutationError(null);
    setCreateParentId(null);
  }, [createRootRequest, canAdmin]);

  useEffect(() => {
    const previousKnownIds = knownModuleIds.current;
    setExpandedIds((current) => {
      const defaults = defaultExpandedModuleIds(modules);
      const next = new Set(current);
      for (const id of defaults) if (!previousKnownIds.has(id)) next.add(id);
      const byId = new Map(modules.map((module) => [module.id, module]));
      const seen = new Set<string>();
      let ancestor = selectedModuleId ? byId.get(selectedModuleId)?.parentId : null;
      while (ancestor && !seen.has(ancestor)) {
        seen.add(ancestor);
        next.add(ancestor);
        ancestor = byId.get(ancestor)?.parentId;
      }
      return next;
    });
    knownModuleIds.current = new Set(modules.map((module) => module.id));
    if (selectedModuleId) setFocusedModuleId(selectedModuleId);
  }, [modules, selectedModuleId]);

  const tree = useMemo(
    () => buildAttributionTree(modules, filters, driverCoverage),
    [filters, modules, driverCoverage]
  );
  const matchingModuleIds = useMemo(() => {
    const filtered = Boolean(filters.search?.trim());
    return filtered ? matchingModulesForAttribution(modules, filters, driverCoverage).map((module) => module.id) : null;
  }, [modules, filters, driverCoverage]);
  useEffect(() => { onVisibleModuleIdsChange?.(matchingModuleIds); }, [matchingModuleIds, onVisibleModuleIdsChange]);
  const modulesById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules]
  );
  const visibleExpandedIds = useMemo(() => filters.search?.trim()
    ? new Set([...expandedIds, ...modules.map((module) => module.id)]) : expandedIds, [expandedIds, filters.search, modules]);
  const visibleIds: string[] = [];
  const collectVisible = (nodes: readonly ModuleTreeNode[]) => {
    for (const node of nodes) {
      visibleIds.push(node.id);
      if (visibleExpandedIds.has(node.id)) collectVisible(node.children);
    }
  };
  collectVisible(tree);
  const selectedNodeVisible = Boolean(selectedModuleId && visibleIds.includes(selectedModuleId));
  const rovingModuleId = focusedModuleId && visibleIds.includes(focusedModuleId) ? focusedModuleId : visibleIds[0] ?? null;
  useEffect(() => {
    if (!selectedModuleId) return;
    const frame = window.requestAnimationFrame(() => {
      [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-module-tree-id]') ?? [])]
        .find((element) => element.dataset.moduleTreeId === selectedModuleId)?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedModuleId, selectedNodeVisible, modules]);
  const focusModule = (id: string | undefined) => {
    if (!id) return;
    setFocusedModuleId(id);
    [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-module-tree-id]') ?? [])]
      .find((element) => element.dataset.moduleTreeId === id)?.focus();
  };
  const handleTreeKeyDown = (event: KeyboardEvent<HTMLLIElement>, node: ModuleTreeNode) => {
    const index = visibleIds.indexOf(node.id);
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowDown") focusModule(visibleIds[Math.min(index + 1, visibleIds.length - 1)]);
    else if (event.key === "ArrowUp") focusModule(visibleIds[Math.max(0, index - 1)]);
    else if (event.key === "Home") focusModule(visibleIds[0]);
    else if (event.key === "End") focusModule(visibleIds.at(-1));
    else if (event.key === "ArrowRight" && node.children.length) {
      if (visibleExpandedIds.has(node.id)) focusModule(node.children[0].id);
      else toggleExpanded(node.id);
    } else if (event.key === "ArrowLeft") {
      if (node.children.length && visibleExpandedIds.has(node.id) && !filters.search?.trim()) toggleExpanded(node.id);
      else focusModule(modulesById.get(node.id)?.parentId ?? undefined);
    } else if (event.key === "Enter" || event.key === " ") onSelectModule?.(node.id);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const ordered = [...visibleIds.slice(index + 1), ...visibleIds.slice(0, index + 1)];
      focusModule(ordered.find((id) => modulesById.get(id)?.name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())));
    }
  };

  const createDialogOpen = createParentId !== undefined;
  const createParent =
    typeof createParentId === "string" ? (modulesById.get(createParentId) ?? null) : null;
  const editingModule = editingModuleId ? (modulesById.get(editingModuleId) ?? null) : null;
  const editShowsImportance = editingModule ? canEditImportance(editingModule) : false;
  const viewingUnclassified = viewingUnclassifiedId
    ? (modulesById.get(viewingUnclassifiedId) ?? null)
    : null;
  const movingModule = moveModuleId ? (modulesById.get(moveModuleId) ?? null) : null;
  const editingDriverRegistration =
    editingModule?.kind === "driver-group"
      ? driverRegistrationByModuleId?.get(editingModule.id)
      : undefined;

  const toggleExpanded = (moduleId: string) => {
    const next = new Set(expandedIds);
    if (next.has(moduleId)) next.delete(moduleId);
    else next.add(moduleId);
    setExpandedIds(next);
    publishTreeSearch(filters, next);
  };

  const handleViewUnclassified = (moduleId: string) => {
    setViewingUnclassifiedId(moduleId);
  };

  const closeCreateDialog = () => {
    setCreateParentId(undefined);
    setDialogMutationError(null);
  };

  const describeMutationError = (error: unknown, fallback: string) => presentError(error, fallback);

  // Dialog mutations await the repository call: the dialog only closes on
  // success; failures keep it open with an in-place error and pending state.
  const handleCreate = (draft: ModuleCreateSaveDraft) => {
    setDialogMutationBusy(true);
    setDialogMutationError(null);
    void (async () => {
      try {
        await onCreateModule({
          name: draft.name,
          description: draft.description,
          scope: draft.scope,
          importance: draft.importance,
          parentId: createParentId ?? null,
          kind: "business"
        });
        closeCreateDialog();
      } catch (error) {
        setDialogMutationError(describeMutationError(error, "创建模块失败，请重试。"));
      } finally {
        setDialogMutationBusy(false);
      }
    })();
  };

  const handleSaveEdit = (patch: ModuleEditSavePatch) => {
    if (!editingModuleId) return;
    const moduleId = editingModuleId;
    setDialogMutationBusy(true);
    setDialogMutationError(null);
    void (async () => {
      try {
        await onUpdateModule(moduleId, {
          name: patch.name,
          description: patch.description,
          scope: patch.scope,
          ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
        });
        setEditingModuleId(null);
        setDialogMutationError(null);
      } catch (error) {
        setDialogMutationError(describeMutationError(error, "保存模块失败，请重试。"));
      } finally {
        setDialogMutationBusy(false);
      }
    })();
  };

  const handleConfirmMove = (parentId: string | null) => {
    if (!moveModuleId) return;
    setDialogMutationBusy(true);
    setDialogMutationError(null);
    void (async () => {
      try {
        await onMove(moveModuleId, parentId);
        setMoveModuleId(null);
        setDialogMutationError(null);
      } catch (error) {
        setDialogMutationError(describeMutationError(error, "移动模块失败，请重试。"));
      } finally {
        setDialogMutationBusy(false);
      }
    })();
  };

  const handleReorder = async (moduleId: string, direction: "up" | "down") => {
    if (busy || dialogMutationBusy) return;
    const module = modulesById.get(moduleId);
    if (!module) return;
    const updates = sortOrderSwapUpdates(module, direction, modules, true);
    if (!updates) return;
    for (const patch of updates) {
      await onUpdateModule(patch.id, { sortOrder: patch.sortOrder });
    }
  };

  const deletingModule = deleteModuleId ? (modulesById.get(deleteModuleId) ?? null) : null;
  const deletingChildCount = deletingModule
    ? modules.filter((module) => module.parentId === deletingModule.id).length
    : 0;
  const deletingCompatibleCount = deletingModule
    ? mappingsForModule(mappings, deletingModule.id).filter(
        (mapping) => mapping.matchKind === "compatible"
      ).length
    : 0;

  const handleConfirmDelete = () => {
    if (!deleteModuleId) return;
    const moduleId = deleteModuleId;
    setDialogMutationBusy(true);
    setDialogMutationError(null);
    void (async () => {
      try {
        await onDelete(moduleId);
        setDeleteModuleId(null);
        setDialogMutationError(null);
      } catch (error) {
        setDialogMutationError(describeMutationError(error, "删除模块失败，请重试。"));
      } finally {
        setDialogMutationBusy(false);
      }
    })();
  };

  return (
    <section className="module-attribution-tree is-compact" aria-label={PARAMETER_ADMIN_UI.moduleTreeTitle}>
      <div className="module-attribution-tree__head">
        {!onSelectModule || (canAdmin && showRootCreateAction) ? <div className="module-attribution-tree__head-main">
          {!onSelectModule ? <div>
            <h4>{PARAMETER_ADMIN_UI.moduleTreeTitle}</h4>
            <p className="muted">展开分类查看驱动组与节点类型。</p>
          </div> : null}
          {canAdmin && showRootCreateAction ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setCreateParentId(null)}
            >
              新建模块
            </button>
          ) : null}
        </div> : null}
        <label className="module-attribution-tree__search"><span className={onSelectModule ? "sr-only" : undefined}>搜索模块</span>
          <input type="search" aria-label="搜索模块" placeholder="按模块名称搜索" value={filters.search ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        </label>
      </div>

      <div className="module-attribution-tree__scroll">
        <ul ref={treeRef} className="module-attribution-tree__list" role="tree" aria-label="模块归属树">
          {tree.length === 0 ? (
            <li className="module-attribution-tree__empty">没有匹配的模块。</li>
          ) : null}
          {tree.map((node) => (
            <ModuleAttributionTreeRow
              key={node.id}
              node={node}
              depth={0}
              modulesById={modulesById}
              modules={modules}
              mappings={mappings}
              driverCoverage={driverCoverage}
              expandedIds={visibleExpandedIds}
              canAdmin={canAdmin}
              busy={busy}
              onToggle={toggleExpanded}
              selectedModuleId={selectedModuleId}
              onSelectModule={onSelectModule}
              focusedModuleId={rovingModuleId}
              onFocusModule={setFocusedModuleId}
              onTreeKeyDown={handleTreeKeyDown}
              onView={handleViewUnclassified}
              onEdit={(id) => {
                setDialogMutationError(null);
                setEditingModuleId(id);
              }}
              onAddChild={(id) => {
                setDialogMutationError(null);
                setCreateParentId(id);
              }}
              onStartMove={(id) => {
                setDialogMutationError(null);
                setMoveModuleId(id);
              }}
              onDelete={(id) => {
                // Deletion/dissolution is irreversible: always confirm with impact first.
                setDialogMutationError(null);
                setDeleteModuleId(id);
              }}
              onReorder={
                canAdmin
                  ? (id, direction) => {
                      // The panel already presents the safe page-level error; close this
                      // fire-and-forget boundary so a failed reorder is not unhandled.
                      void handleReorder(id, direction).catch(() => undefined);
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      </div>

      {createDialogOpen ? (
        <ModuleCreateDialog
          existingNames={siblingModuleNames(modules, createParentId ?? null)}
          parentName={createParent?.name ?? null}
          showImportance
          busy={dialogMutationBusy}
          error={dialogMutationError}
          onCancel={closeCreateDialog}
          onCreate={handleCreate}
        />
      ) : null}

      {editingModule ? (
        <ModuleEditDialog
          existingNames={siblingModuleNames(modules, editingModule.parentId, editingModule.id)}
          module={editingModule}
          showImportance={editShowsImportance}
          busy={busy || dialogMutationBusy}
          error={dialogMutationError}
          onCancel={() => {
            setEditingModuleId(null);
            setDialogMutationError(null);
          }}
          onSave={handleSaveEdit}
          canAdmin={canAdmin}
          readOnly={!canAdmin}
          driverNature={editingDriverRegistration?.driverNature ?? null}
          instanceCardinality={editingDriverRegistration?.instanceCardinality ?? null}
          historicalCompatibles={editingDriverRegistration?.compatibles}
          onManageCanonicalPlacement={
            (editingModule.kind === "driver-group" || editingModule.kind === "node-type") &&
            canonicalPlacementAvailable &&
            onOpenCanonicalPlacement
              ? () => {
                  setEditingModuleId(null);
                  setDialogMutationError(null);
                  onOpenCanonicalPlacement();
                }
              : undefined
          }
        />
      ) : null}

      {movingModule ? (
        <ModuleMoveDialog
          module={movingModule}
          modules={modules}
          busy={busy || dialogMutationBusy}
          error={dialogMutationError}
          onCancel={() => {
            setMoveModuleId(null);
            setDialogMutationError(null);
          }}
          onConfirm={handleConfirmMove}
        />
      ) : null}

      {viewingUnclassified ? (
        <UnclassifiedRootViewDialog
          parameterCount={viewingUnclassified.parameterCount}
          onClose={() => setViewingUnclassifiedId(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deletingModule !== null}
        title={
          deletingModule?.kind === "driver-group"
            ? `解散驱动组「${deletingModule.name}」`
            : `删除模块「${deletingModule?.name ?? ""}」`
        }
        description={
          deletingModule ? (
            <div>
              {deletingModule.kind === "driver-group" ? (
                <>
                  <p>
                    解散后不可恢复：该驱动组的 {deletingCompatibleCount} 条 compatible 匹配规则将一并移除，
                    组内 {deletingModule.parameterCount} 个参数及其子模块（{deletingChildCount} 个）
                    的绑定将退回「未分类」，需要重新归类或重建匹配规则。
                  </p>
                </>
              ) : (
                <p>
                  删除后不可恢复。当前子模块 {deletingChildCount} 个、关联参数 {deletingModule.parameterCount} 个；
                  仍有子模块或参数引用时服务端会拒绝删除。
                </p>
              )}
            </div>
          ) : null
        }
        confirmLabel={deletingModule?.kind === "driver-group" ? "确认解散" : "确认删除"}
        tone="danger"
        pending={dialogMutationBusy}
        pendingLabel={deletingModule?.kind === "driver-group" ? "解散中…" : "删除中…"}
        error={dialogMutationError ?? ""}
        onCancel={() => {
          if (dialogMutationBusy) return;
          setDeleteModuleId(null);
          setDialogMutationError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
}
