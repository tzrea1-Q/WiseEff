import type { LocalBridgeHealthState } from "./deviceBridgeClient";

export type BridgeConnectFailureContext = {
  health: LocalBridgeHealthState | null;
  pairingStale: boolean;
  pairingAuthFailure: boolean;
};

export function describeBridgeConnectFailureMessage(context: BridgeConnectFailureContext): string {
  const { health, pairingStale } = context;

  if (!health) {
    return "30 秒内未检测到 Bridge 上线。请确认 WiseEff Bridge 服务已启动（或运行 wiseeff-bridge start），然后重试；也可使用下方终端命令。";
  }

  if (health.pairingError) {
    return health.pairingError;
  }

  if (pairingStale) {
    return "本地 Bridge 配对已失效。请重新点击「连接本地设备」完成配对。";
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
