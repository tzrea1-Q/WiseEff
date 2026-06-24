import { describe, expect, it, vi } from "vitest";

import type { AdbCommandRunner } from "@wiseeff/device-command-core/adbRunner";
import type { HdcCommandRunner } from "@wiseeff/device-command-core/hdcRunner";

import { probeTools } from "./toolProbe";

function makeRunner(
  results: Array<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut?: boolean }>
) {
  const runner = vi.fn(async () => {
    const result = results.shift();
    if (!result) {
      throw new Error("Unexpected command");
    }
    return result;
  });
  return runner as AdbCommandRunner & HdcCommandRunner;
}

describe("toolProbe", () => {
  it("reports adb and hdc availability with source metadata", async () => {
    const adbRunner = makeRunner([
      { code: 0, stdout: "Android Debug Bridge version 1.0.41\n", stderr: "", durationMs: 5 }
    ]);
    const hdcRunner = makeRunner([{ code: 1, stdout: "", stderr: "hdc not found", durationMs: 4 }]);

    const result = await probeTools({
      adbRunner,
      hdcRunner,
      adbSource: "managed",
      hdcSource: "system"
    });

    expect(result).toEqual({
      adb: {
        available: true,
        source: "managed",
        version: "Android Debug Bridge version 1.0.41"
      },
      hdc: {
        available: false,
        source: "system",
        reason: "hdc not found"
      }
    });
  });
});
