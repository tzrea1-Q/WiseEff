import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type {
  ModuleImportance,
  ParameterModule,
  ParameterModuleMapping
} from "@/domain/parameter-topology/moduleRegistry";
import type { ModuleTreeNode } from "@/domain/modules/moduleTree";
import {
  DEFAULT_ATTRIBUTION_FILTERS,
  IMPORTANCE_LABEL,
  MODULE_KIND_LABEL,
  MODULE_ORIGIN_LABEL,
  buildAttributionTree,
  canDeleteModule,
  canEditImportance,
  canMoveModule,
  canRenameModule,
  countInstanceChildren,
  defaultExpandedModuleIds,
  deleteActionLabel,
  mappingsForModule,
  toBusinessFlatNodes,
  type AttributionFilters
} from "./moduleAttributionTreeUtils";

export type ModuleAttributionTreeProps = {
  modules: readonly ParameterModule[];
  mappings: readonly ParameterModuleMapping[];
  canAdmin?: boolean;
  busy?: boolean;
  onRename: (moduleId: string, name: string) => void | Promise<void>;
  onMove: (moduleId: string, parentId: string | null) => void | Promise<void>;
  onDelete: (moduleId: string) => void | Promise<void>;
  onImportanceChange: (moduleId: string, importance: ModuleImportance) => void | Promise<void>;
  onRemoveMapping: (mappingId: string) => void | Promise<void>;
  onCreateBusinessModule: (input: {
    name: string;
    importance: ModuleImportance;
  }) => void | Promise<void>;
};

const importanceOptions: Array<{ value: ModuleImportance; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
];

function toggleFilterValue<T extends string>(selected: readonly T[], value: T): T[] {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

type RowProps = {
  node: ModuleTreeNode;
  depth: number;
  modulesById: ReadonlyMap<string, ParameterModule>;
  modules: readonly ParameterModule[];
  mappings: readonly ParameterModuleMapping[];
  expandedIds: ReadonlySet<string>;
  canAdmin: boolean;
  busy: boolean;
  renamingId: string | null;
  renameValue: string;
  moveModuleId: string | null;
  moveParentId: string;
  onToggle: (id: string) => void;
  onStartRename: (id: string, name: string) => void;
  onRenameValue: (value: string) => void;
  onConfirmRename: (id: string) => void;
  onCancelRename: () => void;
  onStartMove: (id: string) => void;
  onMoveParentChange: (parentId: string) => void;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: ModuleImportance) => void;
  onRemoveMapping: (mappingId: string) => void;
};

function ModuleAttributionTreeRow({
  node,
  depth,
  modulesById,
  modules,
  mappings,
  expandedIds,
  canAdmin,
  busy,
  renamingId,
  renameValue,
  moveModuleId,
  moveParentId,
  onToggle,
  onStartRename,
  onRenameValue,
  onConfirmRename,
  onCancelRename,
  onStartMove,
  onMoveParentChange,
  onConfirmMove,
  onCancelMove,
  onDelete,
  onImportanceChange,
  onRemoveMapping
}: RowProps) {
  const module = modulesById.get(node.id);
  if (!module) return null;

  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const instanceCount = countInstanceChildren(modules, module.id);
  const rowMappings = mappingsForModule(mappings, module.id);
  const isRenaming = renamingId === module.id;
  const isMoving = moveModuleId === module.id;

  let businessTargets: ReturnType<typeof toBusinessFlatNodes> = [];
  if (isMoving) {
    const flat = toBusinessFlatNodes(modules);
    const selfPath = flat.find((item) => item.id === module.id)?.path ?? `/${module.id}`;
    const blocked = `${selfPath}/`;
    businessTargets = flat.filter(
      (item) => item.id !== module.id && !item.path.startsWith(blocked)
    );
  }

  return (
    <li
      className={[
        "module-attribution-tree__item",
        depth > 0 ? "is-child" : "",
        `is-kind-${module.kind}`
      ]
        .filter(Boolean)
        .join(" ")}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
    >
      <div className="module-attribution-tree__row">
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

        {isRenaming ? (
          <div className="module-attribution-tree__rename">
            <input
              aria-label="新模块名称"
              value={renameValue}
              disabled={busy}
              onChange={(event) => onRenameValue(event.target.value)}
            />
            <button
              type="button"
              className="button subtle"
              disabled={busy || !renameValue.trim()}
              onClick={() => onConfirmRename(module.id)}
            >
              确认重命名
            </button>
            <button type="button" className="button ghost" disabled={busy} onClick={onCancelRename}>
              取消
            </button>
          </div>
        ) : (
          <span className="module-attribution-tree__label">{module.name}</span>
        )}

        <span className={`module-attribution-tree__badge is-${module.kind}`}>
          {MODULE_KIND_LABEL[module.kind]}
        </span>
        {module.origin === "auto" ? (
          <span className="module-attribution-tree__badge is-auto">
            {MODULE_ORIGIN_LABEL.auto}
          </span>
        ) : null}

        <span className="module-attribution-tree__count">{module.parameterCount} 参数</span>

        {!isExpanded && module.kind === "driver-group" && instanceCount > 0 ? (
          <span className="module-attribution-tree__instances">{instanceCount} 个实例</span>
        ) : null}

        {canEditImportance(module) ? (
          canAdmin ? (
            <label className="module-attribution-tree__importance">
              重要性
              <select
                aria-label={`重要性 ${module.name}`}
                value={module.importance}
                disabled={busy}
                onChange={(event) =>
                  onImportanceChange(module.id, event.target.value as ModuleImportance)
                }
              >
                {importanceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="module-attribution-tree__importance">
              重要性：{IMPORTANCE_LABEL[module.importance]}
            </span>
          )
        ) : (
          <span className="module-attribution-tree__importance is-inherited">
            重要性：{IMPORTANCE_LABEL[module.effectiveImportance]}（继承）
          </span>
        )}

        {canAdmin && !isRenaming ? (
          <div className="param-admin-row-actions">
            {canRenameModule(module) ? (
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                aria-label={`重命名模块 ${module.name}`}
                onClick={() => onStartRename(module.id, module.name)}
              >
                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                重命名
              </button>
            ) : null}
            {canMoveModule(module) ? (
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                aria-label={`移动模块 ${module.name}`}
                onClick={() => onStartMove(module.id)}
              >
                移动
              </button>
            ) : null}
            {canDeleteModule(module) ? (
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                aria-label={`${deleteActionLabel(module)} ${module.name}`}
                onClick={() => onDelete(module.id)}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                {deleteActionLabel(module)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {rowMappings.length > 0 ? (
        <ul className="module-attribution-tree__rules">
          {rowMappings.map((mapping) => (
            <li key={mapping.id}>
              <code>
                {mapping.matchKind}:{mapping.matchValue}
              </code>
              {canAdmin ? (
                <button
                  type="button"
                  className="button subtle"
                  disabled={busy}
                  aria-label={`删除归属 ${mapping.matchKind}:${mapping.matchValue}`}
                  onClick={() => onRemoveMapping(mapping.id)}
                >
                  移除规则
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {isMoving ? (
        <div className="param-admin-module-move">
          <p>移动「{module.name}」到业务分类：</p>
          <ModuleTreeSelect
            label="目标业务分类"
            mode="single"
            nodes={businessTargets}
            placeholder="根级（无父模块）"
            value={moveParentId}
            onChange={(next) => onMoveParentChange(typeof next === "string" ? next : "")}
          />
          <div className="param-admin-module-add-actions">
            <button
              className="button primary"
              disabled={busy}
              type="button"
              onClick={onConfirmMove}
            >
              确认移动
            </button>
            <button className="button ghost" type="button" disabled={busy} onClick={onCancelMove}>
              取消
            </button>
          </div>
        </div>
      ) : null}

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
              expandedIds={expandedIds}
              canAdmin={canAdmin}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              moveModuleId={moveModuleId}
              moveParentId={moveParentId}
              onToggle={onToggle}
              onStartRename={onStartRename}
              onRenameValue={onRenameValue}
              onConfirmRename={onConfirmRename}
              onCancelRename={onCancelRename}
              onStartMove={onStartMove}
              onMoveParentChange={onMoveParentChange}
              onConfirmMove={onConfirmMove}
              onCancelMove={onCancelMove}
              onDelete={onDelete}
              onImportanceChange={onImportanceChange}
              onRemoveMapping={onRemoveMapping}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Kind-scoped module attribution tree: business → driver-group → instance.
 */
export function ModuleAttributionTree({
  modules,
  mappings,
  canAdmin = false,
  busy = false,
  onRename,
  onMove,
  onDelete,
  onImportanceChange,
  onRemoveMapping,
  onCreateBusinessModule
}: ModuleAttributionTreeProps) {
  const [filters, setFilters] = useState<AttributionFilters>(DEFAULT_ATTRIBUTION_FILTERS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandedModuleIds(modules)
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [moveParentId, setMoveParentId] = useState("");
  const [createName, setCreateName] = useState("");
  const [createImportance, setCreateImportance] = useState<ModuleImportance>("medium");

  useEffect(() => {
    setExpandedIds((current) => {
      const defaults = defaultExpandedModuleIds(modules);
      const next = new Set(current);
      for (const id of defaults) next.add(id);
      return next;
    });
  }, [modules]);

  const tree = useMemo(() => buildAttributionTree(modules, filters), [filters, modules]);
  const modulesById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules]
  );

  const toggleExpanded = (moduleId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  return (
    <section className="module-attribution-tree" aria-labelledby="module-attribution-tree-title">
      <div className="module-attribution-tree__head">
        <h4 id="module-attribution-tree-title">{PARAMETER_ADMIN_UI.moduleTreeTitle}</h4>
        <div className="module-attribution-tree__filters">
          <fieldset>
            <legend>类型</legend>
            {(Object.keys(MODULE_KIND_LABEL) as Array<ParameterModule["kind"]>).map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={filters.kinds.includes(kind)}
                  onChange={() =>
                    setFilters((current) => ({
                      ...current,
                      kinds: toggleFilterValue(current.kinds, kind)
                    }))
                  }
                />
                {MODULE_KIND_LABEL[kind]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>来源</legend>
            {(Object.keys(MODULE_ORIGIN_LABEL) as Array<ParameterModule["origin"]>).map((origin) => (
              <label key={origin}>
                <input
                  type="checkbox"
                  checked={filters.origins.includes(origin)}
                  onChange={() =>
                    setFilters((current) => ({
                      ...current,
                      origins: toggleFilterValue(current.origins, origin)
                    }))
                  }
                />
                {MODULE_ORIGIN_LABEL[origin]}
              </label>
            ))}
          </fieldset>
        </div>
      </div>

      <ul className="module-attribution-tree__list" role="tree" aria-label="模块归属树">
        {tree.length === 0 ? <li>没有匹配的模块。</li> : null}
        {tree.map((node) => (
          <ModuleAttributionTreeRow
            key={node.id}
            node={node}
            depth={0}
            modulesById={modulesById}
            modules={modules}
            mappings={mappings}
            expandedIds={expandedIds}
            canAdmin={canAdmin}
            busy={busy}
            renamingId={renamingId}
            renameValue={renameValue}
            moveModuleId={moveModuleId}
            moveParentId={moveParentId}
            onToggle={toggleExpanded}
            onStartRename={(id, name) => {
              setRenamingId(id);
              setRenameValue(name);
            }}
            onRenameValue={setRenameValue}
            onConfirmRename={(id) => {
              void onRename(id, renameValue.trim());
              setRenamingId(null);
              setRenameValue("");
            }}
            onCancelRename={() => {
              setRenamingId(null);
              setRenameValue("");
            }}
            onStartMove={(id) => {
              setMoveModuleId(id);
              setMoveParentId("");
            }}
            onMoveParentChange={setMoveParentId}
            onConfirmMove={() => {
              if (!moveModuleId) return;
              void onMove(moveModuleId, moveParentId || null);
              setMoveModuleId(null);
              setMoveParentId("");
            }}
            onCancelMove={() => {
              setMoveModuleId(null);
              setMoveParentId("");
            }}
            onDelete={(id) => void onDelete(id)}
            onImportanceChange={(id, importance) => void onImportanceChange(id, importance)}
            onRemoveMapping={(mappingId) => void onRemoveMapping(mappingId)}
          />
        ))}
      </ul>

      {canAdmin ? (
        <div className="module-attribution-tree__create">
          <label>
            业务分类名称
            <input
              aria-label="模块名称"
              value={createName}
              disabled={busy}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </label>
          <label>
            重要性
            <select
              aria-label="模块重要性"
              value={createImportance}
              disabled={busy}
              onChange={(event) => setCreateImportance(event.target.value as ModuleImportance)}
            >
              {importanceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={busy || !createName.trim()}
            onClick={() => {
              void onCreateBusinessModule({
                name: createName.trim(),
                importance: createImportance
              });
              setCreateName("");
              setCreateImportance("medium");
            }}
          >
            创建模块
          </button>
        </div>
      ) : null}
    </section>
  );
}
