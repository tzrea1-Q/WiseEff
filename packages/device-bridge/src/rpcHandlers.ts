import {
  buildRemoteWriteShellCommand,
  normalizeRemoteReadValue
} from "@wiseeff/device-command-core/remoteNodeWrite";
import {
  createDefaultAdbCommandRunner,
  parseAdbDevices,
  type AdbCommandRunner
} from "@wiseeff/device-command-core/adbRunner";

type RpcMethod = "bridge.getCapabilities" | "debug.detectTargets" | "debug.readNode" | "debug.writeNode";

type RpcMethodResult = Record<string, unknown>;

export class RpcRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type BridgeRpcHandlers = ReturnType<typeof createRpcHandlers>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "RPC execution failed.";
}

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

function requireAdbProtocol(value: unknown) {
  const protocol = readRequiredString(value, "protocol");
  if (protocol !== "adb") {
    throw new RpcRequestError("UNSUPPORTED_PROTOCOL", `Protocol "${protocol}" is not supported in phase 1.`);
  }
  return protocol;
}

export function createRpcHandlers(options: {
  adbRunner?: AdbCommandRunner;
  adbTimeoutMs?: number;
} = {}) {
  const adbRunner = options.adbRunner ?? createDefaultAdbCommandRunner("adb");
  const adbTimeoutMs = options.adbTimeoutMs ?? 5_000;

  async function readNode(params: Record<string, unknown>) {
    requireAdbProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const nodePath = readRequiredString(params.nodePath, "nodePath");
    const preserveExactRead = readBoolean(params.preserveExactRead, false);
    const result = await adbRunner(["-s", targetRef, "shell", "cat", nodePath], { timeoutMs: adbTimeoutMs });
    if (result.code !== 0 || result.timedOut) {
      return {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.timedOut ? "ADB command timed out." : result.stderr.trim() || `ADB exited with ${String(result.code)}.`,
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
        case "bridge.getCapabilities":
          return {
            protocols: {
              adb: { available: true },
              hdc: { available: false, reason: "phase1_adb_only" }
            },
            methods: ["bridge.getCapabilities", "debug.detectTargets", "debug.readNode", "debug.writeNode"]
          };
        case "debug.detectTargets": {
          requireAdbProtocol(params.protocol);
          const result = await adbRunner(["devices"], { timeoutMs: adbTimeoutMs });
          if (result.code !== 0 || result.timedOut) {
            return {
              targets: [],
              ok: false,
              stdout: result.stdout,
              stderr: result.stderr,
              error: result.timedOut ? "ADB command timed out." : result.stderr.trim() || `ADB exited with ${String(result.code)}.`,
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
        case "debug.readNode":
          return readNode(params);
        case "debug.writeNode": {
          requireAdbProtocol(params.protocol);
          const targetRef = readRequiredString(params.targetRef, "targetRef");
          const nodePath = readRequiredString(params.nodePath, "nodePath");
          const value = readRequiredString(params.value, "value");
          const preserveExactRead = readBoolean(params.preserveExactRead, false);
          const readBack = readBoolean(params.readBack, true);

          const remoteCommand = buildRemoteWriteShellCommand(nodePath, value);
          const writeResult = await adbRunner(["-s", targetRef, "shell", remoteCommand], { timeoutMs: adbTimeoutMs });
          const writePayload = {
            ok: writeResult.code === 0 && !writeResult.timedOut,
            stdout: writeResult.stdout,
            stderr: writeResult.stderr,
            error:
              writeResult.code === 0 && !writeResult.timedOut
                ? undefined
                : writeResult.timedOut
                  ? "ADB command timed out."
                  : writeResult.stderr.trim() || `ADB exited with ${String(writeResult.code)}.`,
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

          const readPayload = await readNode({ protocol: "adb", targetRef, nodePath, preserveExactRead });
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
      return { code: "INTERNAL_ERROR", message: toErrorMessage(error) };
    }
  };
}
