import type { DebugConnectionProtocol } from "@/domain/debugging/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

/** Discover devices before choosing a transport; a missing optional tool is not a connection failure. */
export async function detectDeviceTargets<T extends { id?: string; targetRef?: string; bridgeId?: string; protocol?: DebugConnectionProtocol }>(
  detect: (protocol: DebugConnectionProtocol) => Promise<T[]>
): Promise<Array<T & { protocol: DebugConnectionProtocol }>> {
  const protocols = ["hdc", "adb"] as const;
  const results = await Promise.allSettled(protocols.map(async (protocol) =>
    (await detect(protocol))
      .filter((target) => !target.protocol || target.protocol === protocol)
      .map((target) => ({ ...target, protocol }))
  ));
  const targets = results.flatMap((result) => {
    if (result.status === "fulfilled") return result.value;
    if (result.reason instanceof WiseEffApiError &&
      ["PROTOCOL_UNSUPPORTED", "DEVICE_UNAVAILABLE"].includes(result.reason.code)) return [];
    throw result.reason;
  });
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.targetRef ? `${target.bridgeId ?? ""}:${target.targetRef}` : target.id ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
