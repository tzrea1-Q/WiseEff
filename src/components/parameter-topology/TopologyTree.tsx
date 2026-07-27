import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
  TopologyNodeEnablement,
  TopologyView
} from "@/domain/parameter-topology/types";

export type TopologyTreeProps = {
  view: TopologyView;
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

function sourceLabel(node: SourceTopologyNode): string {
  const address = node.unitAddress ? `@${node.unitAddress}` : "";
  const base = `${node.name}${address}`;
  if (node.refTarget) {
    return `&${node.refTarget} → ${base}`;
  }
  if (node.labels.length > 0) {
    return `&${node.labels[0]} ${base}`.trim();
  }
  return base;
}

function effectiveLabel(node: EffectiveTopologyNode): string {
  const address = node.unitAddress ? `@${node.unitAddress}` : "";
  return `${node.name}${address}`;
}

function enablementBadge(enablement: TopologyNodeEnablement | undefined): {
  className: string;
  label: string;
  title: string;
} | null {
  if (!enablement) return null;
  if (!enablement.reachable && enablement.selfEnabled && enablement.blockingAncestorLabel) {
    return {
      className: "topology-tree__enablement-badge is-unreachable",
      label: "不可达",
      title: `父节点 ${enablement.blockingAncestorLabel} 已禁用`
    };
  }
  if (!enablement.selfEnabled) {
    if (enablement.override === "nonstandard") {
      return {
        className: "topology-tree__enablement-badge is-nonstandard",
        label: "非标准",
        title: `status = ${enablement.rawStatus ?? enablement.rawToken ?? "?"}`
      };
    }
    return {
      className: "topology-tree__enablement-badge is-disabled",
      label: "已禁用",
      title: enablement.rawStatus ? `status = ${enablement.rawStatus}` : "节点已禁用"
    };
  }
  if (enablement.override === "force-enabled") {
    return {
      className: "topology-tree__enablement-badge is-enabled",
      label: "已启用",
      title: enablement.rawStatus ? `status = ${enablement.rawStatus}` : "节点已启用"
    };
  }
  return null;
}

export function TopologyTree({
  view,
  sourceNodes,
  effectiveNodes,
  selectedNodeId,
  onSelectNode
}: TopologyTreeProps) {
  if (view === "source") {
    return (
      <ul className="topology-tree" role="tree" aria-label="源拓扑树">
        {sourceNodes.map((node) => {
          const unresolved = Boolean(node.refTarget && !sourceNodes.some((n) => n.labels.includes(node.refTarget!)));
          const name = unresolved
            ? `${sourceLabel(node)} （未解析）`
            : sourceLabel(node);
          const badge = enablementBadge(node.enablement);
          return (
            <li key={node.id} role="none">
              <button
                type="button"
                role="treeitem"
                aria-label={badge ? `${name}，${badge.label}` : name}
                aria-selected={selectedNodeId === node.id}
                className={`topology-tree__item${selectedNodeId === node.id ? " is-selected" : ""}`}
                onClick={() => onSelectNode(node.id)}
              >
                <code>{name}</code>
                {badge ? (
                  <span className={badge.className} title={badge.title}>
                    {badge.label}
                  </span>
                ) : null}
                <small>
                  {node.nodePath.split("/").pop()} · L{node.startLine}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="topology-tree" role="tree" aria-label="生效拓扑树">
      {effectiveNodes.map((node) => {
        const name = effectiveLabel(node);
        const badge = enablementBadge(node.enablement);
        const blockerId =
          node.enablement?.blockingAncestorId != null
            ? effectiveNodes.find((candidate) => candidate.logicalNodeId === node.enablement?.blockingAncestorId)
                ?.id
            : null;
        return (
          <li key={node.id} role="none" className="topology-tree__row">
            <button
              type="button"
              role="treeitem"
              aria-label={badge ? `${name}，${badge.label}` : name}
              aria-selected={selectedNodeId === node.id}
              className={`topology-tree__item${selectedNodeId === node.id ? " is-selected" : ""}`}
              onClick={() => onSelectNode(node.id)}
            >
              <code>{name}</code>
              {badge ? (
                <span className={badge.className} title={badge.title}>
                  {badge.label}
                </span>
              ) : null}
              <small>{node.locator}</small>
            </button>
            {blockerId && badge?.label === "不可达" ? (
              <button
                type="button"
                className="topology-tree__blocker-link"
                onClick={() => onSelectNode(blockerId)}
              >
                跳至阻断点（{node.enablement?.blockingAncestorLabel}）
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
