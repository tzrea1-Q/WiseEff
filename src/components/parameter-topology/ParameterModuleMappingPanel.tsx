import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, ChevronDown, ChevronRight, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import {
  filterUnmappedCompatibles,
  filterUnmappedDrivers,
  toUnmappedCompatibleHint,
  type UnmappedCompatibleHint,
  type UnmappedDriverHint,
} from "@/domain/parameter-topology/moduleDiscovery";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ModuleImportance,
  type ModuleMatchKind,
  type ParameterModule,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { isAutoDiscoveredModuleName } from "@/domain/parameter-topology/moduleProvenance";
import { buildModuleTree, type FlatModuleNode, type ModuleTreeNode } from "@/domain/modules/moduleTree";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";

export type { UnmappedCompatibleHint, UnmappedDriverHint };

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  repository?: ParameterModuleRegistryRepository;
  /**
   * Drivers observed in the org (e.g. from parameter specs).
   * The panel filters out those already covered by a driver mapping.
   */
  observedDrivers?: UnmappedDriverHint[];
};

const importanceOptions: Array<{ value: ModuleImportance; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
];

const matchKindOptions: Array<{ value: ModuleMatchKind; label: string }> = [
  { value: "driver", label: "驱动" },
  { value: "compatible", label: "compatible" },
  { value: "instance", label: "器件实例" }
];

function toFlatModuleNodes(modules: readonly ParameterModule[]): FlatModuleNode[] {
  const byId = new Map(modules.map((module) => [module.id, module]));

  const pathFor = (id: string): string => {
    const segments: string[] = [];
    let current = byId.get(id);
    while (current) {
      segments.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return `/${segments.join("/")}`;
  };

  return modules.map((module) => ({
    id: module.id,
    name: module.name,
    parentId: module.parentId,
    path: pathFor(module.id),
    depth: 0,
    sortOrder: module.sortOrder
  }));
}

function filterVisibleModules(
  modules: readonly ParameterModule[],
  showAutoDiscovered: boolean
): ParameterModule[] {
  if (showAutoDiscovered) {
    return [...modules];
  }
  return modules.filter((module) => !isAutoDiscoveredModuleName(module.name));
}

type ParameterModuleTreeItemProps = {
  node: ModuleTreeNode;
  depth: number;
  expandedTreeIds: ReadonlySet<string>;
  modulesById: ReadonlyMap<string, ParameterModule>;
  canAdmin: boolean;
  busy: boolean;
  renamingModuleId: string | null;
  renameValue: string;
  onToggleTree: (moduleId: string) => void;
  onStartRename: (moduleId: string, name: string) => void;
  onConfirmRename: (moduleId: string) => void;
  onStartMove: (moduleId: string) => void;
  onDelete: (moduleId: string) => void;
  setRenameValue: Dispatch<SetStateAction<string>>;
};

function ParameterModuleTreeItem({
  node,
  depth,
  expandedTreeIds,
  canAdmin,
  busy,
  renamingModuleId,
  renameValue,
  modulesById,
  onToggleTree,
  onStartRename,
  onConfirmRename,
  onStartMove,
  onDelete,
  setRenameValue
}: ParameterModuleTreeItemProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedTreeIds.has(node.id);
  const autoDiscovered = isAutoDiscoveredModuleName(node.name);
  const importance = modulesById.get(node.id)?.importance ?? "medium";

  return (
    <li
      className={
        depth > 0
          ? "parameter-module-mapping-panel__tree-item is-child"
          : "parameter-module-mapping-panel__tree-item"
      }
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div
        className="parameter-module-mapping-panel__tree-row"
        style={{ paddingLeft: depth > 0 ? `${depth * 20}px` : undefined }}
      >
          {hasChildren ? (
            <button
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `折叠 ${node.name} 子模块` : `展开 ${node.name} 子模块`}
              className="parameter-module-mapping-panel__tree-toggle"
              disabled={busy}
              type="button"
              onClick={() => onToggleTree(node.id)}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span aria-hidden="true" className="parameter-module-mapping-panel__tree-toggle parameter-module-mapping-panel__tree-toggle--spacer" />
          )}
          <div className="parameter-module-mapping-panel__tree-label">
            <strong>{node.name}</strong>
            {autoDiscovered ? <span className="parameter-module-mapping-panel__auto-tag">自动发现</span> : null}
            <small>重要性：{importance}</small>
          </div>
          {canAdmin ? (
            <div className="param-admin-row-actions">
              <button
                aria-label={`重命名模块 ${node.name}`}
                className="button subtle"
                disabled={busy}
                type="button"
                onClick={() => onStartRename(node.id, node.name)}
              >
                重命名
              </button>
              <button
                aria-label={`移动模块 ${node.name}`}
                className="button subtle"
                disabled={busy}
                type="button"
                onClick={() => onStartMove(node.id)}
              >
                移动
              </button>
              <button
                aria-label={`删除模块 ${node.name}`}
                className="button subtle"
                disabled={busy}
                type="button"
                onClick={() => onDelete(node.id)}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                删除
              </button>
            </div>
          ) : null}
        </div>
        {canAdmin && renamingModuleId === node.id ? (
          <div className="parameter-module-mapping-panel__form">
            <label>
              新模块名称
              <input
                aria-label="新模块名称"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={busy || !renameValue.trim()}
              type="button"
              onClick={() => onConfirmRename(node.id)}
            >
              确认重命名
            </button>
          </div>
        ) : null}
      {hasChildren && isExpanded ? (
        <ul className="parameter-module-mapping-panel__module-tree-group" role="group">
          {node.children.map((child) => (
            <ParameterModuleTreeItem
              key={child.id}
              busy={busy}
              canAdmin={canAdmin}
              depth={depth + 1}
              expandedTreeIds={expandedTreeIds}
              modulesById={modulesById}
              node={child}
              renameValue={renameValue}
              renamingModuleId={renamingModuleId}
              setRenameValue={setRenameValue}
              onConfirmRename={onConfirmRename}
              onDelete={onDelete}
              onStartMove={onStartMove}
              onStartRename={onStartRename}
              onToggleTree={onToggleTree}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Admin surface for the additive module registry:
 * maintain business modules + driver/compatible/instance mappings,
 * and surface unmapped drivers as a pending queue.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  repository,
  observedDrivers = []
}: ParameterModuleMappingPanelProps) {
  const client = useMemo(
    () => repository ?? createHttpParameterModuleRegistryRepository(),
    [repository]
  );
  const [registry, setRegistry] = useState<ParameterModuleRegistry>(EMPTY_PARAMETER_MODULE_REGISTRY);
  const [observedCompatibles, setObservedCompatibles] = useState<UnmappedCompatibleHint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleImportance, setModuleImportance] = useState<ModuleImportance>("medium");
  const [mappingModuleId, setMappingModuleId] = useState("");
  const [matchKind, setMatchKind] = useState<ModuleMatchKind>("driver");
  const [matchValue, setMatchValue] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeNotice, setRecomputeNotice] = useState<string | null>(null);
  const [renamingModuleId, setRenamingModuleId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showAutoDiscovered, setShowAutoDiscovered] = useState(false);
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(() => new Set());
  const [moveModuleId, setMoveModuleId] = useState<string | null>(null);
  const [moveParentId, setMoveParentId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getRegistry()
      .then((next) => {
        if (cancelled) return;
        setRegistry(next);
        setMappingModuleId((current) => current || next.modules[0]?.id || "");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "无法加载模块注册表。");
        setRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      });
    client
      .getDiscoveryHints()
      .then((hints) => {
        if (cancelled) return;
        setObservedCompatibles(
          hints.compatibles.map((hint) => toUnmappedCompatibleHint(hint)),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setObservedCompatibles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const hiddenAutoDiscoveredCount = useMemo(
    () => registry.modules.filter((module) => isAutoDiscoveredModuleName(module.name)).length,
    [registry.modules]
  );

  const visibleModules = useMemo(
    () => filterVisibleModules(registry.modules, showAutoDiscovered),
    [registry.modules, showAutoDiscovered]
  );

  const flatModuleNodes = useMemo(() => toFlatModuleNodes(registry.modules), [registry.modules]);

  const moduleTree = useMemo(
    () => buildModuleTree(toFlatModuleNodes(visibleModules)),
    [visibleModules]
  );

  const modulesById = useMemo(
    () => new Map(registry.modules.map((module) => [module.id, module])),
    [registry.modules]
  );

  const moveTarget = useMemo(
    () => registry.modules.find((module) => module.id === moveModuleId) ?? null,
    [moveModuleId, registry.modules]
  );

  const moveCandidateNodes = useMemo(() => {
    if (!moveTarget) {
      return flatModuleNodes;
    }
    const blockedPrefix = `${flatModuleNodes.find((node) => node.id === moveTarget.id)?.path ?? `/${moveTarget.id}`}/`;
    return flatModuleNodes.filter(
      (node) => node.id !== moveTarget.id && !node.path.startsWith(blockedPrefix)
    );
  }, [flatModuleNodes, moveTarget]);

  const unmappedDrivers = useMemo(
    () => filterUnmappedDrivers(observedDrivers, registry.mappings),
    [observedDrivers, registry.mappings]
  );

  const unmappedCompatibles = useMemo(
    () => filterUnmappedCompatibles(observedCompatibles, registry.mappings),
    [observedCompatibles, registry.mappings]
  );

  const selectedModuleName =
    registry.modules.find((module) => module.id === mappingModuleId)?.name ?? null;

  const toggleTree = (moduleId: string) => {
    setExpandedTreeIds((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const createModule = async () => {
    if (!canAdmin || !moduleName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.createModule({
        name: moduleName.trim(),
        importance: moduleImportance
      });
      setRegistry(next);
      setModuleName("");
      if (!mappingModuleId && next.modules[0]) setMappingModuleId(next.modules[0].id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const removeModule = async (moduleId: string) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.deleteModule(moduleId);
      setRegistry(next);
      if (mappingModuleId === moduleId) {
        setMappingModuleId(next.modules[0]?.id ?? "");
      }
      if (renamingModuleId === moduleId) {
        setRenamingModuleId(null);
        setRenameValue("");
      }
      if (moveModuleId === moduleId) {
        setMoveModuleId(null);
        setMoveParentId("");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const renameModule = async (moduleId: string) => {
    if (!canAdmin || !renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.updateModule(moduleId, { name: renameValue.trim() });
      setRegistry(next);
      setRenamingModuleId(null);
      setRenameValue("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const moveModule = async (moduleId: string, parentId: string | null) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.updateModule(moduleId, { parentId });
      setRegistry(next);
      setMoveModuleId(null);
      setMoveParentId("");
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "移动模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const createMapping = async () => {
    if (!canAdmin || !mappingModuleId || !matchValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.createMapping({
        moduleId: mappingModuleId,
        matchKind,
        matchValue: matchValue.trim()
      });
      setRegistry(next);
      setMatchValue("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建映射失败。");
    } finally {
      setBusy(false);
    }
  };

  const removeMapping = async (mappingId: string) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.deleteMapping(mappingId);
      setRegistry(next);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除映射失败。");
    } finally {
      setBusy(false);
    }
  };

  const mapUnmappedCompatible = async (hint: UnmappedCompatibleHint) => {
    if (!canAdmin || !mappingModuleId) return;
    setBusy(true);
    setError(null);
    try {
      let next = await client.createModule({
        name: hint.suggestedGroupName,
        parentId: mappingModuleId,
      });
      const groupModule =
        next.modules.find(
          (module) => module.name === hint.suggestedGroupName && module.parentId === mappingModuleId,
        ) ?? next.modules.find((module) => module.name === hint.suggestedGroupName);
      if (!groupModule) {
        throw new Error("创建驱动组模块后未能定位到新模块。");
      }
      next = await client.createMapping({
        moduleId: groupModule.id,
        matchKind: "compatible",
        matchValue: hint.compatible,
        priority: 300,
      });
      setRegistry(next);
      const recompute = await client.recomputeBindings();
      setRecomputeNotice(
        `已为 ${hint.compatible} 创建驱动组并映射，重算了 ${recompute.updated} 个参数绑定。`,
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建驱动组映射失败。");
    } finally {
      setBusy(false);
    }
  };

  const mapUnmappedDriver = async (driverModule: string) => {
    if (!canAdmin || !mappingModuleId) return;
    setMatchKind("driver");
    setMatchValue(driverModule);
    setBusy(true);
    setError(null);
    try {
      const next = await client.createMapping({
        moduleId: mappingModuleId,
        matchKind: "driver",
        matchValue: driverModule
      });
      setRegistry(next);
      setMatchValue("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "映射驱动失败。");
    } finally {
      setBusy(false);
    }
  };

  const recomputeBindings = async () => {
    if (!canAdmin) return;
    setRecomputing(true);
    setError(null);
    setRecomputeNotice(null);
    try {
      const result = await client.recomputeBindings();
      setRecomputeNotice(`已重算模块归属，更新 ${result.updated} 个参数绑定。`);
    } catch (recomputeError) {
      setError(
        recomputeError instanceof Error ? recomputeError.message : "重算模块归属失败。"
      );
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) {
    return (
      <section className="parameter-module-mapping-panel" aria-label="模块映射管理" aria-busy="true">
        <p role="status">
          <LoaderCircle className="dts-status-icon dts-status-icon--spin" size={16} strokeWidth={2} aria-hidden="true" />
          正在加载模块注册表…
        </p>
      </section>
    );
  }

  return (
    <section className="parameter-module-mapping-panel" aria-label="模块映射管理">
      <header>
        <h3>模块与驱动关系</h3>
        <p>
          维护业务模块，并把 DTS 驱动 / compatible / 器件实例映射到模块。
          下方「模块发现队列」来自已 ingest 的绑定，与规格审核队列无关。
        </p>
        {canAdmin ? (
          <div
            className="parameter-module-mapping-panel__actions"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 12px",
              marginTop: 8
            }}
          >
            <button
              type="button"
              className="button"
              disabled={busy || recomputing}
              onClick={() => void recomputeBindings()}
            >
              <RefreshCw
                className={recomputing ? "dts-status-icon dts-status-icon--spin" : undefined}
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
              重算模块归属
            </button>
            <small>映射变更后，按新映射重算并写回参数绑定的模块归属。</small>
          </div>
        ) : null}
      </header>

      {recomputeNotice ? <p role="status">{recomputeNotice}</p> : null}

      {error ? (
        <p role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> {error}
        </p>
      ) : null}

      <div className="parameter-module-mapping-panel__grid">
        <section aria-labelledby="module-list-title">
          <div className="parameter-module-mapping-panel__section-head">
            <h4 id="module-list-title">业务模块</h4>
            <label className="parameter-module-mapping-panel__filter">
              <input
                aria-label="显示自动发现"
                checked={showAutoDiscovered}
                type="checkbox"
                onChange={(event) => setShowAutoDiscovered(event.target.checked)}
              />
              显示自动发现
              {hiddenAutoDiscoveredCount > 0 ? (
                <span className="parameter-module-mapping-panel__hidden-count">
                  （已隐藏 {hiddenAutoDiscoveredCount} 个）
                </span>
              ) : null}
            </label>
          </div>

          {moveTarget ? (
            <div className="param-admin-module-move">
              <p>移动模块「{moveTarget.name}」到：</p>
              <ModuleTreeSelect
                label="目标父模块"
                mode="single"
                nodes={moveCandidateNodes}
                placeholder="根级（无父模块）"
                value={moveParentId}
                onChange={(next) => setMoveParentId(typeof next === "string" ? next : next[0] ?? "")}
              />
              <div className="param-admin-module-add-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  type="button"
                  onClick={() => void moveModule(moveTarget.id, moveParentId || null)}
                >
                  确认移动
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setMoveModuleId(null);
                    setMoveParentId("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <ul className="parameter-module-mapping-panel__module-tree" role="tree" aria-label="业务模块树">
            {moduleTree.map((node) => (
              <ParameterModuleTreeItem
                key={node.id}
                busy={busy}
                canAdmin={canAdmin}
                depth={0}
                expandedTreeIds={expandedTreeIds}
                modulesById={modulesById}
                node={node}
                renameValue={renameValue}
                renamingModuleId={renamingModuleId}
                setRenameValue={setRenameValue}
                onConfirmRename={(moduleId) => void renameModule(moduleId)}
                onDelete={(moduleId) => void removeModule(moduleId)}
                onStartMove={(moduleId) => {
                  const module = registry.modules.find((item) => item.id === moduleId);
                  setMoveModuleId(moduleId);
                  setMoveParentId(module?.parentId ?? "");
                  setRenamingModuleId(null);
                  setRenameValue("");
                }}
                onStartRename={(moduleId, name) => {
                  setRenamingModuleId(moduleId);
                  setRenameValue(name);
                  setMoveModuleId(null);
                  setMoveParentId("");
                }}
                onToggleTree={toggleTree}
              />
            ))}
            {moduleTree.length === 0 ? <li>尚未创建业务模块。</li> : null}
          </ul>
          {canAdmin ? (
            <div className="parameter-module-mapping-panel__form">
              <label>
                模块名称
                <input
                  aria-label="模块名称"
                  value={moduleName}
                  onChange={(event) => setModuleName(event.target.value)}
                />
              </label>
              <label>
                重要性
                <select
                  aria-label="模块重要性"
                  value={moduleImportance}
                  onChange={(event) => setModuleImportance(event.target.value as ModuleImportance)}
                >
                  {importanceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="button" disabled={busy || !moduleName.trim()} onClick={() => void createModule()}>
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                创建模块
              </button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="mapping-list-title">
          <h4 id="mapping-list-title">映射规则</h4>
          <ul>
            {registry.mappings.map((mapping) => {
              const moduleNameLabel = registry.modules.find((module) => module.id === mapping.moduleId)?.name ?? mapping.moduleId;
              return (
                <li key={mapping.id}>
                  <code>{mapping.matchKind}:{mapping.matchValue}</code>
                  <span>→ {moduleNameLabel}</span>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy}
                      aria-label={`删除映射 ${mapping.matchKind}:${mapping.matchValue}`}
                      onClick={() => void removeMapping(mapping.id)}
                    >
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      删除
                    </button>
                  ) : null}
                </li>
              );
            })}
            {registry.mappings.length === 0 ? <li>尚未配置映射规则。</li> : null}
          </ul>
          {canAdmin ? (
            <div className="parameter-module-mapping-panel__form">
              <label>
                目标模块
                <select
                  aria-label="目标模块"
                  value={mappingModuleId}
                  onChange={(event) => setMappingModuleId(event.target.value)}
                >
                  <option value="">选择模块</option>
                  {registry.modules.map((module) => (
                    <option key={module.id} value={module.id}>{module.name}</option>
                  ))}
                </select>
              </label>
              <label>
                匹配类型
                <select
                  aria-label="匹配类型"
                  value={matchKind}
                  onChange={(event) => setMatchKind(event.target.value as ModuleMatchKind)}
                >
                  {matchKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                匹配值
                <input
                  aria-label="匹配值"
                  value={matchValue}
                  placeholder="例如 sc8562"
                  onChange={(event) => setMatchValue(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={busy || !mappingModuleId || !matchValue.trim()}
                onClick={() => void createMapping()}
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                添加映射
              </button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="unmapped-compatible-queue-title">
          <h4 id="unmapped-compatible-queue-title">模块发现队列（compatible）</h4>
          {unmappedCompatibles.length === 0 ? (
            <p>当前没有未映射的 compatible 提示。</p>
          ) : (
            <ul>
              {unmappedCompatibles.map((hint) => (
                <li key={hint.compatible}>
                  <code>{hint.compatible}</code>
                  <small>建议驱动组：{hint.suggestedGroupName}</small>
                  <small>{hint.bindingCount} 个参数</small>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy || !mappingModuleId}
                      onClick={() => void mapUnmappedCompatible(hint)}
                    >
                      {selectedModuleName
                        ? `在「${selectedModuleName}」下创建驱动组`
                        : "创建驱动组并映射"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="unmapped-queue-title">
          <h4 id="unmapped-queue-title">模块发现队列（driver）</h4>
          {unmappedDrivers.length === 0 ? (
            <p>当前没有未映射驱动提示。</p>
          ) : (
            <ul>
              {unmappedDrivers.map((hint) => (
                <li key={hint.driverModule}>
                  <code>{hint.driverModule}</code>
                  <small>{hint.bindingCount} 个参数</small>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy || !mappingModuleId}
                      onClick={() => void mapUnmappedDriver(hint.driverModule)}
                    >
                      {selectedModuleName
                        ? `映射到「${selectedModuleName}」`
                        : "映射到当前模块"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
