import {
  buildRemoteWriteShellCommand,
  normalizeRemoteReadValue,
  shellQuote
} from "@wiseeff/device-command-core/remoteNodeWrite";
import {
  createDefaultAdbCommandRunner,
  parseAdbDevices,
  type AdbCommandRunner
} from "@wiseeff/device-command-core/adbRunner";
import {
  createDefaultHdcCommandRunner,
  parseHdcTargets,
  type HdcCommandRunner
} from "@wiseeff/device-command-core/hdcRunner";

import { probeTools } from "./toolProbe";

type RpcMethod = "bridge.getCapabilities" | "debug.detectTargets" | "debug.readNode" | "debug.writeNode";

type RpcMethodResult = Record<string, unknown>;

type DebugProtocol = "adb" | "hdc";

export class RpcRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type BridgeRpcHandlers = ReturnType<typeof createRpcHandlers>;

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readRequiredString(value: unknown, key: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new RpcRequestError("BAD_REQUEST", `Expected non-empty string for "${key}".`);
  }
  return text;
}

function requireSupportedProtocol(value: unknown): DebugProtocol {
  const protocol = readRequiredString(value, "protocol");
  if (protocol !== "adb" && protocol !== "hdc") {
    throw new RpcRequestError("UNSUPPORTED_PROTOCOL", `Protocol "${protocol}" is not supported.`);
  }
  return protocol;
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

export function createRpcHandlers(options: {
  adbRunner?: AdbCommandRunner;
  hdcRunner?: HdcCommandRunner;
  adbCommand?: string;
  hdcCommand?: string;
  adbSource?: "managed" | "system";
  hdcSource?: "managed" | "system";
  adbTimeoutMs?: number;
  hdcTimeoutMs?: number;
  capabilityProbeTimeoutMs?: number;
} = {}) {
  const adbCommand = options.adbCommand ?? "adb";
  const hdcCommand = options.hdcCommand ?? "hdc";
  const adbRunner = options.adbRunner ?? createDefaultAdbCommandRunner(adbCommand);
  const hdcRunner = options.hdcRunner ?? createDefaultHdcCommandRunner(hdcCommand);
  const adbTimeoutMs = options.adbTimeoutMs ?? 5_000;
  const hdcTimeoutMs = options.hdcTimeoutMs ?? 5_000;
  const capabilityProbeTimeoutMs = options.capabilityProbeTimeoutMs ?? 2_000;

  async function readNode(params: Record<string, unknown>) {
    const protocol = requireSupportedProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const nodePath = readRequiredString(params.nodePath, "nodePath");
    const preserveExactRead = readBoolean(params.preserveExactRead, false);

    if (protocol === "adb") {
      const result = await adbRunner(["-s", targetRef, "shell", "cat", nodePath], { timeoutMs: adbTimeoutMs });
      if (result.code !== 0 || result.timedOut) {
        return {
          ok: false,
          stdout: result.stdout,
          stderr: result.stderr,
          error: commandFailureMessage(protocol, result),
          durationMs: result.durationMs
        };
      }

      return {
        ok: true,
        value: normalizeRemoteReadValue(result.stdout, preserveExactRead),
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      };
    }

    const result = await hdcRunner(["-t", targetRef, "shell", `cat ${shellQuote(nodePath)}`], { timeoutMs: hdcTimeoutMs });
    if (result.code !== 0 || result.timedOut) {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error: commandFailureMessage(protocol, result),
        durationMs: result.durationMs
      };
    }

    return {
      ok: true,
      value: normalizeRemoteReadValue(result.stdout, preserveExactRead),
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
  }

  return {
    async handle(method: RpcMethod, params: Record<string, unknown>): Promise<RpcMethodResult> {
      switch (method) {
        case "bridge.getCapabilities": {
          const tools = await probeTools({
            adbRunner,
            hdcRunner,
            adbSource: options.adbSource,
            hdcSource: options.hdcSource,
            timeoutMs: capabilityProbeTimeoutMs
          });
          return {
            protocols: tools,
            methods: ["bridge.getCapabilities", "debug.detectTargets", "debug.readNode", "debug.writeNode"]
          };
        }
        case "debug.detectTargets": {
          const protocol = requireSupportedProtocol(params.protocol);
          if (protocol === "adb") {
            const result = await adbRunner(["devices"], { timeoutMs: adbTimeoutMs });
            if (result.code !== 0 || result.timedOut) {
              return {
                targets: [],
                ok: false,
                stdout: result.stdout,
                stderr: result.stderr,
                error: commandFailureMessage(protocol, result),
                durationMs: result.durationMs
              };
            }

            const targets = parseAdbDevices(result.stdout).map((device) => ({
              targetRef: device.targetRef,
              label: device.targetRef,
              online: device.online
            }));
            return { targets, ok: true, durationMs: result.durationMs };
          }

          const result = await hdcRunner(["list", "targets"], { timeoutMs: hdcTimeoutMs });
          if (result.code !== 0 || result.timedOut) {
            return {
              targets: [],
              ok: false,
              stdout: result.stdout,
              stderr: result.stderr,
              error: commandFailureMessage(protocol, result),
              durationMs: result.durationMs
            };
          }

          const targets = parseHdcTargets(result.stdout).map((target) => ({
            targetRef: target.targetRef,
            label: target.targetRef,
            online: target.online
          }));
          return { targets, ok: true, durationMs: result.durationMs };
        }
        case "debug.readNode":
          return readNode(params);
        case "debug.writeNode": {
          const protocol = requireSupportedProtocol(params.protocol);
          const targetRef = readRequiredString(params.targetRef, "targetRef");
          const nodePath = readRequiredString(params.nodePath, "nodePath");
          const value = readRequiredString(params.value, "value");
          const preserveExactRead = readBoolean(params.preserveExactRead, false);
          const readBack = readBoolean(params.readBack, true);

          const remoteCommand = buildRemoteWriteShellCommand(nodePath, value);
          const writeArgs =
            protocol === "adb"
              ? ["-s", targetRef, "shell", remoteCommand]
              : ["-t", targetRef, "shell", remoteCommand];
          const runner = protocol === "adb" ? adbRunner : hdcRunner;
          const timeoutMs = protocol === "adb" ? adbTimeoutMs : hdcTimeoutMs;
          const writeResult = await runner(writeArgs, { timeoutMs });
          const writePayload = {
            ok: writeResult.code === 0 && !writeResult.timedOut,
            stdout: writeResult.stdout,
            stderr: writeResult.stderr,
            error:
              writeResult.code === 0 && !writeResult.timedOut
                ? undefined
                : commandFailureMessage(protocol, writeResult),
            durationMs: writeResult.durationMs
          };

          if (!readBack || !writePayload.ok) {
            return {
              ok: writePayload.ok,
              verified: writePayload.ok && !readBack,
              error: writePayload.error,
              writeResult: writePayload
            };
          }

          const readPayload = await readNode({ protocol, targetRef, nodePath, preserveExactRead });
          const readValue = typeof readPayload.value === "string" ? readPayload.value : "";
          const expected = preserveExactRead ? value : value.trim();
          const verified = readPayload.ok === true && readValue === expected;
          return {
            ok: writePayload.ok && readPayload.ok === true && verified,
            verified,
            value: readPayload.value,
            error: verified ? undefined : "Readback mismatch after write.",
            writeResult: writePayload,
            readResult: readPayload
          };
        }
        default:
          throw new RpcRequestError("METHOD_NOT_FOUND", `Unsupported RPC method: ${method}`);
      }
    },
    toRpcError(error: unknown) {
      if (error instanceof RpcRequestError) {
        return { code: error.code, message: error.message };
      }
      if (error instanceof Error && error.message.trim()) {
        return { code: "INTERNAL_ERROR", message: error.message };
      }
      return { code: "INTERNAL_ERROR", message: "RPC execution failed." };
    }
  };
}
