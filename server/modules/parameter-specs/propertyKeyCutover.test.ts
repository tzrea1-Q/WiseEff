import { describe, expect, it } from "vitest";

import { classifyPropertyKeySourceLocation } from "./propertyKeyCutover";

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
