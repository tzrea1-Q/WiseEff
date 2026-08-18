import { describe, expect, it } from "vitest";

import {
  SEMANTIC_EDIT_REQUIRES_SUCCESSOR,
  guardActivateParameterSpec,
  guardDeprecateParameterSpec,
  guardRestoreParameterSpec,
  guardSemanticFieldPatch,
  guardUpdateParameterSpec,
  nextSpecLifecycleAfterRestore
} from "./specLifecycleGuard";

describe("guardActivateParameterSpec", () => {
  it("allows draft and active specs so activate can mint a successor", () => {
    expect(guardActivateParameterSpec("draft", "spec-1")).toEqual({ ok: true });
    expect(guardActivateParameterSpec("active", "spec-1")).toEqual({ ok: true });
  });

  it("rejects activate when the spec is deprecated", () => {
    expect(guardActivateParameterSpec("deprecated", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be activated.",
      details: { specId: "spec-1" }
    });
  });
});

describe("guardSemanticFieldPatch", () => {
  const stored = {
    valueShape: { kind: "string" },
    constraints: { min: 0 },
    units: null as string | null
  };

  it("allows documentation-class patches that restate or omit semantic fields", () => {
    expect(
      guardSemanticFieldPatch("active", "spec-1", stored, {
        valueShape: { kind: "string" },
        constraints: { min: 0 }
      })
    ).toEqual({ ok: true });
    expect(guardSemanticFieldPatch("active", "spec-1", stored, {})).toEqual({ ok: true });
    expect(
      guardSemanticFieldPatch("deprecated", "spec-1", stored, {
        valueShape: { kind: "string" }
      })
    ).toEqual({ ok: true });
  });

  it("treats key-order-only JSON as unchanged", () => {
    expect(
      guardSemanticFieldPatch("active", "spec-1", stored, {
        valueShape: { kind: "string" },
        constraints: { min: 0 }
      })
    ).toEqual({ ok: true });
    expect(
      guardSemanticFieldPatch(
        "active",
        "spec-1",
        { ...stored, valueShape: { kind: "cells", bits: 32, groups: 1 } },
        { valueShape: { groups: 1, bits: 32, kind: "cells" } }
      )
    ).toEqual({ ok: true });
  });

  it("rejects a semantic field change on active or deprecated with the successor code", () => {
    const expected = {
      ok: false as const,
      code: "CONFLICT" as const,
      message: "Semantic fields on an active or deprecated definition must change through activate → successor.",
      details: {
        specId: "spec-1",
        parameterSpecId: "spec-1",
        code: SEMANTIC_EDIT_REQUIRES_SUCCESSOR,
        reason: SEMANTIC_EDIT_REQUIRES_SUCCESSOR
      }
    };
    expect(
      guardSemanticFieldPatch("active", "spec-1", stored, {
        valueShape: { kind: "string", encoding: "ascii" }
      })
    ).toEqual(expected);
    expect(
      guardSemanticFieldPatch("active", "spec-1", stored, {
        constraints: { min: 0, max: 100 }
      })
    ).toEqual(expected);
    expect(
      guardSemanticFieldPatch("deprecated", "spec-1", stored, {
        units: "mV"
      })
    ).toEqual(expected);
  });
});

describe("guardUpdateParameterSpec", () => {
  it("rejects update on a draft spec", () => {
    expect(guardUpdateParameterSpec("draft", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Draft specs must be activated, not updated.",
      details: { specId: "spec-1" }
    });
  });

  it("allows update of active and deprecated specs", () => {
    expect(guardUpdateParameterSpec("active", "spec-1")).toEqual({ ok: true });
    expect(guardUpdateParameterSpec("deprecated", "spec-1")).toEqual({ ok: true });
  });
});

describe("guardDeprecateParameterSpec", () => {
  it("allows draft and active specs", () => {
    expect(guardDeprecateParameterSpec("draft", "spec-1")).toEqual({ ok: true });
    expect(guardDeprecateParameterSpec("active", "spec-1")).toEqual({ ok: true });
  });

  it("rejects deprecate when the spec is already deprecated", () => {
    expect(guardDeprecateParameterSpec("deprecated", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be deprecated.",
      details: { specId: "spec-1" }
    });
  });
});

describe("guardRestoreParameterSpec", () => {
  it("allows only deprecated specs", () => {
    expect(guardRestoreParameterSpec("deprecated", "spec-1")).toEqual({ ok: true });
  });

  it("rejects restore when the spec is not deprecated", () => {
    expect(guardRestoreParameterSpec("draft", "spec-1")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Only deprecated parameter specs can be restored.",
      details: { specId: "spec-1" }
    });
    expect(guardRestoreParameterSpec("active", "spec-1")).toMatchObject({
      ok: false,
      code: "CONFLICT"
    });
  });
});

describe("nextSpecLifecycleAfterRestore", () => {
  it("returns active when the spec was previously activated", () => {
    expect(nextSpecLifecycleAfterRestore("2026-07-14T10:00:00.000Z")).toBe("active");
  });

  it("returns draft when the spec was never activated", () => {
    expect(nextSpecLifecycleAfterRestore(null)).toBe("draft");
    expect(nextSpecLifecycleAfterRestore(undefined)).toBe("draft");
  });
});
