import { describe, expect, it } from "vitest";

import {
  aggregateBehaviouralStatus,
  compareReloadDebugValue,
  type ParameterVerificationRecord
} from "./behaviouralVerify";

describe("compareReloadDebugValue", () => {
  it("matches a u32 cell debug value against a bare sysfs decimal read-back", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<7000>",
        readValue: "7000\n",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe(true);
  });

  it("matches hex cell syntax against the same numeric read-back", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<0x1B58>",
        readValue: "7000",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe(true);
  });

  it("rejects a numeric mismatch without comparing raw text", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<7000>",
        readValue: "6000",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe(false);
  });

  it("matches multi-cell arrays by numeric values", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "combined_para",
        debugValue: "<1 2 3>",
        readValue: "1 2 3",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 }
      })
    ).toBe(true);
  });

  it("matches string-list debug values against a quoted or bare driver surface", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "status",
        debugValue: '"okay"',
        readValue: "okay",
        valueShape: { kind: "string-list" }
      })
    ).toBe(true);
    expect(
      compareReloadDebugValue({
        propertyKey: "status",
        debugValue: '"okay"',
        readValue: "disabled",
        valueShape: { kind: "string-list" }
      })
    ).toBe(false);
  });
});

describe("aggregateBehaviouralStatus", () => {
  function outcome(
    partial: Partial<ParameterVerificationRecord> & Pick<ParameterVerificationRecord, "outcome" | "bindingId">
  ): ParameterVerificationRecord {
    return {
      propertyKey: partial.propertyKey ?? partial.bindingId,
      debugNodeId: partial.debugNodeId ?? null,
      nodePath: partial.nodePath ?? null,
      expectedValue: partial.expectedValue ?? "<1>",
      readValue: partial.readValue ?? null,
      reason: partial.reason ?? null,
      ...partial
    };
  }

  it("stays unverifiable when no selected parameter has a binding", () => {
    expect(
      aggregateBehaviouralStatus([
        outcome({ bindingId: "a", outcome: "unbound" }),
        outcome({ bindingId: "b", outcome: "unbound" })
      ])
    ).toBe("unverifiable");
  });

  it("reports verified only when every bound parameter matched", () => {
    expect(
      aggregateBehaviouralStatus([
        outcome({ bindingId: "a", outcome: "verified", readValue: "1" }),
        outcome({ bindingId: "b", outcome: "unbound" })
      ])
    ).toBe("verified");
  });

  it("reports contradicted when any bound parameter contradicted, never verified", () => {
    expect(
      aggregateBehaviouralStatus([
        outcome({ bindingId: "a", outcome: "verified", readValue: "1" }),
        outcome({ bindingId: "b", outcome: "contradicted", readValue: "9" })
      ])
    ).toBe("contradicted");
  });

  it("stays unverifiable when bindings exist but every read failed", () => {
    expect(
      aggregateBehaviouralStatus([
        outcome({ bindingId: "a", outcome: "read-failed", reason: "Node read failed." }),
        outcome({ bindingId: "b", outcome: "unbound" })
      ])
    ).toBe("unverifiable");
  });

  it("stays unverifiable when some bound reads matched and others failed (no contradiction)", () => {
    expect(
      aggregateBehaviouralStatus([
        outcome({ bindingId: "a", outcome: "verified", readValue: "1" }),
        outcome({ bindingId: "b", outcome: "read-failed" })
      ])
    ).toBe("unverifiable");
  });
});
