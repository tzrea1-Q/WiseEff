import { describe, expect, it, vi } from "vitest";
import { createAdbCommandRunner, parseAdbDevices } from "./adbRunner";

describe("device-command-core adb", () => {
  it("parses adb devices output", () => {
    expect(parseAdbDevices("List of devices attached\nemulator-5554\tdevice\n")).toEqual([
      { targetRef: "emulator-5554", online: true }
    ]);
  });

  it("runs adb with argv arrays", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: { setEncoding: vi.fn(), on: vi.fn() },
      stderr: { setEncoding: vi.fn(), on: vi.fn() },
      on: vi.fn((event, cb) => event === "close" && cb(0))
    });
    const run = createAdbCommandRunner({ spawnImpl: spawn as never, command: "adb" });
    await run(["devices"], { timeoutMs: 1000 });
    expect(spawn).toHaveBeenCalledWith("adb", ["devices"], expect.objectContaining({ windowsHide: true }));
  });
});
