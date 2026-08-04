import { describe, expect, it } from "vitest";

import {
  activateParameterSpecBodySchema,
  updateParameterSpecBodySchema,
} from "./schemas";

const baseUpdate = {
  documentation: "docs",
  reason: "edit",
  constraints: { min: 0 },
};

const baseActivate = {
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
  constraints: { cells: 1 },
  documentation: "docs",
  reason: "activate",
};

describe("parameter spec editor write contract", () => {
  it("strips policyTarget from the update body (SE-1)", () => {
    const parsed = updateParameterSpecBodySchema.parse({
      ...baseUpdate,
      policyTarget: "<&gpio 1 0>",
    });
    expect(parsed).not.toHaveProperty("policyTarget");
  });

  it("accepts null displayName, description, and units on update (SE-3)", () => {
    const parsed = updateParameterSpecBodySchema.parse({
      ...baseUpdate,
      displayName: null,
      description: null,
      units: null,
    });
    expect(parsed.displayName).toBeNull();
    expect(parsed.description).toBeNull();
    expect(parsed.units).toBeNull();
  });

  it("accepts units and exampleValue on activate (SE-4)", () => {
    const parsed = activateParameterSpecBodySchema.parse({
      ...baseActivate,
      units: "mV",
      exampleValue: { kind: "u32", value: 12 },
    });
    expect(parsed.units).toBe("mV");
    expect(parsed.exampleValue).toEqual({ kind: "u32", value: 12 });
  });

  it("accepts clearing units on activate via null (SE-4)", () => {
    const parsed = activateParameterSpecBodySchema.parse({
      ...baseActivate,
      units: null,
    });
    expect(parsed.units).toBeNull();
  });
});
