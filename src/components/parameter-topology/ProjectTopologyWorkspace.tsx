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
  sourceNodes?: SourceTopologyNode[];
  effectiveNodes?: EffectiveTopologyNode[];
  bindings?: ProjectParameterBinding[];
  mappingTasks?: IdentityMappingTask[];
  diagnostics?: TopologyDiagnostic[];
  incompleteBase?: boolean;
  canEdit?: boolean;
  canPublish?: boolean;
  layoutMode?: TopologyLayoutMode;
  onValidateEdit?: (input: { bindingId: string; rawValue: string }) => BindingEditValidation;
  onPublish?: () => void;
  onResolveMapping?: (taskId: string) => void;
};

/** Teaching fixture — identity is binding id, never path. */
export const TOPOLOGY_TEACHING_SOURCE_NODES: SourceTopologyNode[] = [
  {
    id: "src-amba",
    fileVersionId: "fv-base",
    parentOccurrenceId: null,
    name: "amba",
    labels: ["amba"],
    isOverlayRoot: false,
    nodePath: "/amba",
    startLine: 10,
    startColumn: 1,
    endLine: 200,
    endColumn: 1,
    contentHash: "hash-amba",
    sourceOrder: 1,
    properties: []
  },
  {
    id: "src-amba-overlay",
    fileVersionId: "fv-overlay",
    parentOccurrenceId: null,
    name: "amba",
    labels: [],
    refTarget: "amba",
    isOverlayRoot: true,
    nodePath: "/&amba",
    startLine: 4,
    startColumn: 1,
    endLine: 80,
    endColumn: 1,
    contentHash: "hash-amba-overlay",
    sourceOrder: 2,
    properties: []
  },
  {
    id: "src-i2c",
    fileVersionId: "fv-base",
    parentOccurrenceId: "src-amba",
    name: "i2c",
    unitAddress: "FDF5E000",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/amba/i2c@FDF5E000",
    startLine: 42,
    startColumn: 1,
    endLine: 120,
    endColumn: 1,
    contentHash: "hash-i2c",
    sourceOrder: 3,
    properties: []
  },
  {
    id: "src-sc8562",
    fileVersionId: "fv-overlay",
    parentOccurrenceId: "src-i2c",
    name: "sc8562",
    unitAddress: "6E",
    labels: ["sc8562"],
    isOverlayRoot: false,
    nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    startLine: 42,
    startColumn: 1,
    endLine: 60,
    endColumn: 1,
    contentHash: "hash-sc8562",
    sourceOrder: 4,
    properties: [
      {
        id: "src-prop-gpio-int",
        propertyName: "gpio_int",
        startLine: 48,
        startColumn: 1,
        endLine: 48,
        endColumn: 30,
        contentHash: "hash-gpio-int",
        sourceOrder: 1
      }
    ]
  },
  {
    id: "src-unresolved",
    fileVersionId: "fv-overlay",
    parentOccurrenceId: null,
    name: "missing",
    labels: [],
    refTarget: "ghost_label",
    isOverlayRoot: true,
    nodePath: "/&ghost_label",
    startLine: 2,
    startColumn: 1,
    endLine: 3,
    endColumn: 1,
    contentHash: "hash-ghost",
    sourceOrder: 5,
    properties: []
  }
];

export const TOPOLOGY_TEACHING_EFFECTIVE_NODES: EffectiveTopologyNode[] = [
  {
    id: "eff-amba",
    logicalNodeId: "logical-amba",
    locator: "/amba",
    name: "amba",
    parentLogicalNodeId: null,
    effects: []
  },
  {
    id: "eff-i2c",
    logicalNodeId: "logical-i2c",
    locator: "/amba/i2c@FDF5E000",
    name: "i2c",
    unitAddress: "FDF5E000",
    parentLogicalNodeId: "logical-amba",
    effects: []
  },
  {
    id: "eff-sc8562",
    logicalNodeId: "logical-sc8562",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
    name: "sc8562",
    unitAddress: "6E",
    compatible: "vendor,sc8562",
    parentLogicalNodeId: "logical-i2c",
    effects: [
      {
        id: "eff-gpio-int",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: "src-sc8562",
        propertyOccurrenceId: "src-prop-gpio-int",
        sourceOrder: 1
      }
    ]
  },
  {
    id: "eff-mt5788",
    logicalNodeId: "logical-mt5788",
    locator: "/amba/i2c@FDF5E000/mt5788@55",
    name: "mt5788",
    unitAddress: "55",
    compatible: "mediatek,mt5788",
    parentLogicalNodeId: "logical-i2c",
    effects: [
      {
        id: "eff-mt-gpio-int",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: null,
        propertyOccurrenceId: null,
        sourceOrder: 1
      }
    ]
  }
];

export const TOPOLOGY_TEACHING_BINDINGS: ProjectParameterBinding[] = [
  {
    id: "binding-sc8562-gpio-int",
    parameterSpecId: "spec-sc8562-gpio-int",
    parameterSpecVersionId: "specver-sc8562-gpio-int-3",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    logicalNodeId: "logical-sc8562",
    instanceName: "sc8562@6E",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
    effectiveValue: {
      kind: "cells",
      bits: 32,
      groups: [
        [
          { kind: "phandle", label: "gpio13" },
          { kind: "integer", raw: "29", value: "29" },
          { kind: "integer", raw: "0", value: "0" }
        ]
      ]
    },
    rawValue: "<&gpio13 29 0>",
    schemaState: "valid",
    policyState: "pass"
  },
  {
    id: "binding-mt5788-gpio-int",
    parameterSpecId: "spec-mt5788-gpio-int",
    parameterSpecVersionId: "specver-mt5788-gpio-int-1",
    propertyKey: "gpio_int",
    driverModule: "mt5788",
    logicalNodeId: "logical-mt5788",
    instanceName: "mt5788@55",
    locator: "/amba/i2c@FDF5E000/mt5788@55",
    effectiveValue: {
      kind: "cells",
      bits: 32,
      groups: [
        [
          { kind: "phandle", label: "gpio6" },
          { kind: "integer", raw: "15", value: "15" },
          { kind: "integer", raw: "0", value: "0" }
        ]
      ]
    },
    rawValue: "<&gpio6 15 0>",
    schemaState: "valid",
    policyState: "pass"
  },
  {
    id: "binding-sc8562-status",
    parameterSpecId: "spec-sc8562-status",
    parameterSpecVersionId: "specver-sc8562-status-1",
    propertyKey: "status",
    driverModule: "sc8562",
    logicalNodeId: "logical-sc8562",
    instanceName: "sc8562@6E",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
    effectiveValue: { kind: "strings", values: ["okay"] },
    rawValue: '"okay"',
    schemaState: "valid",
    policyState: "not_applicable"
  }
];

type MobilePane = "tree" | "properties" | "detail";

export function ProjectTopologyWorkspace({
  projectId,
  configSetId,
  revisionId,
  sourceNodes = TOPOLOGY_TEACHING_SOURCE_NODES,
  effectiveNodes = TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  bindings = TOPOLOGY_TEACHING_BINDINGS,
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

  const handleValidateEdit = (input: { bindingId: string; rawValue: string }): BindingEditValidation => {
    const result = onValidateEdit?.(input) ?? { valid: true, diagnostics: [] };
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
