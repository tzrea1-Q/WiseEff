import { renderDtsValue, type DtsValue } from "../dts";

/** One target node of a debug overlay, addressed by absolute device-tree path. */
export type DebugOverlayTarget = {
  /** Absolute device-tree path with unit addresses and exact case preserved. */
  nodePath: string;
  properties: Array<{ name: string; value: DtsValue }>;
};

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
      .map((property) => `\t\t\t${property.name} = ${renderDtsValue(property.value)};`)
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

/** A real device-tree path starts at the root and carries no empty segments. */
export function isAbsoluteNodePath(nodePath: string): boolean {
  if (nodePath === "/") return true;
  if (!nodePath.startsWith("/")) return false;
  return nodePath
    .slice(1)
    .split("/")
    .every((segment) => segment.length > 0);
}
