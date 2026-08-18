import { describe, expect, it } from "vitest";

import {
  classifyPropertyKeySourceLocation,
  itemDispositionFromLocationStatus,
} from "./propertyKeyCutover";

describe("classifyPropertyKeySourceLocation (ADR-0034 dry-run)", () => {
  it("marks a tip occurrence of the old key as would-rewrite", () => {
    expect(
      classifyPropertyKeySourceLocation({
        hasTipRevision: true,
        hasFromKeyOccurrence: true,
        hasToKeyOccurrence: false,
      }),
    ).toBe("would-rewrite");
  });

  it("marks a tip that already has only the new key as already-new-key", () => {
    expect(
      classifyPropertyKeySourceLocation({
        hasTipRevision: true,
        hasFromKeyOccurrence: false,
        hasToKeyOccurrence: true,
      }),
    ).toBe("already-new-key");
  });

  it("marks a tip that still lacks both keys as missing-from-source", () => {
    expect(
      classifyPropertyKeySourceLocation({
        hasTipRevision: true,
        hasFromKeyOccurrence: false,
        hasToKeyOccurrence: false,
      }),
    ).toBe("missing-from-source");
  });

  it("marks a binding without a tip revision as no-occurrence", () => {
    expect(
      classifyPropertyKeySourceLocation({
        hasTipRevision: false,
        hasFromKeyOccurrence: false,
        hasToKeyOccurrence: false,
      }),
    ).toBe("no-occurrence");
  });

  it("marks both keys present on the same tip as conflict", () => {
    expect(
      classifyPropertyKeySourceLocation({
        hasTipRevision: true,
        hasFromKeyOccurrence: true,
        hasToKeyOccurrence: true,
      }),
    ).toBe("conflict");
  });
});

describe("itemDispositionFromLocationStatus (ADR-0034 start/finalize)", () => {
  it("skips a tip that already has only the new key", () => {
    expect(itemDispositionFromLocationStatus("already-new-key")).toEqual({
      status: "skipped",
      incompatibilityCode: null,
    });
  });

  it("keeps a would-rewrite tip pending until source is rewritten", () => {
    expect(itemDispositionFromLocationStatus("would-rewrite")).toEqual({
      status: "pending",
      incompatibilityCode: null,
    });
  });

  it("marks missing, no-occurrence, and conflict as incompatible", () => {
    expect(itemDispositionFromLocationStatus("missing-from-source")).toEqual({
      status: "incompatible",
      incompatibilityCode: "missing-from-source",
    });
    expect(itemDispositionFromLocationStatus("no-occurrence")).toEqual({
      status: "incompatible",
      incompatibilityCode: "no-occurrence",
    });
    expect(itemDispositionFromLocationStatus("conflict")).toEqual({
      status: "incompatible",
      incompatibilityCode: "conflict",
    });
  });
});
