import { describe, expect, it, vi } from "vitest";
import { RE2JS } from "re2js";
import { compileFileGlob, compileSkillFiles, matchSkillFile, type SkillFileGlob } from "../../../src/domain/logs/fileApplicability";
import { FILE_PREVIEW_LIMITS, previewSkillFiles } from "./skillFilePreview";
import { logSkillSpecSchema } from "./skillSpec";
import { compileFileGlob as compileLegacyFileGlob } from "./adminPattern";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { parseLogText } from "./parser";

describe("client, server preview and worker file assignment", () => {
  const cases: Array<[SkillFileGlob[] | undefined, string, boolean, string | null]> = [
    [undefined, "misc/notes.txt", true, null], [[], "a.log", true, null],
    [[{ glob: "charger/**", role: "充电" }], "charger/charger.log", true, "充电"],
    [[{ glob: "charger/**", role: "充电" }], "kernel/dmesg.log", false, null],
    [[{ glob: "charger/**" }], "Charger/a.log", false, null],
    [[{ glob: "*.log" }], "nested/a.log", false, null],
    [[{ glob: "**/*.log" }], "a.log", true, null],
    [[{ glob: "**/*.log" }], "a/b/c.log", true, null],
    [[{ glob: "kernel/dmesg?.[lt][ox][gt]", role: "内核" }], "kernel/dmesg1.log", true, "内核"],
    [[{ glob: "file[0-9].log" }], "file5.log", true, null],
    [[{ glob: "file[!0-9].log" }], "filex.log", true, null],
    [[{ glob: "file[^0-9].log" }], "file5.log", false, null],
    [[{ glob: "[!a]" }], "/", false, null],
    [[{ glob: "**", role: "  主日志  " }, { glob: "charger/**", role: "充电" }], "charger/a.log", true, "主日志"],
    [[{ glob: "**" }, { glob: "**", role: "ignored" }], "a.log", true, null],
    [[{ glob: "a(1)+{b}.log", role: "配置" }], "a(1)+{b}.log", true, "配置"],
    [[{ glob: "**/.hidden*" }], ".hidden.log", true, null]
  ];
  it.each(cases)("assigns %j to %s consistently", (files, path, skillMatched, role) => {
    const expected = { skillMatched, role };
    expect(matchSkillFile(files, path)).toEqual(expected);
    expect(compileSkillFiles(files)(path)).toEqual(expected);
    expect(previewSkillFiles(files, [path])).toEqual({ valid: true, issues: [], files: [{ path, ...expected }] });
  });
  it.each(["", "/absolute.log", "../a.log", "a/../b", "a/./b", "a//b", "C:/a.log", "a\\b", "a\n.log", "[", "[]", "[z-a]", "a/"])(
    "rejects unstable or malformed glob at a stable field path: %s", (glob) => {
      const result = previewSkillFiles([{ glob }], ["a.log"]);
      expect(result).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ path: ["files", 0, "glob"] })]) });
    }
  );
  it("caps count, glob length and single-line role labels", () => {
    for (const files of [Array.from({ length: 101 }, () => ({ glob: "**" })), [{ glob: "a".repeat(257) }],
      [{ glob: "**", role: "r".repeat(41) }], [{ glob: "**", role: "a\nb" }]]) {
      expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files }).success).toBe(false);
    }
    expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files: [{ glob: "a".repeat(256), role: "r".repeat(40) }] }).success).toBe(true);
  });
  it("rejects the entire oversized input before compiling even the first glob", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      for (const files of [Array.from({ length: 101 }, () => ({ glob: "**" })),
        [{ glob: "**" }, { glob: "x".repeat(257) }], [{ glob: "**" }, { glob: "**", role: "x".repeat(41) }]]) {
        expect(previewSkillFiles(files, ["a.log"]).valid).toBe(false);
        expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files }).success).toBe(false);
      }
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });
  it("rejects excessive sample paths before compiling", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      expect(previewSkillFiles([{ glob: "**" }], Array(FILE_PREVIEW_LIMITS.paths + 1).fill("a.log")))
        .toMatchObject({ valid: false, issues: [{ path: ["sample", "files"] }], files: [] });
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });
  it("interrupts work within a glob at the preview deadline", () => {
    const compile = vi.spyOn(RE2JS, "compile").mockImplementation(() => {
      const started = performance.now();
      while (performance.now() - started < 100) { /* Simulate unexpectedly costly compilation. */ }
      throw new Error("Compilation was not interrupted");
    });
    try {
      expect(previewSkillFiles([{ glob: "**" }], ["a.log"], { maxMs: 10 }))
        .toMatchObject({ valid: false, issues: [{ path: ["files"], message: expect.stringContaining("deadline") }], files: [] });
      expect(compile).toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });
  it("bounds wildcard execution without backtracking", () => {
    const started = performance.now();
    expect(compileFileGlob("*a".repeat(100) + "b").test("a".repeat(4000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("shares bounded compiled programs and charges file globs to the whole skill budget", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      compileSkillFiles([{ glob: "**", role: "first" }, { glob: "**", role: "second" }]);
      expect(compile).toHaveBeenCalledTimes(1);
      compile.mockClear();
      const result = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1",
        files: Array.from({ length: 100 }, () => ({ glob: "a".repeat(256) })),
        formatProfile: { severityMap: { error: Array(5).fill(`(?:${"a".repeat(100)}){100}`) } } });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]).toMatchObject({
        path: ["formatProfile", "severityMap", "error", 3], message: expect.stringContaining("Total pattern")
      });
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });
  it("preserves literal brackets in immutable parsing/v1 extractor globs", () => {
    expect(compileLegacyFileGlob("capture[1].log").test("capture[1].log")).toBe(true);
    expect(compileLegacyFileGlob("capture[1].log").test("capture1.log")).toBe(false);
    expect(compileLegacyFileGlob("capture[.log").test("capture[.log")).toBe(true);
  });
  it("uses the generic no-hit report when no analyzable file matches", async () => {
    const parsed = parseLogText({ fileName: "quiet.log", content: "INFO ready" });
    if (!parsed.ok) throw new Error(parsed.reason);
    const result = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: { ...genericSignalRuleSet,
      noHit: { ...genericSignalRuleSet.noHit, conclusion: "Skill-only conclusion" } },
      files: [{ path: "quiet.log", role: null, skillMatched: false, sizeBytes: 10, lineCount: 1, encoding: "utf-8", lossy: false,
        status: "analyzed", skipReason: null, parsed }] });
    expect(result.conclusion).toBe(genericSignalRuleSet.noHit.conclusion);
  });
});
