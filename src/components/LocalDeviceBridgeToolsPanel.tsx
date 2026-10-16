import { Download } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);
  const [installProgress, setInstallProgress] = useState("");
  const [installError, setInstallError] = useState("");
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

  const runInstall = async () => {
    rememberBridgeToolInstallConfirm();
    setLocalInstalling(true);
    setInstallError("");
    setInstallProgress("正在打开 Bridge，等待安装任务响应…");
    onInstallError("");
    try {
      launchBridgeToolInstall(buildBridgeToolInstallUrl(resolveBridgeServerUrl(), installProtocol));
      const result = await pollBridgeToolInstall({ protocol: installProtocol,
        previousInstallUpdatedAt: health?.toolsInstall?.updatedAt, onProgress: (snapshot) => {
        setInstallProgress(snapshot.toolsInstall?.status === "running"
          ? "Bridge 正在安装并校验调试工具，请保持程序运行。"
          : snapshot.tools?.[protocol].available ? "调试工具已就绪。" : "等待 Bridge 开始安装；如未响应，请确认已允许浏览器打开 Bridge。");
      } });
      await onInstallComplete();
      if (!result) {
        setInstallError("120 秒内未完成工具安装。请重试或查看 Bridge 日志。");
      }
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "工具安装失败。");
      await onInstallComplete();
    } finally {
      setLocalInstalling(false);
    }
  };

  const handleInstall = () => {
    if (installRunning) {
      return;
    }
    if (shouldConfirmBridgeToolInstall()) {
      setInstallConfirmOpen(true);
      return;
    }
    void runInstall();
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
            {installRunning ? "安装进行中…" : "安装调试工具"}
          </button>
        ) : null}
      </div>
      {installRunning ? <p role="status">{installProgress || "Bridge 正在安装调试工具，请保持程序运行。"}</p> : null}
      {installError || (!installRunning && health?.toolsInstall?.status === "failed" && health.toolsInstall.error) ? (
        <p className="local-device-bridge-panel__error" role="alert">{installError || health?.toolsInstall?.error}</p>
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
      <ConfirmDialog
        open={installConfirmOpen}
        title="安装调试工具"
        description="即将打开 WiseEff Bridge 安装调试工具。是否继续？"
        confirmLabel="继续"
        onConfirm={() => {
          setInstallConfirmOpen(false);
          void runInstall();
        }}
        onCancel={() => setInstallConfirmOpen(false)}
      />
    </div>
  );
}
