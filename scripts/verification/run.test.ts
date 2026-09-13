import { describe, expect, it } from "vitest";

import { parseRunArgs, renderTerminal, TASK_IDS, type TerminalResult } from "./run";

describe("fresh local verification runner", () => {
  it("accepts exactly one fixed task and a full base SHA", () => {
    expect(parseRunArgs(["--base", "a".repeat(40), "--task", TASK_IDS[0]])).toEqual({
      base: "a".repeat(40),
      task: "ci-changed-paths",
      force: false,
    });
    expect(() => parseRunArgs(["--base", "a".repeat(40), "--task", "unknown"])).toThrow("INVALID_ARGUMENTS");
    expect(() => parseRunArgs(["--base", "a".repeat(40), "--task", TASK_IDS[0], "--reuse"])).toThrow("INVALID_ARGUMENTS");
  });

  it("renders only bounded registered terminal fields", () => {
    const result: TerminalResult = {
      version: 1,
      scope: "fresh-local-feedback",
      runId: "00000000-0000-4000-8000-000000000000",
      taskId: "ci-changed-paths",
      status: "passed",
      error: null,
      sourceSha: "a".repeat(40),
      tree: "b".repeat(40),
      sourceDigest: "c".repeat(64),
      nativeFiles: 1,
      nativePassed: 8,
      nativeSkipped: 0,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      wallMs: 1,
      exitCode: 0,
      signal: null,
      memo: "disabled",
      acceptancePending: true,
      tokenUsage: null,
    };
    const output = JSON.parse(renderTerminal(result));
    expect(output).toEqual(result);
    expect(output).not.toHaveProperty("stdout");
    expect(Buffer.byteLength(renderTerminal(result))).toBeLessThanOrEqual(4 * 1024);
  });
});
