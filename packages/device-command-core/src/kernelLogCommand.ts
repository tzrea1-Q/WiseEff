/**
 * Closed allowlist of exact kernel log commands that may be saved or executed.
 * Prefix matching is intentionally rejected: trailing arguments after `cat /proc/kmsg`,
 * embedded newlines, and shell metacharacters must not be smuggled into a privileged
 * execution channel. Server save validation and bridge re-validation must both use this list.
 */
export const KERNEL_LOG_COMMAND_ALLOWLIST = [
  "dmesg",
  "dmesg -T",
  "hilog",
  "hilog -x",
  "cat /proc/kmsg"
] as const;

export type KernelLogCommand = (typeof KERNEL_LOG_COMMAND_ALLOWLIST)[number];

/** Tool families shown in admin copy; prefer KERNEL_LOG_COMMAND_ALLOWLIST for validation. */
export const KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES = ["dmesg", "hilog", "cat /proc/kmsg"] as const;

/** Soft cap on bridge `debug.readKernelLog` stdout returned to the server (256 KiB). */
export const KERNEL_LOG_CAPTURE_MAX_BYTES = 256 * 1024;

/**
 * Commands that stream indefinitely instead of dumping the buffer and exiting.
 * They run until the capture timeout and return whatever was emitted so far.
 */
export const KERNEL_LOG_STREAMING_COMMANDS = ["hilog", "cat /proc/kmsg"] as const;

export function isStreamingKernelLogCommand(command: string): boolean {
  return (KERNEL_LOG_STREAMING_COMMANDS as readonly string[]).includes(command.trim());
}

/**
 * Which side of an oversized capture to keep.
 * Buffer dumps (`dmesg`, `hilog -x`) print oldest-first, so the reload evidence is at the tail.
 * Streaming reads start at trigger time, so the evidence is at the head.
 */
export function kernelLogTruncationKeep(command: string): "head" | "tail" {
  return isStreamingKernelLogCommand(command) ? "head" : "tail";
}

const DISALLOWED_KERNEL_LOG_CHARS = /[\u0000-\u001f\u007f;&|`$<>(){}[\]\\]/;

/**
 * Exact membership check shared by server configuration save and bridge execution.
 * Newlines, control characters, and shell metacharacters are rejected before the membership check.
 */
export function isAllowedKernelLogCommand(value: string): boolean {
  if (typeof value !== "string") return false;
  if (DISALLOWED_KERNEL_LOG_CHARS.test(value)) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (KERNEL_LOG_COMMAND_ALLOWLIST as readonly string[]).includes(trimmed);
}

/**
 * Truncate UTF-8 text to at most `maxBytes` without splitting a multi-byte character when possible.
 * `keep` selects which side survives: "head" keeps the earliest bytes, "tail" the latest.
 */
export function truncateKernelLogText(
  text: string,
  maxBytes: number = KERNEL_LOG_CAPTURE_MAX_BYTES,
  keep: "head" | "tail" = "head"
): {
  text: string;
  truncated: boolean;
  byteLength: number;
} {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) {
    return { text, truncated: false, byteLength: encoded.length };
  }
  if (keep === "tail") {
    let start = encoded.length - maxBytes;
    while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) {
      start += 1;
    }
    const sliced = encoded.subarray(start).toString("utf8");
    return { text: sliced, truncated: true, byteLength: Buffer.byteLength(sliced, "utf8") };
  }
  let end = maxBytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  const sliced = encoded.subarray(0, end).toString("utf8");
  return { text: sliced, truncated: true, byteLength: Buffer.byteLength(sliced, "utf8") };
}
