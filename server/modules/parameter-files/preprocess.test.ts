import { describe, expect, it } from "vitest";
import { stripDtsComments } from "./preprocess";

describe("stripDtsComments", () => {
  it("removes block and line comments", () => {
    const src = `a = <1>; /* b = <2>; */ c = <3>; // d = <4>;\n e = <5>;`;
    const out = stripDtsComments(src);
    expect(out).toContain("a = <1>;");
    expect(out).toContain("c = <3>;");
    expect(out).toContain("e = <5>;");
    expect(out).not.toContain("b = <2>");
    expect(out).not.toContain("d = <4>");
  });

  it("keeps comment-like text inside string literals", () => {
    const src = `path = "a/*not-comment*/b"; note = "http://x"; end = <1>;`;
    const out = stripDtsComments(src);
    expect(out).toContain(`"a/*not-comment*/b"`);
    expect(out).toContain(`"http://x"`);
  });
});
