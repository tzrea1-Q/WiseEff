import { describe, expect, it } from "vitest";

import { parseRecoverCliArgs, runRecoverCutoverCli } from "./recover-parameter-catalog-cutover";

describe("recover-parameter-catalog-cutover CLI", () => {
  it("parses whole-state-restore arguments", () => {
    const args = parseRecoverCliArgs([
      "--run-id",
      "cutover_abc",
      "--action",
      "whole-state-restore",
      "--run-bound-token",
      "token",
    ]);
    expect(args.recordedAction).toBe("whole-state-restore");
    expect(args.runBoundToken).toBe("token");
  });

  it("refuses ad-hoc SQL recovery", async () => {
    const result = await runRecoverCutoverCli([
      "--run-id",
      "cutover_abc",
      "--action",
      "ad-hoc-sql",
      "--run-bound-token",
      "token",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-AD-HOC");
  });

  it("refuses activation phases on recover", async () => {
    const result = await runRecoverCutoverCli(["--phase", "P12", "--action", "whole-state-restore"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
  });
});
