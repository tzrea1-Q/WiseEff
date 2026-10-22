import { describe, expect, it } from "vitest";
import { hasSourceMergeConflicts, mergeSourceText } from "./sourceTextMerge";

describe("DTS three-way text merge", () => {
  it("combines independent replacements, insertion and deletion without changing exact line endings", () => {
    expect(mergeSourceText("\ufeffa\r\nb\r\nc\r\nd\r\n", "\ufeffa\r\nlocal\r\nc\r\nd\r\n", "\ufeffa\r\nb\r\nc\r\nremote\r\nd\r\n"))
      .toEqual({ text: "\ufeffa\r\nlocal\r\nc\r\nremote\r\nd\r\n", conflicts: false });
    expect(mergeSourceText("a\nb\nc", "b\nc", "a\nb\nC")).toEqual({ text: "b\nC", conflicts: false });
    expect(mergeSourceText("a\nb\n", "A\nb\n", "a\nB\n")).toEqual({ text: "A\nB\n", conflicts: false });
  });
  it("marks overlapping changes with local, original and latest contents while merging separate regions", () => {
    const merged = mergeSourceText("a\nb\nc\nd\n", "local\nb\nc\nD\n", "remote\nb\nC\nd\n");
    expect(merged.conflicts).toBe(true);
    expect(merged.text).toBe("<<<<<<< 本地草稿\nlocal\n||||||| 原始基线\na\n=======\nremote\n>>>>>>> 最新来源\nb\nC\nD\n");
    expect(hasSourceMergeConflicts(merged.text)).toBe(true);
    expect(hasSourceMergeConflicts("local\nb\nC\nD\n")).toBe(false);
  });
  it("deduplicates identical changes and conflicts on competing insertions and delete versus edit", () => {
    expect(mergeSourceText("a\nb", "A\nb", "A\nb")).toEqual({ text: "A\nb", conflicts: false });
    expect(mergeSourceText("a\n", "local\na\n", "remote\na\n").conflicts).toBe(true);
    expect(mergeSourceText("a\nb", "a\n", "a\nB").conflicts).toBe(true);
    expect(mergeSourceText("", "local", "remote").text).toContain("local\n||||||| 原始基线\n=======\nremote\n");
    expect(mergeSourceText("a\n", "a", "a\n")).toEqual({ text: "a", conflicts: false });
  });
});
