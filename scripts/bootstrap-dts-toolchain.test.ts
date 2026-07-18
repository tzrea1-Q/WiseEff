import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDtsToolchainVenvPaths } from "./bootstrap-dts-toolchain";

describe("resolveDtsToolchainVenvPaths", () => {
  it("uses the repository-local ignored venv on Unix", () => {
    const rootDir = "/workspace/wiseeff";
    expect(resolveDtsToolchainVenvPaths(rootDir, "darwin")).toEqual({
      venvDir: join(rootDir, ".wiseeff-tools", "dts-toolchain"),
      python: join(rootDir, ".wiseeff-tools", "dts-toolchain", "bin", "python"),
      dtValidate: join(rootDir, ".wiseeff-tools", "dts-toolchain", "bin", "dt-validate")
    });
  });

  it("uses the venv Scripts directory on Windows", () => {
    const rootDir = "C:\\workspace\\wiseeff";
    const paths = resolveDtsToolchainVenvPaths(rootDir, "win32");
    expect(paths.venvDir).toBe(join(rootDir, ".wiseeff-tools", "dts-toolchain"));
    expect(paths.python).toBe(join(paths.venvDir, "Scripts", "python.exe"));
    expect(paths.dtValidate).toBe(join(paths.venvDir, "Scripts", "dt-validate.exe"));
  });
});
