import { describe, expect, it } from "vitest";

import {
  isAllowedKernelLogCommand,
  isStreamingKernelLogCommand,
  KERNEL_LOG_CAPTURE_MAX_BYTES,
  KERNEL_LOG_COMMAND_ALLOWLIST,
  kernelLogTruncationKeep,
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

  it("keeps the tail when asked so newest dmesg lines survive truncation", () => {
    const oldNoise = "boot noise\n".repeat(40_000);
    const evidence = "overlay reload applied for wireless\n";
    const result = truncateKernelLogText(oldNoise + evidence, KERNEL_LOG_CAPTURE_MAX_BYTES, "tail");
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith(evidence)).toBe(true);
    expect(result.byteLength).toBeLessThanOrEqual(KERNEL_LOG_CAPTURE_MAX_BYTES);
  });

  it("does not split multi-byte characters at the tail-keep boundary", () => {
    const text = "汉".repeat(20) + "end";
    const result = truncateKernelLogText(text, 16, "tail");
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith("end")).toBe(true);
    expect(result.text).not.toContain("\uFFFD");
    expect(result.byteLength).toBeLessThanOrEqual(16);
  });

  it("maps buffer dumps to tail-keep and streaming commands to head-keep", () => {
    expect(kernelLogTruncationKeep("dmesg")).toBe("tail");
    expect(kernelLogTruncationKeep("dmesg -T")).toBe("tail");
    expect(kernelLogTruncationKeep("hilog -x")).toBe("tail");
    expect(kernelLogTruncationKeep("hilog")).toBe("head");
    expect(kernelLogTruncationKeep("cat /proc/kmsg")).toBe("head");
    expect(isStreamingKernelLogCommand("hilog")).toBe(true);
    expect(isStreamingKernelLogCommand("dmesg")).toBe(false);
  });
});
