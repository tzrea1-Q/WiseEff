import { Check, Copy, Download, Link2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatBridgeConnectFallbackCommand,
  formatBridgeHandleUrlFallbackCommand,
  bridgeCliDiscoveryHint
} from "../infrastructure/http/bridgeInstallPaths";
import {
  buildBridgeConnectUrl,
  connectLocalBridge,
  launchBridgeSchemeForConnect,
  pollLocalBridgeHealth
} from "../infrastructure/http/bridgeConnectLauncher";
import { describeBridgeConnectFailureMessage, shouldShowBridgeConnectFallback } from "../infrastructure/http/bridgeConnectFailure";
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
import { bridgePanelStatusHint, canConnectBridgeWithoutPairingCode, isBridgeOnlinePanelStatus, needsLocalBridgeLaunch, needsPairingCodeForBridgeConnect, resolvePairingCodeForBridgeConnect, shouldClearStaleBridgeConnectError, type BridgePanelStatus, type DebugConnectionProtocol } from "./bridgePanelStatus";
import type { LocalBridgeReachability } from "../infrastructure/http/bridgeConnectLauncher";
import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";

export type { BridgePanelStatus } from "./bridgePanelStatus";

export const WINDOWS_BRIDGE_ADMIN_INSTALL_HINT =
  "请右键安装包，选择「以管理员身份运行」。管理员权限用于正确注册 wiseeff-bridge:// 协议；若未提权，浏览器可能无法唤起 Bridge。";

export type WizardViewStep = 1 | 2 | 3;

export function deriveWizardStep(panelStatus: BridgePanelStatus): 1 | 2 | 3 | "done" {
  switch (panelStatus) {
    case "missing_bridge":
      return 1;
    case "bridge_blocked":
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
  hasRegisteredBridge?: boolean;
  healthReachability?: LocalBridgeReachability;
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

function CopyableCommand({ command, label = "命令" }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="local-device-bridge-panel__command-block">
      <pre className="local-device-bridge-panel__command-code">
        <code>{command}</code>
      </pre>
      <button
        type="button"
        className="local-device-bridge-panel__command-copy"
        aria-label={copied ? `已复制${label}` : `复制${label}`}
        title={copied ? "已复制" : "复制"}
        onClick={() => void handleCopy()}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
    </div>
  );
}

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
  hasRegisteredBridge = false,
  healthReachability = "offline",
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
  const [allowStep2WhileMissing, setAllowStep2WhileMissing] = useState(false);
  const naturalStep = deriveNaturalWizardStep(panelStatus);
  const [viewStep, setViewStep] = useState<WizardViewStep>(naturalStep);
  const previousNaturalStep = useRef(naturalStep);
  const hostTarget = detectBrowserBridgeTarget();
  const showSetupWizard = !isBridgeOnlinePanelStatus(panelStatus);
  const hostTargetLabel = bridgeHostTargetLabel(hostTarget);
  const hasInstallCatalog = Boolean(hostRelease || installerAlternates.length > 0 || portableReleases.length > 0);
  const showWindowsAdminInstallHint =
    hostTarget.platform === "windows" && viewStep === 1 && hasInstallCatalog && !releasesLoading;
  const connectUrlForFallback = buildBridgeConnectUrl(
    resolveBridgeServerUrl(),
    pairingCode?.code,
    resolveBridgeWebOrigin()
  );

  useEffect(() => {
    if (panelStatus === "missing_bridge") {
      if (!allowStep2WhileMissing) {
        setViewStep(1);
        previousNaturalStep.current = 1;
      }
      return;
    }

    setAllowStep2WhileMissing(false);

    if (naturalStep > previousNaturalStep.current) {
      setViewStep(naturalStep);
    }
    previousNaturalStep.current = naturalStep;
  }, [naturalStep, panelStatus, allowStep2WhileMissing]);

  useEffect(() => {
    if (shouldClearStaleBridgeConnectError({ connectError, health, panelStatus })) {
      onConnectError("");
    }
  }, [connectError, health, panelStatus, onConnectError]);

  const goToStep = async (step: WizardViewStep) => {
    if (step > naturalStep) {
      return;
    }
    setViewStep(step);
    if (step === 1 && !hasInstallCatalog) {
      await onLoadInstallReleases?.();
    }
  };

  const handleConnect = useCallback(async () => {
    if (viewStep === 3 || panelStatus === "bridges_with_targets") {
      onDetect();
      return;
    }

    if (viewStep !== 2) {
      return;
    }

    const needsPairingCode = needsPairingCodeForBridgeConnect({
      panelStatus,
      pairingStale,
      pairingAuthFailure
    });
    const canConnectWithoutPairingCode = canConnectBridgeWithoutPairingCode({
      panelStatus,
      hasRegisteredBridge
    });
    const serverUrl = resolveBridgeServerUrl();
    const webOrigin = resolveBridgeWebOrigin();
    const pairingCodeValue = resolvePairingCodeForBridgeConnect({
      panelStatus,
      pairingStale,
      pairingAuthFailure,
      pairingCode,
      health,
      targetServerUrl: serverUrl
    });

    if (!pairingCodeValue && needsPairingCode) {
      onConnectError("配对码尚未就绪，请稍后重试。");
      return;
    }

    if (!pairingCodeValue && !canConnectWithoutPairingCode) {
      onConnectError("配对码尚未就绪，请稍后重试。");
      return;
    }

    const shouldLaunchScheme = needsLocalBridgeLaunch(panelStatus);

    // Custom protocol URLs must launch synchronously inside the click handler (before any await).
    if (shouldLaunchScheme) {
      launchBridgeSchemeForConnect({
        server: serverUrl,
        webOrigin,
        code: pairingCodeValue
      });
    }

    setConnecting(true);
    onConnectError("");
    try {
      await connectLocalBridge({
        server: serverUrl,
        webOrigin,
        code: pairingCodeValue,
        launchSchemeFallback: false
      });
      const nextHealth = await pollLocalBridgeHealth({
        timeoutMs: shouldLaunchScheme ? 45_000 : 30_000
      });
      const refreshSnapshot = await onRefresh();
      const connected = Boolean(nextHealth?.connected || refreshSnapshot.connected);
      if (connected) {
        onConnectError("");
        onDetect();
      } else {
        onConnectError(
          describeBridgeConnectFailureMessage({
            health: nextHealth,
            pairingStale,
            pairingAuthFailure
          })
        );
      }
    } finally {
      setConnecting(false);
    }
  }, [
    onConnectError,
    onDetect,
    onRefresh,
    pairingAuthFailure,
    pairingCode,
    pairingStale,
    panelStatus,
    hasRegisteredBridge,
    viewStep
  ]);

  // Only a connect flow that actually consumes a pairing code should be blocked
  // while the code is loading. Statuses like "not_running" connect without a
  // code, so gating them on pairingCodeLoading would wrongly disable the button.
  const pairingCodeRequiredForConnect = needsPairingCodeForBridgeConnect({
    panelStatus,
    pairingStale,
    pairingAuthFailure
  });

  const primaryLabel =
    viewStep === 2
      ? pairingStale || pairingAuthFailure || panelStatus === "not_paired"
        ? "重新配对"
        : panelStatus === "not_connected"
          ? "重新连接"
          : needsLocalBridgeLaunch(panelStatus)
            ? "启动并连接本机"
            : "连接本机"
      : viewStep === 3
        ? panelStatus === "tools_missing"
          ? "安装调试工具"
          : "重新检测设备"
        : "连接本地设备";

  const statusHint =
    viewStep === 1 && naturalStep > 1
      ? "可下载安装包升级或重装 Bridge，完成后点击步骤 2 继续连接。"
      : bridgePanelStatusHint(panelStatus, protocol, {
          pairingStale,
          authFailure: pairingAuthFailure,
          healthReachability
        });
  const hostInstaller =
    hostRelease?.artifactKind === "installer"
      ? hostRelease
      : installerAlternates.find((item) => isBridgeReleaseForHost(item, hostTarget));
  const hostPortable = pickHostPortableRelease(portableReleases, hostTarget);
  const otherInstallers = installerAlternates.filter(
    (item) => !hostInstaller || item.downloadUrl !== hostInstaller.downloadUrl
  );
  const otherPortables = portableReleases.filter((item) => !hostPortable || item.downloadUrl !== hostPortable.downloadUrl);
  const showPrimaryAction = showSetupWizard ? viewStep === 2 || viewStep === 3 : true;

  if (panelStatus === "bridges_with_targets") {
    return (
      <div className="local-device-bridge-panel__ready">
        <div className="local-device-bridge-panel__head">
          <div>
            <strong>本地设备桥接</strong>
            <small>{statusHint}</small>
          </div>
          <button
            className="button subtle"
            type="button"
            disabled={checking || detecting || connecting}
            onClick={() => onDetect()}
          >
            <Link2 size={14} aria-hidden="true" />
            {detecting ? "检测中..." : "重新检测设备"}
          </button>
        </div>
      </div>
    );
  }

  if (panelStatus === "online_no_device") {
    return (
      <div className="local-device-bridge-panel__ready">
        <div className="local-device-bridge-panel__head">
          <div>
            <strong>本地设备桥接</strong>
            <small>{statusHint}</small>
          </div>
          <button
            className="button subtle"
            type="button"
            disabled={checking || detecting || connecting}
            onClick={() => onDetect()}
          >
            <Link2 size={14} aria-hidden="true" />
            {detecting ? "检测中..." : "重新检测设备"}
          </button>
        </div>
      </div>
    );
  }

  if (panelStatus === "tools_missing") {
    return (
      <>
        <div className="local-device-bridge-panel__head">
          <div>
            <strong>本地设备桥接</strong>
            <small>{statusHint}</small>
          </div>
        </div>
        <div className="local-device-bridge-panel__body">
          {connectError ? <p className="local-device-bridge-panel__error">{connectError}</p> : null}
          {health?.tools ? (
            <LocalDeviceBridgeToolsPanel
              health={health}
              protocol={protocol}
              panelStatus="tools_missing"
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
            disabled={checking || detecting || connecting || (viewStep === 2 && pairingCodeRequiredForConnect && pairingCodeLoading)}
            onClick={() => {
              handleConnect();
            }}
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

                {showWindowsAdminInstallHint ? (
                  <p className="local-device-bridge-panel__install-notice" role="note">
                    <strong>Windows 安装提示：</strong>
                    {WINDOWS_BRIDGE_ADMIN_INSTALL_HINT}
                  </p>
                ) : null}

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

            {needsLocalBridgeLaunch(panelStatus) ? (
              <p className="local-device-bridge-panel__already-installed">
                {pairingCodeLoading ? (
                  <span className="local-device-bridge-panel__install-desc">正在生成配对码...</span>
                ) : pairingCode ? (
                  <span className="local-device-bridge-panel__install-desc">
                    当前配对码：<strong>{pairingCode.code}</strong>（约 30 分钟内有效，用于终端兜底命令）
                  </span>
                ) : null}
                <button
                  type="button"
                  className="button local-device-bridge-panel__already-installed-cta"
                  onClick={() => {
                    setAllowStep2WhileMissing(true);
                    setViewStep(2);
                  }}
                >
                  {panelStatus === "missing_bridge"
                    ? "Bridge 已安装但未运行？点此自动启动并配对"
                    : "Bridge 未运行？点此自动启动并连接"}
                </button>
              </p>
            ) : null}
          </>
        ) : null}

        {viewStep !== 1 && connectError ? <p className="local-device-bridge-panel__error">{connectError}</p> : null}

        {viewStep !== 1 && !connectError && health?.pairingError ? (
          <p className="local-device-bridge-panel__error" role="alert">{health.pairingError}</p>
        ) : null}

        {viewStep === 2 &&
        shouldShowBridgeConnectFallback({
          viewStep,
          pairingCode,
          health,
          connectError,
          needsLocalLaunch: needsLocalBridgeLaunch(panelStatus)
        }) ? (
          <div className="local-device-bridge-panel__install-desc" role="status">
            {pairingCode ? (
              <p>
                配对码：<strong>{pairingCode.code}</strong>
              </p>
            ) : null}
            <p>
              若网页未能自动打开 Bridge，请在 Bridge 安装目录打开终端并执行：
            </p>
            {hostTarget.platform === "windows" ? (
              <>
                <p className="local-device-bridge-panel__install-desc">推荐（与浏览器点击连接等效）：</p>
                <CopyableCommand
                  command={formatBridgeHandleUrlFallbackCommand({
                    cliPath: health?.launcherPath,
                    connectUrl: connectUrlForFallback
                  })}
                />
                <p className="local-device-bridge-panel__install-desc">或使用 connect 子命令：</p>
              </>
            ) : null}
            <CopyableCommand
              command={formatBridgeConnectFallbackCommand({
                platform: hostTarget.platform,
                serverUrl: resolveBridgeServerUrl(),
                webOrigin: resolveBridgeWebOrigin(),
                code: pairingCode?.code,
                cliPath: health?.launcherPath
              })}
            />
            {!health?.launcherPath ? (
              <p className="local-device-bridge-panel__install-desc">{bridgeCliDiscoveryHint(hostTarget.platform)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
