import posixPath from "node:path/posix";

import { parseDts } from "./parser";
import { stripDtsComments } from "./preprocess";
import type { DtsDeleteNodeCst, DtsDeletePropertyCst, DtsNodeCst, DtsPropertyCst, DtsValue, DtsValueType } from "./types";

/**
 * Multi-file DTS config-set resolver. Locked in
 * `docs/exec-plans/active/2026-07-16-parameter-topology-schema-management.md` § Task 3.
 *
 * Resolves `/include/` (before overlays), then applies overlays in `overlayOrder` on top of the
 * expanded base, tracking an ordered per-property `sourceChain` of provenance so no source
 * occurrence is ever overwritten in place.
 */

export type DtsConfigSetFile = {
  fileVersionId: string;
  content: string;
};

export type DtsConfigSetInput = {
  entryFile: string;
  includeSearchPaths: string[];
  overlayOrder: string[];
  files: ReadonlyMap<string, DtsConfigSetFile>;
  /** Strict, bounded provenance entry used for canonical source proofs. */
  requireExactOrigins?: boolean;
};

export type DtsResolutionDiagnosticCode =
  | "include-missing"
  | "include-cycle"
  | "path-escape"
  | "target-unresolved"
  | "dangling-reference"
  | "label-duplicate"
  | "source-proof-limit";

class SourceProofLimit extends Error {}

export type DtsResolutionDiagnostic = {
  code: DtsResolutionDiagnosticCode;
  severity: "error" | "warning";
  fileName: string;
  message: string;
};

export type DtsSourceEffect = "set" | "override" | "delete";

export interface DtsSourceChainEntry {
  fileName: string;
  nodeLocator: string;
  propertyName: string;
  effect: DtsSourceEffect;
  rawText: string;
  /** Original UTF-16 property span; null when expansion crosses source segments. */
  origin: { fileVersionId: string; start: number; end: number } | null;
}

export type DtsNodeEffect = "create" | "delete";

export interface DtsNodeSourceChainEntry {
  fileName: string;
  nodeLocator: string;
  effect: DtsNodeEffect;
}

export interface DtsEffectiveProperty {
  name: string;
  valueType: DtsValueType;
  value?: DtsValue;
  rawText: string;
  normalizedValue: string;
  /** `true` once removed by `/delete-property/`; the property stays addressable for provenance. */
  deleted: boolean;
  sourceChain: DtsSourceChainEntry[];
}

export interface DtsEffectiveNode {
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  labels: string[];
  /** `true` once removed by `/delete-node/`; the node stays addressable for provenance. */
  deleted: boolean;
  properties: Map<string, DtsEffectiveProperty>;
  sourceChain: DtsNodeSourceChainEntry[];
}

export interface DtsEffectiveConfigSet {
  nodesByLocator: Map<string, DtsEffectiveNode>;
}

export interface DtsConfigSetResult {
  effective: DtsEffectiveConfigSet;
  diagnostics: DtsResolutionDiagnostic[];
}

interface MutableProperty {
  name: string;
  valueType: DtsValueType;
  value?: DtsValue;
  rawText: string;
  normalizedValue: string;
  deleted: boolean;
  sourceChain: DtsSourceChainEntry[];
}

interface MutableNode {
  /** Path without leading slash; `""` denotes the root. */
  locator: string;
  name: string;
  unitAddress?: string;
  labels: Set<string>;
  deleted: boolean;
  properties: Map<string, MutableProperty>;
  sourceChain: DtsNodeSourceChainEntry[];
}

interface Segment {
  fileName: string;
  start: number;
  end: number;
  sourceStart: number;
}

interface Builder {
  text: string;
  segments: Segment[];
  proofBudget?: { expandedBytes: number; entries: number; metadataBytes: number };
}

interface WalkContext {
  fileForOffset: (offset: number) => string;
  originForSpan: (span: { start: number; end: number }) => DtsSourceChainEntry["origin"];
  visitEntry: () => void;
  retainMetadata: (...fields: string[]) => void;
  diagnostics: DtsResolutionDiagnostic[];
  byLocator: Map<string, MutableNode>;
  byLabel: Map<string, MutableNode>;
}

function displayLocator(locator: string): string {
  return locator === "" ? "/" : `/${locator}`;
}

function segmentFor(node: Pick<DtsNodeCst, "name" | "unitAddress" | "isOverlayRoot">): string {
  if (node.isOverlayRoot) return "";
  if (node.unitAddress !== undefined) return `${node.name}@${node.unitAddress}`;
  return node.name;
}

function joinLocator(parent: string, segment: string): string {
  if (!segment) return parent;
  if (!parent) return segment;
  return `${parent}/${segment}`;
}

function isEscaping(normalized: string): boolean {
  return normalized === ".." || normalized.startsWith("../");
}

type IncludeResolution = { ok: true; fileName: string } | { ok: false; code: "include-missing" | "path-escape" };

/** Resolve an `/include/ "path"` request against the including file, then declared search roots. */
function resolveIncludeTarget(
  includingFile: string,
  requestedPath: string,
  includeSearchPaths: readonly string[],
  files: ReadonlyMap<string, DtsConfigSetFile>,
): IncludeResolution {
  const candidates = [
    posixPath.normalize(posixPath.join(posixPath.dirname(includingFile), requestedPath)),
    ...includeSearchPaths.map((root) => posixPath.normalize(posixPath.join(root, requestedPath))),
  ];

  let sawEscape = false;
  for (const candidate of candidates) {
    if (isEscaping(candidate)) {
      sawEscape = true;
      continue;
    }
    if (files.has(candidate)) {
      return { ok: true, fileName: candidate };
    }
  }
  return { ok: false, code: sawEscape ? "path-escape" : "include-missing" };
}

function appendText(builder: Builder, text: string, fileName: string, sourceStart: number): void {
  if (text.length === 0) return;
  if (builder.proofBudget) {
    builder.proofBudget.expandedBytes += Buffer.byteLength(text);
    if (builder.proofBudget.expandedBytes > 32 * 1024 * 1024) throw new SourceProofLimit();
  }
  const start = builder.text.length;
  builder.text += text;
  const end = builder.text.length;
  const last = builder.segments[builder.segments.length - 1];
  if (last && last.fileName === fileName && last.end === start && last.sourceStart + last.end - last.start === sourceStart) {
    last.end = end;
  } else {
    builder.segments.push({ fileName, start, end, sourceStart });
  }
}

/**
 * Textually expand `/include/ "path"` directives depth-first, appending each file's own text
 * (minus its include directives) into `builder` so the combined text can be parsed as one
 * document while still letting every offset be traced back to its origin file.
 *
 * Uses a fresh regex per call so recursive expansion cannot clobber `lastIndex` on a shared
 * global pattern (which would re-match the same include forever).
 */
function expandFile(
  fileName: string,
  stack: readonly string[],
  files: ReadonlyMap<string, DtsConfigSetFile>,
  includeSearchPaths: readonly string[],
  diagnostics: DtsResolutionDiagnostic[],
  builder: Builder,
  requireExactOrigins = false,
): void {
  if (requireExactOrigins && stack.length >= 64) throw new SourceProofLimit();
  if (stack.includes(fileName)) {
    diagnostics.push({
      code: "include-cycle",
      severity: "error",
      fileName,
      message: `Include cycle detected while expanding "${fileName}" (chain: ${[...stack, fileName].join(" -> ")})`,
    });
    return;
  }
  const file = files.get(fileName);
  if (!file) {
    diagnostics.push({
      code: "include-missing",
      severity: "error",
      fileName,
      message: `File "${fileName}" was not found in the config set manifest`,
    });
    return;
  }

  const nextStack = [...stack, fileName];
  // Expand against comment-stripped text so commented `/include/` lines are ignored.
  // `stripDtsComments` preserves length (comments → spaces), so spans stay aligned with
  // the original file while the combined document remains parseable.
  const cleaned = stripDtsComments(file.content);
  const includeRe = /\/include\/\s*"([^"]*)"\s*;?/g;
  let cursor = 0;
  for (const match of cleaned.matchAll(includeRe)) {
    const matchIndex = match.index ?? 0;
    appendText(builder, cleaned.slice(cursor, matchIndex), fileName, cursor);
    const requestedPath = match[1];
    const resolution = resolveIncludeTarget(fileName, requestedPath, includeSearchPaths, files);
    if (resolution.ok) {
      expandFile(resolution.fileName, nextStack, files, includeSearchPaths, diagnostics, builder, requireExactOrigins);
    } else {
      diagnostics.push({
        code: resolution.code,
        severity: "error",
        fileName,
        message:
          resolution.code === "path-escape"
            ? `Include path "${requestedPath}" in "${fileName}" resolves outside the config set`
            : `Include target "${requestedPath}" referenced from "${fileName}" was not found`,
      });
    }
    cursor = matchIndex + match[0].length;
  }
  appendText(builder, cleaned.slice(cursor), fileName, cursor);
}

function resolveSegment(segments: readonly Segment[], offset: number): string {
  for (const seg of segments) {
    if (offset >= seg.start && offset < seg.end) return seg.fileName;
  }
  return segments.length > 0 ? segments[segments.length - 1].fileName : "";
}

function ensureNode(ctx: WalkContext, locator: string, name: string, unitAddress: string | undefined, fileName: string): MutableNode {
  const existing = ctx.byLocator.get(locator);
  if (existing) return existing;
  ctx.retainMetadata(locator, name, fileName);
  const node: MutableNode = {
    locator,
    name,
    unitAddress,
    labels: new Set(),
    deleted: false,
    properties: new Map(),
    sourceChain: [{ fileName, nodeLocator: displayLocator(locator), effect: "create" }],
  };
  ctx.byLocator.set(locator, node);
  return node;
}

function registerLabel(ctx: WalkContext, label: string, node: MutableNode, fileName: string): void {
  const existing = ctx.byLabel.get(label);
  if (existing && existing !== node) {
    ctx.diagnostics.push({
      code: "label-duplicate",
      severity: "error",
      fileName,
      message: `Label "${label}" already resolves to node "${displayLocator(existing.locator)}"; ignoring duplicate binding to "${displayLocator(node.locator)}"`,
    });
    return;
  }
  node.labels.add(label);
  ctx.byLabel.set(label, node);
}

function walkProperty(ctx: WalkContext, node: MutableNode, cst: DtsPropertyCst, fileName: string): void {
  ctx.visitEntry();
  const existing = node.properties.get(cst.name);
  const effect: DtsSourceEffect = existing && !existing.deleted ? "override" : "set";
  const entry: DtsSourceChainEntry = {
    fileName,
    nodeLocator: displayLocator(node.locator),
    propertyName: cst.name,
    effect,
    rawText: cst.rawText,
    origin: ctx.originForSpan(cst.span),
  };
  ctx.retainMetadata(entry.fileName, entry.nodeLocator, entry.propertyName, entry.origin?.fileVersionId ?? "");
  if (existing) {
    existing.valueType = cst.valueType;
    existing.value = cst.value;
    existing.rawText = cst.rawText;
    existing.normalizedValue = cst.normalizedValue;
    existing.deleted = false;
    existing.sourceChain.push(entry);
    return;
  }
  node.properties.set(cst.name, {
    name: cst.name,
    valueType: cst.valueType,
    value: cst.value,
    rawText: cst.rawText,
    normalizedValue: cst.normalizedValue,
    deleted: false,
    sourceChain: [entry],
  });
}

function walkDeleteProperty(ctx: WalkContext, node: MutableNode, cst: DtsDeletePropertyCst, fileName: string): void {
  ctx.visitEntry();
  const entry: DtsSourceChainEntry = {
    fileName,
    nodeLocator: displayLocator(node.locator),
    propertyName: cst.name,
    effect: "delete",
    rawText: "",
    origin: ctx.originForSpan(cst.span),
  };
  ctx.retainMetadata(entry.fileName, entry.nodeLocator, entry.propertyName, entry.origin?.fileVersionId ?? "");
  const existing = node.properties.get(cst.name);
  if (existing) {
    existing.deleted = true;
    existing.sourceChain.push(entry);
    return;
  }
  node.properties.set(cst.name, {
    name: cst.name,
    valueType: "empty",
    rawText: "",
    normalizedValue: "",
    deleted: true,
    sourceChain: [entry],
  });
}

function walkDeleteNode(ctx: WalkContext, parent: MutableNode, cst: DtsDeleteNodeCst, fileName: string): void {
  const segment = cst.unitAddress !== undefined ? `${cst.name}@${cst.unitAddress}` : cst.name;
  const locator = joinLocator(parent.locator, segment);
  const target = ctx.byLocator.get(locator);
  if (!target) {
    ctx.diagnostics.push({
      code: "target-unresolved",
      severity: "error",
      fileName,
      message: `/delete-node/ target "${segment}" under "${displayLocator(parent.locator)}" does not resolve to any node`,
    });
    return;
  }
  target.deleted = true;
  target.sourceChain.push({ fileName, nodeLocator: displayLocator(target.locator), effect: "delete" });
}

function walkNode(ctx: WalkContext, cst: DtsNodeCst, parentLocator: string): void {
  ctx.visitEntry();
  const fileName = ctx.fileForOffset(cst.span.start);
  let node: MutableNode;

  if (cst.refTarget) {
    const target = ctx.byLabel.get(cst.refTarget);
    if (!target) {
      // Self-anchoring overlay: the referenced label is not defined anywhere in the
      // uploaded file set. Dropping the fragment would silently lose its business
      // parameters, and failing the whole ingest would leave the project unusable.
      // Instead, synthesize a virtual anchor node keyed by the label so the fragment's
      // properties still surface and round-trip on writeback (which locates them from the
      // uploaded text alone). Full-tree linkage / phandle / L2 toolchain correctness stays
      // a separate, optional concern that a later context upload or export can satisfy.
      ctx.diagnostics.push({
        code: "dangling-reference",
        severity: "warning",
        fileName,
        message: `Overlay target "&${cst.refTarget}" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)`,
      });
      node = ensureNode(ctx, cst.refTarget, cst.refTarget, undefined, fileName);
      registerLabel(ctx, cst.refTarget, node, fileName);
    } else {
      node = target;
    }
  } else {
    const locator = joinLocator(parentLocator, segmentFor(cst));
    node = ensureNode(ctx, locator, cst.isOverlayRoot ? "/" : cst.name, cst.unitAddress, fileName);
    for (const label of cst.labels) {
      registerLabel(ctx, label, node, fileName);
    }
  }

  for (const child of cst.children) {
    const childFileName = ctx.fileForOffset(child.span.start);
    if (child.kind === "property") {
      walkProperty(ctx, node, child, childFileName);
    } else if (child.kind === "node") {
      walkNode(ctx, child, node.locator);
    } else if (child.kind === "delete-property") {
      walkDeleteProperty(ctx, node, child, childFileName);
    } else if (child.kind === "delete-node") {
      ctx.visitEntry();
      walkDeleteNode(ctx, node, child, childFileName);
    }
  }
}

function ingestDocument(
  fileName: string,
  input: DtsConfigSetInput,
  diagnostics: DtsResolutionDiagnostic[],
  byLocator: Map<string, MutableNode>,
  byLabel: Map<string, MutableNode>,
  proofBudget?: Builder["proofBudget"],
): void {
  const builder: Builder = { text: "", segments: [], proofBudget };
  expandFile(fileName, [], input.files, input.includeSearchPaths, diagnostics, builder, input.requireExactOrigins);

  let topLevel: DtsNodeCst[];
  try {
    topLevel = parseDts(builder.text).topLevel;
  } catch {
    // A malformed member is reported structurally elsewhere (parser safety); the config-set
    // resolver only owns include/overlay provenance diagnostics.
    return;
  }

  const ctx: WalkContext = {
    fileForOffset: (offset) => resolveSegment(builder.segments, offset),
    visitEntry: () => { if (proofBudget && ++proofBudget.entries > 100_000) throw new SourceProofLimit(); },
    retainMetadata: (...fields) => {
      if (!proofBudget) return;
      proofBudget.metadataBytes += fields.reduce((size, field) => size + Buffer.byteLength(field), 24);
      if (proofBudget.metadataBytes > 8 * 1024 * 1024) throw new SourceProofLimit();
    },
    originForSpan: (span) => {
      const segment = builder.segments.find((entry) => span.start >= entry.start && span.end <= entry.end);
      const file = segment && input.files.get(segment.fileName);
      return segment && file ? {
        fileVersionId: file.fileVersionId,
        start: segment.sourceStart + span.start - segment.start,
        end: segment.sourceStart + span.end - segment.start,
      } : null;
    },
    diagnostics,
    byLocator,
    byLabel,
  };
  for (const node of topLevel) {
    walkNode(ctx, node, "");
  }
}

function finalize(byLocator: Map<string, MutableNode>): Map<string, DtsEffectiveNode> {
  const out = new Map<string, DtsEffectiveNode>();
  for (const node of byLocator.values()) {
    const properties = new Map<string, DtsEffectiveProperty>();
    for (const [name, prop] of node.properties) {
      properties.set(name, { ...prop, sourceChain: [...prop.sourceChain] });
    }
    out.set(displayLocator(node.locator), {
      nodeLocator: displayLocator(node.locator),
      name: node.name,
      unitAddress: node.unitAddress,
      labels: [...node.labels],
      deleted: node.deleted,
      properties,
      sourceChain: [...node.sourceChain],
    });
  }
  return out;
}

/**
 * Resolve a complete DTS config set: expand includes for the base and every overlay, then apply
 * overlays in `overlayOrder` on top of the expanded base, recording per-property provenance.
 * Never throws; unresolvable includes/targets/labels become diagnostics and the rest of the set
 * still resolves as far as possible.
 */
export function resolveDtsConfigSet(input: DtsConfigSetInput): DtsConfigSetResult {
  const diagnostics: DtsResolutionDiagnostic[] = [];
  const byLocator = new Map<string, MutableNode>();
  const byLabel = new Map<string, MutableNode>();
  const proofBudget = input.requireExactOrigins ? { expandedBytes: 0, entries: 0, metadataBytes: 0 } : undefined;

  if (!input.files.has(input.entryFile)) {
    diagnostics.push({
      code: "include-missing",
      severity: "error",
      fileName: input.entryFile,
      message: `Entry file "${input.entryFile}" was not found in the config set manifest`,
    });
    return { effective: { nodesByLocator: finalize(byLocator) }, diagnostics };
  }

  try {
    ingestDocument(input.entryFile, input, diagnostics, byLocator, byLabel, proofBudget);

    for (const overlayFile of input.overlayOrder) {
      if (!input.files.has(overlayFile)) {
        diagnostics.push({
          code: "include-missing",
          severity: "error",
          fileName: overlayFile,
          message: `Overlay file "${overlayFile}" was not found in the config set manifest`,
        });
        continue;
      }
      ingestDocument(overlayFile, input, diagnostics, byLocator, byLabel, proofBudget);
    }

    return { effective: { nodesByLocator: finalize(byLocator) }, diagnostics };
  } catch (error) {
    if (!(error instanceof SourceProofLimit)) throw error;
    return { effective: { nodesByLocator: new Map() }, diagnostics: [{
      code: "source-proof-limit",severity: "error",fileName: input.entryFile,message: "Exact source proof exceeds its bounded capacity.",
    }] };
  }
}
