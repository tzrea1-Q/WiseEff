import { describe, expect, it } from "vitest";
import type { DefinitionRevisionSnapshot } from "../../catalog-kernel/interface";
import { vendorValueSchemaFor } from "../../catalog-publication/import/vendorYaml";
import { rawTextToPayload } from "../catalogProjectValueSync";
import { assertCanonicalValueConstraints } from "./service";

function assertValue(schema: object, source: string) {
  const revision = { id: "definition-revision", definitionId: "definition", content: {
    valueShape: { schema }, matching: { selectorKind: "driver-compatible" }
  } } as unknown as DefinitionRevisionSnapshot;
  assertCanonicalValueConstraints(revision, rawTextToPayload("value", source), true);
}

describe("whole-source pinned supported value schema", () => {
  it.each([
    [{ type: "integer", minimum: 0, maximum: 10 }, '"wrong"'],
    [{ type: "integer", minimum: 0 }, "<(-1)>"],
    [{ type: "integer", maximum: 10 }, "<11>"],
    [{ type: "string" }, "<1>"],
    [{ type: "string" }, "<&target>"],
    [{ type: "string" }, "/bits/ 8 <&target>"],
    [{ type: "string" }, "/bits/ 32 <1 2>"],
    [{ type: "string" }, "/bits/ 64 <1>"],
    [{ type: "boolean" }, '"true"'],
    [{ type: "array", items: { type: "integer" } }, '"a", "b"'],
    [{ type: "array", minItems: 2 }, "<1>"],
    [{ type: "array", maxItems: 2 }, "<1 2 3>"],
    [{ type: "array", items: { type: "integer", maximum: 254 } }, "[00 ff]"],
    [{ type: "integer", maximum: 9007199254740992 }, "/bits/ 64 <9007199254740993>"],
    [{ type: "array", items: { type: "array", minItems: 2 } }, "<1>, <2 3>"]
  ])("rejects %j for %s", (schema, source) => {
    expect(() => assertValue(schema, source)).toThrowError(expect.objectContaining({
      code: "VALIDATION_FAILED", details: expect.objectContaining({ reason: "definition-value-constraint" })
    }));
  });
  it.each([
    [{ type: "integer", minimum: 0 }, "/bits/ 64 <9007199254740993>"],
    [{ type: "string" }, '""'],
    [{ type: "boolean" }, ""],
    [{ type: "array", items: { type: "integer" } }, "<1 2>"],
    [{ type: "array", items: { type: "array", minItems: 2 } }, "<1 2>, <3 4>"],
    [{ description: "mixed" }, '"one", <1 &target>']
  ])("accepts %j for %s", (schema, source) => {
    expect(() => assertValue(schema, source)).not.toThrow();
  });
  it.each(["[00 ff]", "/bits/ 8 <0 1 1 5 6>", "/bits/ 8 <0 1 2 5 6>", "/bits/ 8 <0xff>"])(
    "accepts the production vendor bytes schema for %s", (source) => {
      const schema = vendorValueSchemaFor("bytes");
      expect(schema).toEqual({ type: "string" });
      expect(() => assertValue(schema, source)).not.toThrow();
    },
  );
  it.each(["[0]", "[00 gg]"])("rejects malformed bytes %s before schema projection", (source) => {
    expect(() => assertValue(vendorValueSchemaFor("bytes"), source)).toThrow(SyntaxError);
  });
  it.each(["/bits/ 8 <256>", "/bits/ 8 <(-129)>"])("rejects overflowing bytes %s before schema projection", (source) => {
    expect(() => assertValue(vendorValueSchemaFor("bytes"), source)).toThrow(RangeError);
  });
});
