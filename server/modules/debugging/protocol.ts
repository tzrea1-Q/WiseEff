export const debugConnectionProtocols = ["hdc", "adb"] as const;
export type DebugConnectionProtocol = (typeof debugConnectionProtocols)[number];

export const defaultDebugConnectionProtocol: DebugConnectionProtocol = "hdc";

export function isDebugConnectionProtocol(value: unknown): value is DebugConnectionProtocol {
  return typeof value === "string" && debugConnectionProtocols.includes(value as DebugConnectionProtocol);
}

export function debugProtocolLabel(protocol: DebugConnectionProtocol) {
  return protocol.toUpperCase();
}
