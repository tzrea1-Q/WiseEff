import type {
  DebugDeviceGateway,
  GatewayNodeResult,
  GatewayReadInput,
  GatewayTarget,
  GatewayWriteInput,
  GatewayWriteResult
} from "./gateway";
import {
  createAdbCommandRunner,
  createDefaultAdbCommandRunner as createCoreDefaultAdbCommandRunner,
  parseAdbDevices as parseCoreAdbDevices,
  type AdbCommandResult
} from "@wiseeff/device-command-core/adbRunner";
import {
  buildRemoteWriteShellCommand,
  normalizeRemoteReadValue,
  shellQuote
} from "@wiseeff/device-command-core/remoteNodeWrite";

export type { AdbCommandResult };

export type AdbCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number }
) => Promise<AdbCommandResult>;

type AdbGatewayOptions = {
  command?: string;
  timeoutMs?: number;
  runCommand?: AdbCommandRunner;
};

const defaultTimeoutMs = 5000;

function normalizeFailure(result: AdbCommandResult, timeoutMs: number) {
  if (result.timedOut) {
    return `ADB command timed out after ${timeoutMs}ms.`;
  }

  const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
  return `ADB command failed: ${reason}`;
}

function nodeResultFromCommand(
  result: AdbCommandResult,
  timeoutMs: number,
  value?: string,
  preserveExact = false
): GatewayNodeResult {
  if (result.timedOut || result.code !== 0) {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: result.stderr,
      error: normalizeFailure(result, timeoutMs),
      durationMs: result.durationMs
    };
  }

  const stdoutValue = value ?? normalizeRemoteReadValue(result.stdout, preserveExact);
  return {
    ok: true,
    value: stdoutValue,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  };
}

export function createDefaultAdbCommandRunner(): AdbCommandRunner {
  const run = createCoreDefaultAdbCommandRunner();
  return (command, args, options) => {
    const runner = command === "adb" ? run : createAdbCommandRunner({ command });
    return runner(args, options);
  };
}

function parseAdbDevices(stdout: string, deviceId: string): GatewayTarget[] {
  return parseCoreAdbDevices(stdout).map(({ targetRef }) => ({
    id: `adb:${targetRef}`,
    deviceId,
    protocol: "adb" as const,
    targetRef,
    label: `ADB target ${targetRef}`,
    online: true
  }));
}

export function createAdbDebugDeviceGateway(options: AdbGatewayOptions = {}): DebugDeviceGateway {
  const command = options.command ?? "adb";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const coreRunner = createAdbCommandRunner({ command });
  const runCommand = options.runCommand ?? createDefaultAdbCommandRunner();

  async function run(args: string[]) {
    try {
      if (options.runCommand) {
        return await runCommand(command, args, { timeoutMs });
      }
      return await coreRunner(args, { timeoutMs });
    } catch (error) {
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 1
      };
    }
  }

  async function readNodeValue(input: GatewayReadInput): Promise<GatewayNodeResult> {
    const result = await run([
      "-s",
      input.targetRef,
      "shell",
      `cat ${shellQuote(input.nodePath)}`
    ]);
    return nodeResultFromCommand(result, timeoutMs, undefined, input.preserveExactRead ?? false);
  }

  return {
    async detectTargets(input) {
      if (!input.deviceId?.trim()) {
        return {
          ok: false,
          targets: [],
          error: "ADB target detection requires deviceId so detected targets can be persisted against a known debugging device."
        };
      }

      const result = await run(["devices"]);

      if (result.timedOut || result.code !== 0) {
        return {
          ok: false,
          targets: [],
          error: normalizeFailure(result, timeoutMs)
        };
      }

      return {
        ok: true,
        targets: parseAdbDevices(result.stdout, input.deviceId)
      };
    },

    readNode(input) {
      return readNodeValue(input);
    },

    async writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult> {
      const writeCommand = await run([
        "-s",
        input.targetRef,
        "shell",
        buildRemoteWriteShellCommand(input.nodePath, input.value)
      ]);
      const writeResult = nodeResultFromCommand(writeCommand, timeoutMs, input.value);

      if (!writeResult.ok) {
        return {
          ok: false,
          verified: false,
          error: writeResult.error,
          writeResult
        };
      }

      if (!input.readBack) {
        return {
          ok: true,
          value: input.value,
          verified: true,
          writeResult
        };
      }

      const readResult = await readNodeValue(input);

      if (!readResult.ok) {
        return {
          ok: false,
          value: input.value,
          verified: false,
          error: readResult.error,
          writeResult,
          readResult
        };
      }

      const readbackMatches = input.compareReadback
        ? input.compareReadback(input.value, readResult.value ?? "")
        : readResult.value === input.value;

      if (!readbackMatches) {
        return {
          ok: false,
          value: input.value,
          verified: false,
          error: "Read-back mismatch after ADB write.",
          writeResult,
          readResult
        };
      }

      return {
        ok: true,
        value: input.value,
        verified: true,
        writeResult,
        readResult
      };
    }
  };
}
