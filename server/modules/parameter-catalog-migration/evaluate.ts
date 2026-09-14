/**
 * Pure evaluation helpers for the definition identity correction migration:
 * old-value / new-contract compatibility, source provenance classification, and
 * coupled-source detection.  Nothing here writes.
 */
import type { SupportedValueSchema } from "../catalog-publication/builder/types";

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

const DTS_SOURCE_PATTERN = /\.dts(?:$|[?#])/u;

/**
 * Source format gate.  Only `.dts` is rewritten; every other format blocks the
 * project with `unsupported-source-format` (default 6, gate at
 * `server/modules/parameter-specs/propertyKeyCutover.ts`).
 */
export const classifySourceFormat = (sourceRef: string): "dts" | "unsupported" => {
  const path = sourceRef.split("!")[0] ?? sourceRef;
  return DTS_SOURCE_PATTERN.test(path) ? "dts" : "unsupported";
};

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
