import type { LocalBridgeHealthState } from "./deviceBridgeClient";

function isCurrentTokenInvalid(health: LocalBridgeHealthState | null, now = Date.now()) {
  const error = health?.lastError ?? "";
  if (/invalid or expired bridge token/i.test(error) || /missing bridge authorization/i.test(error)) {
    return true;
  }
  if (!health?.tokenExpiresAt) {
    return false;
  }
  const expiresAt = new Date(health.tokenExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export type BridgeConnectAttemptResult = {
  ok: boolean;
  reachable?: boolean;
  accepted?: boolean;
  error?: string;
};

export type BridgeConnectFailureContext = {
  health: LocalBridgeHealthState | null;
  connectResult?: BridgeConnectAttemptResult;
  previousBridgeId?: string;
  registeredBridgeIds?: string[];
  listingFailed?: boolean;
  listingError?: string;
  reconnectAttempted?: boolean;
};

export const BRIDGE_CONNECT_FAILURE = {
  listingFailed: "刷新当前账号的设备代理列表失败。请点击「刷新代理状态」后重试。",
  pairingCodeExpired: "配对码无效、已过期或已被使用。请回到网页重新生成配对码后再试。",
  oldInstaller:
    "当前安装的 Bridge 不支持安全重新绑定。请下载并安装最新 Bridge，然后再次点击「重新配对」。",
  restartFailed:
    "配对已成功，但本机仍在运行旧账号的 Bridge 进程。请安装最新 Bridge，或手动停止 18787 端口进程后再次重新配对。",
  websocketOffline:
    "配对已成功，但新的 Bridge 尚未连接到服务器。请检查网络后重试，或从托盘/菜单栏重新启动 Bridge。",
  tokenInvalid: "本地 Bridge 令牌已失效或过期。请点击「重新配对」并使用新的配对码。",
  tokenStillInvalid: "重新配对后本地 Bridge 令牌仍无效。请确认配对码未过期，或升级 Bridge 后重试。"
} as const;

export function describeBridgeConnectFailureMessage(context: BridgeConnectFailureContext): string {
  const {
    health,
    connectResult,
    previousBridgeId,
    registeredBridgeIds,
    listingFailed,
    listingError,
    reconnectAttempted
  } = context;

  if (listingFailed) {
    return listingError
      ? `刷新当前账号的设备代理列表失败：${listingError}。请点击「刷新代理状态」后重试。`
      : BRIDGE_CONNECT_FAILURE.listingFailed;
  }

  if (health?.pairingError) {
    return health.pairingError;
  }

  if (connectResult?.error === "connect_unsupported") {
    return BRIDGE_CONNECT_FAILURE.oldInstaller;
  }

  const currentAuthFailure = isCurrentTokenInvalid(health);
  if (currentAuthFailure) {
    return reconnectAttempted ? BRIDGE_CONNECT_FAILURE.tokenStillInvalid : BRIDGE_CONNECT_FAILURE.tokenInvalid;
  }

  if (reconnectAttempted && previousBridgeId && health?.bridgeId === previousBridgeId) {
    if (registeredBridgeIds?.some((id) => id !== previousBridgeId)) {
      return BRIDGE_CONNECT_FAILURE.restartFailed;
    }
    return BRIDGE_CONNECT_FAILURE.oldInstaller;
  }

  if (
    reconnectAttempted &&
    health?.bridgeId &&
    registeredBridgeIds?.includes(health.bridgeId) &&
    !health.connected
  ) {
    return BRIDGE_CONNECT_FAILURE.websocketOffline;
  }

  if (!health) {
    return "30 秒内未检测到 Bridge 上线。请确认 WiseEff Bridge 服务已启动（或运行 wiseeff-bridge start），然后重试；也可使用下方终端命令。";
  }

  if (!health.paired && !health.connected) {
    return "本地 Bridge 已响应但尚未完成配对。请重试连接，或使用下方终端命令。";
  }

  if (health.lastError) {
    return `30 秒内 Bridge 未能连接到服务器：${health.lastError}`;
  }

  if (!health.connected) {
    return "Bridge 未连接到服务器。若 Bridge 已在运行，请使用下方终端命令完成连接。";
  }

  return "30 秒内 Bridge 未能连接到服务器。请检查网络后重试，或从托盘/菜单栏重新启动 Bridge。";
}

export function shouldShowBridgeConnectFallback(input: {
  viewStep: number;
  pairingCode?: { code: string } | null;
  health: LocalBridgeHealthState | null;
  connectError?: string;
  needsLocalLaunch?: boolean;
}): boolean {
  if (input.viewStep !== 2) {
    return false;
  }
  if (input.pairingCode) {
    return true;
  }
  if (input.needsLocalLaunch) {
    return true;
  }
  if (input.health?.launcherPath) {
    return true;
  }
  if (input.health?.ok && !input.health.connected) {
    return true;
  }
  return Boolean(input.connectError);
}
