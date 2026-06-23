import { describe, expect, it, vi } from "vitest";
import { createHdcCommandRunner, parseHdcTargets } from "./hdcRunner";

describe("device-command-core hdc", () => {
  it("parses hdc list targets output", () => {
    expect(parseHdcTargets("\nAURORA-001\n  lab target 2  \n\n")).toEqual([
      { targetRef: "AURORA-001", online: true },
      { targetRef: "lab target 2", online: true }
    ]);
  });

  it("runs hdc with argv arrays", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: { setEncoding: vi.fn(), on: vi.fn() },
      stderr: { setEncoding: vi.fn(), on: vi.fn() },
      on: vi.fn((event, cb) => event === "close" && cb(0))
    });
    const run = createHdcCommandRunner({ spawnImpl: spawn as never, command: "hdc" });
    await run(["list", "targets"], { timeoutMs: 1000 });
    expect(spawn).toHaveBeenCalledWith("hdc", ["list", "targets"], expect.objectContaining({ windowsHide: true }));
  });
});
