import { describe, expect, it } from "vitest";

import { activateParameterSpecBodySchema } from "./schemas";

const baseActivateBody = {
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
  constraints: { cells: 1 },
  documentation: "docs",
  reason: "activate",
};

describe("coverageClaim contract", () => {
  it("accepts overlay-property coverage claims", () => {
    const parsed = activateParameterSpecBodySchema.safeParse({
      ...baseActivateBody,
      coverageClaim: {
        kind: "overlay-property",
        upsertOverlay: {
          compatible: "vendor,sc8562",
          createPropertyLink: true,
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects pinned-schema-property as unsupported in this release", () => {
    const parsed = activateParameterSpecBodySchema.safeParse({
      ...baseActivateBody,
      coverageClaim: {
        kind: "pinned-schema-property",
      },
    });
    expect(parsed.success).toBe(false);
  });
});
