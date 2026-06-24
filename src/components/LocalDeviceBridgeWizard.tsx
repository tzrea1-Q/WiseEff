import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";

import {
  buildBridgeConnectUrl,
  launchBridgeConnect,
  pollLocalBridgeHealth,
  rememberBridgeSchemeLaunchConfirm,
  shouldConfirmBridgeSchemeLaunch
} from "../infrastructure/http/bridgeConnectLauncher";
import { bridgeReleaseDownloadLabel } from "../infrastructure/http/bridgeReleaseSelection";
import type { DeviceBridgePairingCode, DeviceBridgeReleaseItem, LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import { bridgePanelStatusHint, type BridgePanelStatus, type DebugConnectionProtocol } from "./bridgePanelStatus";
import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";

export type { BridgePanelStatus } from "./bridgePanelStatus";

export function deriveWizardStep(panelStatus: BridgePanelStatus): 1 | 2 | 3 | "done" {
  switch (panelStatus) {
    case "missing_bridge":
      return 1;
    case "not_paired":
    case "not_running":
    case "not_connected":
      return 2;
    case "tools_missing":
    case "online_no_device":
      return 3;
    case "bridges_with_targets":
      return "done";
  }
}

type LocalDeviceBridgeWizardProps = {
  panelStatus: BridgePanelStatus;
  protocol: DebugConnectionProtocol;
  health: LocalBridgeHealthState | null;
  hostRelease: DeviceBridgeReleaseItem | null;
  alternateReleases: DeviceBridgeReleaseItem[];
  pairingCode: DeviceBridgePairingCode | null;
  pairingCodeLoading: boolean;
  checking: boolean;
  detecting: boolean;
  connectError: string;
  onConnectError: (message: string) => void;
  onRefresh: () => Promise<{ connected: boolean }>;
  onDetect: () => void;
  advancedCommands: {
    connect: string;
    pair: string;
    start: string;
  };
};

function formatPairingCodeExpiry(expiresAt: string) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return expiresAt;
  }
  return date.toLocaleString();
}

function AdvancedCommandRow({
  label,
  command,
  loading,
  loadingText,
  hint,
  copyKey,
  copiedKey,
  onCopy
}: {
  label: string;
  command: string;
  loading?: boolean;
  loadingText?: string;
  hint?: string;
  copyKey: "connect" | "pair" | "start";
  copiedKey: "connect" | "pair" | "start" | null;
  onCopy: (key: "connect" | "pair" | "start", command: string) => void;
}) {
  const displayCommand = loading ? (loadingText ?? "正在生成命令...") : command;

  return (
    <div className="local-device-bridge-panel__command">
      <div className="local-device-bridge-panel__command-head">
        <span>{label}</span>
      </div>
      <div className="local-device-bridge-panel__command-box">
        <button
          type="button"
          className="local-device-bridge-panel__copy-button"
          disabled={loading || !command.trim()}
          aria-label={copiedKey === copyKey ? `已复制${label}` : `复制${label}`}
          title={copiedKey === copyKey ? "已复制" : "复制"}
          onClick={() => onCopy(copyKey, command)}
        >
          {copiedKey === copyKey ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
        <code>{displayCommand}</code>
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function LocalDeviceBridgeWizard({
  panelStatus,
  protocol,
  health,
  hostRelease,
  alternateReleases,
  pairingCode,
  pairingCodeLoading,
  checking,
  detecting,
  connectError,
  onConnectError,
  onRefresh,
  onDetect,
  advancedCommands
}: LocalDeviceBridgeWizardProps) {
  const [copiedCommandKey, setCopiedCommandKey] = useState<"connect" | "pair" | "start" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const step = deriveWizardStep(panelStatus);

  const copyCommand = async (key: "connect" | "pair" | "start", command: string) => {
    if (!command.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommandKey(key);
      window.setTimeout(() => setCopiedCommandKey(null), 2000);
    } catch {
      onConnectError("无法复制命令，请手动选择复制。");
    }
  };

  const handleConnect = async () => {
    if (step === 3 || panelStatus === "bridges_with_targets") {
      onDetect();
      return;
    }

    if (step !== 2) {
      return;
    }

    if (!pairingCode && panelStatus !== "not_connected" && panelStatus !== "not_running") {
      onConnectError("配对码尚未就绪，请稍后重试。");
      return;
    }

    if (shouldConfirmBridgeSchemeLaunch() && !window.confirm("即将打开 WiseEff Bridge 以完成连接。是否继续？")) {
      return;
    }
    rememberBridgeSchemeLaunchConfirm();

    setConnecting(true);
    onConnectError("");
    try {
      const connectUrl =
        panelStatus === "not_connected" || panelStatus === "not_running"
          ? buildBridgeConnectUrl(window.location.origin)
          : buildBridgeConnectUrl(window.location.origin, pairingCode!.code);
      launchBridgeConnect(connectUrl);
      const health = await pollLocalBridgeHealth({});
      await onRefresh();
      if (health?.connected) {
        onDetect();
      } else if (!health) {
        onConnectError("30 秒内未检测到 Bridge 上线。请从托盘或菜单栏打开 WiseEff Bridge 后重试。");
      } else {
        onConnectError("30 秒内 Bridge 未能连接到服务器。请检查网络后重试，或从托盘/菜单栏重新启动 Bridge。");
      }
    } finally {
      setConnecting(false);
    }
  };

  const primaryLabel =
    step === 1 && hostRelease
      ? bridgeReleaseDownloadLabel(hostRelease)
      : step === 2
        ? panelStatus === "not_running"
          ? "启动 Bridge 并连接"
          : panelStatus === "not_connected"
            ? "重新连接"
            : "连接本地设备"
        : step === 3
          ? panelStatus === "tools_missing"
            ? "安装调试工具"
            : "重新检测设备"
          : "连接本地设备";

  const statusHint = bridgePanelStatusHint(panelStatus, protocol);

  return (
    <>
      <ol className="local-device-bridge-wizard__steps" aria-label="Bridge 连接步骤">
        <li data-active={step === 1} data-done={step !== 1 && step !== "done"}>
          安装 Bridge
        </li>
        <li data-active={step === 2} data-done={step === 3 || step === "done"}>
          连接本机
        </li>
        <li data-active={step === 3} data-done={step === "done"}>
          插入 USB 设备
        </li>
      </ol>

      <div className="local-device-bridge-panel__head">
        <div>
          <strong>本地设备桥接</strong>
          <small>{statusHint}</small>
        </div>
        {step === 1 && hostRelease ? (
          <a className="button subtle" href={hostRelease.downloadUrl}>
            {primaryLabel}
          </a>
        ) : (
          <button
            className="button subtle"
            type="button"
            disabled={checking || detecting || connecting || (step === 2 && pairingCodeLoading)}
            onClick={() => void handleConnect()}
          >
            <Link2 size={14} aria-hidden="true" />
            {checking || connecting ? "连接中..." : primaryLabel}
          </button>
        )}
      </div>

      <div className="local-device-bridge-panel__body">
        {step === 1 && hostRelease && alternateReleases.length > 0 ? (
          <details className="local-device-bridge-panel__alternate-downloads">
            <summary>其他平台</summary>
            {alternateReleases.map((item) => (
              <a key={item.downloadUrl} className="button subtle" href={item.downloadUrl}>
                {bridgeReleaseDownloadLabel(item)}
              </a>
            ))}
          </details>
        ) : null}

        {connectError ? <p className="local-device-bridge-panel__error">{connectError}</p> : null}

        {step === 3 && health?.tools ? (
          <LocalDeviceBridgeToolsPanel
            health={health}
            protocol={protocol}
            panelStatus={
              panelStatus === "tools_missing"
                ? "tools_missing"
                : panelStatus === "bridges_with_targets"
                  ? "bridges_with_targets"
                  : "online_no_device"
            }
            onInstallError={onConnectError}
            onInstallComplete={async () => {
              await onRefresh();
            }}
          />
        ) : null}

        <details className="local-device-bridge-panel__advanced">
          <summary>高级 · 命令行方式</summary>
          {(panelStatus === "missing_bridge" ||
            panelStatus === "not_paired" ||
            panelStatus === "not_running" ||
            panelStatus === "not_connected") &&
          advancedCommands.connect ? (
            <AdvancedCommandRow
              label="连接命令"
              command={advancedCommands.connect}
              copyKey="connect"
              copiedKey={copiedCommandKey}
              onCopy={copyCommand}
            />
          ) : null}
          {(panelStatus === "missing_bridge" || panelStatus === "not_paired") ? (
            <AdvancedCommandRow
              label="配对命令"
              command={advancedCommands.pair}
              loading={pairingCodeLoading}
              loadingText="正在生成配对码..."
              hint={pairingCode ? `配对码有效期至 ${formatPairingCodeExpiry(pairingCode.expiresAt)}` : undefined}
              copyKey="pair"
              copiedKey={copiedCommandKey}
              onCopy={copyCommand}
            />
          ) : null}
          {panelStatus === "not_running" ||
          panelStatus === "not_paired" ||
          panelStatus === "not_connected" ? (
            <AdvancedCommandRow
              label="启动命令"
              command={advancedCommands.start}
              copyKey="start"
              copiedKey={copiedCommandKey}
              onCopy={copyCommand}
            />
          ) : null}
        </details>
      </div>
    </>
  );
}
