import { describe, expect, it } from "vitest";

import { normalizeBindingSchemaState } from "./schemaState";

describe("normalizeBindingSchemaState", () => {
  it("maps product and legacy healthy states to valid", () => {
    expect(normalizeBindingSchemaState("valid")).toBe("valid");
    expect(normalizeBindingSchemaState("matched")).toBe("valid");
    expect(normalizeBindingSchemaState("reviewed")).toBe("valid");
    expect(normalizeBindingSchemaState("merged")).toBe("valid");
  });

  it("keeps invalid and unreviewed, and fails closed for unknown or empty", () => {
    expect(normalizeBindingSchemaState("invalid")).toBe("invalid");
    expect(normalizeBindingSchemaState("unreviewed")).toBe("unreviewed");
    expect(normalizeBindingSchemaState(null)).toBe("unreviewed");
    expect(normalizeBindingSchemaState(undefined)).toBe("unreviewed");
    expect(normalizeBindingSchemaState("weird")).toBe("unreviewed");
  });
});
