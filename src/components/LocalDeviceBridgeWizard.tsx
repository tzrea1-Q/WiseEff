import { Download, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  buildBridgeConnectUrl,
  launchBridgeConnect,
  pollLocalBridgeHealth,
  rememberBridgeSchemeLaunchConfirm,
  shouldConfirmBridgeSchemeLaunch
} from "../infrastructure/http/bridgeConnectLauncher";
import { resolveBridgeServerUrl, resolveBridgeWebOrigin } from "../infrastructure/http/bridgeServerUrl";
import {
  bridgeHostTargetLabel,
  bridgeReleaseDownloadLabel,
  detectBrowserBridgeTarget,
  isBridgeReleaseForHost,
  pickHostPortableRelease
} from "../infrastructure/http/bridgeReleaseSelection";
import { resolveDeviceBridgeDownloadUrl } from "../infrastructure/http/deviceBridgeDownloadUrl";
import type { DeviceBridgePairingCode, DeviceBridgeReleaseItem, LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import { bridgePanelStatusHint, type BridgePanelStatus, type DebugConnectionProtocol } from "./bridgePanelStatus";
import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";

export type { BridgePanelStatus } from "./bridgePanelStatus";

export type WizardViewStep = 1 | 2 | 3;

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

export function deriveNaturalWizardStep(panelStatus: BridgePanelStatus): WizardViewStep {
  const step = deriveWizardStep(panelStatus);
  return step === "done" ? 3 : step;
}

type LocalDeviceBridgeWizardProps = {
  panelStatus: BridgePanelStatus;
  pairingStale?: boolean;
  pairingAuthFailure?: boolean;
  protocol: DebugConnectionProtocol;
  health: LocalBridgeHealthState | null;
  hostRelease: DeviceBridgeReleaseItem | null;
  installerAlternates: DeviceBridgeReleaseItem[];
  portableReleases: DeviceBridgeReleaseItem[];
  pairingCode: DeviceBridgePairingCode | null;
  pairingCodeLoading: boolean;
  checking: boolean;
  detecting: boolean;
  connectError: string;
  onConnectError: (message: string) => void;
  onRefresh: () => Promise<{ connected: boolean }>;
  onDetect: () => void;
  releasesLoading?: boolean;
  onLoadInstallReleases?: () => Promise<void>;
};

function WizardStepItem({
  step,
  label,
  viewStep,
  naturalStep,
  onSelect
}: {
  step: WizardViewStep;
  label: string;
  viewStep: WizardViewStep;
  naturalStep: WizardViewStep;
  onSelect: (step: WizardViewStep) => void;
}) {
  const reachable = step <= naturalStep;
  const active = viewStep === step;
  const done = naturalStep > step;

  return (
    <li data-active={active} data-done={done && !active}>
      {reachable && !active ? (
        <button type="button" className="local-device-bridge-wizard__step-button" onClick={() => onSelect(step)}>
          {label}
        </button>
      ) : (
        label
      )}
    </li>
  );
}

export function LocalDeviceBridgeWizard({
  panelStatus,
  pairingStale = false,
  pairingAuthFailure = false,
  protocol,
  health,
  hostRelease,
  installerAlternates,
  portableReleases,
  pairingCode,
  pairingCodeLoading,
  checking,
  detecting,
  connectError,
  onConnectError,
  onRefresh,
  onDetect,
  releasesLoading = false,
  onLoadInstallReleases
}: LocalDeviceBridgeWizardProps) {
  const [connecting, setConnecting] = useState(false);
  const naturalStep = deriveNaturalWizardStep(panelStatus);
  const [viewStep, setViewStep] = useState<WizardViewStep>(naturalStep);
  const previousNaturalStep = useRef(naturalStep);
  const hostTarget = detectBrowserBridgeTarget();
  const hostTargetLabel = bridgeHostTargetLabel(hostTarget);
  const hasInstallCatalog = Boolean(hostRelease || installerAlternates.length > 0 || portableReleases.length > 0);

  useEffect(() => {
    if (panelStatus === "missing_bridge") {
      setViewStep(1);
      previousNaturalStep.current = 1;
      return;
    }

    if (naturalStep > previousNaturalStep.current) {
      setViewStep(naturalStep);
    }
    previousNaturalStep.current = naturalStep;
  }, [naturalStep, panelStatus]);

  const goToStep = async (step: WizardViewStep) => {
    if (step > naturalStep) {
      return;
    }
    setViewStep(step);
    if (step === 1 && !hasInstallCatalog) {
      await onLoadInstallReleases?.();
    }
  };

  const handleConnect = async () => {
    if (viewStep === 3 || panelStatus === "bridges_with_targets") {
      onDetect();
      return;
    }

    if (viewStep !== 2) {
      return;
    }

    if (!pairingCode && (panelStatus === "not_paired" || panelStatus === "missing_bridge" || pairingStale || pairingAuthFailure)) {
      onConnectError("配对码尚未就绪，请稍后重试。");
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
      const serverUrl = resolveBridgeServerUrl();
      const webOrigin = resolveBridgeWebOrigin();
      const needsPairingCode = panelStatus === "not_paired" || panelStatus === "missing_bridge" || pairingStale || pairingAuthFailure;
      const connectUrl =
        needsPairingCode
          ? buildBridgeConnectUrl(serverUrl, pairingCode!.code, webOrigin)
          : panelStatus === "not_connected" || panelStatus === "not_running"
            ? buildBridgeConnectUrl(serverUrl, undefined, webOrigin)
            : buildBridgeConnectUrl(serverUrl, pairingCode!.code, webOrigin);
      launchBridgeConnect(connectUrl);
      const nextHealth = await pollLocalBridgeHealth({});
      await onRefresh();
      if (nextHealth?.connected) {
        onDetect();
      } else if (!nextHealth) {
        onConnectError("30 秒内未检测到 Bridge 上线。请从托盘或菜单栏打开 WiseEff Bridge 后重试。");
      } else {
        onConnectError(
          pairingStale
            ? "本地 Bridge 配对已失效。请重新点击「连接本地设备」完成配对。"
            : nextHealth.lastError
              ? `30 秒内 Bridge 未能连接到服务器：${nextHealth.lastError}`
              : "30 秒内 Bridge 未能连接到服务器。请检查网络后重试，或从托盘/菜单栏重新启动 Bridge。"
        );
      }
    } finally {
      setConnecting(false);
    }
  };

  const primaryLabel =
    viewStep === 2
      ? panelStatus === "not_running"
        ? "启动 Bridge 并连接"
        : pairingStale || pairingAuthFailure || panelStatus === "not_paired"
          ? "重新配对"
          : panelStatus === "not_connected"
            ? "重新连接"
            : "连接本地设备"
      : viewStep === 3
        ? panelStatus === "tools_missing"
          ? "安装调试工具"
          : "重新检测设备"
        : "连接本地设备";

  const statusHint =
    viewStep === 1 && naturalStep > 1
      ? "可下载安装包升级或重装 Bridge，完成后点击步骤 2 继续连接。"
      : bridgePanelStatusHint(panelStatus, protocol, { pairingStale, authFailure: pairingAuthFailure });
  const hostInstaller =
    hostRelease?.artifactKind === "installer"
      ? hostRelease
      : installerAlternates.find((item) => isBridgeReleaseForHost(item, hostTarget));
  const hostPortable = pickHostPortableRelease(portableReleases, hostTarget);
  const otherInstallers = installerAlternates.filter(
    (item) => !hostInstaller || item.downloadUrl !== hostInstaller.downloadUrl
  );
  const otherPortables = portableReleases.filter((item) => !hostPortable || item.downloadUrl !== hostPortable.downloadUrl);
  const showPrimaryAction = viewStep === 2 || viewStep === 3;

  return (
    <>
      <ol className="local-device-bridge-wizard__steps" aria-label="Bridge 连接步骤">
        <WizardStepItem step={1} label="安装 Bridge" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={2} label="连接本机" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={3} label="插入 USB 设备" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
      </ol>

      <div className="local-device-bridge-panel__head">
        <div>
          <strong>本地设备桥接</strong>
          <small>{statusHint}</small>
        </div>
        {showPrimaryAction ? (
          <button
            className="button subtle"
            type="button"
            disabled={checking || detecting || connecting || (viewStep === 2 && pairingCodeLoading)}
            onClick={() => void handleConnect()}
          >
            <Link2 size={14} aria-hidden="true" />
            {checking || connecting ? "连接中..." : primaryLabel}
          </button>
        ) : null}
      </div>

      <div className="local-device-bridge-panel__body">
        {viewStep === 1 ? (
          <>
            {releasesLoading ? (
              <p className="local-device-bridge-panel__install-desc" role="status">
                正在加载安装包列表...
              </p>
            ) : hasInstallCatalog ? (
              <>
                <p className="local-device-bridge-panel__host-banner" role="status">
                  已识别当前环境：<strong>{hostTargetLabel}</strong>。请优先下载下方标注为「本机推荐」的安装包。
                </p>

                <div className="local-device-bridge-panel__install-options">
                  <article className="local-device-bridge-panel__install-option">
                    <h4 className="local-device-bridge-panel__install-title">图形安装包（推荐）</h4>
                    <p className="local-device-bridge-panel__install-desc">
                      运行安装程序即可完成 Bridge 安装，自动注册连接协议、后台服务与托盘/菜单栏。安装后回到本页，在步骤 2 点击「连接本机」。
                    </p>

                    {hostInstaller ? (
                      <div className="local-device-bridge-panel__host-pick">
                        <span className="local-device-bridge-panel__host-badge">本机推荐</span>
                        <a
                          className="button local-device-bridge-panel__install-cta"
                          href={resolveDeviceBridgeDownloadUrl(hostInstaller.downloadUrl)}
                        >
                          <Download size={14} aria-hidden="true" />
                          {bridgeReleaseDownloadLabel(hostInstaller)}
                        </a>
                      </div>
                    ) : (
                      <p className="local-device-bridge-panel__install-desc">
                        当前环境暂无图形安装包。可展开下方「便携压缩包」手动部署，或选择其他平台安装包。
                      </p>
                    )}

                    {otherInstallers.length > 0 ? (
                      <details className="local-device-bridge-panel__install-more">
                        <summary>其他平台图形安装包</summary>
                        <div className="local-device-bridge-panel__install-actions">
                          {otherInstallers.map((item) => (
                            <a
                              key={item.downloadUrl}
                              className="button subtle"
                              href={resolveDeviceBridgeDownloadUrl(item.downloadUrl)}
                            >
                              {bridgeReleaseDownloadLabel(item)}
                            </a>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>

                  {portableReleases.length > 0 ? (
                    <details className="local-device-bridge-panel__install-portable">
                      <summary>便携压缩包（zip / tar.gz）</summary>
                      <div className="local-device-bridge-panel__install-portable-body">
                        <p className="local-device-bridge-panel__install-desc">
                          下载后需自行解压并手动启动 Bridge，适合内网分发或无法运行安装程序的环境。完成后同样在本页点击「连接本机」。
                        </p>

                        {hostPortable ? (
                          <div className="local-device-bridge-panel__host-pick local-device-bridge-panel__host-pick--portable">
                            <span className="local-device-bridge-panel__host-badge">本机便携包</span>
                            <a
                              className="button subtle local-device-bridge-panel__install-cta-secondary"
                              href={resolveDeviceBridgeDownloadUrl(hostPortable.downloadUrl)}
                            >
                              <Download size={14} aria-hidden="true" />
                              {bridgeReleaseDownloadLabel(hostPortable)}
                            </a>
                          </div>
                        ) : null}

                        {otherPortables.length > 0 ? (
                          <div className="local-device-bridge-panel__install-actions">
                            <span className="local-device-bridge-panel__install-actions-label">其他平台便携包</span>
                            {otherPortables.map((item) => (
                              <a
                                key={item.downloadUrl}
                                className="button subtle"
                                href={resolveDeviceBridgeDownloadUrl(item.downloadUrl)}
                              >
                                {bridgeReleaseDownloadLabel(item)}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="local-device-bridge-panel__install-desc" role="status">
                暂时无法加载安装包列表，请稍后重试。
              </p>
            )}

            {panelStatus === "missing_bridge" ? (
              <p className="local-device-bridge-panel__already-installed">
                <button
                  type="button"
                  className="button subtle local-device-bridge-panel__already-installed-cta"
                  onClick={() => setViewStep(2)}
                >
                  已安装 Bridge？点这里继续配对
                </button>
              </p>
            ) : null}
          </>
        ) : null}

        {viewStep !== 1 && connectError ? <p className="local-device-bridge-panel__error">{connectError}</p> : null}

        {viewStep === 3 && health?.tools ? (
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
      </div>
    </>
  );
}
