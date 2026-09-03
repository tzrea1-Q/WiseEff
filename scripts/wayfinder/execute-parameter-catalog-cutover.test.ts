import { describe, expect, it } from "vitest";

import { parseExecuteCliArgs, runExecuteCutoverCli } from "./execute-parameter-catalog-cutover";

describe("execute-parameter-catalog-cutover CLI", () => {
  it("parses execute-or-resume arguments", () => {
    const args = parseExecuteCliArgs([
      "--database-url",
      "postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_705",
      "--graph",
      "graph.json",
      "--release-json",
      "release.json",
      "--fail-before-phase",
      "P7",
    ]);
    expect(args.databaseUrl).toContain("wiseeff_lane_705");
    expect(args.failBeforePhase).toBe("P7");
  });

  it("refuses activation P12-P15 on execute", async () => {
    const result = await runExecuteCutoverCli(["--phase", "P14"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
  });

  it("refuses unknown fail-before-phase", async () => {
    const result = await runExecuteCutoverCli(["--fail-before-phase", "P99"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-UNKNOWN-PHASE");
  });
});
