import { describe, expect, it } from "vitest";

import type { AllowlistEntry, BoundaryViolation } from "./schema";
import { compareBoundaryInventory, formatBoundaryReport } from "./deterministicOutput";

const violation = (overrides: Partial<BoundaryViolation> = {}): BoundaryViolation => ({
  id: "S12-CGH:legacy-catalog-sql-write:0123456789abcdef:fedcba9876543210",
  family: "S12-CGH",
  rule: "legacy-catalog-sql-write",
  file: "server/modules/parameter-specs/repository.ts",
  line: 10,
  column: 5,
  trustedBaseSha: "9b3ba7df7e21f5589684bc92c872da593ad4c246",
  trustedBlobOid: "0123456789abcdef0123456789abcdef01234567",
  byteStart: 120,
  byteEnd: 148,
  token: "write:parameter_specs",
  evidence: "insert into parameter_specs",
  reason: "Legacy writer remains pending S12-CGH.",
  ...overrides,
});

const allowance = (source = violation()): AllowlistEntry => ({
  id: source.id,
  rule: source.rule,
  file: source.file,
  reason: source.reason,
});

describe("deterministic parameter catalog boundary output", () => {
  it("passes only when every live violation has one exact named allowance", () => {
    const live = violation();
    const report = compareBoundaryInventory([live], [allowance(live)]);

    expect(report.status).toBe("passed");
    expect(report.summary).toEqual({
      violations: 1,
      allowlisted: 1,
      unallowlisted: 0,
      staleAllowances: 0,
      metadataMismatches: 0,
      allowlistGrowth: 0,
    });
  });

  it("rejects any allowance that was not present in the immutable initial fixture", () => {
    const initial = violation();
    const added = violation({
      id: "S12-CGH:legacy-catalog-route:fedcba9876543210:1111111111111111",
      rule: "legacy-catalog-route",
      file: "server/modules/parameter-specs/routes.ts",
      evidence: "/api/v2/parameter-specs",
    });

    const report = compareBoundaryInventory([initial, added], [allowance(initial), allowance(added)], [initial]);

    expect(report.status).toBe("failed");
    expect(report.allowlistGrowth).toEqual([allowance(added)]);
    expect(report.summary.allowlistGrowth).toBe(1);
  });

  it("fails for a new live violation and for an allowance whose code was removed", () => {
    const allowed = violation();
    const added = violation({
      id: "S12-CGH:legacy-catalog-raw-read:fedcba9876543210:2222222222222222",
      rule: "legacy-catalog-raw-read",
      line: 20,
      evidence: "from parameter_specs",
    });
    const stale = allowance(
      violation({
        id: "S12-CGH:legacy-catalog-route:aaaaaaaaaaaaaaaa:3333333333333333",
        rule: "legacy-catalog-route",
        file: "server/modules/parameter-specs/routes.ts",
        evidence: "/api/v2/parameter-specs",
      }),
    );

    const report = compareBoundaryInventory([added, allowed], [stale, allowance(allowed)]);

    expect(report.status).toBe("failed");
    expect(report.unallowlisted.map((item) => item.id)).toEqual([added.id]);
    expect(report.staleAllowances.map((item) => item.id)).toEqual([stale.id]);
  });

  it("fails when an ID is reused with different rule or file metadata", () => {
    const live = violation();
    const report = compareBoundaryInventory([live], [
      {
        ...allowance(live),
        file: "server/modules/parameter-specs/service.ts",
      },
    ]);

    expect(report.status).toBe("failed");
    expect(report.metadataMismatches).toEqual([
      {
        id: live.id,
        expected: {
          rule: live.rule,
          file: "server/modules/parameter-specs/service.ts",
          reason: live.reason,
        },
        actual: {
          rule: live.rule,
          file: live.file,
          reason: live.reason,
        },
      },
    ]);
  });

  it("fails when a named allowance reason drifts from the immutable violation metadata", () => {
    const live = violation();
    const report = compareBoundaryInventory(
      [live],
      [{ ...allowance(live), reason: "A rewritten allowance justification." }],
      [live],
    );

    expect(report.status).toBe("failed");
    expect(report.metadataMismatches).toEqual([
      {
        id: live.id,
        expected: {
          rule: live.rule,
          file: live.file,
          reason: "A rewritten allowance justification.",
        },
        actual: {
          rule: live.rule,
          file: live.file,
          reason: live.reason,
        },
      },
    ]);
    expect(report.allowlistGrowth).toEqual([{ ...allowance(live), reason: "A rewritten allowance justification." }]);
  });

  it("rejects delete/add replacement that reuses the same base identity", () => {
    const baseline = violation();
    const replacement = violation({
      id: baseline.id.replace(/:[a-f0-9]{16}$/u, ":0000000000000001"),
      trustedBlobOid: "89abcdef0123456789abcdef0123456789abcdef",
      byteStart: 220,
      byteEnd: 248,
    });

    const report = compareBoundaryInventory([replacement], [allowance(baseline)], [baseline]);

    expect(report.status).toBe("failed");
    expect(report.unallowlisted).toEqual([replacement]);
    expect(report.staleAllowances).toEqual([allowance(baseline)]);
  });

  it("emits byte-identical sorted JSON regardless of discovery or shard order", () => {
    const first = violation();
    const second = violation({
      id: "S12-TOP:legacy-catalog-module-import:fedcba9876543210:4444444444444444",
      family: "S12-TOP",
      rule: "legacy-catalog-module-import",
      file: "server/modules/parameter-topology/service.ts",
      line: 3,
      column: 1,
      evidence: "../parameter-specs/repository",
      reason: "Legacy import remains pending S12-TOP.",
    });

    const forward = formatBoundaryReport(compareBoundaryInventory([first, second], [allowance(first), allowance(second)]));
    const reversed = formatBoundaryReport(compareBoundaryInventory([second, first], [allowance(second), allowance(first)]));

    expect(reversed).toBe(forward);
    expect(forward).toMatch(/^\{\n  "schemaVersion": 1,/u);
    expect(forward.endsWith("\n")).toBe(true);
    expect(forward.indexOf(first.id)).toBeLessThan(forward.indexOf(second.id));
  });
});
