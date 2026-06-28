import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";

import type { LocalBridgeReachability } from "../infrastructure/http/bridgeConnectLauncher";

export type BridgePanelStatus =
  | "missing_bridge"
  | "bridge_blocked"
  | "not_paired"
  | "not_running"
  | "not_connected"
  | "tools_missing"
  | "online_no_device"
  | "bridges_with_targets";

export type DebugConnectionProtocol = "adb" | "hdc";

export function isLocalBridgeAuthFailure(health: LocalBridgeHealthState | null) {
  const error = health?.lastError ?? "";
  return /invalid or expired bridge token/i.test(error) || /missing bridge authorization/i.test(error);
}

export function isLocalBridgeTokenExpired(health: LocalBridgeHealthState | null, now = Date.now()) {
  if (!health?.tokenExpiresAt) {
    return false;
  }
  const expiresAt = new Date(health.tokenExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function isLocalBridgePairingStale(input: {
  health: LocalBridgeHealthState | null;
  registeredBridgeIds: string[];
}) {
  const localBridgeId = input.health?.bridgeId;
  const registeredIds = input.registeredBridgeIds;
  return Boolean(
    input.health?.paired &&
      localBridgeId &&
      registeredIds.length > 0 &&
      !registeredIds.includes(localBridgeId)
  );
}

export function deriveBridgePanelStatus(input: {
  health: LocalBridgeHealthState | null;
  bridgeCount: number;
  registeredBridgeIds?: string[];
  target?: string;
  protocol?: DebugConnectionProtocol;
  healthReachability?: LocalBridgeReachability;
}): BridgePanelStatus {
  if (!input.health) {
    if (input.bridgeCount > 0) {
      return "not_running";
    }
    if (input.healthReachability === "possibly_blocked") {
      return "bridge_blocked";
    }
    return "missing_bridge";
  }
  if (!input.health.paired) {
    return "not_paired";
  }
  if (isLocalBridgeAuthFailure(input.health) || isLocalBridgeTokenExpired(input.health)) {
    return "not_paired";
  }
  if (
    isLocalBridgePairingStale({
      health: input.health,
      registeredBridgeIds: input.registeredBridgeIds ?? []
    })
  ) {
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

export function isBridgeOnlinePanelStatus(status: BridgePanelStatus): boolean {
  return status === "online_no_device" || status === "tools_missing" || status === "bridges_with_targets";
}

export function needsLocalBridgeLaunch(status: BridgePanelStatus): boolean {
  return status === "missing_bridge" || status === "not_running" || status === "bridge_blocked";
}

export function canConnectBridgeWithoutPairingCode(input: {
  panelStatus: BridgePanelStatus;
  hasRegisteredBridge: boolean;
}): boolean {
  if (input.panelStatus === "not_connected" || input.panelStatus === "not_running") {
    return true;
  }
  return input.panelStatus === "bridge_blocked" && input.hasRegisteredBridge;
}

export function needsPairingCodeForBridgeConnect(input: {
  panelStatus: BridgePanelStatus;
  pairingStale?: boolean;
  pairingAuthFailure?: boolean;
}): boolean {
  if (input.pairingStale || input.pairingAuthFailure) {
    return true;
  }
  return input.panelStatus === "not_paired" || input.panelStatus === "missing_bridge";
}

export function shouldFetchBridgePairingCode(input: {
  panelStatus: BridgePanelStatus;
  pairingStale?: boolean;
  pairingAuthFailure?: boolean;
}): boolean {
  return (
    needsPairingCodeForBridgeConnect(input) ||
    input.panelStatus === "bridge_blocked"
  );
}

export function shouldClearStaleBridgeConnectError(input: {
  connectError: string;
  health: LocalBridgeHealthState | null;
  panelStatus: BridgePanelStatus;
}): boolean {
  if (!input.connectError) {
    return false;
  }
  return Boolean(input.health?.connected) || isBridgeOnlinePanelStatus(input.panelStatus);
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

export function bridgePanelStatusHint(
  status: BridgePanelStatus,
  protocol: DebugConnectionProtocol = "hdc",
  options: { pairingStale?: boolean; authFailure?: boolean; healthReachability?: LocalBridgeReachability } = {}
) {
  if (options.pairingStale && status === "not_paired") {
    return "本地 Bridge 配对已失效，请点击连接本机并使用新的配对码重新配对。";
  }
  if (status === "not_paired" && options.authFailure) {
    return "本地 Bridge 令牌已失效或过期，请点击连接本机并使用新的配对码重新配对。";
  }

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
      if (options.healthReachability === "possibly_blocked") {
        return "已配对 Bridge，但本地服务未运行或浏览器尚未允许访问本机网络。请点击「启动并连接本机」，并在浏览器提示中允许「本地网络」。";
      }
      return "已配对 Bridge，但本地服务未运行。请点击「启动并连接本机」自动打开 Bridge。";
    case "not_paired":
      return "Bridge 已启动但尚未配对，请点击连接。";
    case "missing_bridge":
      return "未检测到本地 Bridge 在运行（127.0.0.1:18787 无响应）。若已安装，请点击下方按钮进入步骤 2 自动启动并配对。";
    case "bridge_blocked":
      return "未检测到本地 Bridge。若已安装，请点击「启动并连接本机」；若浏览器提示访问本地网络，请选择允许。";
  }
}
