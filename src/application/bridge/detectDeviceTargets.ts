import type { DebugConnectionProtocol } from "@/domain/debugging/types";

/** The server discovers enabled transports; keep one choice per physical device, HDC first. */
export async function detectDeviceTargets<T extends { id?: string; targetRef?: string; bridgeId?: string; protocol?: DebugConnectionProtocol }>(
  detect: () => Promise<T[]>
): Promise<T[]> {
  const targets = await detect();
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.targetRef ? `${target.bridgeId ?? ""}:${target.targetRef}` : target.id ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
