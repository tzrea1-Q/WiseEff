import { describe, expect, it } from "vitest";

import { organizationDriverSchemaPropertyBodySchema } from "./schemas";

/**
 * The valueShape union must preserve the layout fields the value-shape model
 * carries (DraftValueShape: cells/phandle-list/u32-array have bits/groups/
 * cellsPerGroup; bytes has length). A plain `z.object({ kind })` union member
 * silently strips them, which corrupts the stored driver-schema property.
 */
describe("organizationDriverSchemaPropertyBodySchema valueShape layout", () => {
  it("preserves bits/groups/cellsPerGroup for u32-array", () => {
    const parsed = organizationDriverSchemaPropertyBodySchema.parse({
      propertyKey: "clock-frequency",
      valueShape: { kind: "u32-array", bits: 32, groups: 2, cellsPerGroup: 1 }
    });
    expect(parsed).toMatchObject({
      valueShape: { kind: "u32-array", bits: 32, groups: 2, cellsPerGroup: 1 }
    });
  });

  it("preserves bits/groups/cellsPerGroup for phandle-list and cells", () => {
    const phandle = organizationDriverSchemaPropertyBodySchema.parse({
      propertyKey: "clocks",
      valueShape: { kind: "phandle-list", bits: 32, groups: 3, cellsPerGroup: 2 }
    });
    expect(phandle).toMatchObject({
      valueShape: { kind: "phandle-list", bits: 32, groups: 3, cellsPerGroup: 2 }
    });

    const cells = organizationDriverSchemaPropertyBodySchema.parse({
      propertyKey: "reg",
      valueShape: { kind: "cells", bits: 16, groups: 4, cellsPerGroup: 2 }
    });
    expect(cells).toMatchObject({
      valueShape: { kind: "cells", bits: 16, groups: 4, cellsPerGroup: 2 }
    });
  });

  it("preserves length for bytes", () => {
    const parsed = organizationDriverSchemaPropertyBodySchema.parse({
      propertyKey: "mac-address",
      valueShape: { kind: "bytes", length: 6 }
    });
    expect(parsed).toMatchObject({ valueShape: { kind: "bytes", length: 6 } });
  });

  it("still accepts simple kinds without layout", () => {
    const parsed = organizationDriverSchemaPropertyBodySchema.parse({
      propertyKey: "enabled",
      valueShape: { kind: "bool" }
    });
    expect(parsed).toMatchObject({ valueShape: { kind: "bool" } });
  });
});
