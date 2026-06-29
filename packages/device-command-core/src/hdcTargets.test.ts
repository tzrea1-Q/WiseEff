import { describe, expect, it } from "vitest";

import { isHdcPlaceholderTarget, parseHdcTargets } from "./hdcTargets";

describe("hdcTargets", () => {
  it("treats HDC [Empty] output as no connected device", () => {
    expect(isHdcPlaceholderTarget("[Empty]")).toBe(true);
    expect(isHdcPlaceholderTarget("  [empty]  ")).toBe(true);
    expect(parseHdcTargets("[Empty]\n")).toEqual([]);
    expect(parseHdcTargets("\n[Empty]\n\n")).toEqual([]);
  });

  it("parses real HDC target lines", () => {
    expect(parseHdcTargets("\nAURORA-001\n  lab target 2  \n\n")).toEqual([
      { targetRef: "AURORA-001", online: true },
      { targetRef: "lab target 2", online: true }
    ]);
  });
});
