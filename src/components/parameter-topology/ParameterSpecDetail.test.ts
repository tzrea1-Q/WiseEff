import { describe, expect, it } from "vitest";

import {
  buildSpecEditorSavePayload,
  createSpecEditorDraft,
  isSpecEditorDraftDirty,
  type ParameterSpecDetailView,
  type SpecEditorDraft,
} from "./ParameterSpecDetail";

function baseDetail(overrides: Partial<ParameterSpecDetailView> = {}): ParameterSpecDetailView {
  return {
    id: "pspec:org:demo",
    organizationId: "org-1",
    propertyKey: "active_perf_limit",
    attributionModules: [],
    driverModule: null,
    compatible: null,
    valueType: "u32-array",
    valueShape: { kind: "u32-array" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    businessCategory: null,
    reviewState: "active",
    usageCount: 0,
    displayName: "Perf limit",
    description: "desc",
    documentation: "docs",
    units: "mV",
    constraints: { min: 0, max: 100 },
    policyTarget: "<&gpio 1 0>",
    ...overrides,
  };
}

function draftFrom(detail: ParameterSpecDetailView, overrides: Partial<SpecEditorDraft> = {}): SpecEditorDraft {
  return { ...createSpecEditorDraft(detail), ...overrides };
}

describe("createSpecEditorDraft", () => {
  it("falls back displayName to propertyKey when displayName is empty (pre-SE-D3)", () => {
    const draft = createSpecEditorDraft(
      baseDetail({ displayName: "", description: "kept" }),
    );
    expect(draft.displayName).toBe("active_perf_limit");
  });

  it("does not invent missing cell fields for incomplete shapes (SE-23)", () => {
    const draft = createSpecEditorDraft(baseDetail({ valueShape: { kind: "u32-array" } }));
    expect(draft.valueShape).toEqual({ kind: "u32-array" });
  });

  it("does not seed a policyTarget editor field (SE-1)", () => {
    const draft = createSpecEditorDraft(baseDetail());
    expect(draft).not.toHaveProperty("policyTargetText");
  });

  it("does not keep audit reason on the editor draft", () => {
    const draft = createSpecEditorDraft(baseDetail());
    expect(draft).not.toHaveProperty("reason");
  });
});

describe("buildSpecEditorSavePayload", () => {
  it("omits policyTarget from the save payload (SE-1)", () => {
    const detail = baseDetail();
    const built = buildSpecEditorSavePayload(detail, draftFrom(detail), "fix");
    expect(built.error).toBeNull();
    expect(built.payload).not.toBeNull();
    expect(built.payload!).not.toHaveProperty("policyTarget");
  });

  it("falls back displayName to propertyKey when cleared (pre-SE-D3)", () => {
    const detail = baseDetail({ displayName: "Perf limit" });
    const built = buildSpecEditorSavePayload(
      detail,
      draftFrom(detail, { displayName: "   " }),
      "fix",
    );
    expect(built.error).toBeNull();
    expect(built.payload!.displayName).toBe("active_perf_limit");
  });

  it("sends null units when the units field is cleared (SE-3)", () => {
    const detail = baseDetail({ units: "mV" });
    const built = buildSpecEditorSavePayload(
      detail,
      draftFrom(detail, { units: "  " }),
      "fix",
    );
    expect(built.error).toBeNull();
    expect(built.payload!.units).toBeNull();
  });

  it("round-trips an incomplete valueShape without filling keys (SE-23)", () => {
    const detail = baseDetail({ valueShape: { kind: "u32-array" } });
    const built = buildSpecEditorSavePayload(detail, draftFrom(detail), "fix");
    expect(built.error).toBeNull();
    expect(built.payload!.valueShape).toEqual({ kind: "u32-array" });
  });

  it("sends the full constraints object so omitted keys are removed on replace (SE-2)", () => {
    const detail = baseDetail({ constraints: { min: 0, max: 100, step: 1 } });
    const built = buildSpecEditorSavePayload(
      detail,
      draftFrom(detail, { constraintsText: '{"min":0}' }),
      "fix",
    );
    expect(built.error).toBeNull();
    expect(built.payload!.constraints).toEqual({ min: 0 });
  });

  it("rejects an empty reason (SE-13)", () => {
    const detail = baseDetail();
    const built = buildSpecEditorSavePayload(detail, draftFrom(detail), "   ");
    expect(built.payload).toBeNull();
    expect(built.error).toMatch(/原因/);
  });

  it("uses activate-reason copy for org drafts", () => {
    const detail = baseDetail({ reviewState: "draft" });
    const built = buildSpecEditorSavePayload(detail, draftFrom(detail), "");
    expect(built.payload).toBeNull();
    expect(built.error).toMatch(/激活原因/);
  });
});

describe("isSpecEditorDraftDirty", () => {
  it("is false for an untouched draft", () => {
    const detail = baseDetail();
    expect(isSpecEditorDraftDirty(detail, createSpecEditorDraft(detail))).toBe(false);
  });

  it("is true after a field change", () => {
    const detail = baseDetail();
    const draft = draftFrom(detail, { documentation: "changed docs" });
    expect(isSpecEditorDraftDirty(detail, draft)).toBe(true);
  });
});
