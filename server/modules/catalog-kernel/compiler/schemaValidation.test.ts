import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidJsonSchema202012 } from "./schemaValidation";

const Ajv2020 = (createRequire(import.meta.url)("ajv/dist/2020") as {
  default: { prototype: { compile(schema: unknown): unknown } };
}).default;

afterEach(() => vi.restoreAllMocks());

describe("Catalog value schema validation cache", () => {
  it("compiles equivalent schemas only once, including reordered isolated copies", () => {
    const compile = vi.spyOn(Ajv2020.prototype, "compile");
    const schema = { type: "integer", minimum: 17, maximum: 43 };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(isValidJsonSchema202012(structuredClone(schema))).toBe(true);
    expect(isValidJsonSchema202012({ maximum: 43, minimum: 17, type: "integer" })).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("revalidates mutated content and retains cached invalid results", () => {
    const compile = vi.spyOn(Ajv2020.prototype, "compile");
    const schema = { type: "number", minimum: 23 };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    schema.type = "not-a-json-schema-type";
    expect(isValidJsonSchema202012(schema)).toBe(false);
    expect(isValidJsonSchema202012(structuredClone(schema))).toBe(false);
    schema.type = "number";
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("does not share schema registrations between different contents with the same id", () => {
    const schema = { $id: "urn:wiseeff:cache-isolation", type: "integer" };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(isValidJsonSchema202012({ ...schema, type: "string" })).toBe(true);
    expect(isValidJsonSchema202012({ ...schema, type: "invalid" })).toBe(false);
    expect(isValidJsonSchema202012(schema)).toBe(true);
  });

  it("bounds retained schemas and revalidates evicted content", () => {
    const compile = vi.spyOn(Ajv2020.prototype, "compile");
    const schema = { type: "integer", description: "cache eviction target" };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    for (let index = 0; index < 256; index += 1) {
      expect(isValidJsonSchema202012({ type: "integer", description: `eviction ${index}` })).toBe(true);
    }
    compile.mockClear();
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("still validates oversized content without retaining it", () => {
    const compile = vi.spyOn(Ajv2020.prototype, "compile");
    const schema = { type: "boolean", description: "x".repeat(65_536) };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(isValidJsonSchema202012(structuredClone(schema))).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("preserves validation for runtime schemas that cannot be canonically serialized", () => {
    const compile = vi.spyOn(Ajv2020.prototype, "compile");
    const schema = { type: "integer", minimum: undefined, description: "uncacheable runtime schema" };
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(isValidJsonSchema202012(schema)).toBe(true);
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
