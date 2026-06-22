import { spawn } from "node:child_process";
import type {
  DebugDeviceGateway,
  GatewayNodeResult,
  GatewayReadInput,
  GatewayTarget,
  GatewayWriteInput,
  GatewayWriteResult
} from "./gateway";

export type AdbCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
};

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

function durationSince(startedAt: number) {
  return Math.max(1, Date.now() - startedAt);
}

function normalizeFailure(result: AdbCommandResult, timeoutMs: number) {
  if (result.timedOut) {
    return `ADB command timed out after ${timeoutMs}ms.`;
  }

  const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
  return `ADB command failed: ${reason}`;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nodeResultFromCommand(result: AdbCommandResult, timeoutMs: number, value?: string): GatewayNodeResult {
  if (result.timedOut || result.code !== 0) {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: result.stderr,
      error: normalizeFailure(result, timeoutMs),
      durationMs: result.durationMs
    };
  }

  const stdoutValue = value ?? result.stdout.trim();
  return {
    ok: true,
    value: stdoutValue,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs
  };
}

export function createDefaultAdbCommandRunner(): AdbCommandRunner {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const timeout = setTimeout(() => {
        settled = true;
        child.kill();
        resolve({
          code: null,
          stdout,
          stderr,
          timedOut: true,
          durationMs: durationSince(startedAt)
        });
      }, options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({
          code,
          stdout,
          stderr,
          durationMs: durationSince(startedAt)
        });
      });
    });
}

function parseAdbDevices(stdout: string, deviceId: string): GatewayTarget[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => line.split(/\s+/))
    .filter(([serial, state]) => Boolean(serial) && state === "device")
    .map(([serial]) => ({
      id: `adb:${serial}`,
      deviceId,
      protocol: "adb" as const,
      targetRef: serial,
      label: `ADB target ${serial}`,
      online: true
    }));
}

export function createAdbDebugDeviceGateway(options: AdbGatewayOptions = {}): DebugDeviceGateway {
  const command = options.command ?? "adb";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const runCommand = options.runCommand ?? createDefaultAdbCommandRunner();

  async function run(args: string[]) {
    try {
      return await runCommand(command, args, { timeoutMs });
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
    return nodeResultFromCommand(result, timeoutMs);
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
        `printf %s ${shellQuote(input.value)} > ${shellQuote(input.nodePath)}`
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

      if (readResult.value !== input.value) {
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
