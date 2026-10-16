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
import type { BrowserBridgeTarget } from "../infrastructure/http/bridgeReleaseSelection";
import { resolveDeviceBridgeDownloadUrl } from "../infrastructure/http/deviceBridgeDownloadUrl";
import type { DeviceBridgePairingCode, DeviceBridgeRecord, DeviceBridgeReleaseItem, LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import { BRIDGE_UPGRADE_NOTICE_TITLE, bridgePanelStatusHint, bridgePanelStatusLabel, bridgeServerUrlMismatch, canConnectBridgeWithoutPairingCode, describeLocalBridgeUpgradeMessage, isBridgeClientVersionBehind, isBridgePairingCodeExpired, isBridgeOnlinePanelStatus, needsLocalBridgeLaunch, needsPairingCodeForBridgeConnect, resolveInstalledBridgeClientVersion, resolvePairingCodeForBridgeConnect, shouldClearStaleBridgeConnectError, shouldPromptLocalBridgeUpgrade, type BridgePanelStatus, type DebugConnectionProtocol } from "./bridgePanelStatus";
import type { LocalBridgeReachability } from "../infrastructure/http/bridgeConnectLauncher";
import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";
import { ModalDialog } from "./common/ModalDialog";
import { SelectControl } from "./common/SelectControl";
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
  compact?: boolean;
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
  pairingError?: { message: string; detail: string } | null;
  onRefreshPairingCode?: () => Promise<void>;
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
  const active = viewStep === step;
  const done = naturalStep > step;
  const content = <>
    <span className="local-device-bridge-wizard__step-number" aria-hidden="true">{done && !active ? <Check size={12} /> : step}</span>
    <span>{label}</span>
  </>;

  return (
    <li data-active={active} data-done={done && !active} aria-current={active ? "step" : undefined}>
      {!active ? (
        <button type="button" className="local-device-bridge-wizard__step-button" aria-label={`查看${label}步骤`} onClick={() => onSelect(step)}>
          {content}
        </button>
      ) : (
        <span className="local-device-bridge-wizard__step-label">{content}</span>
      )}
    </li>
  );
}

export function LocalDeviceBridgeWizard({
  compact = false,
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
  pairingError,
  onRefreshPairingCode,
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [inlineGuideDismissed, setInlineGuideDismissed] = useState(false);
  const naturalStep = deriveNaturalWizardStep(panelStatus);
  const [viewStep, setViewStep] = useState<WizardViewStep>(naturalStep);
  const previousNaturalStep = useRef(naturalStep);
  const [hostTarget, setHostTarget] = useState<BrowserBridgeTarget>(detectBrowserBridgeTarget);
  const showSetupWizard = !isBridgeOnlinePanelStatus(panelStatus);
  const hostTargetLabel = bridgeHostTargetLabel(hostTarget);
  const hasInstallCatalog = Boolean(hostRelease || installerAlternates.length > 0 || portableReleases.length > 0);
  const showWindowsAdminInstallHint =
    hostTarget.platform === "windows" && viewStep === 1 && hasInstallCatalog && !releasesLoading;
  const connectUrlForFallback = buildBridgeConnectUrl(
    resolveBridgeServerUrl(),
    isBridgePairingCodeExpired(pairingCode) ? undefined : pairingCode?.code,
    resolveBridgeWebOrigin()
  );

  useEffect(() => {
    if (guideOpen && viewStep === 1) return;
    if (naturalStep > previousNaturalStep.current) {
      setViewStep(naturalStep);
    }
    previousNaturalStep.current = naturalStep;
  }, [naturalStep, viewStep, guideOpen]);

  useEffect(() => {
    if (shouldClearStaleBridgeConnectError({ connectError, health, panelStatus })) {
      onConnectError("");
    }
  }, [connectError, health, panelStatus, onConnectError]);

  const goToStep = async (step: WizardViewStep) => {
    setViewStep(step);
    if (step === 1 && !hasInstallCatalog) {
      await onLoadInstallReleases?.();
    }
  };

  const handleConnect = useCallback(async () => {
    if (connecting) return;
    const needsPairingCode = needsPairingCodeForBridgeConnect({
      panelStatus,
      pairingStale,
      pairingAuthFailure
    });
    const canConnectWithoutPairingCode = canConnectBridgeWithoutPairingCode({
      panelStatus,
      hasRegisteredBridge
    });
    const usesPairingCode = needsPairingCode || panelStatus === "not_running" || panelStatus === "bridge_blocked" ||
      bridgeServerUrlMismatch(health?.serverUrl, resolveBridgeServerUrl());
    if (usesPairingCode && pairingCode && isBridgePairingCodeExpired(pairingCode)) {
      onConnectError("配对码已过期，正在更新。更新后请再次点击「连接本机」。");
      await onRefreshPairingCode?.();
      return;
    }
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
      void onRefreshPairingCode?.();
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
        if (pairingCodeValue) void onRefreshPairingCode?.();
      }
    } catch (error) {
      onConnectError(error instanceof Error ? error.message : String(error));
      if (pairingCodeValue) void onRefreshPairingCode?.();
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
    hasRegisteredBridge,
    connecting,
    onRefreshPairingCode
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
  const allInstallers = [hostRelease, ...installerAlternates].filter((item): item is DeviceBridgeReleaseItem => item?.artifactKind === "installer");
  const hostInstaller = allInstallers.find((item) => isBridgeReleaseForHost(item, hostTarget));
  const portable = pickHostPortableRelease(portableReleases, hostTarget);
  const hostPortable = portable && isBridgeReleaseForHost(portable, hostTarget) ? portable : null;
  const otherInstallers = allInstallers.filter(
    (item) => !hostInstaller || item.downloadUrl !== hostInstaller.downloadUrl
  );
  const otherPortables = portableReleases.filter((item) => !hostPortable || item.downloadUrl !== hostPortable.downloadUrl);
  const installTargets = Array.from(new Map([hostRelease, ...installerAlternates, ...portableReleases]
    .filter((item): item is DeviceBridgeReleaseItem => Boolean(item))
    .map((item) => [`${item.platform}/${item.arch}`, item])).values());
  const hasReleaseCatalog = Boolean(hostRelease || installerAlternates.length > 0 || portableReleases.length > 0);
  const promptUpgrade = shouldPromptLocalBridgeUpgrade({
    health,
    bridges,
    recommendedVersion,
    hasReleaseCatalog
  });
  const installedClientVersion = resolveInstalledBridgeClientVersion({ health, bridges });
  const installerBehind = Boolean(hostInstaller && isBridgeClientVersionBehind(hostInstaller.version, hostPortable?.version || recommendedVersion));
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
  const connectionError = localError?.message || (connectError ? presentLocalBridgeError(connectError) : health?.pairingError);
  const technicalDetail = localError?.detail || connectError;

  const guide = (
    <>
      <ol className="local-device-bridge-wizard__steps" aria-label="Bridge 连接步骤">
        <WizardStepItem step={1} label="安装 Bridge" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={2} label="连接本机" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
        <WizardStepItem step={3} label="插入 USB 设备" viewStep={viewStep} naturalStep={naturalStep} onSelect={goToStep} />
      </ol>

      <div className="local-device-bridge-panel__body">
        {upgradeNotice}
        {viewStep === 2 ? (
          <section className="local-device-bridge-panel__step-content" aria-label="本机连接指引">
            <header className="local-device-bridge-panel__step-intro">
              <h3>连接这台电脑</h3>
              <p>让本地 Bridge 与当前网页建立连接，随后即可发现 USB 设备。</p>
            </header>
            <ol className="local-device-bridge-panel__checklist" aria-label="本机连接操作">
              <li><div><strong>打开本地 Bridge</strong><p>点击下方「连接本机」，在浏览器弹窗中允许打开 WiseEff Bridge。</p></div></li>
              <li><div><strong>等待连接完成</strong><p>保持 Bridge 运行。网页会自动完成配对，并更新连接状态。</p></div></li>
            </ol>
            <p className="local-device-bridge-panel__step-status" role="status">{isBridgeOnlinePanelStatus(panelStatus) ? "本机已连接，可以继续连接 USB 设备。" : connecting ? "正在连接，请留意浏览器的打开应用提示…" : "尚未连接 · 已安装 Bridge 后即可连接"}</p>
          </section>
        ) : null}
        {pairingError ? <div className="local-device-bridge-panel__error" role="alert">
          <p>{pairingError.message}</p>
          {pairingError.detail && pairingError.detail !== pairingError.message ? <details><summary>技术详情</summary><p>{pairingError.detail}</p></details> : null}
          <button type="button" className="button subtle" disabled={pairingCodeLoading}
            onClick={() => void onRefreshPairingCode?.()}>重试生成配对码</button>
        </div> : null}
        {viewStep === 1 ? (
          <>
            {releasesLoading ? (
              <p className="local-device-bridge-panel__install-desc" role="status">
                正在加载安装包列表...
              </p>
            ) : hasInstallCatalog ? (
              <>
                <div className="local-device-bridge-panel__host-banner">
                  <label htmlFor="bridge-install-target">安装环境</label>
                  <SelectControl id="bridge-install-target" value={`${hostTarget.platform}/${hostTarget.arch}`}
                    onValueChange={(value) => {
                      const [platform, arch] = value.split("/");
                      setHostTarget({ platform: platform as BrowserBridgeTarget["platform"], arch: arch! });
                    }} options={[
                      ...(!installTargets.some((item) => isBridgeReleaseForHost(item, hostTarget)) ? [{
                        value: `${hostTarget.platform}/${hostTarget.arch}`,
                        label: `${hostTargetLabel}${hostTarget.arch === "unknown" ? "" : "（暂无安装包）"}`
                      }] : []),
                      ...installTargets.map((item) => ({ value: `${item.platform}/${item.arch}`, label: bridgeHostTargetLabel(item) }))
                    ]} />
                  <small>{hostTarget.platform === "darwin" ? "浏览器无法可靠识别 Mac 芯片，请在「关于本机」核对 Apple Silicon 或 Intel。" : "请核对安装目标的操作系统与芯片架构。"}</small>
                </div>

                {showWindowsAdminInstallHint ? (
                  <p className="local-device-bridge-panel__install-notice" role="note">
                    <strong>Windows 安装提示：</strong>
                    {WINDOWS_BRIDGE_ADMIN_INSTALL_HINT}
                  </p>
                ) : null}

                <div className="local-device-bridge-panel__install-options">
                  <article className="local-device-bridge-panel__install-option">
                    <h4 className="local-device-bridge-panel__install-title">图形安装包{installerBehind ? "" : "（推荐）"}</h4>
                    <p className="local-device-bridge-panel__install-desc">
                      运行安装程序即可完成 Bridge 安装，自动注册连接协议、后台服务与托盘/菜单栏。安装后点击「连接本机」。
                    </p>

                    {hostInstaller ? (
                      <div className="local-device-bridge-panel__host-pick">
                        <span className="local-device-bridge-panel__host-badge">{installerBehind ? "较早版本" : "本机推荐"} · v{hostInstaller.version}</span>
                        <a
                          className={`button ${installerBehind ? "subtle" : "primary"} local-device-bridge-panel__install-cta`}
                          href={resolveDeviceBridgeDownloadUrl(hostInstaller.downloadUrl)}
                        >
                          <Download size={14} aria-hidden="true" />
                          {bridgeReleaseDownloadLabel(hostInstaller)}
                        </a>
                      </div>
                    ) : (
                      <p className="local-device-bridge-panel__install-desc">
                        {hostTarget.arch === "unknown"
                          ? "请先选择本机芯片架构，再查看对应安装包。"
                          : "当前环境暂无图形安装包。可展开下方「便携压缩包」手动部署，或选择其他平台安装包。"}
                      </p>
                    )}
                    {installerBehind ? (
                      <p className="local-device-bridge-panel__install-notice" role="note">
                        此平台图形安装包仍为 v{hostInstaller?.version}，低于推荐版本 v{hostPortable?.version || recommendedVersion}。
                        {hostPortable ? <>需要新版连接修复时，请使用下方便携包并按终端指引启动。</> : <>此平台新版安装包尚未提供，请勿重复安装旧版。</>}
                      </p>
                    ) : null}

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
                    <details className="local-device-bridge-panel__install-portable" open={installerBehind || undefined}>
                      <summary>便携压缩包（zip / tar.gz）</summary>
                      <div className="local-device-bridge-panel__install-portable-body">
                        <p className="local-device-bridge-panel__install-desc">
                          下载后解压，确认已安装 Node.js，在包含 cli.js 的解压目录打开终端（Windows 可使用 PowerShell 或命令提示符），执行下方命令启动并连接便携版。
                        </p>

                        {hostPortable ? (
                          <>
                          <div className="local-device-bridge-panel__host-pick local-device-bridge-panel__host-pick--portable">
                            <span className="local-device-bridge-panel__host-badge">{installerBehind ? "推荐便携包" : "本机便携包"} · v{hostPortable.version}</span>
                            <a
                              className={`button ${installerBehind ? "primary" : "subtle"} local-device-bridge-panel__install-cta-secondary`}
                              href={resolveDeviceBridgeDownloadUrl(hostPortable.downloadUrl)}
                            >
                              <Download size={14} aria-hidden="true" />
                              {bridgeReleaseDownloadLabel(hostPortable)}
                            </a>
                          </div>
                          <CopyableCommand label="便携版连接命令" command={formatBridgeConnectFallbackCommand({
                            platform: hostPortable.platform,
                            serverUrl: resolveBridgeServerUrl(),
                            webOrigin: resolveBridgeWebOrigin(),
                            code: isBridgePairingCodeExpired(pairingCode) ? undefined : pairingCode?.code,
                            portable: true
                          })} />
                          <p className="local-device-bridge-panel__install-desc">请保持解压目录位置不变。命令执行完成后，返回本页刷新状态；不要使用旧安装版路径启动便携版。</p>
                          </>
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
              <div className="local-device-bridge-panel__install-desc" role="status">
                暂时无法加载安装包列表，请稍后重试。
                <button type="button" className="button subtle" onClick={() => void onLoadInstallReleases?.()}>重新加载安装包</button>
              </div>
            )}

          </>
        ) : null}

        {viewStep === 3 ? (
          <section className="local-device-bridge-panel__step-content" aria-label="USB 设备连接指引">
            <header className="local-device-bridge-panel__step-intro">
              <h3>连接并授权设备</h3>
              <p>当前使用 {protocol.toUpperCase()} 协议。完成设备授权后，再检测连接。</p>
            </header>
            <ol className="local-device-bridge-panel__checklist" aria-label="USB 设备连接操作">
              <li><div><strong>使用 USB 数据线直连电脑</strong><p>确认设备已开机并解锁，使用支持数据传输的 USB 线。</p></div></li>
              <li><div><strong>开启调试并允许授权</strong><p>{protocol === "adb" ? "在 Android 设备开启开发者选项和 USB 调试，允许此电脑的调试授权。" : "在设备开启开发者模式和 USB 调试，在设备端允许此电脑通过 HDC 调试。"}</p></div></li>
              <li><div><strong>返回网页检测设备</strong><p>如设备类型不匹配，请关闭指南，在页面切换 HDC / ADB 后再检测。</p></div></li>
            </ol>
            {!isBridgeOnlinePanelStatus(panelStatus) ? <p className="local-device-bridge-panel__step-status" role="status">请先完成「连接本机」，再检测 USB 设备。</p> : null}
            {health?.tools && isBridgeOnlinePanelStatus(panelStatus) ? (
              <LocalDeviceBridgeToolsPanel health={health} protocol={protocol}
                panelStatus={panelStatus as "tools_missing" | "online_no_device" | "bridges_with_targets"}
                onInstallError={onConnectError} onInstallComplete={async () => { await onRefresh(); }} />
            ) : null}
            <details className="local-device-bridge-panel__guide-details"><summary>仍未发现设备？</summary><p>更换数据线或 USB 接口，重新插拔并核对设备上的授权弹窗；避免仅充电线、USB 集线器和其他程序占用调试连接。工具不可用时先安装对应调试工具，再重新检测。</p></details>
          </section>
        ) : null}
        {viewStep === 2 &&
        shouldShowBridgeConnectFallback({
          viewStep,
          pairingCode,
          health,
          connectError,
          needsLocalLaunch: needsLocalBridgeLaunch(panelStatus)
        }) ? (
          <details className="local-device-bridge-panel__guide-details" open={Boolean(connectError)}>
            <summary>使用终端手动连接</summary>
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
                code: isBridgePairingCodeExpired(pairingCode) ? undefined : pairingCode?.code,
                cliPath: health?.launcherPath
              })}
            />
            {!health?.launcherPath ? (
              <p className="local-device-bridge-panel__install-desc">{bridgeCliDiscoveryHint(hostTarget.platform)}</p>
            ) : null}
          </details>
        ) : null}
        {viewStep === 2 ? <details className="local-device-bridge-panel__guide-details">
          <summary>手动配对码</summary>
          <p>网页连接会自动传入配对信息。仅在 Bridge 提示手动配对时，复制下方配对码。</p>
        {pairingCodeLoading ? (
          <p className="local-device-bridge-panel__install-desc" role="status">正在生成配对码...</p>
        ) : pairingCode ? (
          <div className="local-device-bridge-panel__pairing-code">
            <span>{isBridgePairingCodeExpired(pairingCode) ? "配对码已过期" : <>配对码 · 有效至 <time dateTime={pairingCode.expiresAt}>{formatAbsolute(pairingCode.expiresAt)}</time></>}</span>
            {!isBridgePairingCodeExpired(pairingCode) ? <CopyableCommand command={pairingCode.code} label="配对码" /> : null}
            <button type="button" className="button subtle" disabled={connecting || pairingCodeLoading} onClick={() => void onRefreshPairingCode?.()}>重新生成配对码</button>
          </div>
        ) : pairingCodeRequiredForConnect ? <button type="button" className="button subtle" onClick={() => void onRefreshPairingCode?.()}>生成配对码</button> : <p>当前连接无需手动配对码。</p>}
        </details> : null}
        {connectionError && guideOpen ? <div className="local-device-bridge-panel__error" role="alert"><p>{connectionError}</p>
          {technicalDetail && technicalDetail !== connectionError ? <details className="local-device-bridge-panel__guide-details"><summary>技术详情</summary><p>{technicalDetail}</p></details> : null}
          {localError ? <button type="button" className="button subtle" disabled={checking} onClick={() => void onRefresh()}>刷新代理状态</button> : null}
        </div> : null}
      </div>
    </>
  );

  const showInlineGuide = !compact && bridgeListLoaded && !inlineGuideDismissed && !guideOpen &&
    !isBridgeOnlinePanelStatus(panelStatus) && !bridges.some((bridge) => !bridge.revokedAt);
  const closeGuide = () => {
    setGuideOpen(false);
  };
  const connectButton = (
    <button type="button" className="button primary"
      disabled={checking || detecting || connecting || ((pairingCodeRequiredForConnect || Boolean(pairingCode)) && pairingCodeLoading)}
      onClick={() => {
        setViewStep(2);
        if (compact || inlineGuideDismissed) setGuideOpen(true);
        void handleConnect();
      }}><Link2 size={14} aria-hidden="true" />连接本机</button>
  );
  const guideFooter = <footer className="local-device-bridge-panel__guide-footer">
    <p>{viewStep === 1 ? "安装完成后，继续连接这台电脑。" : viewStep === 2 ? "首次连接时，请允许浏览器打开 WiseEff Bridge。" : "设备授权后，检测结果会显示在工作台中。"}</p>
    {viewStep === 3 && isBridgeOnlinePanelStatus(panelStatus) ? (
      <button type="button" className="button primary" disabled={checking || detecting || panelStatus === "tools_missing"} onClick={onDetect}>
        {detecting ? "正在检测设备…" : "检测 USB 设备"}
      </button>
    ) : isBridgeOnlinePanelStatus(panelStatus) ? (
      <button type="button" className="button primary" onClick={() => goToStep(3)}>继续连接 USB 设备</button>
    ) : connectButton}
  </footer>;

  return (
    <>
      <div className="local-device-bridge-panel__readiness" aria-busy={checking || connecting}>
        {isBridgeOnlinePanelStatus(panelStatus) ? connectedChip : (
          <span role="status" className="local-device-bridge-panel__readiness-status" title={statusHint}>
            <span className="local-device-bridge-panel__status-dot" aria-hidden="true" />
            {connecting ? "正在连接…" : checking ? "正在检查 Bridge…" : bridgePanelStatusLabel(panelStatus)}
          </span>
        )}
        {!guideOpen && !isBridgeOnlinePanelStatus(panelStatus) ? connectButton : null}
        <button type="button" className="button subtle" onClick={() => {
          setInlineGuideDismissed(true);
          setGuideOpen(true);
          if (!hasInstallCatalog) void onLoadInstallReleases?.();
        }}>安装指南</button>
        {isBridgeOnlinePanelStatus(panelStatus) ? (
          <>
            <span className="local-device-bridge-panel__readiness-hint">{bridgePanelStatusLabel(panelStatus)}</span>
            <button type="button" className="button subtle" onClick={() => { setViewStep(3); setGuideOpen(true); }}>设备连接与排查</button>
          </>
        ) : null}
        {compact && upgradeNotice ? (
          <span className="local-device-bridge-panel__readiness-hint">{BRIDGE_UPGRADE_NOTICE_TITLE} · 请打开安装指南更新</span>
        ) : null}
        {pairingStale || pairingAuthFailure || panelStatus === "bridge_blocked" ? (
          <p className="local-device-bridge-panel__readiness-hint">{statusHint}</p>
        ) : null}
        {connectionError && !guideOpen ? (
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
      {!compact && !showInlineGuide && !guideOpen ? upgradeNotice : null}
      {panelStatus === "tools_missing" && !guideOpen && health?.tools ? (
        <LocalDeviceBridgeToolsPanel health={health} protocol={protocol} panelStatus="tools_missing"
          onInstallError={onConnectError} onInstallComplete={async () => { await onRefresh(); }} />
      ) : null}
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
            {guideFooter}
          </>
        )}
      </ModalDialog>
    </>
  );
}
