import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModuleCreateDialog, type ModuleCreateSaveDraft } from "@/components/admin/ModuleCreateDialog";
import { ModuleEditDialog, type ModuleEditSavePatch } from "@/components/admin/ModuleEditDialog";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import type {
  DriverNature,
  InstanceCardinality,
  OrganizationDriverSchema,
  OrganizationDriverSchemaDeprecationImpact
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
  DEFAULT_ATTRIBUTION_FILTERS,
  MODULE_KIND_LABEL,
  MODULE_ORIGIN_LABEL,
  buildAttributionTree,
  canEditImportance,
  canReclassifyModule,
  canViewUnclassifiedRoot,
  defaultExpandedModuleIds,
  isNotYetObservedModule,
  isUnclassifiedRoot,
  mappingsForModule,
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
  /** Per-compatible coverage rows keyed by moduleId (for edit dialog detail). */
  driverCoverageDetails?: ReadonlyMap<
    string,
    readonly { compatible: string; covered: boolean; pattern?: string }[]
  >;
  driverRegistrationByModuleId?: ReadonlyMap<
    string,
    { driverNature: DriverNature | null; instanceCardinality: InstanceCardinality | null }
  >;
  /** When set, 「查看」on the unclassified root prefers opening the queue. */
  hasUnclassifiedQueue?: boolean;
  onOpenUnclassifiedQueue?: () => void;
  onUpdateModule: (
    moduleId: string,
    patch: {
      name?: string;
      description?: string;
      scope?: string;
      importance?: ModuleImportance;
      kind?: "business" | "node-type";
      sortOrder?: number;
    }
  ) => void | Promise<void>;
  onMove: (moduleId: string, parentId: string | null) => void | Promise<void>;
  onDelete: (moduleId: string) => void | Promise<void>;
  onRemoveMapping: (mappingId: string) => void | Promise<void>;
  onAddCompatibleMapping?: (input: {
    moduleId: string;
    matchValue: string;
  }) => void | Promise<void>;
  onCreateModule: (input: {
    name: string;
    description?: string;
    scope?: string;
    importance?: ModuleImportance;
    parentId?: string | null;
    kind?: "business" | "driver-group" | "node-type";
    compatibles?: string[];
    sourceKey?: string | null;
  }) => void | Promise<void>;
  onAuthorOverlaySchema?: (compatible: string) => void;
  organizationDriverSchemas?: readonly OrganizationDriverSchema[];
  onPreviewOverlayDeprecation?: (
    schemaId: string
  ) => Promise<OrganizationDriverSchemaDeprecationImpact>;
  onDeprecateOverlaySchema?: (
    schemaId: string,
    input: { confirmCoverageLoss?: boolean }
  ) => void | Promise<void>;
};

const KIND_FILTER_OPTIONS = (Object.keys(MODULE_KIND_LABEL) as Array<ParameterModule["kind"]>).map(
  (kind) => ({ value: kind, label: MODULE_KIND_LABEL[kind] })
);

const ORIGIN_FILTER_OPTIONS = (
  Object.keys(MODULE_ORIGIN_LABEL) as Array<ParameterModule["origin"]>
).map((origin) => ({ value: origin, label: MODULE_ORIGIN_LABEL[origin] }));

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
  onReorder
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
              onClick={() => onToggle(module.id)}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="module-attribution-tree__toggle is-spacer" aria-hidden="true" />
          )}

          <span className="module-attribution-tree__label" title={module.name}>
            {module.name}
          </span>

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
          <span className="module-attribution-tree__count">{module.parameterCount} 参数</span>
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

        {canAdmin || canViewUnclassifiedRoot(module) ? (
          <ModuleAttributionRowActions
            module={module}
            modules={modules}
            busy={busy}
            canAdmin={canAdmin}
            onView={canViewUnclassifiedRoot(module) ? () => onView(module.id) : undefined}
            onEdit={() => onEdit(module.id)}
            onAddChild={() => onAddChild(module.id)}
            onMove={() => onStartMove(module.id)}
            onDelete={() => onDelete(module.id)}
            onReorder={
              onReorder ? (direction) => onReorder(module.id, direction) : undefined
            }
          />
        ) : (
          <span className="module-attribution-tree__actions is-spacer" aria-hidden="true" />
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
  driverCoverageDetails,
  driverRegistrationByModuleId,
  hasUnclassifiedQueue = false,
  onOpenUnclassifiedQueue,
  onUpdateModule,
  onMove,
  onDelete,
  onRemoveMapping,
  onAddCompatibleMapping,
  onCreateModule,
  onAuthorOverlaySchema,
  organizationDriverSchemas = [],
  onPreviewOverlayDeprecation,
  onDeprecateOverlaySchema
}: ModuleAttributionTreeProps) {
  const [filters, setFilters] = useState<AttributionFilters>(DEFAULT_ATTRIBUTION_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandedModuleIds(modules)
  );
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [viewingUnclassifiedId, setViewingUnclassifiedId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedIds((current) => {
      const defaults = defaultExpandedModuleIds(modules);
      const next = new Set(current);
      for (const id of defaults) next.add(id);
      return next;
    });
  }, [modules]);

  const tree = useMemo(
    () => buildAttributionTree(modules, filters, driverCoverage),
    [filters, modules, driverCoverage]
  );
  const modulesById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules]
  );

  const createDialogOpen = createParentId !== undefined;
  const createParent =
    typeof createParentId === "string" ? (modulesById.get(createParentId) ?? null) : null;
  const editingModule = editingModuleId ? (modulesById.get(editingModuleId) ?? null) : null;
  const editShowsImportance = editingModule ? canEditImportance(editingModule) : false;
  const editShowsKind = editingModule ? canReclassifyModule(editingModule) : false;
  const viewingUnclassified = viewingUnclassifiedId
    ? (modulesById.get(viewingUnclassifiedId) ?? null)
    : null;
  const movingModule = moveModuleId ? (modulesById.get(moveModuleId) ?? null) : null;
  const editingCompatibleCoverages =
    editingModule?.kind === "driver-group"
      ? (driverCoverageDetails?.get(editingModule.id) ?? undefined)
      : undefined;
  const editingCompatibleValues = useMemo(() => {
    if (!editingModule || editingModule.kind !== "driver-group") return new Set<string>();
    return new Set(
      mappingsForModule(mappings, editingModule.id)
        .filter((mapping) => mapping.matchKind === "compatible")
        .map((mapping) => mapping.matchValue)
    );
  }, [editingModule, mappings]);
  const editingOverlaySchemas = useMemo(() => {
    if (editingCompatibleValues.size === 0) return [];
    return organizationDriverSchemas.filter((schema) =>
      editingCompatibleValues.has(schema.compatible)
    );
  }, [editingCompatibleValues, organizationDriverSchemas]);
  const editingDriverRegistration =
    editingModule?.kind === "driver-group"
      ? driverRegistrationByModuleId?.get(editingModule.id)
      : undefined;

  const toggleExpanded = (moduleId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const handleViewUnclassified = (moduleId: string) => {
    if (hasUnclassifiedQueue && onOpenUnclassifiedQueue) {
      onOpenUnclassifiedQueue();
      return;
    }
    setViewingUnclassifiedId(moduleId);
  };

  const closeCreateDialog = () => {
    setCreateParentId(undefined);
  };

  const handleCreate = (draft: ModuleCreateSaveDraft) => {
    void onCreateModule({
      name: draft.name,
      description: draft.description,
      scope: draft.scope,
      importance: draft.importance,
      parentId: draft.parentId !== undefined ? draft.parentId : (createParentId ?? null),
      kind: draft.kind ?? "business",
      compatibles: draft.compatibles,
      sourceKey: draft.sourceKey
    });
    closeCreateDialog();
  };

  const handleSaveEdit = (patch: ModuleEditSavePatch) => {
    if (!editingModuleId) return;
    void onUpdateModule(editingModuleId, {
      name: patch.name,
      description: patch.description,
      scope: patch.scope,
      ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {})
    });
    setEditingModuleId(null);
  };

  const handleConfirmMove = (parentId: string | null) => {
    if (!moveModuleId) return;
    void onMove(moveModuleId, parentId);
    setMoveModuleId(null);
  };

  const handleReorder = async (moduleId: string, direction: "up" | "down") => {
    const module = modulesById.get(moduleId);
    if (!module) return;
    const updates = sortOrderSwapUpdates(module, direction, modules);
    if (!updates) return;
    for (const patch of updates) {
      await onUpdateModule(patch.id, { sortOrder: patch.sortOrder });
    }
  };

  return (
    <section className="module-attribution-tree" aria-labelledby="module-attribution-tree-title">
      <div className="module-attribution-tree__head">
        <div className="module-attribution-tree__head-main">
          <div>
            <h4 id="module-attribution-tree-title">{PARAMETER_ADMIN_UI.moduleTreeTitle}</h4>
            <p className="muted">默认只展开顶层业务分类；再逐级点开驱动组与节点类型。</p>
          </div>
          {canAdmin ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setCreateParentId(null)}
            >
              新建模块
            </button>
          ) : null}
        </div>
        <div className="module-attribution-tree__filters" aria-label="模块树筛选">
          <MultiSelectDropdown
            label="类型"
            value={[...filters.kinds]}
            options={KIND_FILTER_OPTIONS}
            onChange={(next) =>
              setFilters((current) => ({
                ...current,
                kinds: next as Array<ParameterModule["kind"]>
              }))
            }
          />
          <MultiSelectDropdown
            label="来源"
            value={[...filters.origins]}
            options={ORIGIN_FILTER_OPTIONS}
            onChange={(next) =>
              setFilters((current) => ({
                ...current,
                origins: next as Array<ParameterModule["origin"]>
              }))
            }
          />
          <label className="module-attribution-tree__filter-toggle">
            <input
              type="checkbox"
              checked={filters.hideNotYetObserved}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  hideNotYetObserved: event.target.checked
                }))
              }
            />
            <span>{PARAMETER_ADMIN_UI.moduleAttributionHideNotYetObserved}</span>
          </label>
          <label className="module-attribution-tree__filter-toggle">
            <input
              type="checkbox"
              checked={filters.onlyUncoveredParse}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  onlyUncoveredParse: event.target.checked
                }))
              }
            />
            <span>{PARAMETER_ADMIN_UI.moduleAttributionOnlyUncoveredParse}</span>
          </label>
        </div>
      </div>

      <div className="module-attribution-tree__scroll">
        <ul className="module-attribution-tree__list" role="tree" aria-label="模块归属树">
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
              expandedIds={expandedIds}
              canAdmin={canAdmin}
              busy={busy}
              onToggle={toggleExpanded}
              onView={handleViewUnclassified}
              onEdit={(id) => setEditingModuleId(id)}
              onAddChild={(id) => setCreateParentId(id)}
              onStartMove={(id) => setMoveModuleId(id)}
              onDelete={(id) => void onDelete(id)}
              onReorder={canAdmin ? (id, direction) => void handleReorder(id, direction) : undefined}
            />
          ))}
        </ul>
      </div>

      {createDialogOpen ? (
        <ModuleCreateDialog
          existingNames={siblingModuleNames(modules, createParentId ?? null)}
          parentName={createParent?.name ?? null}
          showImportance
          allowKindSelect
          modules={modules}
          initialParentId={createParentId ?? null}
          onCancel={closeCreateDialog}
          onCreate={handleCreate}
        />
      ) : null}

      {editingModule ? (
        <ModuleEditDialog
          existingNames={siblingModuleNames(modules, editingModule.parentId, editingModule.id)}
          module={editingModule}
          showImportance={editShowsImportance}
          showKind={editShowsKind}
          busy={busy}
          compatibleMappings={
            editingModule.kind === "driver-group"
              ? mappingsForModule(mappings, editingModule.id).filter(
                  (mapping) => mapping.matchKind === "compatible"
                )
              : undefined
          }
          compatibleCoverages={editingCompatibleCoverages}
          overlaySchemas={editingOverlaySchemas}
          onPreviewOverlayDeprecation={onPreviewOverlayDeprecation}
          onDeprecateOverlaySchema={onDeprecateOverlaySchema}
          onCancel={() => setEditingModuleId(null)}
          onSave={handleSaveEdit}
          driverNature={editingDriverRegistration?.driverNature ?? null}
          instanceCardinality={editingDriverRegistration?.instanceCardinality ?? null}
          onRemoveCompatibleMapping={
            editingModule.kind === "driver-group"
              ? (mappingId) => void onRemoveMapping(mappingId)
              : undefined
          }
          onAddCompatibleMapping={
            editingModule.kind === "driver-group" && onAddCompatibleMapping
              ? (matchValue) =>
                  void onAddCompatibleMapping({ moduleId: editingModule.id, matchValue })
              : undefined
          }
          canAdmin={canAdmin}
          onAuthorOverlaySchema={
            onAuthorOverlaySchema
              ? (compatible) => {
                  setEditingModuleId(null);
                  onAuthorOverlaySchema(compatible);
                }
              : undefined
          }
        />
      ) : null}

      {movingModule ? (
        <ModuleMoveDialog
          module={movingModule}
          modules={modules}
          busy={busy}
          onCancel={() => setMoveModuleId(null)}
          onConfirm={handleConfirmMove}
        />
      ) : null}

      {viewingUnclassified ? (
        <UnclassifiedRootViewDialog
          parameterCount={viewingUnclassified.parameterCount}
          hasQueue={hasUnclassifiedQueue}
          onOpenQueue={onOpenUnclassifiedQueue}
          onClose={() => setViewingUnclassifiedId(null)}
        />
      ) : null}
    </section>
  );
}
