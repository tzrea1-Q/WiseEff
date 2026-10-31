import { describe, expect, it } from "vitest";
import { conflictingMembers, hasDuplicateMemberPaths, hasMemberPath, mergeSourceMembers } from "./sharedDtsiMembers";

describe("shared DTSI member paths", () => {
  it("detects NFC-equivalent paths and preserves existing identities and order when merging", () => {
    const existing = [{ id: "one", sourceName: "café.dtsi", content: "old" }, { id: "two", sourceName: "keep.h", content: "keep" }];
    const incoming = [{ sourceName: "cafe\u0301.dtsi", content: "new" }, { sourceName: "extra.hpp", content: "extra" }];
    expect(hasMemberPath(existing, "cafe\u0301.dtsi")).toBe(true);
    expect(hasMemberPath(existing, "café.dtsi", 0)).toBe(false);
    expect(hasDuplicateMemberPaths([...existing, incoming[0]!])).toBe(true);
    expect(conflictingMembers(existing, incoming)).toEqual([incoming[0]]);
    expect(mergeSourceMembers(existing, incoming)).toEqual([
      { id: "one", sourceName: "café.dtsi", content: "new" },
      { id: "two", sourceName: "keep.h", content: "keep" },
      { sourceName: "extra.hpp", content: "extra" },
    ]);
    expect(existing[0]!.content).toBe("old");
  });
});
