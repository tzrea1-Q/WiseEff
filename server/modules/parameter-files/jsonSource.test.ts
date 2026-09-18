import { describe, expect, it } from "vitest";
import { patchJsonSource, readJsonSourceValue } from "./jsonSource";
import { patchJsonValue } from "./writebackService";

describe("exact JSON source writeback", () => {
  it("reads exact typed values by document-absolute pointers within the registered root", () => {
    const source = '{"a/b":{"": [false,36.5,null]}, "a":{"b":9}}';
    expect(readJsonSourceValue(source, "/a~1b//1", "/a~1b")).toBe(36.5);
    expect(readJsonSourceValue(source, "/a~1b//0", "/a~1b")).toBe(false);
    expect(readJsonSourceValue(source, "/a~1b//2", "/a~1b")).toBeNull();
    expect(() => readJsonSourceValue(source, "/a/b", "/a~1b")).toThrow();
  });
  it("changes only the selected span under an escaped instance root", () => {
    const source = '{ "a/b": {"": [{"x~y":1, "sibling":2}]}, "a":{"b":3} }\n';
    const patched = patchJsonSource(source, "/a~1b//0/x~0y", "36.5", "/a~1b/");
    expect(patched.toString("utf8")).toBe(
      '{ "a/b": {"": [{"x~y":36.5, "sibling":2}]}, "a":{"b":3} }\n'
    );
  });

  it("uses escaped index locators in the existing writer without changing sibling bytes", () => {
    const source = '{"a/b":1, "a":{"b":2}, "keep":true}';
    expect(patchJsonValue(source, "a~1b", "85").toString("utf8"))
      .toBe('{"a/b":85, "a":{"b":2}, "keep":true}');
    expect(() => patchJsonValue(source, "missing", "85")).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }) as unknown as Error
    );
  });

  it("refuses missing, noncanonical, inherited and outside-instance locations", () => {
    const source = '{"items":[1,2],"01":3,"__proto__":{"safe":false}}';
    for (const pointer of ["items/0", "/items/01", "/items/-1", "/items/-", "/items/2", "/missing", "/~2", "/constructor/prototype"]) {
      expect(() => patchJsonSource(source, pointer, "9"), pointer).toThrow();
    }
    expect(() => patchJsonSource(source, "/01", "9", "/items")).toThrow();
    expect(() => patchJsonSource('{"a":1,"ab":2}', "/ab", "9", "/a")).toThrow();
    expect(patchJsonSource(source, "/01", "9").toString()).toContain('"01":9');
    expect(patchJsonSource(source, "/__proto__/safe", "true").toString()).toContain('"__proto__":{"safe":true}');
    expect(Object.hasOwn({}, "safe")).toBe(false);
  });

  it("preserves JSON scalar/container types and validates targets and non-target source content", () => {
    for (const target of ['"85"', "false", "null", "0.1", '[1,[true,null],"x"]', '{"a/b":2}', '"😀"']) {
      expect(patchJsonSource('{"value":1,"keep":2}', "/value", target).toString())
        .toBe(`{"value":${target},"keep":2}`);
    }
    for (const target of ['"\\u0000"', '"\\ud800"', "9007199254740993", '{"x":1,"x":2}', "[1,]", "NaN"]) {
      expect(() => patchJsonSource('{"value":1}', "/value", target), target).toThrow();
    }
    expect(() => patchJsonSource('{"value":1,"other":"\\ud800"}', "/value", "2")).toThrow();
    expect(patchJsonSource('{"value":1}', "", '[false,null]', "").toString()).toBe('[false,null]');
  });

  it("bounds the total locator inventory for large repeated prefixes", () => {
    const source = `{"${"x".repeat(250_000)}":[${Array(50).fill("1").join(",")}]}`;
    expect(() => patchJsonSource(source, "", "{}" )).toThrow(/locator.*budget/i);
  });
});
