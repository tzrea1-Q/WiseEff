import { createHash } from "node:crypto";
import type {
  DebugNormalizationMode,
  DebugParameterRecord,
  DebugValueEnvelope,
  DebugValueFormat,
  DebugValueKind,
  DebugValueMetadata
} from "./types";
import {
  DEBUG_NORMALIZATION_MODE_EXACT,
  DEBUG_NORMALIZATION_MODE_JSON_CANONICAL,
  DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED,
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_JSON,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR
} from "./types";

export const DEFAULT_MAX_VALUE_BYTES = 65536;
export const PREVIEW_MAX_CHARS = 240;

export type DebugValueValidationResult = { ok: true } | { ok: false; error: string };

export function resolveDebugValueMetadata(
  record: Partial<Pick<DebugParameterRecord, "valueKind" | "valueFormat" | "normalizationMode" | "maxValueBytes">>
): DebugValueMetadata {
  return {
    valueKind: record.valueKind ?? DEBUG_VALUE_KIND_SCALAR,
    valueFormat: record.valueFormat ?? DEBUG_VALUE_FORMAT_RAW,
    normalizationMode: record.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM,
    maxValueBytes: record.maxValueBytes ?? null
  };
}

export function normalizeDebugValue(raw: string, metadata: DebugValueMetadata) {
  switch (metadata.normalizationMode) {
    case DEBUG_NORMALIZATION_MODE_EXACT:
      return raw;
    case DEBUG_NORMALIZATION_MODE_TRIM:
      return raw.trim();
    case DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED:
      return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    case DEBUG_NORMALIZATION_MODE_JSON_CANONICAL:
      return canonicalizeJson(raw);
    default:
      return raw.trim();
  }
}

export function compareDebugValues(left: string, right: string, metadata: DebugValueMetadata) {
  return normalizeDebugValue(left, metadata) === normalizeDebugValue(right, metadata);
}

export function canonicalizeJson(raw: string) {
  const parsed = JSON.parse(raw);
  return JSON.stringify(sortJsonValue(parsed));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortJsonValue(record[key]);
        return sorted;
      }, {});
  }

  return value;
}

export function computeValueDigest(value: string, metadata?: DebugValueMetadata) {
  const normalized = metadata ? normalizeDebugValue(value, metadata) : value;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function buildValuePreview(raw: string) {
  if (raw.length <= PREVIEW_MAX_CHARS) {
    return raw;
  }

  return `${raw.slice(0, PREVIEW_MAX_CHARS)}…`;
}

export function validateWritePayload(value: string, metadata: DebugValueMetadata): DebugValueValidationResult {
  const maxBytes = metadata.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES;
  const bytes = Buffer.byteLength(value, "utf8");

  if (bytes > maxBytes) {
    return {
      ok: false,
      error: `Debug value exceeds max payload size of ${maxBytes} bytes (${bytes} bytes provided).`
    };
  }

  if (metadata.valueFormat === DEBUG_VALUE_FORMAT_JSON) {
    try {
      JSON.parse(value);
    } catch {
      return {
        ok: false,
        error: "Debug value must be valid JSON for json format parameters."
      };
    }
  }

  return { ok: true };
}

export function buildValueEnvelope(raw: string, metadata: DebugValueMetadata): DebugValueEnvelope {
  const normalized = normalizeDebugValue(raw, metadata);
  const canonical =
    metadata.normalizationMode === DEBUG_NORMALIZATION_MODE_JSON_CANONICAL ? normalized : undefined;

  return {
    kind: metadata.valueKind,
    format: metadata.valueFormat,
    normalization: metadata.normalizationMode,
    raw,
    canonical,
    digest: computeValueDigest(raw, metadata),
    bytes: Buffer.byteLength(raw, "utf8"),
    preview: buildValuePreview(raw)
  };
}

export function requiresExactRead(metadata: DebugValueMetadata) {
  return (
    metadata.normalizationMode === DEBUG_NORMALIZATION_MODE_EXACT ||
    metadata.normalizationMode === DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED
  );
}

export function requiresExactWrite(value: string, metadata: DebugValueMetadata) {
  return requiresExactRead(metadata) || metadata.valueKind !== DEBUG_VALUE_KIND_SCALAR || /[\r\n\u0000]/.test(value);
}
