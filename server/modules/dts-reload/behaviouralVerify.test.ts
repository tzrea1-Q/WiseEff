import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";

import {
  aggregateBehaviouralStatus,
  resolveDebugNodeBindingForReloadTarget,
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

describe("resolveDebugNodeBindingForReloadTarget", () => {
  it("fails closed when canonical association resolves more than one debug node", async () => {
    const query = vi.fn(async () => ({ rows: [{}, {}], rowCount: 2 }));
    const db = { query } as unknown as Queryable;

    await expect(
      resolveDebugNodeBindingForReloadTarget(db, {
        organizationId: "org-1",
        projectId: "project-1",
        bindingId: "binding-1",
        definitionId: "definition-1",
        definitionRevisionId: "revision-1",
        currentValueId: "value-1",
        catalogReleaseId: "release-1",
        configRevisionId: "config-1",
        sourcePinId: "source-pin-1",
        sourceOccurrenceId: "source-occurrence-1",
        sourceRef: "vendor.dts",
        sourceFormat: "dts",
        sourceLocator: { nodePath: "/soc/watchdog" },
        protocol: "hdc"
      })
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("limit 2"), expect.any(Array));
  });
});
