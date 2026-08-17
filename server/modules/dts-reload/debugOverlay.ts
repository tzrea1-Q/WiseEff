import { renderDtsValue, type DtsValue } from "../dts";

/** One target node of a debug overlay, addressed by absolute device-tree path. */
export type DebugOverlayTarget = {
  /** Absolute device-tree path with unit addresses and exact case preserved. */
  nodePath: string;
  properties: Array<{ name: string; value: DtsValue; deleteProperty?: boolean }>;
};

/** One property binding before node grouping — several may share a node path. */
export type DebugOverlayPropertyBinding = {
  nodePath: string;
  propertyKey: string;
  value: DtsValue;
  /** Overlay `/delete-property/` instead of an assignment. Never inferred from an empty RHS. */
  deleteProperty?: boolean;
};

/**
 * Group property bindings into one fragment target per distinct node path.
 * First-seen node order and within-node property order are preserved so batch
 * selection order stays predictable in the generated overlay.
 */
export function groupDebugOverlayTargets(
  bindings: readonly DebugOverlayPropertyBinding[]
): DebugOverlayTarget[] {
  if (bindings.length === 0) {
    throw new Error("A debug overlay needs at least one property binding.");
  }

  const targets: DebugOverlayTarget[] = [];
  const indexByPath = new Map<string, number>();

  for (const binding of bindings) {
    const existing = indexByPath.get(binding.nodePath);
    if (existing === undefined) {
      indexByPath.set(binding.nodePath, targets.length);
      targets.push({
        nodePath: binding.nodePath,
        properties: [
          {
            name: binding.propertyKey,
            value: binding.value,
            ...(binding.deleteProperty ? { deleteProperty: true } : {})
          }
        ]
      });
      continue;
    }
    targets[existing]!.properties.push({
      name: binding.propertyKey,
      value: binding.value,
      ...(binding.deleteProperty ? { deleteProperty: true } : {})
    });
  }

  return targets;
}

const HEADER = [
  "/dts-v1/;",
  "/plugin/;",
  "",
  "/*",
  " * WiseEff DTS reload debugging — generated debug overlay.",
  " * Authored by the platform from resolved parameter bindings; never hand-edited.",
  " * Debug values are run-scoped and do not change the parameter library.",
  " */",
  ""
].join("\n");

/**
 * Render a `/plugin/` debug overlay that addresses every target by absolute `target-path`
 * inside a numbered `fragment` node. Label references are deliberately never emitted: the
 * manual procedure this replaces addresses nodes by path, and `target-path` imposes no
 * requirement that the base blob carry a symbol table.
 *
 * Pure: the same targets always produce the same text, which is what the golden fixtures pin.
 */
export function generateDebugOverlay(targets: readonly DebugOverlayTarget[]): string {
  if (targets.length === 0) {
    throw new Error("A debug overlay needs at least one target node.");
  }

  const fragments = targets.map((target, index) => {
    if (!isAbsoluteNodePath(target.nodePath)) {
      throw new Error(`Debug overlay target "${target.nodePath}" is not an absolute device-tree path.`);
    }
    if (target.properties.length === 0) {
      throw new Error(`Debug overlay target "${target.nodePath}" carries no properties.`);
    }

    const properties = target.properties
      .map((property) => `\t\t\t${renderOverlayProperty(property)}`)
      .join("\n");

    return [
      `\tfragment@${index} {`,
      `\t\ttarget-path = "${target.nodePath}";`,
      "",
      "\t\t__overlay__ {",
      properties,
      "\t\t};",
      "\t};"
    ].join("\n");
  });

  return `${HEADER}\n/ {\n${fragments.join("\n\n")}\n};\n`;
}

function renderOverlayProperty(property: {
  name: string;
  value: DtsValue;
  deleteProperty?: boolean;
}): string {
  if (property.deleteProperty) {
    return `/delete-property/ ${property.name};`;
  }
  if (property.value.kind === "boolean" || property.value.kind === "empty") {
    return `${property.name};`;
  }
  return `${property.name} = ${renderDtsValue(property.value)};`;
}

/** A real device-tree path starts at the root and carries no empty segments. */
export function isAbsoluteNodePath(nodePath: string): boolean {
  if (nodePath === "/") return true;
  if (!nodePath.startsWith("/")) return false;
  return nodePath
    .slice(1)
    .split("/")
    .every((segment) => segment.length > 0);
}
