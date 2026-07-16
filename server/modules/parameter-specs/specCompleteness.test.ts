import { describe, expect, it } from "vitest";

import {
  assertSpecActivatable,
  assertSpecResolvable,
  hasCompleteConstraints,
  isUnsupportedShape,
} from "./specCompleteness";

describe("specCompleteness", () => {
  it("treats unknown and mixed shapes as unsupported", () => {
    expect(isUnsupportedShape({ kind: "unknown" })).toBe(true);
    expect(isUnsupportedShape({ kind: "mixed" })).toBe(true);
    expect(isUnsupportedShape({ kind: "cells", bits: 32 })).toBe(false);
  });

  it("requires cells constraint for cell-like shapes", () => {
    expect(hasCompleteConstraints({ kind: "cells", bits: 32 }, {})).toBe(false);
    expect(hasCompleteConstraints({ kind: "cells", bits: 32 }, { cells: 1 })).toBe(true);
  });

  it("rejects activating unknown shapes", () => {
    expect(() =>
      assertSpecActivatable({
        parameterSpecId: "spec-1",
        valueShape: { kind: "unknown" },
        constraints: {},
        documentation: "docs",
      }),
    ).toThrow(/Unsupported/);
  });

  it("rejects resolving draft specs", () => {
    expect(() =>
      assertSpecResolvable({
        id: "spec-1",
        lifecycle: "draft",
        currentVersionId: "ver-1",
        valueShape: { kind: "cells", bits: 32 },
        constraints: { cells: 1 },
        documentation: "docs",
      }),
    ).toThrow(/Only active/);
  });

  it("rejects resolving active specs with incomplete constraints", () => {
    expect(() =>
      assertSpecResolvable({
        id: "spec-1",
        lifecycle: "active",
        currentVersionId: "ver-1",
        valueShape: { kind: "cells", bits: 32 },
        constraints: {},
        documentation: "docs",
      }),
    ).toThrow(/incomplete/);
  });
});
