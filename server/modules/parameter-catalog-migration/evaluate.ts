/**
 * Pure evaluation helpers for the definition identity correction migration:
 * old-value / new-contract compatibility, source provenance classification, and
 * coupled-source detection.  Nothing here writes.
 */
import type { SupportedValueSchema } from "../catalog-publication/builder/types";
import { deriveDtsSourceRef, isDtsSourceRef } from "../dts/sourceRef";

export type ValueCompatibility =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const withinBounds = (
  value: number,
  schema: { readonly minimum?: number; readonly maximum?: number },
): string | null => {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    return `below-minimum:${schema.minimum}`;
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    return `above-maximum:${schema.maximum}`;
  }
  return null;
};

/**
 * Compatibility of one already-stored ProjectValue against the proposed
 * replacement revision's `valueSchema`.  Incompatible values block the project;
 * the capability never converts, truncates, clamps or substitutes (default 5).
 */
export const evaluateValueCompatibility = (
  value: unknown,
  schema: SupportedValueSchema,
): ValueCompatibility => {
  const type = (schema as { readonly type?: unknown }).type;
  switch (type) {
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return { compatible: false, reason: "expected-integer" };
      }
      const bound = withinBounds(value, schema as { minimum?: number; maximum?: number });
      return bound ? { compatible: false, reason: bound } : { compatible: true };
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { compatible: false, reason: "expected-number" };
      }
      const bound = withinBounds(value, schema as { minimum?: number; maximum?: number });
      return bound ? { compatible: false, reason: bound } : { compatible: true };
    }
    case "string":
      return typeof value === "string" ? { compatible: true } : { compatible: false, reason: "expected-string" };
    case "boolean":
      return typeof value === "boolean" ? { compatible: true } : { compatible: false, reason: "expected-boolean" };
    case "null":
      return value === null ? { compatible: true } : { compatible: false, reason: "expected-null" };
    case "array": {
      if (!Array.isArray(value)) {
        return { compatible: false, reason: "expected-array" };
      }
      const items = (schema as { readonly items?: { readonly type?: string } }).items;
      if (!items || typeof items.type !== "string") {
        return { compatible: true };
      }
      for (const entry of value) {
        if (items.type === "string" && typeof entry !== "string") {
          return { compatible: false, reason: "expected-string-array" };
        }
        if (items.type === "integer" && (typeof entry !== "number" || !Number.isInteger(entry))) {
          return { compatible: false, reason: "expected-integer-array" };
        }
      }
      return { compatible: true };
    }
    default:
      // Mixed/described schema: the only supported non-typed member accepts any
      // JSON value, which is what the builder's allow-list permits.
      return { compatible: true };
  }
};

/**
 * Source format gate.  Only `.dts` is rewritten; every other format blocks the
 * project with `unsupported-source-format` (default 6, gate at
 * `server/modules/parameter-specs/propertyKeyCutover.ts`).
 */
export const classifySourceFormat = (sourceRef: string): "dts" | "unsupported" =>
  isDtsSourceRef(sourceRef) ? "dts" : "unsupported";

export { deriveDtsSourceRef };

/**
 * The canonical source location of a project value, resolved from DTS
 * provenance when the recorded `source_ref` is opaque.
 *
 * The dts ingest path records a config-set reference on the value row because
 * that is the write the operator approved; the actual `.dts` file (and node) the
 * value came from lives in `dts_property_occurrences`.  Resolving the file here
 * keeps append-only value rows immutable while still gating on real `.dts`
 * provenance, including for rows written before this resolution existed.
 */
export type SourceProvenanceFacts = {
  /** `source_ref` exactly as recorded on the project value row. */
  readonly recordedSourceRef: string;
  readonly configRevisionId: string;
  /** DTS occurrences matching this binding's config revision, node and key. */
  readonly occurrenceCount: number;
  /** Project file the matched occurrence belongs to, when one matched. */
  readonly fileName: string | null;
  /** Node locator of the matched occurrence, when the config carries one. */
  readonly nodeLocator: string | null;
};

export type ResolvedSourceLocation =
  | { readonly status: "resolved"; readonly sourceRef: string; readonly format: "dts" }
  | {
      readonly status: "blocked";
      readonly reason:
        | "missing-source-provenance"
        | "unsupported-source-format"
        | "ambiguous-source-match";
    };

export const resolveSourceLocation = (
  facts: SourceProvenanceFacts,
): ResolvedSourceLocation => {
  const recorded = facts.recordedSourceRef.trim();
  if (recorded.length === 0 || facts.configRevisionId.trim().length === 0) {
    return { status: "blocked", reason: "missing-source-provenance" };
  }
  if (recorded === IDENTITY_PLACEHOLDER_SOURCE) {
    return { status: "blocked", reason: "missing-source-provenance" };
  }
  if (isDtsSourceRef(recorded)) {
    return { status: "resolved", sourceRef: recorded, format: "dts" };
  }
  // A recorded ref that names a real file already states its format.
  if (!recorded.startsWith(OPAQUE_SOURCE_PREFIX)) {
    return { status: "blocked", reason: "unsupported-source-format" };
  }
  if (facts.occurrenceCount === 0) {
    return { status: "blocked", reason: "missing-source-provenance" };
  }
  if (facts.occurrenceCount > 1) {
    return { status: "blocked", reason: "ambiguous-source-match" };
  }
  const fileName = facts.fileName?.trim() ?? "";
  if (fileName.length === 0) {
    return { status: "blocked", reason: "missing-source-provenance" };
  }
  if (!isDtsSourceRef(fileName)) {
    return { status: "blocked", reason: "unsupported-source-format" };
  }
  return {
    status: "resolved",
    format: "dts",
    sourceRef: deriveDtsSourceRef({ fileName, nodeLocator: facts.nodeLocator }),
  };
};

/** The placeholder identity source; never a real file. */
export const IDENTITY_PLACEHOLDER_SOURCE = "canonical-binding-identity";

/**
 * A recorded ref that names a provenance record instead of a file, and so has
 * to be resolved through the DTS occurrence the value came from.
 */
export const OPAQUE_SOURCE_PREFIX = "config-set:";

export type SourceOccurrenceFacts = {
  readonly sourceRef: string;
  readonly configRevisionId: string;
  readonly logicalNodeId: string;
  readonly propertyKey: string;
};

/**
 * Coupled-source impact: another definition in the same project that shares the
 * same source location (same source file and logical node) with a different
 * property key would also change under a property-key rewrite.  Such a project
 * is blocked with `coupled-source-impact` and nothing outside the approved
 * manifest is rewritten.
 */
export const detectCoupledSourceImpact = (input: {
  readonly target: SourceOccurrenceFacts;
  readonly siblings: readonly SourceOccurrenceFacts[];
}): readonly string[] => {
  const shared = new Set<string>();
  for (const sibling of input.siblings) {
    if (sibling.sourceRef !== input.target.sourceRef) continue;
    if (sibling.logicalNodeId !== input.target.logicalNodeId) continue;
    if (sibling.propertyKey === input.target.propertyKey) continue;
    shared.add(`${sibling.sourceRef}\u0000${sibling.logicalNodeId}`);
  }
  return [...shared];
};

/**
 * Source rewrites are ambiguous when two occurrences of the same key exist at
 * the same location in one file: no occurrence is rewritten and the
 * `source_ref` values stay as recorded.
 */
export const hasAmbiguousSourceMatch = (input: {
  readonly targetKey: string;
  readonly occurrences: readonly { readonly propertyKey: string; readonly sourceRef: string; readonly logicalNodeId: string }[];
  readonly sourceRef: string;
  readonly logicalNodeId: string;
}): boolean =>
  input.occurrences.filter(
    (occurrence) =>
      occurrence.sourceRef === input.sourceRef &&
      occurrence.logicalNodeId === input.logicalNodeId &&
      occurrence.propertyKey === input.targetKey,
  ).length > 1;

export const isRecordValue = isRecord;
