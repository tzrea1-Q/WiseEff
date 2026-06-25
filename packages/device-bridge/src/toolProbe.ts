import type { AdbCommandRunner } from "@wiseeff/device-command-core/adbRunner";
import type { HdcCommandRunner } from "@wiseeff/device-command-core/hdcRunner";

export type ToolProbeState = {
  available: boolean;
  source?: "managed" | "system";
  version?: string;
  reason?: string;
};

export type ToolProbeResult = {
  adb: ToolProbeState;
  hdc: ToolProbeState;
};

type DebugProtocol = "adb" | "hdc";

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Tool probe failed.";
}

function protocolLabel(protocol: DebugProtocol) {
  return protocol === "adb" ? "ADB" : "HDC";
}

function commandFailureMessage(protocol: DebugProtocol, result: { code: number | null; stderr: string; timedOut?: boolean }) {
  if (result.timedOut) {
    return `${protocolLabel(protocol)} command timed out.`;
  }
  return result.stderr.trim() || `${protocolLabel(protocol)} exited with ${String(result.code)}.`;
}

function extractVersion(stdout: string) {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? undefined;
}

async function probeProtocolAvailability(
  runner: AdbCommandRunner | HdcCommandRunner,
  protocol: DebugProtocol,
  timeoutMs: number,
  source?: "managed" | "system"
): Promise<ToolProbeState> {
  try {
    const result = await runner(["version"], { timeoutMs });
    if (result.code === 0 && !result.timedOut) {
      return {
        available: true,
        source,
        version: extractVersion(result.stdout)
      };
    }
    return {
      available: false,
      source,
      reason: commandFailureMessage(protocol, result)
    };
  } catch (error) {
    return {
      available: false,
      source,
      reason: toErrorMessage(error)
    };
  }
}

export async function probeTools(input: {
  adbRunner: AdbCommandRunner;
  hdcRunner: HdcCommandRunner;
  adbSource?: "managed" | "system";
  hdcSource?: "managed" | "system";
  timeoutMs?: number;
}): Promise<ToolProbeResult> {
  const timeoutMs = input.timeoutMs ?? 2_000;
  const [adb, hdc] = await Promise.all([
    probeProtocolAvailability(input.adbRunner, "adb", timeoutMs, input.adbSource),
    probeProtocolAvailability(input.hdcRunner, "hdc", timeoutMs, input.hdcSource)
  ]);
  return { adb, hdc };
}

export { probeProtocolAvailability, commandFailureMessage, extractVersion, toErrorMessage };
