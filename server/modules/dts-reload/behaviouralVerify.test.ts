import { describe, expect, it } from "vitest";

import {
  aggregateBehaviouralStatus,
  type ParameterVerificationRecord
} from "./behaviouralVerify";

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
