import type { DtsResolutionDiagnostic } from "./configSetResolver";

/**
 * Ephemeral stub synthesis for self-anchored overlays (L2 toolchain support).
 *
 * Validation levels for the project-primary / overlay flow:
 *
 * - L0 (writeback, always on): occurrence-precise CST round-trip against the *uploaded*
 *   text. Never needs external label definitions; the authoritative artifact is the file
 *   the user uploaded.
 * - L1 (resolve): `resolveDtsConfigSet` merges the config set. A `&label` whose target is
 *   not defined in the uploaded file set becomes a `dangling-reference` **warning** and is
 *   self-anchored to a synthetic node, so parameters stay manageable. Not fail-closed.
 * - L2 (export / release / Admin validate): real `dtc` / `fdtoverlay` / `dt-validate`. This
 *   is the only place that needs the full tree to link. When dangling references exist, an
 *   **ephemeral** stub defining the missing labels can be prepended to the compile input so
 *   `dtc` can resolve `&label` node overlays.
 *
 * The stub produced here is a throwaway compile companion. It MUST NOT be persisted as a
 * config-set member, exported to Git, or written back — the uploaded overlay remains the
 * sole authoritative text. It only makes the labels exist so a full-tree compile can run;
 * it makes no claim about phandle-cell shapes or business semantics of the referenced nodes.
 */

const STUB_HEADER =
  "/*\n" +
  " * EPHEMERAL toolchain stub — NOT authoritative, NOT persisted, NOT for writeback/export.\n" +
  " * Auto-generated so `dtc` can resolve `&label` overlay targets that are not defined in the\n" +
  " * uploaded file set. Defines each missing label as an empty node only.\n" +
  " */";

/** Extract the label names that `resolveDtsConfigSet` self-anchored (dangling `&label`). */
export function danglingAnchorLabels(diagnostics: readonly DtsResolutionDiagnostic[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "dangling-reference") continue;
    const match = diagnostic.message.match(/Overlay target "&([^"]+)"/);
    const label = match?.[1];
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Labels referenced via `&name` that are not defined in the same source.
 * Used only to build an ephemeral L2 compile companion — never persisted.
 */
export function missingReferencedLabels(source: string): string[] {
  const defined = new Set<string>();
  for (const match of source.matchAll(/(?:^|[\s;{])([A-Za-z_][A-Za-z0-9_]*):/gm)) {
    defined.add(match[1]!);
  }
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(/&([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const label = match[1]!;
    if (defined.has(label) || seen.has(label)) continue;
    seen.add(label);
    missing.push(label);
  }
  return missing;
}

function stripDtsPreamble(source: string): string {
  return source
    .replace(/^\/dts-v1\/;\s*\n?/gm, "")
    .replace(/^\/plugin\/;\s*\n?/gm, "")
    .trim();
}

/** Merge a stub base tree with overlay/primary body into one self-contained compile input. */
export function mergeEphemeralStubWithSource(stubSource: string, overlaySource: string): string {
  const baseBody = stripDtsPreamble(stubSource);
  const overlayBody = stripDtsPreamble(overlaySource);
  return `/dts-v1/;\n\n${baseBody}\n\n${overlayBody}\n`;
}

/**
 * Prepend an ephemeral empty-node stub for dangling `&label` / phandle targets so
 * `dtc` can compile overlay-only project-primary boards. The stub is a throwaway
 * compile companion (see module doc) and must not be persisted.
 */
export function withEphemeralDanglingAnchorStub(source: string): string {
  const stub = synthesizeDanglingAnchorStub(missingReferencedLabels(source));
  if (!stub) return source;
  return mergeEphemeralStubWithSource(stub, source);
}

/**
 * Synthesize an ephemeral base DTS that defines each given label as an empty node, so a
 * downstream `dtc` compile can resolve `&label { ... }` overlay fragments. Returns an empty
 * string when there is nothing to stub. The output is a non-authoritative compile companion
 * (see module doc); callers must keep it out of persistence, writeback, and export.
 */
export function synthesizeDanglingAnchorStub(labels: Iterable<string>): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (isValidLabel(label) && !seen.has(label)) {
      seen.add(label);
      unique.push(label);
    }
  }
  if (unique.length === 0) return "";

  const nodes = unique.map((label) => `\t${label}: ${label} { };`).join("\n");
  return `/dts-v1/;\n\n${STUB_HEADER}\n/ {\n${nodes}\n};\n`;
}

/** DTS label grammar: leading letter/underscore, then letters/digits/underscore. */
function isValidLabel(label: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(label);
}
