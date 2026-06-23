import { describe, expect, it } from "vitest";
import {
  buildValueEnvelope,
  buildValuePreview,
  canonicalizeJson,
  compareDebugValues,
  computeValueDigest,
  normalizeDebugValue,
  resolveDebugValueMetadata,
  validateWritePayload
} from "./valueCodec";
import type { DebugValueMetadata } from "./types";
import {
  DEBUG_NORMALIZATION_MODE_EXACT,
  DEBUG_NORMALIZATION_MODE_JSON_CANONICAL,
  DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED,
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_JSON,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_COMPLEX,
  DEBUG_VALUE_KIND_SCALAR
} from "./types";

const scalarTrim: DebugValueMetadata = {
  valueKind: DEBUG_VALUE_KIND_SCALAR,
  valueFormat: DEBUG_VALUE_FORMAT_RAW,
  normalizationMode: DEBUG_NORMALIZATION_MODE_TRIM,
  maxValueBytes: null
};

const exactRaw: DebugValueMetadata = {
  valueKind: DEBUG_VALUE_KIND_COMPLEX,
  valueFormat: DEBUG_VALUE_FORMAT_RAW,
  normalizationMode: DEBUG_NORMALIZATION_MODE_EXACT,
  maxValueBytes: null
};

const lineEnding: DebugValueMetadata = {
  valueKind: DEBUG_VALUE_KIND_COMPLEX,
  valueFormat: DEBUG_VALUE_FORMAT_RAW,
  normalizationMode: DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED,
  maxValueBytes: null
};

const jsonCanonical: DebugValueMetadata = {
  valueKind: DEBUG_VALUE_KIND_COMPLEX,
  valueFormat: DEBUG_VALUE_FORMAT_JSON,
  normalizationMode: DEBUG_NORMALIZATION_MODE_JSON_CANONICAL,
  maxValueBytes: null
};

describe("valueCodec", () => {
  it("defaults missing parameter metadata to scalar/raw/trim", () => {
    expect(resolveDebugValueMetadata({})).toEqual({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null
    });
  });

  it("trims scalar values when normalization mode is trim", () => {
    expect(normalizeDebugValue("  42  \n", scalarTrim)).toBe("42");
    expect(compareDebugValues("  42  ", "42", scalarTrim)).toBe(true);
  });

  it("preserves exact raw values without trimming", () => {
    const value = "  line one\nline two  \n";
    expect(normalizeDebugValue(value, exactRaw)).toBe(value);
    expect(compareDebugValues(value, value, exactRaw)).toBe(true);
    expect(compareDebugValues("alpha", " alpha", exactRaw)).toBe(false);
  });

  it("normalizes CRLF and CR line endings for comparison", () => {
    const left = "a\r\nb\rc";
    const right = "a\nb\nc";
    expect(normalizeDebugValue(left, lineEnding)).toBe("a\nb\nc");
    expect(compareDebugValues(left, right, lineEnding)).toBe(true);
  });

  it("compares JSON values using canonical ordering", () => {
    const left = '{ "b": 2, "a": { "z": 1, "y": 0 } }';
    const right = '{ "a": { "y": 0, "z": 1 }, "b": 2 }';
    expect(canonicalizeJson(left)).toBe('{"a":{"y":0,"z":1},"b":2}');
    expect(compareDebugValues(left, right, jsonCanonical)).toBe(true);
    expect(compareDebugValues(left, '{"a":{"y":0,"z":2},"b":2}', jsonCanonical)).toBe(false);
  });

  it("computes stable digests from normalized values", () => {
    const digest = computeValueDigest(' { "b": 1, "a": 2 } ', jsonCanonical);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(computeValueDigest('{"a":2,"b":1}', jsonCanonical));
  });

  it("builds capped previews for large payloads", () => {
    const raw = "x".repeat(300);
    expect(buildValuePreview(raw)).toHaveLength(241);
    expect(buildValuePreview(raw).endsWith("…")).toBe(true);
  });

  it("builds value envelopes with digest, bytes, and preview", () => {
    const envelope = buildValueEnvelope("alpha", scalarTrim);
    expect(envelope).toMatchObject({
      kind: "scalar",
      format: "raw",
      normalization: "trim",
      raw: "alpha",
      bytes: 5,
      preview: "alpha"
    });
    expect(envelope.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid JSON payloads for json format parameters", () => {
    expect(validateWritePayload("{not-json", { ...jsonCanonical })).toEqual({
      ok: false,
      error: "Debug value must be valid JSON for json format parameters."
    });
    expect(validateWritePayload('{"ok":true}', { ...jsonCanonical })).toEqual({ ok: true });
  });
});
