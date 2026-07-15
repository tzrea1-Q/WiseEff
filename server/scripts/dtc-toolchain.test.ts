import { describe, expect, it } from "vitest";

import { probeDtc } from "../../scripts/check-dtc";
import { resolveDtcInstallCommand } from "../../scripts/bootstrap-dtc";
import { compileDtsSeedFiles } from "../../scripts/compile-dts-seed";
import { createStubDtcValidator } from "../modules/parameter-files/dtcValidator";

const oneSeedFile = [
  {
    projectId: "aurora" as const,
    fileName: "wiseeff-power-overlay.dts" as const,
    artifactFileName: "aurora-power-overlay.dts",
    source: "/dts-v1/; /plugin/; / { board_id = <1>; };"
  }
];

describe("dtc toolchain", () => {
  it("reports compiler version from a successful probe", () => {
    const result = probeDtc(() => ({ status: 0, stdout: "Version: DTC 1.7.2\n", stderr: "" }));

    expect(result).toEqual({ available: true, version: "Version: DTC 1.7.2", error: null });
  });

  it("reports an actionable unavailable result", () => {
    const result = probeDtc(() => ({ status: null, stdout: "", stderr: "spawn dtc ENOENT" }));

    expect(result).toEqual({ available: false, version: null, error: "spawn dtc ENOENT" });
  });

  it("selects Homebrew for macOS", () => {
    expect(
      resolveDtcInstallCommand({ platform: "darwin", osRelease: "", isRoot: false, hasSudo: false })
    ).toEqual({ command: "brew", args: ["install", "dtc"] });
  });

  it("selects the native package manager for common Linux distributions", () => {
    expect(
      resolveDtcInstallCommand({
        platform: "linux",
        osRelease: "ID=alpine\nID_LIKE=alpine\n",
        isRoot: true,
        hasSudo: false
      })
    ).toEqual({ command: "apk", args: ["add", "--no-cache", "dtc"] });
    expect(
      resolveDtcInstallCommand({
        platform: "linux",
        osRelease: "ID=ubuntu\nID_LIKE=debian\n",
        isRoot: false,
        hasSudo: true
      })
    ).toEqual({
      command: "sudo",
      args: ["sh", "-lc", "apt-get update && apt-get install -y device-tree-compiler"]
    });
    expect(
      resolveDtcInstallCommand({
        platform: "linux",
        osRelease: "ID=rhel\nID_LIKE=\"fedora centos\"\n",
        isRoot: true,
        hasSudo: false
      })
    ).toEqual({ command: "dnf", args: ["install", "-y", "dtc"] });
  });

  it("rejects unsupported hosts instead of pretending installation succeeded", () => {
    expect(() =>
      resolveDtcInstallCommand({ platform: "win32", osRelease: "", isRoot: false, hasSudo: false })
    ).toThrow("Automatic dtc installation is supported on macOS and Linux");
    expect(() =>
      resolveDtcInstallCommand({
        platform: "linux",
        osRelease: "ID=debian\n",
        isRoot: false,
        hasSudo: false
      })
    ).toThrow("root or sudo");
  });

  it("requires a real compiler for the seed gate", async () => {
    await expect(
      compileDtsSeedFiles(
        oneSeedFile,
        createStubDtcValidator(() => ({
          ok: false,
          mode: "block",
          compiler: "unavailable",
          diagnostics: [{ file: "<validation>", severity: "warning", message: "dtc unavailable" }]
        }))
      )
    ).rejects.toThrow("dtc unavailable");

    await expect(
      compileDtsSeedFiles(
        oneSeedFile,
        createStubDtcValidator(() => ({
          ok: true,
          mode: "block",
          compiler: "dtc",
          diagnostics: []
        }))
      )
    ).resolves.toMatchObject({ ok: true, compiler: "dtc" });
  });
});
