import { useMemo, useState } from "react";
import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  ResolveMappingInput,
  SourceTopologyNode,
  TopologyDiagnostic,
  TopologyView
} from "@/domain/parameter-topology/types";
import { buildProvenanceLabels } from "@/domain/parameter-topology/buildProvenanceLabels";
import {
  BindingDetailPanel,
  type BindingEditValidation
} from "./BindingDetailPanel";
import { BindingPropertyTable } from "./BindingPropertyTable";
import { IdentityMappingReview } from "./IdentityMappingReview";
import { TopologyTree } from "./TopologyTree";
import { WorkbenchDiagnosticsSection } from "./WorkbenchDiagnosticsSection";

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
  /**
   * Toolbar action label. Default `校验` because the wired action is validateRevision.
   * Only use `发布` when a real publish/release transition is provided via onPublish.
   */
  publishActionLabel?: "校验" | "发布";
  layoutMode?: TopologyLayoutMode;
  onValidateEdit?: (
    input: { bindingId: string; rawValue: string; reason: string }
  ) => BindingEditValidation | Promise<BindingEditValidation>;
  onPublish?: () => void;
  onResolveMapping?: (taskId: string, input: ResolveMappingInput) => void | Promise<void>;
};

/** @deprecated Import from `./topologyTeachingFixtures` — not for API-mode defaults. */
export {
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./topologyTeachingFixtures";

type MobilePane = "tree" | "properties" | "detail";

function collectPublishBlockers(input: {
  incompleteBase: boolean;
  openMappings: IdentityMappingTask[];
  diagnostics: TopologyDiagnostic[];
  editBlocked: boolean;
  bindings: ProjectParameterBinding[];
}): string[] {
  const blockers: string[] = [];
  if (input.incompleteBase) {
    blockers.push("缺少 base 配置");
  }
  if (input.openMappings.length > 0) {
    blockers.push(`存在 ${input.openMappings.length} 个未解决身份映射`);
  }
  const schemaInvalid = input.bindings.filter((binding) => binding.schemaState === "invalid");
  if (schemaInvalid.length > 0) {
    blockers.push(`${schemaInvalid.length} 个绑定 schema 无效`);
  }
  const policyFail = input.bindings.filter((binding) => binding.policyState === "fail");
  if (policyFail.length > 0) {
    blockers.push(`${policyFail.length} 个绑定 policy 未通过`);
  }
  const toolchainErrors = input.diagnostics.filter(
    (item) => (item.severity ?? "error").toLocaleLowerCase() === "error"
  );
  for (const item of toolchainErrors) {
    blockers.push(item.message);
  }
  if (input.editBlocked) {
    blockers.push("编辑诊断未通过");
  }
  return blockers;
}

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
  publishActionLabel = "校验",
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
  const publishBlockers = collectPublishBlockers({
    incompleteBase,
    openMappings,
    diagnostics,
    editBlocked,
    bindings
  });
  const publishBlocked = publishBlockers.length > 0;

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

  const provenanceLabels = buildProvenanceLabels({
    effects: selectedEffectiveNode?.effects ?? [],
    sourceNodes,
    propertyKey: selectedBinding?.propertyKey,
    nodeLocator: selectedEffectiveNode?.locator ?? selectedBinding?.locator
  });

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
    reason: string;
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
          {publishActionLabel}
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

      {view === "source" && selectedSourceNode ? (
        <p className="project-topology-workspace__source-meta">
          {selectedSourceNode.fileName ? `${selectedSourceNode.fileName} · ` : null}
          {selectedSourceNode.nodePath} · L{selectedSourceNode.startLine}
        </p>
      ) : null}

      {publishBlockers.length > 0 ? (
        <section className="project-topology-workspace__publish-block" role="status" aria-label="发布阻断项">
          <p>{publishActionLabel === "发布" ? "发布已阻断：" : "校验前阻断："}</p>
          <ul>
            {publishBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <WorkbenchDiagnosticsSection diagnostics={diagnostics} />

      <IdentityMappingReview tasks={mappingTasks} onResolve={onResolveMapping} />

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
