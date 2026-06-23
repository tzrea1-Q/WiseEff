import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  compareDebugValues,
  debugValueEditorRows,
  getDebugValueFormatLabel,
  isComplexDebugParameter,
  normalizeDebugValue,
  resolveDebugValueMetadata,
  validateDebugJsonValue,
  DEBUG_NORMALIZATION_MODE_EXACT,
  DEBUG_NORMALIZATION_MODE_JSON_CANONICAL,
  DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED,
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_JSON,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_COMPLEX,
  DEBUG_VALUE_KIND_SCALAR,
  type DebugValueMetadata
} from "./debugValueKind";

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

describe("debugValueKind", () => {
  it("defaults missing parameter metadata to scalar/raw/trim", () => {
    expect(resolveDebugValueMetadata({})).toEqual({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null
    });
  });

  it("detects complex debug parameters", () => {
    expect(isComplexDebugParameter({ valueKind: "scalar" })).toBe(false);
    expect(isComplexDebugParameter({ valueKind: "complex" })).toBe(true);
  });

  it("sizes complex editors from line count", () => {
    expect(debugValueEditorRows("")).toBe(6);
    expect(debugValueEditorRows("one\ntwo\nthree\nfour\nfive\nsix\nseven")).toBe(7);
    expect(debugValueEditorRows("x\n".repeat(20))).toBe(16);
  });

  it("labels scalar and complex formats", () => {
    expect(getDebugValueFormatLabel({ valueKind: "scalar" })).toBe("标量");
    expect(getDebugValueFormatLabel({ valueKind: "complex", valueFormat: "json" })).toBe("JSON");
    expect(getDebugValueFormatLabel({ valueKind: "complex", valueFormat: "dts" })).toBe("DTS");
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

  it("validates JSON payloads for json format parameters", () => {
    expect(validateDebugJsonValue("{not-json")).toBe("值必须是有效的 JSON。");
    expect(validateDebugJsonValue('{"ok":true}')).toBeNull();
    expect(validateDebugJsonValue("   ")).toBeNull();
  });
});
