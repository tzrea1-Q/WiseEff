import { spawn } from "node:child_process";
import type {
  DebugDeviceGateway,
  GatewayNodeResult,
  GatewayReadInput,
  GatewayTarget,
  GatewayWriteInput,
  GatewayWriteResult
} from "./gateway";

export type HdcCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
};

export type HdcCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number }
) => Promise<HdcCommandResult>;

type HdcGatewayOptions = {
  command?: string;
  timeoutMs?: number;
  runCommand?: HdcCommandRunner;
};

const defaultTimeoutMs = 5000;

function durationSince(startedAt: number) {
  return Math.max(1, Date.now() - startedAt);
}

function normalizeFailure(result: HdcCommandResult, timeoutMs: number) {
  if (result.timedOut) {
    return `HDC command timed out after ${timeoutMs}ms.`;
  }

  const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
  return `HDC command failed: ${reason}`;
}

function nodeResultFromCommand(result: HdcCommandResult, timeoutMs: number, value?: string): GatewayNodeResult {
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

export function createDefaultHdcCommandRunner(): HdcCommandRunner {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(command, args, { shell: false, windowsHide: true });
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

function targetFromLine(line: string, deviceId: string): GatewayTarget {
  return {
    id: line,
    deviceId,
    targetRef: line,
    label: `HDC target ${line}`,
    online: true
  };
}

export function createHdcDebugDeviceGateway(options: HdcGatewayOptions = {}): DebugDeviceGateway {
  const command = options.command ?? "hdc";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const runCommand = options.runCommand ?? createDefaultHdcCommandRunner();

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
      "-t",
      input.targetRef,
      "shell",
      "sh",
      "-c",
      "cat \"$1\"",
      "wiseeff-read-node",
      input.nodePath
    ]);

    return nodeResultFromCommand(result, timeoutMs);
  }

  return {
    async detectTargets(input) {
      if (!input.deviceId?.trim()) {
        return {
          ok: false,
          targets: [],
          error: "HDC target detection requires deviceId so detected targets can be persisted against a known debugging device."
        };
      }

      const result = await run(["list", "targets"]);

      if (result.timedOut || result.code !== 0) {
        return {
          ok: false,
          targets: [],
          error: normalizeFailure(result, timeoutMs)
        };
      }

      return {
        ok: true,
        targets: result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => targetFromLine(line, input.deviceId!))
      };
    },

    readNode(input) {
      return readNodeValue(input);
    },

    async writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult> {
      const writeCommand = await run([
        "-t",
        input.targetRef,
        "shell",
        "sh",
        "-c",
        "printf '%s' \"$1\" > \"$2\"",
        "wiseeff-write-node",
        input.value,
        input.nodePath
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
          error: "Read-back mismatch after HDC write.",
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
