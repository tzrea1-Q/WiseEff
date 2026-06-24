import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";

export type BridgePanelStatus =
  | "missing_bridge"
  | "not_paired"
  | "not_running"
  | "not_connected"
  | "tools_missing"
  | "online_no_device"
  | "bridges_with_targets";

export type DebugConnectionProtocol = "adb" | "hdc";

export function deriveBridgePanelStatus(input: {
  health: LocalBridgeHealthState | null;
  bridgeCount: number;
  target?: string;
  protocol?: DebugConnectionProtocol;
}): BridgePanelStatus {
  if (!input.health) {
    return input.bridgeCount > 0 ? "not_running" : "missing_bridge";
  }
  if (!input.health.paired) {
    return "not_paired";
  }
  if (!input.health.connected) {
    return "not_connected";
  }

  const protocol = input.protocol ?? "hdc";
  const toolState = input.health.tools?.[protocol];
  if (toolState && !toolState.available) {
    return "tools_missing";
  }

  if (!input.target) {
    return "online_no_device";
  }
  return "bridges_with_targets";
}

const TOOL_MISSING_PATTERNS = [
  /\badb\b.*not found/i,
  /\badb\b.*不可用/i,
  /\bhdc\b.*not found/i,
  /\bhdc\b.*不可用/i,
  /command not found/i,
  /ENOENT.*\b(adb|hdc)\b/i
];

export function isToolMissingDetectError(message: string) {
  return TOOL_MISSING_PATTERNS.some((pattern) => pattern.test(message));
}

export function formatDetectFailureMessage(input: {
  error: unknown;
  health: LocalBridgeHealthState | null;
  protocol: DebugConnectionProtocol;
  formatError: (error: unknown) => string;
}) {
  const message = input.formatError(input.error);
  const toolState = input.health?.tools?.[input.protocol];
  if (toolState && !toolState.available) {
    return input.protocol === "adb"
      ? "缺少 ADB 调试工具，请先安装调试工具。"
      : "缺少 HDC 调试工具，请先安装调试工具。";
  }
  if (isToolMissingDetectError(message)) {
    return input.protocol === "adb"
      ? "缺少 ADB 调试工具，请先安装调试工具。"
      : "缺少 HDC 调试工具，请先安装调试工具。";
  }
  return message;
}

export function bridgePanelStatusHint(status: BridgePanelStatus, protocol: DebugConnectionProtocol = "hdc") {
  switch (status) {
    case "bridges_with_targets":
      return "Bridge 在线，已连接可调试目标。";
    case "online_no_device":
      return "Bridge 在线，请插入 USB 设备并授权调试。";
    case "tools_missing":
      return protocol === "adb"
        ? "缺少 ADB 调试工具，请先安装调试工具。"
        : "缺少 HDC 调试工具，请先安装调试工具。";
    case "not_connected":
      return "Bridge 已配对，但尚未连接到服务器。";
    case "not_running":
      return "已配对 Bridge，但本地服务未运行。";
    case "not_paired":
      return "Bridge 已启动但尚未配对，请点击连接。";
    case "missing_bridge":
      return "未检测到本地 Bridge，请先安装。";
  }
}
