import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePinnedDtcBinPaths } from "./ensure-pinned-dtc";

describe("resolvePinnedDtcBinPaths", () => {
  it("places dtc/fdtoverlay beside the project toolchain venv on Unix", () => {
    const rootDir = "/workspace/wiseeff";
    expect(resolvePinnedDtcBinPaths(rootDir, "darwin")).toEqual({
      binDir: join(rootDir, ".wiseeff-tools", "dts-toolchain", "bin"),
      dtc: join(rootDir, ".wiseeff-tools", "dts-toolchain", "bin", "dtc"),
      fdtoverlay: join(rootDir, ".wiseeff-tools", "dts-toolchain", "bin", "fdtoverlay"),
      sourceDir: join(rootDir, ".wiseeff-tools", "dtc-src")
    });
  });

  it("uses the Scripts directory on Windows", () => {
    const rootDir = "C:\\workspace\\wiseeff";
    const paths = resolvePinnedDtcBinPaths(rootDir, "win32");
    expect(paths.binDir).toBe(join(rootDir, ".wiseeff-tools", "dts-toolchain", "Scripts"));
    expect(paths.dtc).toBe(join(paths.binDir, "dtc.exe"));
    expect(paths.fdtoverlay).toBe(join(paths.binDir, "fdtoverlay.exe"));
  });
});
