import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  GATE0_OWNER_TIMEOUT_MS,
  buildGate0Commands,
  evaluateGate0Outcome,
  gate0PhaseArtifactSources,
  runGate0PhaseCommand,
} from "./run-acceptance-gate0";

describe("acceptance Gate 0 runner", () => {
  it("owns a hard 60 minute deadline so timeout cleanup runs before the CI job is killed", () => {
    expect(GATE0_OWNER_TIMEOUT_MS).toBe(60 * 60 * 1_000);
  });

  it("terminates the exact phase process when the owner deadline elapses", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-gate0-timeout-"));
    const pidFile = path.join(root, "pid");
    const result = await runGate0PhaseCommand(
      {
        phase: "visual",
        command: process.execPath,
        args: [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`,
        ],
        env: {},
      },
      {},
      path.join(root, "phase.log"),
      500,
      50,
    );
    const pid = Number(readFileSync(pidFile, "utf8"));

    expect(result).toMatchObject({ timedOut: true });
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("passes one descriptor to visual and full browser while disabling reuse and quality reseed", () => {
    const commands = buildGate0Commands("/tmp/owned-full/runtime.json");

    expect(commands).toEqual([
      expect.objectContaining({
        phase: "visual",
        args: ["run", "acceptance:visual"],
        env: expect.objectContaining({
          WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned-full/runtime.json",
          WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
          WISEEFF_QUALITY_SKIP_SEED: "true",
        }),
      }),
      expect.objectContaining({
        phase: "browser",
        args: [
          "run",
          "acceptance:browser",
          "--",
          "--mode",
          "local-non-hdc",
          "--runtime-descriptor",
          "/tmp/owned-full/runtime.json",
        ],
        env: expect.objectContaining({
          WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned-full/runtime.json",
          WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
          WISEEFF_QUALITY_SKIP_SEED: "true",
        }),
      }),
    ]);
  });

  it("archives browser preflight outside the Playwright-cleaned output directory", () => {
    expect(gate0PhaseArtifactSources("browser")).toMatchObject({
      preflight: expect.stringMatching(/test-results\/acceptance-preflight$/u),
    });
  });

  it("allows exact cleanup only after both phases and the inventory pass", () => {
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: true, failureCount: 0 })).toBe("success");
    expect(evaluateGate0Outcome({ visualPassed: false, browserPassed: true, failureCount: 1 })).toBe("failure");
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: false, failureCount: 1 })).toBe("failure");
    expect(evaluateGate0Outcome({ visualPassed: true, browserPassed: true, failureCount: 1 })).toBe("failure");
  });
});
