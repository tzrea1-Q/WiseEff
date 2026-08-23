import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type ProcessStartIdentity = {
  startToken: string;
  commandSha256: string;
};

/**
 * Reads a non-secret OS process incarnation. PID alone is never ownership:
 * both the kernel start token and exact command digest must remain unchanged.
 */
export function readProcessStartIdentity(pid: number): ProcessStartIdentity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      const fields = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/u) : [];
      const startTicks = fields[19];
      const command = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replace(/\0/g, "\n");
      if (!startTicks || !command) return undefined;
      return {
        startToken: `linux-start-ticks:${startTicks}`,
        commandSha256: createHash("sha256").update(command).digest("hex"),
      };
    } catch {
      return undefined;
    }
  }
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    const match = output.match(/^(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+([\s\S]+)$/u);
    if (!match?.[1] || !match[2]) return undefined;
    return {
      startToken: `${process.platform}-lstart:${match[1]}`,
      commandSha256: createHash("sha256").update(match[2]).digest("hex"),
    };
  } catch {
    return undefined;
  }
}

export function sameProcessStartIdentity(
  expected: ProcessStartIdentity,
  current: ProcessStartIdentity | undefined,
) {
  return current !== undefined &&
    current.startToken === expected.startToken &&
    current.commandSha256 === expected.commandSha256;
}
