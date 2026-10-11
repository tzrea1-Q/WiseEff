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
import type { DeviceBridgePairingCode, DeviceBridgeRecord, DeviceBridgeReleaseItem, LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import { BRIDGE_UPGRADE_NOTICE_TITLE, bridgePanelStatusHint, canConnectBridgeWithoutPairingCode, describeLocalBridgeUpgradeMessage, isBridgeOnlinePanelStatus, needsLocalBridgeLaunch, needsPairingCodeForBridgeConnect, resolveInstalledBridgeClientVersion, resolvePairingCodeForBridgeConnect, shouldClearStaleBridgeConnectError, shouldPromptLocalBridgeUpgrade, type BridgePanelStatus, type DebugConnectionProtocol } from "./bridgePanelStatus";
import type { LocalBridgeReachability } from "../infrastructure/http/bridgeConnectLauncher";
import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";
import { ModalDialog } from "./common/ModalDialog";
import { presentLocalBridgeError } from "../infrastructure/http/presentError";
import { formatAbsolute } from "../domain/format/formatDateTime";

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
  bridgeListLoaded?: boolean;
  healthReachability?: LocalBridgeReachability;
  protocol: DebugConnectionProtocol;
  health: LocalBridgeHealthState | null;
  bridges?: DeviceBridgeRecord[];
  recommendedVersion?: string | null;
  hostRelease: DeviceBridgeReleaseItem | null;
  installerAlternates: DeviceBridgeReleaseItem[];
  portableReleases: DeviceBridgeReleaseItem[];
  pairingCode: DeviceBridgePairingCode | null;
  pairingCodeLoading: boolean;
  checking: boolean;
  detecting: boolean;
  connectError: string;
  localError?: { message: string; detail: string } | null;
  onConnectError: (message: string) => void;
  onRefresh: (options?: { connectionAttempt?: boolean }) => Promise<{
    connected: boolean;
    health?: LocalBridgeHealthState | null;
    registeredBridgeIds?: string[];
    listingFailed?: boolean;
    listingError?: string;
  }>;
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

function LocalBridgeUpgradeNotice({
  installedVersion,
  recommendedVersion,
  onOpenInstall
}: {
  installedVersion: string | null;
  recommendedVersion: string;
  onOpenInstall?: () => void;
}) {
  return (
    <div className="local-device-bridge-panel__install-notice local-device-bridge-panel__upgrade-notice" role="status">
      <p>
        <strong>{BRIDGE_UPGRADE_NOTICE_TITLE}</strong>
        {" "}
        {describeLocalBridgeUpgradeMessage({ installedVersion, recommendedVersion })}
        请使用与首次安装相同的图形安装包；便携压缩包仅作备选。
      </p>
      {onOpenInstall ? (
        <div className="local-device-bridge-panel__upgrade-actions">
          <button type="button" className="button primary local-device-bridge-panel__install-cta" onClick={onOpenInstall}>
            <Download size={14} aria-hidden="true" />
            下载安装包
          </button>
        </div>
      ) : null}
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
        <button type="button" className="local-device-bridge-wizard__step-button" aria-label={`查看${label}步骤`} onClick={() => onSelect(step)}>
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
  bridgeListLoaded = true,
  healthReachability = "offline",
  protocol,
  health,
  bridges = [],
  recommendedVersion = null,
  hostRelease,
  installerAlternates,
  portableReleases,
  pairingCode,
  pairingCodeLoading,
  checking,
  detecting,
  connectError,
  localError,
  onConnectError,
  onRefresh,
  onDetect,
  releasesLoading = false,
  onLoadInstallReleases
}: LocalDeviceBridgeWizardProps) {
  const [connecting, setConnecting] = useState(false);
  const [allowStep2WhileMissing, setAllowStep2WhileMissing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [inlineGuideDismissed, setInlineGuideDismissed] = useState(false);
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
    if (guideOpen && viewStep === 1) return;
    if (panelStatus === "missing_bridge") {
      if (!allowStep2WhileMissing) {
        setViewStep(1);
        previousNaturalStep.current = 1;
      }
      return;
    }

    setAllowStep2WhileMissing(false);

    if (naturalStep > previousNaturalStep.current || viewStep > naturalStep) {
      setViewStep(naturalStep);
    }
    previousNaturalStep.current = naturalStep;
  }, [naturalStep, panelStatus, allowStep2WhileMissing, viewStep, guideOpen]);

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

    const previousBridgeId = health?.bridgeId;
    setConnecting(true);
    onConnectError("");
    try {
      const connectResult = await connectLocalBridge({
        server: serverUrl,
        webOrigin,
        code: pairingCodeValue,
        launchSchemeFallback: false
      });
      const nextHealth = await pollLocalBridgeHealth({
        timeoutMs: shouldLaunchScheme ? 45_000 : 30_000,
        ...(pairingStale && previousBridgeId ? { excludeBridgeId: previousBridgeId } : {})
      });
      const refreshSnapshot = await onRefresh({ connectionAttempt: true });
      if (refreshSnapshot.connected) {
        onConnectError("");
        onDetect();
      } else {
        onConnectError(
          describeBridgeConnectFailureMessage({
            health: refreshSnapshot.health ?? nextHealth,
            connectResult,
            previousBridgeId,
            registeredBridgeIds: refreshSnapshot.registeredBridgeIds,
            listingFailed: refreshSnapshot.listingFailed,
            listingError: refreshSnapshot.listingError,
            reconnectAttempted: Boolean(pairingCodeValue)
          })
        );
      }
    } catch (error) {
      onConnectError(error instanceof Error ? error.message : String(error));
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
    health,
    hasRegisteredBridge
  ]);

  // Only a connect flow that actually consumes a pairing code should be blocked
  // while the code is loading. Statuses like "not_running" connect without a
  // code, so gating them on pairingCodeLoading would wrongly disable the button.
  const pairingCodeRequiredForConnect = needsPairingCodeForBridgeConnect({
    panelStatus,
    pairingStale,
    pairingAuthFailure
  });

  const statusHint =
    viewStep === 1 && naturalStep > 1
      ? "可下载安装包升级或重装 Bridge，完成后点击「连接本机」。"
      : bridgePanelStatusHint(panelStatus, protocol, {
          pairingStale,
          authFailure: pairingAuthFailure,
          healthReachability,
          connecting
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
  const hasReleaseCatalog = Boolean(hostRelease || installerAlternates.length > 0 || portableReleases.length > 0);
  const promptUpgrade = shouldPromptLocalBridgeUpgrade({
    health,
    bridges,
    recommendedVersion,
    hasReleaseCatalog
  });
  const installedClientVersion = resolveInstalledBridgeClientVersion({ health, bridges });
  const openInstallStep = () => {
    setInlineGuideDismissed(true);
    setGuideOpen(true);
    setViewStep(1);
    if (!hasInstallCatalog) void onLoadInstallReleases?.();
  };
  const upgradeNotice =
    promptUpgrade && recommendedVersion ? (
      <LocalBridgeUpgradeNotice
        installedVersion={installedClientVersion}
        recommendedVersion={recommendedVersion}
        onOpenInstall={showSetupWizard && viewStep === 1 ? undefined : openInstallStep}
      />
    ) : null;

  const connectedChip = (
    <span className="local-device-bridge-panel__connected" role="status" title={statusHint}>
      <span className="local-device-bridge-panel__status-dot" aria-hidden="true" />
      已连接 · {bridges.find((bridge) => bridge.id === health?.bridgeId)?.machineLabel || "本机"}
    </span>
  );

  if ((panelStatus === "bridges_with_targets" || panelStatus === "online_no_device") && !guideOpen) {
    return (
      <div className="local-device-bridge-panel__ready">
        {connectedChip}
        {upgradeNotice}
      </div>
    );
  }

  if (panelStatus === "tools_missing" && !guideOpen) {
    return (
      <>
        {connectedChip}
        <p className="local-device-bridge-panel__install-desc">{statusHint}</p>
        <div className="local-device-bridge-panel__body">
          {upgradeNotice}
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

  const guide = (
    <>
      <ol className="local-device-bridge-wizard__steps" aria-label="Bridge 连接步骤">
        <WizardStepItem step={1} label="安装 Bridge" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={2} label="连接本机" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={3} label="插入 USB 设备" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
      </ol>

      <div className="local-device-bridge-panel__body">
        {upgradeNotice}
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
                      运行安装程序即可完成 Bridge 安装，自动注册连接协议、后台服务与托盘/菜单栏。安装后点击「连接本机」。
                    </p>

                    {hostInstaller ? (
                      <div className="local-device-bridge-panel__host-pick">
                        <span className="local-device-bridge-panel__host-badge">本机推荐</span>
                        <a
                          className="button primary local-device-bridge-panel__install-cta"
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

          </>
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
        {pairingCodeLoading ? (
          <p className="local-device-bridge-panel__install-desc" role="status">正在生成配对码...</p>
        ) : pairingCode ? (
          <div className="local-device-bridge-panel__pairing-code">
            <span>配对码 · 有效至 <time dateTime={pairingCode.expiresAt}>{formatAbsolute(pairingCode.expiresAt)}</time></span>
            <CopyableCommand command={pairingCode.code} label="配对码" />
          </div>
        ) : null}
      </div>
    </>
  );

  const showInlineGuide = bridgeListLoaded && !inlineGuideDismissed && !guideOpen &&
    !isBridgeOnlinePanelStatus(panelStatus) && !bridges.some((bridge) => !bridge.revokedAt);
  const closeGuide = () => {
    setGuideOpen(false);
  };
  const connectionError = localError?.message || (connectError ? presentLocalBridgeError(connectError) : health?.pairingError);
  const technicalDetail = localError?.detail || connectError;
  const connectButton = (
    <button type="button" className="button primary"
      disabled={checking || detecting || connecting || (pairingCodeRequiredForConnect && pairingCodeLoading)}
      onClick={() => {
        setInlineGuideDismissed(true);
        closeGuide();
        setAllowStep2WhileMissing(true);
        setViewStep(2);
        void handleConnect();
      }}><Link2 size={14} aria-hidden="true" />连接本机</button>
  );

  return (
    <>
      <div className="local-device-bridge-panel__readiness" aria-busy={checking || connecting}>
        {isBridgeOnlinePanelStatus(panelStatus) ? connectedChip : (
          <span role="status" className="local-device-bridge-panel__readiness-status" title={statusHint}>
            <span className="local-device-bridge-panel__status-dot" aria-hidden="true" />
            {checking || connecting ? "正在连接…" : "本地 Bridge 未运行"}
          </span>
        )}
        {!guideOpen && !isBridgeOnlinePanelStatus(panelStatus) ? connectButton : null}
        <button type="button" className="button subtle" onClick={openInstallStep}>安装指南</button>
        {pairingStale || pairingAuthFailure || panelStatus === "bridge_blocked" ? (
          <p className="local-device-bridge-panel__readiness-hint">{statusHint}</p>
        ) : null}
        {connectionError ? (
          <div className="local-device-bridge-panel__error" role="alert">
            <p>{connectionError}</p>
            {technicalDetail && technicalDetail !== connectionError ? (
              <details><summary>技术详情</summary><p>{technicalDetail}</p></details>
            ) : null}
            {localError ? <button type="button" className="button subtle" disabled={checking}
              onClick={() => void onRefresh()}>刷新代理状态</button> : null}
          </div>
        ) : null}
      </div>
      {!showInlineGuide && !guideOpen ? upgradeNotice : null}
      {showInlineGuide ? (
        <section className="local-device-bridge-panel__guide" aria-label="安装与连接本地 Bridge">
          <button type="button" className="button subtle" onClick={() => setInlineGuideDismissed(true)}>收起安装指南</button>
          {guide}
        </section>
      ) : null}
      <ModalDialog open={guideOpen} onDismiss={closeGuide} className="local-device-bridge-panel__guide-drawer"
        backdropClassName="local-device-bridge-panel__guide-backdrop">
        {({ titleId }) => (
          <>
            <div className="local-device-bridge-panel__head">
              <h2 id={titleId}>安装与连接本地 Bridge</h2>
              <button type="button" className="button subtle" onClick={closeGuide}>关闭安装指南</button>
            </div>
            {guide}
            {!isBridgeOnlinePanelStatus(panelStatus) ? connectButton : null}
          </>
        )}
      </ModalDialog>
    </>
  );
}
