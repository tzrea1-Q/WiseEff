import { describe, expect, it } from "vitest";
import { isValidMergeLink } from "./mergeLink";

describe("isValidMergeLink", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isValidMergeLink("https://example.com/mr/1")).toBe(true);
    expect(isValidMergeLink(" http://gerrit.example/c/123 ")).toBe(true);
  });

  it("rejects empty, relative, or non-http schemes", () => {
    expect(isValidMergeLink("")).toBe(false);
    expect(isValidMergeLink("   ")).toBe(false);
    expect(isValidMergeLink("not a url")).toBe(false);
    expect(isValidMergeLink("/relative/path")).toBe(false);
    expect(isValidMergeLink("ftp://example.com/file")).toBe(false);
    expect(isValidMergeLink("javascript:alert(1)")).toBe(false);
  });
});
