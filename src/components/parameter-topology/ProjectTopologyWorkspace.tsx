import { useMemo, useState } from "react";
import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode,
  TopologyDiagnostic,
  TopologyView
} from "@/domain/parameter-topology/types";
import {
  BindingDetailPanel,
  type BindingEditValidation
} from "./BindingDetailPanel";
import { BindingPropertyTable } from "./BindingPropertyTable";
import { TopologyTree } from "./TopologyTree";

export type TopologyLayoutMode = "desktop" | "tablet" | "mobile";

export type ProjectTopologyWorkspaceProps = {
  projectId: string;
  configSetId: string;
  revisionId: string;
  /** Explicit data only — no teaching-data defaults (use topologyTeachingFixtures in tests). */
  sourceNodes?: SourceTopologyNode[];
  effectiveNodes?: EffectiveTopologyNode[];
  bindings?: ProjectParameterBinding[];
  mappingTasks?: IdentityMappingTask[];
  diagnostics?: TopologyDiagnostic[];
  incompleteBase?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
  layoutMode?: TopologyLayoutMode;
  onValidateEdit?: (
    input: { bindingId: string; rawValue: string }
  ) => BindingEditValidation | Promise<BindingEditValidation>;
  onPublish?: () => void;
  onResolveMapping?: (taskId: string) => void;
};

/** @deprecated Import from `./topologyTeachingFixtures` — not for API-mode defaults. */
export {
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./topologyTeachingFixtures";

type MobilePane = "tree" | "properties" | "detail";

export function ProjectTopologyWorkspace({
  projectId,
  configSetId,
  revisionId,
  sourceNodes = [],
  effectiveNodes = [],
  bindings = [],
  mappingTasks = [],
  diagnostics = [],
  incompleteBase = false,
  canEdit = true,
  canPublish = false,
  layoutMode = "desktop",
  onValidateEdit,
  onPublish,
  onResolveMapping
}: ProjectTopologyWorkspaceProps) {
  const [view, setView] = useState<TopologyView>("effective");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("tree");
  const [editBlocked, setEditBlocked] = useState(false);

  const openMappings = mappingTasks.filter((task) => task.status === "open");
  const hasCompileErrors = diagnostics.some(
    (item) => (item.severity ?? "error").toLocaleLowerCase() === "error"
  );
  const publishBlocked = incompleteBase || openMappings.length > 0 || hasCompileErrors || editBlocked;

  const selectedSourceNode = useMemo(
    () => sourceNodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, sourceNodes]
  );
  const selectedEffectiveNode = useMemo(
    () => effectiveNodes.find((node) => node.id === selectedNodeId) ?? null,
    [effectiveNodes, selectedNodeId]
  );

  const visibleBindings = useMemo(() => {
    if (searchQuery.trim()) {
      return bindings;
    }
    if (!selectedNodeId) {
      return bindings;
    }
    if (view === "effective" && selectedEffectiveNode) {
      return bindings.filter(
        (binding) =>
          binding.logicalNodeId === selectedEffectiveNode.logicalNodeId ||
          binding.locator === selectedEffectiveNode.locator
      );
    }
    if (view === "source" && selectedSourceNode) {
      const leaf = selectedSourceNode.nodePath;
      return bindings.filter(
        (binding) =>
          binding.locator === leaf ||
          binding.instanceName === `${selectedSourceNode.name}${selectedSourceNode.unitAddress ? `@${selectedSourceNode.unitAddress}` : ""}`
      );
    }
    return bindings;
  }, [
    bindings,
    searchQuery,
    selectedEffectiveNode,
    selectedNodeId,
    selectedSourceNode,
    view
  ]);

  const selectedBinding = selectedBindingId
    ? bindings.find((binding) => binding.id === selectedBindingId) ?? null
    : null;

  const provenanceLabels =
    selectedEffectiveNode?.effects
      .filter((effect) => !selectedBinding || effect.propertyName === selectedBinding.propertyKey)
      .map((effect) => `power.dtso · ${effect.propertyName ?? "node"} · ${effect.effectKind}`) ?? [];

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedBindingId(null);
    if (layoutMode === "mobile") {
      setMobilePane("properties");
    }
  };

  const handleSelectBinding = (bindingId: string) => {
    setSelectedBindingId(bindingId);
    if (layoutMode === "mobile") {
      setMobilePane("detail");
    }
  };

  const handleValidateEdit = async (input: {
    bindingId: string;
    rawValue: string;
  }): Promise<BindingEditValidation> => {
    const result = (await onValidateEdit?.(input)) ?? { valid: true, diagnostics: [] };
    setEditBlocked(!result.valid);
    return result;
  };

  if (incompleteBase) {
    return (
      <section className="project-topology-workspace" aria-label="项目拓扑工作区">
        <div className="project-topology-workspace__incomplete" role="alert">
          缺少 base 配置，拓扑不完整（incomplete）。请先补齐 base 后再浏览或发布。
        </div>
      </section>
    );
  }

  const showTree = layoutMode !== "mobile" || mobilePane === "tree";
  const showProperties = layoutMode !== "mobile" || mobilePane === "properties";
  const showDetailInline =
    selectedBinding &&
    (layoutMode === "desktop" || (layoutMode === "mobile" && mobilePane === "detail"));
  const showDetailDrawer = selectedBinding && layoutMode === "tablet";

  return (
    <section
      className={`project-topology-workspace project-topology-workspace--${layoutMode}`}
      aria-label="项目拓扑工作区"
      data-project-id={projectId}
      data-config-set-id={configSetId}
      data-revision-id={revisionId}
    >
      <header className="project-topology-workspace__toolbar">
        <div role="radiogroup" aria-label="拓扑视图">
          <label>
            <input
              type="radio"
              name="topology-view"
              checked={view === "source"}
              onChange={() => setView("source")}
            />
            源树
          </label>
          <label>
            <input
              type="radio"
              name="topology-view"
              checked={view === "effective"}
              onChange={() => setView("effective")}
            />
            生效树
          </label>
        </div>
        <label>
          搜索绑定
          <input
            type="search"
            role="searchbox"
            aria-label="搜索绑定"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="gpio_int"
          />
        </label>
        <button
          type="button"
          className="button primary"
          disabled={!canPublish || publishBlocked}
          onClick={() => onPublish?.()}
        >
          发布
        </button>
      </header>

      {layoutMode === "mobile" ? (
        <nav className="project-topology-workspace__breadcrumb" aria-label="拓扑导航">
          <button type="button" onClick={() => setMobilePane("tree")}>
            树
          </button>
          <span>/</span>
          <button type="button" onClick={() => setMobilePane("properties")} disabled={!selectedNodeId && !searchQuery}>
            属性
          </button>
          <span>/</span>
          <button type="button" onClick={() => setMobilePane("detail")} disabled={!selectedBinding}>
            详情
          </button>
        </nav>
      ) : null}

      {view === "source" ? (
        <p className="project-topology-workspace__source-meta">power.dtsi · L42</p>
      ) : null}

      {publishBlocked ? (
        <p className="project-topology-workspace__publish-block" role="status">
          发布已阻断：
          {incompleteBase ? "缺少 base；" : null}
          {openMappings.length > 0 ? `存在 ${openMappings.length} 个未解决映射；` : null}
          {hasCompileErrors ? "编译诊断未通过；" : null}
          {editBlocked ? "编辑诊断未通过。" : null}
        </p>
      ) : null}

      {diagnostics.length > 0 ? (
        <section aria-label="编译诊断">
          <ul>
            {diagnostics.map((item) => (
              <li key={`${item.code ?? ""}:${item.message}`}>{item.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {openMappings.length > 0 ? (
        <section aria-label="映射审核">
          <h3>映射审核</h3>
          <ul>
            {openMappings.map((task) => (
              <li key={task.id}>
                {task.reason ?? "open mapping"}
                {onResolveMapping ? (
                  <button type="button" onClick={() => onResolveMapping(task.id)}>
                    处理
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="project-topology-workspace__panes">
        {showTree ? (
          <aside className="project-topology-workspace__tree" aria-label="拓扑树">
            <TopologyTree
              view={view}
              sourceNodes={sourceNodes}
              effectiveNodes={effectiveNodes}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
            />
          </aside>
        ) : null}

        {showProperties ? (
          <section className="project-topology-workspace__table" aria-label="绑定属性表">
            <BindingPropertyTable
              bindings={visibleBindings}
              selectedBindingId={selectedBinding?.id ?? null}
              onSelectBinding={handleSelectBinding}
              searchQuery={searchQuery}
            />
          </section>
        ) : null}

        {showDetailInline && selectedBinding ? (
          <BindingDetailPanel
            binding={selectedBinding}
            view={view}
            sourceNode={selectedSourceNode}
            effects={selectedEffectiveNode?.effects}
            provenanceLabels={provenanceLabels}
            mappingTasks={mappingTasks}
            canEdit={canEdit}
            onValidateEdit={handleValidateEdit}
          />
        ) : null}
      </div>

      {showDetailDrawer && selectedBinding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="绑定详情">
          <div className="binding-detail-drawer">
            <BindingDetailPanel
              binding={selectedBinding}
              view={view}
              sourceNode={selectedSourceNode}
              effects={selectedEffectiveNode?.effects}
              provenanceLabels={provenanceLabels}
              mappingTasks={mappingTasks}
              canEdit={canEdit}
              onValidateEdit={handleValidateEdit}
              asDialog
            />
            <button type="button" className="button subtle" onClick={() => setSelectedBindingId(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
