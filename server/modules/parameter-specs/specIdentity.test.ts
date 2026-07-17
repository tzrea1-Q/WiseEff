import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildLegacyManualSpecIds,
  buildManualSpecIds,
  canonicalIdentityPart,
  findLegacyManualSpecIdentityCollisions,
} from "./specIdentity";

describe("manual spec identity", () => {
  it("uses lossless canonical parts so vendor,limit and vendor-limit differ", () => {
    expect(canonicalIdentityPart("propertyKey", "vendor,limit")).not.toBe(
      canonicalIdentityPart("propertyKey", "vendor-limit"),
    );

    const comma = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "vendor,limit",
      driverModule: null,
    });
    const hyphen = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "vendor-limit",
      driverModule: null,
    });

    expect(comma.parameterSpecId).not.toBe(hyphen.parameterSpecId);
    expect(comma.parameterSpecVersionId).not.toBe(hyphen.parameterSpecVersionId);
    expect(comma.dtsPropertySpecId).not.toBe(hyphen.dtsPropertySpecId);
  });

  it("legacy sanitize formula still collides (documents why audit exists)", () => {
    const comma = buildLegacyManualSpecIds({
      organizationId: "org-1",
      propertyKey: "vendor,limit",
      driverModule: null,
    });
    const hyphen = buildLegacyManualSpecIds({
      organizationId: "org-1",
      propertyKey: "vendor-limit",
      driverModule: null,
    });
    expect(comma.parameterSpecId).toBe(hyphen.parameterSpecId);
  });

  it("is stable across call order for the same raw inputs", () => {
    const first = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
    });
    const second = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
    });
    expect(first).toEqual(second);
  });

  it("distinguishes case and locator/driver combinations", () => {
    const lower = buildManualSpecIds({ organizationId: "org-1", propertyKey: "Status", driverModule: null });
    const upper = buildManualSpecIds({ organizationId: "org-1", propertyKey: "status", driverModule: null });
    expect(lower.parameterSpecId).not.toBe(upper.parameterSpecId);

    const a = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
    });
    const b = buildManualSpecIds({
      organizationId: "org-1",
      propertyKey: "gpio_int",
      driverModule: "mt5788",
    });
    expect(a.parameterSpecId).not.toBe(b.parameterSpecId);
  });

  it("collision audit reports legacy sanitize collisions without rewriting ids", () => {
    const collisions = findLegacyManualSpecIdentityCollisions([
      { organizationId: "org-1", propertyKey: "vendor,limit", driverModule: null },
      { organizationId: "org-1", propertyKey: "vendor-limit", driverModule: null },
      { organizationId: "org-1", propertyKey: "gpio_int", driverModule: "sc8562" },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.losslessLeftId).not.toBe(collisions[0]?.losslessRightId);
    expect(collisions[0]?.legacyParameterSpecId).toBeTruthy();
  });

  it("property: distinct raw driver/property tuples keep distinct stable ids", () => {
    fc.assert(
      fc.property(
        fc.record({
          driverModule: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
          propertyKey: fc.string({ minLength: 1, maxLength: 32 }),
        }),
        fc.record({
          driverModule: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
          propertyKey: fc.string({ minLength: 1, maxLength: 32 }),
        }),
        (left, right) => {
          fc.pre(
            left.propertyKey !== right.propertyKey ||
              (left.driverModule ?? "") !== (right.driverModule ?? ""),
          );
          const leftIds = buildManualSpecIds({ organizationId: "org-property", ...left });
          const rightIds = buildManualSpecIds({ organizationId: "org-property", ...right });
          expect(leftIds.parameterSpecId).not.toBe(rightIds.parameterSpecId);
          expect(leftIds.parameterSpecVersionId).not.toBe(rightIds.parameterSpecVersionId);
          expect(leftIds.dtsPropertySpecId).not.toBe(rightIds.dtsPropertySpecId);
        },
      ),
      { numRuns: 500 },
    );
  });
});
