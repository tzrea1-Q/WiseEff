import { useMemo, useState } from "react";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";

export type DtsNodeTreeViewProps = {
  nodes: DtsStructuralNode[];
  selectedNodePath?: string;
  onSelectNode: (nodePath: string) => void;
};

export function DtsNodeTreeView({ nodes, selectedNodePath, onSelectNode }: DtsNodeTreeViewProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) {
      return nodes;
    }
    return nodes.filter((item) => item.nodePath.toLocaleLowerCase().includes(needle));
  }, [filter, nodes]);

  return (
    <section className="dts-node-tree-view" aria-label="DTS 节点树面板">
      <label className="dts-node-tree-view__filter">
        <span>筛选节点路径</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="例如 chip@6E"
          aria-label="筛选节点路径"
        />
      </label>
      <ul className="dts-node-tree-view__list" role="tree" aria-label="DTS 节点树">
        {filtered.map((item) => {
          const selected = item.nodePath === selectedNodePath;
          return (
            <li key={item.nodePath} role="none">
              <button
                type="button"
                role="treeitem"
                aria-label={item.nodePath}
                aria-selected={selected}
                className={`dts-node-tree-view__item${selected ? " is-selected" : ""}`}
                onClick={() => onSelectNode(item.nodePath)}
              >
                <code>{item.nodePath}</code>
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 ? <p className="dts-node-tree-view__empty">无匹配节点。</p> : null}
    </section>
  );
}
