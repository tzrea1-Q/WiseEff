import type { LocalBridgeHealthState } from "./deviceBridgeClient";

export type BridgeConnectFailureContext = {
  health: LocalBridgeHealthState | null;
  pairingStale: boolean;
  pairingAuthFailure: boolean;
};

export function describeBridgeConnectFailureMessage(context: BridgeConnectFailureContext): string {
  const { health, pairingStale } = context;

  if (!health) {
    return "30 秒内未检测到 Bridge 上线。若 Console 报 wiseeff-bridge:// 无 handler，请改用 https://tzrea1.com 打开页面，或执行下方 --handle-url 命令。";
  }

  if (health.pairingError) {
    return health.pairingError;
  }

  if (pairingStale) {
    return "本地 Bridge 配对已失效。请重新点击「连接本地设备」完成配对。";
  }

  if (!health.paired && !health.connected) {
    return "浏览器未能通过 wiseeff-bridge:// 完成配对（协议未注册或指向错误目录）。请使用下方终端命令完成连接。";
  }

  if (health.lastError) {
    return `30 秒内 Bridge 未能连接到服务器：${health.lastError}`;
  }

  if (!health.connected) {
    return "浏览器未能唤起 Bridge 配对，或 Bridge 未连接到服务器。若 Bridge 已在运行，请使用下方终端命令完成连接。";
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
