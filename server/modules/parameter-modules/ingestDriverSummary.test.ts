import { describe, expect, it } from "vitest";

import { buildIngestDriverSummary } from "./ingestDriverSummary";

describe("buildIngestDriverSummary", () => {
  it("splits observed compatibles into matched registered vs newly unregistered", () => {
    const summary = buildIngestDriverSummary({
      observedCompatibles: ["sc8562", "huawei,orphan", "mt5788", "sc8562"],
      registeredCompatibles: new Set(["sc8562", "mt5788"]),
    });

    expect(summary).toEqual({
      matchedRegistered: ["mt5788", "sc8562"],
      newUnregistered: ["huawei,orphan"],
      matchedRegisteredCount: 2,
      newUnregisteredCount: 1,
    });
  });

  it("ignores empty and scaffolding-shaped labels", () => {
    const summary = buildIngestDriverSummary({
      observedCompatibles: ["", "  ", "i2c@FDF5E000", "sc8562"],
      registeredCompatibles: new Set(["sc8562"]),
    });

    expect(summary.matchedRegistered).toEqual(["sc8562"]);
    expect(summary.newUnregistered).toEqual([]);
  });
});
