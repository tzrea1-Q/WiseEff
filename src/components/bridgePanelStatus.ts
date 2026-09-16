import { isHdcPlaceholderTarget } from "@wiseeff/device-command-core/hdcTargets";

import type { LocalBridgeHealthState, DeviceBridgePlatform, DeviceBridgePairingCode } from "../infrastructure/http/deviceBridgeClient";

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

export type LocalBridgeBindingState =
  | "unknown"
  | "unpaired"
  | "matched"
  | "foreign_account"
  | "token_invalid";

export const FOREIGN_ACCOUNT_REBIND_HINT =
  "当前本机 Bridge 已配对到其他账号。请点击「重新配对」，使用当前账号的新配对码完成本机绑定。";

export const REBIND_IN_PROGRESS_HINT = "正在将本机 Bridge 重新绑定到当前账号，并等待新进程上线。";

export const BRIDGE_UPGRADE_NOTICE_TITLE = "请升级本机 Bridge";

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
  registeredBridgeIds?: string[];
}) {
  const localBridgeId = input.health?.bridgeId;
  const registeredIds = input.registeredBridgeIds;
  return Boolean(
    input.health?.paired &&
      localBridgeId &&
      registeredIds !== undefined &&
      !registeredIds.includes(localBridgeId)
  );
}

function parseBridgeSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function isBridgeClientVersionBehind(
  installed: string | null | undefined,
  recommended: string | null | undefined
) {
  if (!recommended?.trim()) {
    return false;
  }
  if (!installed?.trim()) {
    return true;
  }
  const left = parseBridgeSemver(installed);
  const right = parseBridgeSemver(recommended);
  if (!left || !right) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! < right[index]!) {
      return true;
    }
    if (left[index]! > right[index]!) {
      return false;
    }
  }
  return false;
}

export function resolveInstalledBridgeClientVersion(input: {
  health: LocalBridgeHealthState | null;
  bridges?: Array<{ id: string; clientVersion: string | null; revokedAt: string | null }>;
}) {
  const reported = input.health?.clientVersion?.trim();
  if (reported) {
    return reported;
  }
  const localBridgeId = input.health?.bridgeId;
  if (!localBridgeId) {
    return null;
  }
  const match = input.bridges?.find((bridge) => !bridge.revokedAt && bridge.id === localBridgeId);
  const recorded = match?.clientVersion?.trim();
  return recorded || null;
}

export function shouldPromptLocalBridgeUpgrade(input: {
  health: LocalBridgeHealthState | null;
  bridges?: Array<{ id: string; clientVersion: string | null; revokedAt: string | null }>;
  recommendedVersion?: string | null;
  hasReleaseCatalog?: boolean;
}) {
  if (!input.hasReleaseCatalog || !input.recommendedVersion?.trim() || !input.health) {
    return false;
  }
  const installed = resolveInstalledBridgeClientVersion(input);
  return isBridgeClientVersionBehind(installed, input.recommendedVersion);
}

export function describeLocalBridgeUpgradeMessage(input: {
  installedVersion: string | null;
  recommendedVersion: string;
}) {
  const current = input.installedVersion
    ? `当前本机版本 ${input.installedVersion}`
    : "当前本机 Bridge 未报告版本，按旧安装包处理";
  return `${current}，推荐版本 ${input.recommendedVersion}。请先下载并安装最新安装包，否则切换账号重新配对可能无法完成。`;
}

export function deriveLocalBridgeBindingState(input: {
  health: LocalBridgeHealthState | null;
  registeredBridgeIds?: string[];
}): LocalBridgeBindingState {
  if (!input.health?.paired) {
    return input.health ? "unpaired" : "unknown";
  }
  if (isLocalBridgeAuthFailure(input.health) || isLocalBridgeTokenExpired(input.health)) {
    return "token_invalid";
  }
  if (isLocalBridgePairingStale(input)) {
    return "foreign_account";
  }
  if (input.health.bridgeId && input.registeredBridgeIds?.includes(input.health.bridgeId)) {
    return "matched";
  }
  return input.registeredBridgeIds === undefined ? "unknown" : "unpaired";
}

export function countActiveBridgesForPlatform(
  bridges: Array<{ platform: DeviceBridgePlatform; revokedAt: string | null }>,
  platform: DeviceBridgePlatform
): number {
  return bridges.filter((bridge) => bridge.revokedAt === null && bridge.platform === platform).length;
}

export function deriveBridgePanelStatus(input: {
  health: LocalBridgeHealthState | null;
  bridgeCount: number;
  registeredBridgeCountForHost?: number;
  registeredBridgeIds?: string[];
  target?: string;
  protocol?: DebugConnectionProtocol;
  healthReachability?: LocalBridgeReachability;
}): BridgePanelStatus {
  if (!input.health) {
    const registeredOnHost = input.registeredBridgeCountForHost ?? input.bridgeCount;
    if (registeredOnHost > 0) {
      if (input.healthReachability === "possibly_blocked") {
        return "bridge_blocked";
      }
      return "not_running";
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
      registeredBridgeIds: input.registeredBridgeIds
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

  if (!input.target?.trim() || isHdcPlaceholderTarget(input.target)) {
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

export function normalizeBridgeServerUrl(raw: string) {
  const url = new URL(raw);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function bridgeServerUrlMismatch(healthServerUrl: string | undefined, targetServerUrl: string) {
  if (!healthServerUrl?.trim()) {
    return false;
  }
  return normalizeBridgeServerUrl(healthServerUrl) !== normalizeBridgeServerUrl(targetServerUrl);
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
  health?: LocalBridgeHealthState | null;
  targetServerUrl?: string;
}): boolean {
  if (
    needsPairingCodeForBridgeConnect(input) ||
    input.panelStatus === "bridge_blocked" ||
    input.panelStatus === "not_running"
  ) {
    return true;
  }
  if (input.panelStatus === "not_connected") {
    return bridgeServerUrlMismatch(input.health?.serverUrl, input.targetServerUrl ?? "");
  }
  return false;
}

export function resolvePairingCodeForBridgeConnect(input: {
  panelStatus: BridgePanelStatus;
  pairingStale?: boolean;
  pairingAuthFailure?: boolean;
  pairingCode?: DeviceBridgePairingCode | null;
  health?: LocalBridgeHealthState | null;
  targetServerUrl: string;
}): string | undefined {
  const code = input.pairingCode?.code;
  if (!code) {
    return undefined;
  }

  if (needsPairingCodeForBridgeConnect(input)) {
    return code;
  }

  // When local health is offline, bridge.json may still point at another server (e.g. prod vs local dev).
  if (input.panelStatus === "not_running" || input.panelStatus === "bridge_blocked") {
    return code;
  }

  if (bridgeServerUrlMismatch(input.health?.serverUrl, input.targetServerUrl)) {
    return code;
  }

  return undefined;
}

export function shouldClearStaleBridgeConnectError(input: {
  connectError: string;
  health: LocalBridgeHealthState | null;
  panelStatus: BridgePanelStatus;
  listingFailed?: boolean;
}): boolean {
  if (!input.connectError || input.listingFailed) {
    return false;
  }
  return isBridgeOnlinePanelStatus(input.panelStatus);
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
  options: {
    pairingStale?: boolean;
    authFailure?: boolean;
    healthReachability?: LocalBridgeReachability;
    connecting?: boolean;
  } = {}
) {
  if (options.connecting && (options.pairingStale || options.authFailure)) {
    return REBIND_IN_PROGRESS_HINT;
  }
  if (options.pairingStale && status === "not_paired") {
    return FOREIGN_ACCOUNT_REBIND_HINT;
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
