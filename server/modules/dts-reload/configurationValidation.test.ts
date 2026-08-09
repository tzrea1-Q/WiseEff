import { describe, expect, it } from "vitest";

import {
  KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES,
  SEEDED_RELOAD_CONFIGURATION
} from "./configurationTypes";
import {
  assertReloadConfigurationContract,
  isAbsoluteUnixPath,
  isAllowedKernelLogCommand,
  isValidDestinationFilename,
  parseReloadConfigurationContract
} from "./configurationValidation";
import { ApiError } from "../../shared/http/errors";

describe("reload configuration validation", () => {
  it("accepts the seeded defaults", () => {
    expect(parseReloadConfigurationContract(SEEDED_RELOAD_CONFIGURATION)).toEqual(SEEDED_RELOAD_CONFIGURATION);
  });

  it("requires absolute paths for destination directory and trigger node path", () => {
    expect(isAbsoluteUnixPath("/vendor/firmware/")).toBe(true);
    expect(isAbsoluteUnixPath("/sys/kernel/debug/power_debug/dts_overlay/trigger")).toBe(true);
    expect(isAbsoluteUnixPath("vendor/firmware/")).toBe(false);
    expect(isAbsoluteUnixPath("/vendor/../etc/")).toBe(false);
    expect(isAbsoluteUnixPath("")).toBe(false);

    expect(() =>
      assertReloadConfigurationContract({
        ...SEEDED_RELOAD_CONFIGURATION,
        destinationDirectory: "vendor/firmware/"
      })
    ).toThrow(ApiError);

    expect(() =>
      assertReloadConfigurationContract({
        ...SEEDED_RELOAD_CONFIGURATION,
        triggerNodePath: "sys/kernel/debug/trigger"
      })
    ).toThrow(/absolute/i);
  });

  it("requires a basename-only destination filename", () => {
    expect(isValidDestinationFilename("power_dts_overlay.dtbo")).toBe(true);
    expect(isValidDestinationFilename("../evil.dtbo")).toBe(false);
    expect(isValidDestinationFilename("/vendor/firmware/power_dts_overlay.dtbo")).toBe(false);
    expect(isValidDestinationFilename("")).toBe(false);

    expect(() =>
      assertReloadConfigurationContract({
        ...SEEDED_RELOAD_CONFIGURATION,
        destinationFilename: "/tmp/x.dtbo"
      })
    ).toThrow(/filename/i);
  });

  it("rejects kernel log commands outside the allowlist of recognised log sources", () => {
    for (const prefix of KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES) {
      expect(isAllowedKernelLogCommand(prefix)).toBe(true);
    }
    expect(isAllowedKernelLogCommand("dmesg -T")).toBe(true);
    expect(isAllowedKernelLogCommand("hilog -x")).toBe(true);
    expect(isAllowedKernelLogCommand("cat /proc/kmsg")).toBe(true);

    expect(isAllowedKernelLogCommand("rm -rf /")).toBe(false);
    expect(isAllowedKernelLogCommand("bash -c dmesg")).toBe(false);
    expect(isAllowedKernelLogCommand("dmesg; reboot")).toBe(false);
    expect(isAllowedKernelLogCommand("cat /etc/passwd")).toBe(false);

    expect(() =>
      assertReloadConfigurationContract({
        ...SEEDED_RELOAD_CONFIGURATION,
        kernelLogCommand: "curl http://evil"
      })
    ).toThrow(/allowlist|kernel log/i);
  });

  it("requires a non-empty trigger payload", () => {
    expect(() =>
      assertReloadConfigurationContract({
        ...SEEDED_RELOAD_CONFIGURATION,
        triggerPayload: "   "
      })
    ).toThrow(/payload/i);
  });
});
