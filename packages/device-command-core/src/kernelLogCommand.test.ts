import { describe, expect, it } from "vitest";

import {
  isAllowedKernelLogCommand,
  KERNEL_LOG_CAPTURE_MAX_BYTES,
  KERNEL_LOG_COMMAND_ALLOWLIST,
  truncateKernelLogText
} from "./kernelLogCommand";

describe("kernelLogCommand allowlist", () => {
  it("accepts only exact allowlist entries", () => {
    for (const command of KERNEL_LOG_COMMAND_ALLOWLIST) {
      expect(isAllowedKernelLogCommand(command)).toBe(true);
    }
  });

  it("refuses prefix extensions, metacharacters, and unknown tools", () => {
    expect(isAllowedKernelLogCommand("dmesg -w")).toBe(false);
    expect(isAllowedKernelLogCommand("cat /proc/kmsg; rm -rf /")).toBe(false);
    expect(isAllowedKernelLogCommand("bash -c id")).toBe(false);
    expect(isAllowedKernelLogCommand("dmesg\n-T")).toBe(false);
    expect(isAllowedKernelLogCommand("")).toBe(false);
  });

  it("truncates captures at the documented byte cap", () => {
    const oversized = "a".repeat(KERNEL_LOG_CAPTURE_MAX_BYTES + 32);
    const result = truncateKernelLogText(oversized);
    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBe(KERNEL_LOG_CAPTURE_MAX_BYTES);
    expect(Buffer.byteLength(result.text, "utf8")).toBe(KERNEL_LOG_CAPTURE_MAX_BYTES);
  });
});
