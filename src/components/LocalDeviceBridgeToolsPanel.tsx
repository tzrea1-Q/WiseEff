import { Download } from "lucide-react";
import { useState } from "react";

import {
  buildBridgeToolInstallUrl,
  launchBridgeToolInstall,
  pollBridgeToolInstall,
  rememberBridgeToolInstallConfirm,
  shouldConfirmBridgeToolInstall
} from "../infrastructure/http/bridgeToolInstallLauncher";
import { resolveBridgeServerUrl } from "../infrastructure/http/bridgeServerUrl";
import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import type { DebugConnectionProtocol } from "./bridgePanelStatus";

type LocalDeviceBridgeToolsPanelProps = {
  health: LocalBridgeHealthState | null;
  protocol: DebugConnectionProtocol;
  panelStatus: "tools_missing" | "online_no_device" | "bridges_with_targets";
  installing?: boolean;
  onInstallError: (message: string) => void;
  onInstallComplete: () => Promise<void>;
};

function formatToolDetail(state: NonNullable<LocalBridgeHealthState["tools"]>[DebugConnectionProtocol]) {
  const parts: string[] = [];
  if (state.version) {
    parts.push(state.version);
  }
  if (state.source) {
    parts.push(state.source === "managed" ? "私有目录" : "系统 PATH");
  }
  if (!state.available && state.reason) {
    parts.push(state.reason);
  }
  return parts.join(" · ");
}

export function LocalDeviceBridgeToolsPanel({
  health,
  protocol,
  panelStatus,
  installing = false,
  onInstallError,
  onInstallComplete
}: LocalDeviceBridgeToolsPanelProps) {
  const [localInstalling, setLocalInstalling] = useState(false);
  const tools = health?.tools;
  if (!tools) {
    return null;
  }

  const primary = tools[protocol];
  const secondaryProtocol = protocol === "adb" ? "hdc" : "adb";
  const secondary = tools[secondaryProtocol];
  const installProtocol = panelStatus === "tools_missing" ? protocol : "all";
  const installRunning =
    localInstalling || installing || health?.toolsInstall?.status === "running";
  const advancedInstallCommand = `wiseeff-bridge tools install --protocol ${installProtocol === "all" ? "all" : installProtocol}`;

  const handleInstall = async () => {
    if (installRunning) {
      return;
    }
    if (shouldConfirmBridgeToolInstall() && !window.confirm("即将打开 WiseEff Bridge 安装调试工具。是否继续？")) {
      return;
    }
    rememberBridgeToolInstallConfirm();
    setLocalInstalling(true);
    onInstallError("");
    try {
      launchBridgeToolInstall(buildBridgeToolInstallUrl(resolveBridgeServerUrl(), installProtocol));
      const result = await pollBridgeToolInstall({ protocol: installProtocol });
      await onInstallComplete();
      if (!result) {
        onInstallError("120 秒内未完成工具安装。请重试或查看 Bridge 日志。");
      }
    } catch (error) {
      onInstallError(error instanceof Error ? error.message : "工具安装失败。");
    } finally {
      setLocalInstalling(false);
    }
  };

  return (
    <div className="local-device-bridge-tools-panel" aria-label="调试工具状态">
      <div className="local-device-bridge-tools-panel__head">
        <div>
          <strong>{protocol.toUpperCase()} 工具</strong>
          <p className={primary.available ? "local-device-bridge-tools-panel__ok" : "local-device-bridge-tools-panel__missing"}>
            {primary.available ? "可用" : "不可用"}
            {!primary.available && panelStatus === "tools_missing"
              ? ` · 请先安装 ${protocol.toUpperCase()} 调试工具`
              : null}
          </p>
          <small>{formatToolDetail(primary)}</small>
        </div>
        {panelStatus === "tools_missing" ? (
          <button
            className="button subtle"
            type="button"
            disabled={installRunning}
            onClick={() => void handleInstall()}
          >
            <Download size={14} aria-hidden="true" />
            {installRunning ? "正在下载..." : "安装调试工具"}
          </button>
        ) : null}
      </div>
      {health?.toolsInstall?.status === "failed" && health.toolsInstall.error ? (
        <p className="local-device-bridge-panel__error">{health.toolsInstall.error}</p>
      ) : null}
      <details className="local-device-bridge-tools-panel__details">
        <summary>其他工具</summary>
        <small>
          {secondaryProtocol.toUpperCase()}: {secondary.available ? "可用" : "不可用"}
          {secondary.version ? ` · ${secondary.version}` : ""}
          {secondary.source ? ` · ${secondary.source === "managed" ? "私有目录" : "系统 PATH"}` : ""}
        </small>
        <small className="local-device-bridge-tools-panel__cli">高级 CLI：{advancedInstallCommand}</small>
      </details>
    </div>
  );
}
