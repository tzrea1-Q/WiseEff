import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BRIDGE_RPC_METHODS, type BridgeRpcMethod } from "@wiseeff/device-command-core/bridgeRpcMethods";
import {
  isAllowedKernelLogCommand,
  KERNEL_LOG_CAPTURE_MAX_BYTES,
  kernelLogTruncationKeep,
  truncateKernelLogText
} from "@wiseeff/device-command-core/kernelLogCommand";
import {
  buildRemoteWriteShellCommand,
  normalizeRemoteReadValue,
  remoteShellDiagnostic,
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

type RpcMethod = BridgeRpcMethod;

type RpcMethodResult = Record<string, unknown>;

type DebugProtocol = "adb" | "hdc";

export type IntegrityCheckStrength = "sha256" | "md5" | "byte-length";

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

function readNodeFailure(
  protocol: DebugProtocol,
  result: { code: number | null; stderr: string; timedOut?: boolean },
  diagnostic?: string
) {
  if (diagnostic) {
    return `${protocolLabel(protocol)} command failed: ${diagnostic}`;
  }
  return commandFailureMessage(protocol, result);
}

function evaluateRemoteCommand(
  protocol: DebugProtocol,
  result: { code: number | null; stdout: string; stderr: string; timedOut?: boolean; durationMs: number }
) {
  const diagnostic = remoteShellDiagnostic(result);
  const ok = result.code === 0 && !result.timedOut && !diagnostic;
  return {
    ok,
    stdout: result.stdout,
    stderr: result.stderr,
    error: ok ? undefined : readNodeFailure(protocol, result, diagnostic),
    durationMs: result.durationMs
  };
}

function joinRemotePath(directory: string, filename: string) {
  const trimmedDir = directory.replace(/\/+$/, "");
  const trimmedFile = filename.replace(/^\/+/, "");
  return `${trimmedDir}/${trimmedFile}`;
}

function parseLeadingToken(stdout: string) {
  const match = stdout.trim().match(/^([0-9a-fA-F]+|\d+)/);
  return match?.[1] ?? "";
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
  mountTimeoutMs?: number;
  pushFileTimeoutMs?: number;
  kernelLogTimeoutMs?: number;
} = {}) {
  const adbCommand = options.adbCommand ?? "adb";
  const hdcCommand = options.hdcCommand ?? "hdc";
  const adbRunner = options.adbRunner ?? createDefaultAdbCommandRunner(adbCommand);
  const hdcRunner = options.hdcRunner ?? createDefaultHdcCommandRunner(hdcCommand);
  const adbTimeoutMs = options.adbTimeoutMs ?? 5_000;
  const hdcTimeoutMs = options.hdcTimeoutMs ?? 5_000;
  const capabilityProbeTimeoutMs = options.capabilityProbeTimeoutMs ?? 2_000;
  const mountTimeoutMs = options.mountTimeoutMs ?? 15_000;
  const pushFileTimeoutMs = options.pushFileTimeoutMs ?? 30_000;
  const kernelLogTimeoutMs = options.kernelLogTimeoutMs ?? 10_000;
  const digestToolCache = new Map<string, IntegrityCheckStrength>();

  async function readNode(params: Record<string, unknown>) {
    const protocol = requireSupportedProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const nodePath = readRequiredString(params.nodePath, "nodePath");
    const preserveExactRead = readBoolean(params.preserveExactRead, false);

    if (protocol === "adb") {
      const result = await adbRunner(["-s", targetRef, "shell", "cat", nodePath], { timeoutMs: adbTimeoutMs });
      const evaluated = evaluateRemoteCommand(protocol, result);
      if (!evaluated.ok) {
        return evaluated;
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
    const evaluated = evaluateRemoteCommand(protocol, result);
    if (!evaluated.ok) {
      return evaluated;
    }

    return {
      ok: true,
      value: normalizeRemoteReadValue(result.stdout, preserveExactRead),
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
  }

  async function runShell(
    protocol: DebugProtocol,
    targetRef: string,
    remoteCommand: string,
    timeoutMs: number
  ) {
    if (protocol === "adb") {
      return adbRunner(["-s", targetRef, "shell", remoteCommand], { timeoutMs });
    }
    return hdcRunner(["-t", targetRef, "shell", remoteCommand], { timeoutMs });
  }

  async function probeIntegrityCheck(
    protocol: DebugProtocol,
    targetRef: string,
    remotePath: string,
    timeoutMs: number
  ): Promise<{ strength: IntegrityCheckStrength; remoteDigest: string; stdout: string; stderr: string; durationMs: number }> {
    const cacheKey = `${protocol}:${targetRef}`;
    const ladder: Array<{ strength: IntegrityCheckStrength; command: string }> = [
      { strength: "sha256", command: `sha256sum ${shellQuote(remotePath)}` },
      { strength: "md5", command: `md5sum ${shellQuote(remotePath)}` },
      { strength: "byte-length", command: `wc -c < ${shellQuote(remotePath)}` }
    ];
    const cached = digestToolCache.get(cacheKey);
    const ordered = cached ? ladder.filter((entry) => entry.strength === cached) : ladder;

    let lastDurationMs = 0;
    let lastStdout = "";
    let lastStderr = "";
    for (const entry of ordered) {
      const result = await runShell(protocol, targetRef, entry.command, timeoutMs);
      lastDurationMs += result.durationMs;
      lastStdout = result.stdout;
      lastStderr = result.stderr;
      const token = parseLeadingToken(result.stdout);
      if (result.code === 0 && !result.timedOut && token) {
        digestToolCache.set(cacheKey, entry.strength);
        return {
          strength: entry.strength,
          remoteDigest: token,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: lastDurationMs
        };
      }
    }

    // Cached tool disappeared — clear and re-probe the full ladder once.
    if (cached) {
      digestToolCache.delete(cacheKey);
      return probeIntegrityCheck(protocol, targetRef, remotePath, timeoutMs);
    }

    throw new RpcRequestError(
      "INTEGRITY_PROBE_FAILED",
      lastStderr.trim() || lastStdout.trim() || "Failed to probe on-device digest tooling."
    );
  }

  async function mountTarget(params: Record<string, unknown>) {
    const protocol = requireSupportedProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const timeoutMs = mountTimeoutMs;

    if (protocol === "hdc") {
      const result = await hdcRunner(["-t", targetRef, "target", "mount"], { timeoutMs });
      const evaluated = evaluateRemoteCommand(protocol, result);
      return {
        ok: evaluated.ok,
        error: evaluated.error,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      };
    }

    const result = await adbRunner(["-s", targetRef, "remount"], { timeoutMs });
    const evaluated = evaluateRemoteCommand(protocol, result);
    return {
      ok: evaluated.ok,
      error: evaluated.error,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    };
  }

  async function pushFile(params: Record<string, unknown>) {
    const protocol = requireSupportedProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const destinationDirectory = readRequiredString(params.destinationDirectory, "destinationDirectory");
    const destinationFilename = readRequiredString(params.destinationFilename, "destinationFilename");
    const contentBase64 = readRequiredString(params.contentBase64, "contentBase64");
    const contentSha256 = readRequiredString(params.contentSha256, "contentSha256").toLowerCase();
    const remotePath = joinRemotePath(destinationDirectory, destinationFilename);

    let bytes: Buffer;
    try {
      bytes = Buffer.from(contentBase64, "base64");
    } catch {
      throw new RpcRequestError("BAD_REQUEST", "contentBase64 is not valid base64.");
    }
    if (bytes.length === 0) {
      throw new RpcRequestError("BAD_REQUEST", "contentBase64 decoded to empty bytes.");
    }

    const localDigest = createHash("sha256").update(bytes).digest("hex");
    if (localDigest !== contentSha256) {
      throw new RpcRequestError(
        "DIGEST_MISMATCH",
        "contentSha256 does not match the decoded payload digest."
      );
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "wiseeff-bridge-push-"));
    const localPath = join(tempRoot, destinationFilename);
    try {
      await writeFile(localPath, bytes);

      const sendArgs =
        protocol === "hdc"
          ? ["-t", targetRef, "file", "send", localPath, remotePath]
          : ["-s", targetRef, "push", localPath, remotePath];
      const runner = protocol === "hdc" ? hdcRunner : adbRunner;
      const sendResult = await runner(sendArgs, { timeoutMs: pushFileTimeoutMs });
      if (sendResult.code !== 0 || sendResult.timedOut) {
        return {
          ok: false,
          error: commandFailureMessage(protocol, sendResult),
          localDigest,
          remoteDigest: null,
          integrityCheck: null,
          stdout: sendResult.stdout,
          stderr: sendResult.stderr,
          durationMs: sendResult.durationMs
        };
      }

      const probe = await probeIntegrityCheck(protocol, targetRef, remotePath, pushFileTimeoutMs);
      let matches = false;
      if (probe.strength === "sha256") {
        matches = probe.remoteDigest.toLowerCase() === localDigest;
      } else if (probe.strength === "md5") {
        matches = probe.remoteDigest.toLowerCase() === createHash("md5").update(bytes).digest("hex");
      } else {
        matches = probe.remoteDigest === String(bytes.length);
      }

      return {
        ok: matches,
        error: matches
          ? undefined
          : `On-device ${probe.strength} integrity check did not match the transferred artifact.`,
        localDigest,
        remoteDigest: probe.remoteDigest,
        integrityCheck: probe.strength,
        stdout: probe.stdout,
        stderr: probe.stderr,
        durationMs: sendResult.durationMs + probe.durationMs
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  async function readKernelLog(params: Record<string, unknown>) {
    const protocol = requireSupportedProtocol(params.protocol);
    const targetRef = readRequiredString(params.targetRef, "targetRef");
    const command = readRequiredString(params.command, "command");

    if (!isAllowedKernelLogCommand(command)) {
      throw new RpcRequestError(
        "COMMAND_NOT_ALLOWED",
        `Kernel log command is not on the bridge allowlist. Refusing execution.`
      );
    }

    // Pass the exact allowlisted string as a single shell argument — never append caller argv.
    const runner = protocol === "hdc" ? hdcRunner : adbRunner;
    const shellArgs =
      protocol === "hdc"
        ? ["-t", targetRef, "shell", command]
        : ["-s", targetRef, "shell", command];
    const result = await runner(shellArgs, { timeoutMs: kernelLogTimeoutMs });

    // Streaming readers (e.g. cat /proc/kmsg) may time out with partial stdout; keep non-empty text.
    // Do NOT run remoteShellDiagnostic over kernel log stdout — real dmesg/hilog lines often contain
    // [Fail], [E######], or "Permission denied" substrings that are evidence, not tool diagnostics.
    // Buffer dumps keep the tail (newest lines carry the reload evidence); streams keep the head.
    const rawStdout = typeof result.stdout === "string" ? result.stdout : "";
    const capped = truncateKernelLogText(rawStdout, KERNEL_LOG_CAPTURE_MAX_BYTES, kernelLogTruncationKeep(command));
    const hasText = capped.text.length > 0;
    if (hasText) {
      return {
        ok: true,
        text: capped.text,
        truncated: capped.truncated,
        byteLength: capped.byteLength,
        maxBytes: KERNEL_LOG_CAPTURE_MAX_BYTES,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs
      };
    }

    const diagnostic = remoteShellDiagnostic({ stdout: "", stderr: result.stderr ?? "" });
    const ok = result.code === 0 && !result.timedOut && !diagnostic;
    return {
      ok,
      text: "",
      truncated: false,
      byteLength: 0,
      maxBytes: KERNEL_LOG_CAPTURE_MAX_BYTES,
      error: ok ? undefined : commandFailureMessage(protocol, result),
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
            methods: [...BRIDGE_RPC_METHODS]
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
          const writePayload = evaluateRemoteCommand(protocol, writeResult);

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
        case "debug.mountTarget":
          return mountTarget(params);
        case "debug.pushFile":
          return pushFile(params);
        case "debug.readKernelLog":
          return readKernelLog(params);
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
