import { describe, expect, it } from "vitest";

import {
  buildSpecEditorSavePayload,
  createSpecEditorDraft,
  type ParameterSpecDetailView,
  type SpecEditorDraft,
} from "./ParameterSpecDetail";
import { specEditorSaveDiff, stablePrettyJson } from "./specEditorSaveDiff";

function baseDetail(overrides: Partial<ParameterSpecDetailView> = {}): ParameterSpecDetailView {
  return {
    id: "pspec:org:demo",
    organizationId: "org-1",
    propertyKey: "active_perf_limit",
    attributionSubjectId: "asub:driver:demo",
    attributionModules: [],
    driverModule: null,
    compatible: null,
    valueType: "u32-array",
    valueShape: { kind: "u32-array" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    reviewState: "active",
    usageCount: 0,
    displayName: "Perf limit",
    description: "desc",
    documentation: "docs",
    units: "mV",
    constraints: { min: 0, max: 100 },
    ...overrides,
  };
}

function draftFrom(detail: ParameterSpecDetailView, overrides: Partial<SpecEditorDraft> = {}): SpecEditorDraft {
  return { ...createSpecEditorDraft(detail), ...overrides };
}

describe("specEditorSaveDiff", () => {
  it("flags a constraints shrink and keeps both sides (SE-D5)", () => {
    const diff = specEditorSaveDiff(
      { valueShape: { kind: "u32-array" }, constraints: { min: 0, max: 100 } },
      { valueShape: { kind: "u32-array" }, constraints: { min: 0 } },
    );

    expect(diff.valueShapeChanged).toBe(false);
    expect(diff.constraintsChanged).toBe(true);
    expect(diff.previousConstraints).toEqual({ min: 0, max: 100 });
    expect(diff.nextConstraints).toEqual({ min: 0 });
  });

  it("does not invent a diff when shape and constraints are unchanged", () => {
    const diff = specEditorSaveDiff(
      { valueShape: { kind: "u32-array" }, constraints: { min: 0 } },
      { valueShape: { kind: "u32-array" }, constraints: { min: 0 } },
    );

    expect(diff.valueShapeChanged).toBe(false);
    expect(diff.constraintsChanged).toBe(false);
  });

  it("treats reordered object keys as unchanged", () => {
    const diff = specEditorSaveDiff(
      { valueShape: { kind: "u32-array", bits: 32 }, constraints: { max: 100, min: 0 } },
      { valueShape: { bits: 32, kind: "u32-array" }, constraints: { min: 0, max: 100 } },
    );

    expect(diff.valueShapeChanged).toBe(false);
    expect(diff.constraintsChanged).toBe(false);
  });

  it("flags a valueShape change", () => {
    const diff = specEditorSaveDiff(
      { valueShape: { kind: "u32-array" }, constraints: {} },
      { valueShape: { kind: "u32-array", bits: 32 }, constraints: {} },
    );

    expect(diff.valueShapeChanged).toBe(true);
    expect(diff.constraintsChanged).toBe(false);
    expect(diff.previousValueShape).toEqual({ kind: "u32-array" });
    expect(diff.nextValueShape).toEqual({ kind: "u32-array", bits: 32 });
  });

  it("reads the next side from buildSpecEditorSavePayload so the preview matches the request", () => {
    const detail = baseDetail();
    const built = buildSpecEditorSavePayload(
      detail,
      draftFrom(detail, { constraintsText: '{"min":0}' }),
      "shrink constraints",
    );
    expect(built.payload).not.toBeNull();
    const diff = specEditorSaveDiff(detail, built.payload!);
    expect(diff.constraintsChanged).toBe(true);
    expect(diff.nextConstraints).toEqual({ min: 0 });
    expect(diff.nextConstraints).toEqual(built.payload!.constraints);
  });
});

describe("stablePrettyJson", () => {
  it("pretty-prints with two-space indent and sorted keys", () => {
    expect(stablePrettyJson({ min: 0, max: 100 })).toBe(`{
  "max": 100,
  "min": 0
}`);
  });
});
