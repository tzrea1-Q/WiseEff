import { resolveDts } from "../dts";
import type { ResolvedNode } from "../dts";

export type StructuralChange =
  | { kind: "node_added" | "node_removed"; nodePath: string }
  | { kind: "prop_added" | "prop_removed" | "prop_changed"; nodePath: string; prop: string; before?: string; after?: string };

function indexNodesByPath(nodes: ResolvedNode[]): Map<string, ResolvedNode> {
  return new Map(nodes.map((node) => [node.nodePath, node]));
}

function indexPropsByName(node: ResolvedNode): Map<string, string> {
  return new Map(node.properties.map((prop) => [prop.name, prop.normalizedValue]));
}

function diffNodeProperties(nodePath: string, baselineNode: ResolvedNode, currentNode: ResolvedNode): StructuralChange[] {
  const changes: StructuralChange[] = [];
  const baselineProps = indexPropsByName(baselineNode);
  const currentProps = indexPropsByName(currentNode);
  const propNames = new Set([...baselineProps.keys(), ...currentProps.keys()]);

  for (const prop of [...propNames].sort()) {
    const before = baselineProps.get(prop);
    const after = currentProps.get(prop);

    if (before === undefined && after !== undefined) {
      changes.push({ kind: "prop_added", nodePath, prop, after });
    } else if (before !== undefined && after === undefined) {
      changes.push({ kind: "prop_removed", nodePath, prop, before });
    } else if (before !== after) {
      changes.push({ kind: "prop_changed", nodePath, prop, before, after });
    }
  }

  return changes;
}

/**
 * Structural node/property diff between two DTS sources, aligned on ResolvedNode.nodePath
 * and property name. Property equality is decided via normalizedValue only, so equivalent
 * reorderings (hex case, multi-group flattening, etc.) never produce a false diff.
 */
export function diffResolvedDts(baselineSource: string, currentSource: string): StructuralChange[] {
  const baselineNodes = indexNodesByPath(resolveDts(baselineSource).nodes);
  const currentNodes = indexNodesByPath(resolveDts(currentSource).nodes);
  const nodePaths = new Set([...baselineNodes.keys(), ...currentNodes.keys()]);

  const changes: StructuralChange[] = [];
  for (const nodePath of [...nodePaths].sort()) {
    const baselineNode = baselineNodes.get(nodePath);
    const currentNode = currentNodes.get(nodePath);

    if (!baselineNode && currentNode) {
      changes.push({ kind: "node_added", nodePath });
      continue;
    }
    if (baselineNode && !currentNode) {
      changes.push({ kind: "node_removed", nodePath });
      continue;
    }
    if (!baselineNode || !currentNode) {
      continue;
    }

    changes.push(...diffNodeProperties(nodePath, baselineNode, currentNode));
  }

  return changes;
}
