import type { BridgeRpcClient } from "../deviceBridge/rpc";
import { isHdcPlaceholderTarget } from "@wiseeff/device-command-core/hdcTargets";
import type { DebugConnectionProtocol } from "./protocol";
import type { GatewayNodeResult, GatewayWriteResult } from "./gateway";

type BridgeDescriptor = {
  id: string;
  machineLabel: string;
};

type BridgeDetectTarget = {
  targetRef: string;
  label?: string;
  online?: boolean;
};

export type BridgeDetectedTarget = {
  id: string;
  bridgeId: string;
  bridgeMachineLabel: string;
  deviceId: string;
  protocol: DebugConnectionProtocol;
  targetRef: string;
  label: string;
  online: boolean;
};

type BridgeRpc = Pick<BridgeRpcClient, "call">;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Bridge RPC failed.";
}

function toDurationMs(startMs: number, endMs: number) {
  const delta = endMs - startMs;
  return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

function parseDetectTargets(result: Record<string, unknown>): BridgeDetectTarget[] {
  const targets = result.targets;
  if (!Array.isArray(targets)) {
    return [];
  }

  const records: BridgeDetectTarget[] = [];
  for (const entry of targets) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const targetRef = typeof entry.targetRef === "string" ? entry.targetRef.trim() : "";
    if (!targetRef || isHdcPlaceholderTarget(targetRef)) {
      continue;
    }
    records.push({
      targetRef,
      label: typeof entry.label === "string" ? entry.label : undefined,
      online: typeof entry.online === "boolean" ? entry.online : true
    });
  }
  return records;
}

function readNodeResultFromBridgePayload(payload: Record<string, unknown>, durationMs: number): GatewayNodeResult {
  const ok = payload.ok === true;
  return {
    ok,
    value: typeof payload.value === "string" ? payload.value : undefined,
    stdout: typeof payload.stdout === "string" ? payload.stdout : undefined,
    stderr: typeof payload.stderr === "string" ? payload.stderr : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    durationMs: typeof payload.durationMs === "number" ? payload.durationMs : durationMs
  };
}

function deriveReadbackValue(result: GatewayNodeResult) {
  return result.value ?? result.stdout;
}

export async function detectTargetsAcrossBridges(input: {
  rpc: BridgeRpc;
  bridges: BridgeDescriptor[];
  protocol: DebugConnectionProtocol;
  timeoutMs: number;
}): Promise<BridgeDetectedTarget[]> {
  const settled = await Promise.allSettled(
    input.bridges.map(async (bridge) => {
      const result = await input.rpc.call(
        bridge.id,
        "debug.detectTargets",
        { protocol: input.protocol },
        { timeoutMs: input.timeoutMs }
      );
      const targets = parseDetectTargets(result);
      if (targets.length === 0) {
        return [];
      }
      return targets.map<BridgeDetectedTarget>((target) => ({
        id: `bridge:${bridge.id}:${input.protocol}:${target.targetRef}`,
        bridgeId: bridge.id,
        bridgeMachineLabel: bridge.machineLabel,
        deviceId: `bridge:${bridge.id}`,
        protocol: input.protocol,
        targetRef: target.targetRef,
        label: target.label?.trim() || target.targetRef,
        online: target.online !== false
      }));
    })
  );

  return settled.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
}

export function isBridgeBackedTargetId(targetId: string) {
  return targetId.startsWith("bridge:");
}

export async function readNodeViaBridge(input: {
  rpc: BridgeRpc;
  bridgeId: string;
  protocol: DebugConnectionProtocol;
  targetRef: string;
  nodePath: string;
  preserveExactRead: boolean;
  now?: () => Date | number;
  timeoutMs: number;
}): Promise<GatewayNodeResult> {
  const now = input.now ?? (() => Date.now());
  const startMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
  try {
    const result = await input.rpc.call(
      input.bridgeId,
      "debug.readNode",
      {
        protocol: input.protocol,
        targetRef: input.targetRef,
        nodePath: input.nodePath,
        preserveExactRead: input.preserveExactRead
      },
      { timeoutMs: input.timeoutMs }
    );
    const endMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
    return readNodeResultFromBridgePayload(result, toDurationMs(startMs, endMs));
  } catch (error) {
    const endMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
    return {
      ok: false,
      error: toErrorMessage(error),
      durationMs: toDurationMs(startMs, endMs)
    };
  }
}

export async function writeNodeViaBridge(input: {
  rpc: BridgeRpc;
  bridgeId: string;
  protocol: DebugConnectionProtocol;
  targetRef: string;
  nodePath: string;
  value: string;
  readBack: boolean;
  preserveExactRead: boolean;
  compareReadback?: (written: string, read: string) => boolean;
  now?: () => Date | number;
  timeoutMs: number;
}): Promise<GatewayWriteResult> {
  const now = input.now ?? (() => Date.now());
  const startMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
  try {
    const result = await input.rpc.call(
      input.bridgeId,
      "debug.writeNode",
      {
        protocol: input.protocol,
        targetRef: input.targetRef,
        nodePath: input.nodePath,
        value: input.value,
        readBack: input.readBack,
        preserveExactRead: input.preserveExactRead
      },
      { timeoutMs: input.timeoutMs }
    );
    const endMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
    const elapsedMs = toDurationMs(startMs, endMs);
    const writeResult = readNodeResultFromBridgePayload(
      (typeof result.writeResult === "object" && result.writeResult !== null ? result.writeResult : result) as Record<string, unknown>,
      elapsedMs
    );
    const readResultRaw =
      typeof result.readResult === "object" && result.readResult !== null ? (result.readResult as Record<string, unknown>) : null;
    const readResult = readResultRaw ? readNodeResultFromBridgePayload(readResultRaw, elapsedMs) : undefined;
    const readbackValue = readResult ? deriveReadbackValue(readResult) : typeof result.value === "string" ? result.value : undefined;
    const computedVerified =
      typeof readbackValue === "string" && input.compareReadback ? input.compareReadback(input.value, readbackValue) : undefined;
    const verified = typeof computedVerified === "boolean" ? computedVerified : result.verified === true;
    const ok = result.ok === true;

    return {
      ok,
      value: typeof result.value === "string" ? result.value : readbackValue,
      verified,
      error: typeof result.error === "string" ? result.error : undefined,
      writeResult,
      readResult
    };
  } catch (error) {
    const endMs = typeof now() === "number" ? (now() as number) : (now() as Date).getTime();
    const elapsedMs = toDurationMs(startMs, endMs);
    const failureMessage = toErrorMessage(error);
    return {
      ok: false,
      verified: false,
      error: failureMessage,
      writeResult: {
        ok: false,
        error: failureMessage,
        durationMs: elapsedMs
      }
    };
  }
}
