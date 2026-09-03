import { describe, expect, it } from "vitest";

import { parseInspectCliArgs, runInspectCutoverCli } from "./inspect-parameter-catalog-cutover";

describe("inspect-parameter-catalog-cutover CLI", () => {
  it("parses run id inspection", () => {
    const args = parseInspectCliArgs(["--run-id", "cutover_abc", "--plan-digest", "sha256:plan"]);
    expect(args.runId).toBe("cutover_abc");
    expect(args.planDigest).toBe("sha256:plan");
  });

  it("refuses activation phases on inspect", async () => {
    const result = await runInspectCutoverCli(["--phase", "P15"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
  });
});
