import type {
  EffectiveTopologyEffect,
  SourceTopologyNode
} from "./types";

/**
 * Build human-readable provenance chain labels from API topology data.
 * Never invent file names — use fileName when present, else fileVersionId.
 */
export function buildProvenanceLabels(input: {
  effects: EffectiveTopologyEffect[];
  sourceNodes: SourceTopologyNode[];
  propertyKey?: string | null;
  nodeLocator?: string | null;
}): string[] {
  const nodesById = new Map(input.sourceNodes.map((node) => [node.id, node]));
  const propsById = new Map(
    input.sourceNodes.flatMap((node) =>
      node.properties.map((property) => [property.id, { property, node }] as const)
    )
  );

  return input.effects
    .filter((effect) => !input.propertyKey || effect.propertyName === input.propertyKey)
    .slice()
    .sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((effect) => {
      const node = effect.nodeOccurrenceId ? nodesById.get(effect.nodeOccurrenceId) : undefined;
      const propEntry = effect.propertyOccurrenceId
        ? propsById.get(effect.propertyOccurrenceId)
        : undefined;
      const sourceNode = propEntry?.node ?? node;
      const fileLabel =
        sourceNode?.fileName ??
        (sourceNode?.fileVersionId ? `fileVersion:${sourceNode.fileVersionId}` : "unknown-file");
      const locator = input.nodeLocator ?? sourceNode?.nodePath ?? "—";
      const line = propEntry?.property.startLine ?? sourceNode?.startLine;
      const linePart = line != null ? ` · L${line}` : "";
      return `${fileLabel} · ${locator}${linePart} · ${effect.effectKind}`;
    });
}
