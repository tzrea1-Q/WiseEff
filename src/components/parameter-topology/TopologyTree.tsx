import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
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
          return (
            <li key={node.id} role="none">
              <button
                type="button"
                role="treeitem"
                aria-label={name}
                aria-selected={selectedNodeId === node.id}
                className={`topology-tree__item${selectedNodeId === node.id ? " is-selected" : ""}`}
                onClick={() => onSelectNode(node.id)}
              >
                <code>{name}</code>
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
        return (
          <li key={node.id} role="none">
            <button
              type="button"
              role="treeitem"
              aria-label={name}
              aria-selected={selectedNodeId === node.id}
              className={`topology-tree__item${selectedNodeId === node.id ? " is-selected" : ""}`}
              onClick={() => onSelectNode(node.id)}
            >
              <code>{name}</code>
              <small>{node.locator}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
