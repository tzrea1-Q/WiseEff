import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

import { LocalDeviceBridgeWizard } from "./LocalDeviceBridgeWizard";
import {
  deriveBridgePanelStatus,
  countActiveBridgesForPlatform,
  isLocalBridgeAuthFailure,
  isLocalBridgePairingStale,
  isLocalBridgeTokenExpired,
  shouldFetchBridgePairingCode,
  type BridgePanelStatus,
  type DebugConnectionProtocol
} from "./bridgePanelStatus";
import { formatBridgeLastSeen, inferBridgeOnline } from "./bridgeOnline";
import {
  createPairingCode,
  listMyBridges,
  listReleases,
  renameBridge,
  revokeBridge,
  type DeviceBridgePairingCode,
  type DeviceBridgeRecord,
  type DeviceBridgeReleaseItem,
  type LocalBridgeHealthState
} from "../infrastructure/http/deviceBridgeClient";
import { resolveBridgeServerUrl } from "../infrastructure/http/bridgeServerUrl";
import {
  probeLocalBridgeHealthDetailed,
  type LocalBridgeProbeResult,
  type LocalBridgeReachability
} from "../infrastructure/http/bridgeConnectLauncher";
import {
  detectBrowserBridgeTarget,
  listInstallerBridgeReleases,
  listPortableBridgeReleases,
  pickBridgeReleaseForHost
} from "../infrastructure/http/bridgeReleaseSelection";
import { presentError, presentLocalBridgeError } from "../infrastructure/http/presentError";
import "./local-device-bridge.css";

type BridgeRefreshResult = {
  connected: boolean;
  health?: LocalBridgeHealthState | null;
  registeredBridgeIds?: string[];
  listingFailed?: boolean;
  listingError?: string;
};

export type LocalDeviceBridgePanelState = {
  bridges: DeviceBridgeRecord[];
  health: LocalBridgeHealthState | null;
  panelStatus: BridgePanelStatus;
};

export type LocalDeviceBridgePanelProps = {
  compact?: boolean;
  target?: string;
  detecting: boolean;
  protocol: DebugConnectionProtocol;
  onDetect: () => void;
  /** When set (including `[]`), skip network listing and use these bridges. */
  bridgesOverride?: DeviceBridgeRecord[] | null;
  listBridges?: () => Promise<DeviceBridgeRecord[]>;
  probeHealth?: () => Promise<LocalBridgeProbeResult>;
  /** Pairing-code seam for non-API runtimes; defaults to the HTTP client. */
  createPairingCode?: () => Promise<DeviceBridgePairingCode>;
  onBridgeStateChange?: (state: LocalDeviceBridgePanelState) => void;
};

export function LocalDeviceBridgePanel({
  compact = false,
  target,
  detecting,
  protocol,
  onDetect,
  bridgesOverride,
  listBridges,
  probeHealth,
  createPairingCode: createPairingCodeProp,
  onBridgeStateChange
}: LocalDeviceBridgePanelProps) {
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<LocalBridgeHealthState | null>(null);
  const [healthReachability, setHealthReachability] = useState<LocalBridgeReachability>("offline");
  const [bridges, setBridges] = useState<DeviceBridgeRecord[]>(bridgesOverride ?? []);
  const [bridgeListLoaded, setBridgeListLoaded] = useState(bridgesOverride != null);
  const [hostRelease, setHostRelease] = useState<DeviceBridgeReleaseItem | null>(null);
  const [installerAlternates, setInstallerAlternates] = useState<DeviceBridgeReleaseItem[]>([]);
  const [portableReleases, setPortableReleases] = useState<DeviceBridgeReleaseItem[]>([]);
  const [pairingCode, setPairingCode] = useState<DeviceBridgePairingCode | null>(null);
  const [pairingCodeLoading, setPairingCodeLoading] = useState(false);
  const [pairingError, setPairingError] = useState<{ message: string; detail: string } | null>(null);
  const [panelError, setPanelError] = useState<{ source: "local" | "server"; error: unknown } | null>(null);
  const [connectError, setConnectError] = useState("");
  const [renameDraftById, setRenameDraftById] = useState<Record<string, string>>({});
  const [renamingBridgeId, setRenamingBridgeId] = useState<string | null>(null);
  const [revokingBridgeId, setRevokingBridgeId] = useState<string | null>(null);
  const [revokeCandidate, setRevokeCandidate] = useState<DeviceBridgeRecord | null>(null);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [recommendedVersion, setRecommendedVersion] = useState<string | null>(null);
  const installReleasesLoadedRef = useRef(false);
  const lastEmittedBridgeStateRef = useRef<LocalDeviceBridgePanelState | null>(null);
  const bridgesRef = useRef<DeviceBridgeRecord[]>(bridgesOverride ?? []);
  const localProbeFailedRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<BridgeRefreshResult> | null>(null);
  const pairingRequestRef = useRef<Promise<void> | null>(null);
  const installRequestRef = useRef<Promise<void> | null>(null);

  const loadInstallReleases = useCallback(async () => {
    if (installRequestRef.current) return installRequestRef.current;
    const request = (async () => {
      setReleasesLoading(true);
      try {
        const manifest = await listReleases().catch(() => null);
        // `.catch` only covers rejections; a resolving client can still hand back a
        // body without `items` (misrouted proxy/error JSON). Treat that as "no manifest"
        // instead of letting `pickBridgeReleaseForHost` explode on `undefined.filter`.
        const items = Array.isArray(manifest?.items) ? manifest.items : null;
        const hostTarget = detectBrowserBridgeTarget();
        const primary = items ? pickBridgeReleaseForHost(items, hostTarget) : null;
        const nextAlternates = items ? listInstallerBridgeReleases(items, primary) : [];
        const nextPortables = items ? listPortableBridgeReleases(items, null) : [];
        const nextRecommended =
          typeof manifest?.recommendedVersion === "string" && manifest.recommendedVersion.trim()
            ? manifest.recommendedVersion
            : null;
        setRecommendedVersion((current) => (current === nextRecommended ? current : nextRecommended));
        setHostRelease((current) =>
          current?.downloadUrl === primary?.downloadUrl && current?.version === primary?.version ? current : primary
        );
        setInstallerAlternates((current) =>
          current.length === nextAlternates.length &&
          current.every((item, index) => item.downloadUrl === nextAlternates[index]?.downloadUrl)
            ? current
            : nextAlternates
        );
        setPortableReleases((current) =>
          current.length === nextPortables.length &&
          current.every((item, index) => item.downloadUrl === nextPortables[index]?.downloadUrl)
            ? current
            : nextPortables
        );
        installReleasesLoadedRef.current = true;
      } finally {
        setReleasesLoading(false);
      }
    })();
    installRequestRef.current = request;
    try { await request; } finally { installRequestRef.current = null; }
  }, []);

  const refreshBridgeState = useCallback(
    async (options?: { silent?: boolean; connectionAttempt?: boolean }) => {
      if (refreshInFlightRef.current) {
        const snapshot = await refreshInFlightRef.current;
        if (!options?.connectionAttempt) return snapshot;
      }
      const request = (async (): Promise<BridgeRefreshResult> => {
        if (!options?.silent) {
          setChecking(true);
          setPanelError((current) => current?.source === "local" ? current : null);
        }
        try {
          const probe = probeHealth ?? (() => probeLocalBridgeHealthDetailed());
          let healthProbe: LocalBridgeProbeResult;
          try {
            healthProbe = await probe();
          } catch (error) {
            healthProbe = { health: null, reachability: "offline", error };
          }
          if (healthProbe.error != null) {
            if (options?.connectionAttempt) localProbeFailedRef.current = true;
            setPanelError((current) => options?.connectionAttempt || current?.source === "local"
              ? { source: "local", error: healthProbe.error }
              : current);
          } else if (healthProbe.reachability === "ok" && healthProbe.error == null) {
            if (localProbeFailedRef.current) {
              localProbeFailedRef.current = false;
              setConnectError("");
            }
            setPanelError((current) => current?.source === "local" ? null : current);
          }
          const nextHealth = healthProbe.health;
          setHealthReachability((current) =>
            current === healthProbe.reachability ? current : healthProbe.reachability
          );
          setHealth((current) =>
            JSON.stringify(current) === JSON.stringify(nextHealth)
              ? current
              : nextHealth
          );

          let nextBridges: DeviceBridgeRecord[];
          let listingFailed = false;
          let listingError: string | undefined;
          try {
            nextBridges =
              bridgesOverride !== undefined && bridgesOverride !== null
                ? bridgesOverride
                : await (listBridges ?? (() => listMyBridges()))();
          } catch (error) {
            listingFailed = true;
            listingError = presentError(error, "设备代理列表加载失败，请刷新代理状态后重试。");
            nextBridges = bridgesRef.current;
            setPanelError({ source: "server", error });
          }

          if (!listingFailed) {
            setBridgeListLoaded(true);
            setBridges((current) =>
              current.length === nextBridges.length &&
              current.every((bridge, index) => {
                const next = nextBridges[index];
                return (
                  next &&
                  bridge.id === next.id &&
                  bridge.machineLabel === next.machineLabel &&
                  bridge.lastSeenAt === next.lastSeenAt &&
                  bridge.revokedAt === next.revokedAt
                );
              })
                ? current
                : nextBridges
            );
            setRenameDraftById((current) => {
              const nextDraft = Object.fromEntries(nextBridges.map((bridge) => {
                const previous = bridgesRef.current.find((item) => item.id === bridge.id);
                const draft = current[bridge.id];
                return [bridge.id, draft !== undefined && draft !== previous?.machineLabel ? draft : bridge.machineLabel];
              }));
              const currentKeys = Object.keys(current);
              const nextKeys = Object.keys(nextDraft);
              if (
                currentKeys.length === nextKeys.length &&
                nextKeys.every((key) => current[key] === nextDraft[key])
              ) {
                return current;
              }
              return nextDraft;
            });
          }

          // Fetch the install catalog once so an already-running old Bridge can be
          // compared with recommendedVersion. Silent polls must not re-hit /releases.
          if (!installReleasesLoadedRef.current && !options?.silent) {
            await loadInstallReleases();
          }
          const registeredBridgeIds = nextBridges.filter((bridge) => !bridge.revokedAt).map((bridge) => bridge.id);
          return {
            health: nextHealth,
            registeredBridgeIds,
            listingFailed,
            listingError,
            connected: Boolean(
              !listingFailed &&
                nextHealth?.connected &&
                nextBridges.some((bridge) => !bridge.revokedAt && bridge.id === nextHealth.bridgeId)
            )
          };
        } catch (error) {
          setPanelError({ source: "server", error });
          return { connected: false, listingFailed: true, listingError: presentError(error, "设备代理状态加载失败，请刷新代理状态后重试。") };
        } finally {
          if (!options?.silent) {
            setChecking(false);
          }
        }
      })();
      refreshInFlightRef.current = request;
      try { return await request; } finally {
        if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
      }
    },
    [bridgesOverride, listBridges, loadInstallReleases, probeHealth]
  );

  useEffect(() => {
    bridgesRef.current = bridges;
  }, [bridges]);

  useEffect(() => {
    if (bridgesOverride !== undefined && bridgesOverride !== null) {
      setBridges(bridgesOverride);
      setBridgeListLoaded(true);
      setRenameDraftById((current) => Object.fromEntries(bridgesOverride.map((bridge) => {
        const previous = bridgesRef.current.find((item) => item.id === bridge.id);
        return [bridge.id, current[bridge.id] !== undefined && current[bridge.id] !== previous?.machineLabel
          ? current[bridge.id] : bridge.machineLabel];
      })));
    }
  }, [bridgesOverride]);

  useEffect(() => {
    void refreshBridgeState();
  }, [refreshBridgeState]);

  const hostTarget = detectBrowserBridgeTarget();
  const activeBridges = bridges.filter((bridge) => !bridge.revokedAt);
  const registeredBridgeCountForHost = countActiveBridgesForPlatform(activeBridges, hostTarget.platform);
  const panelStatus = deriveBridgePanelStatus({
    health,
    bridgeCount: activeBridges.length,
    registeredBridgeCountForHost,
    registeredBridgeIds: activeBridges.map((bridge) => bridge.id),
    target,
    protocol,
    healthReachability
  });
  const pairingStale = isLocalBridgePairingStale({
    health,
    registeredBridgeIds: bridges.filter((bridge) => !bridge.revokedAt).map((bridge) => bridge.id)
  });
  const pairingAuthFailure = isLocalBridgeAuthFailure(health) || isLocalBridgeTokenExpired(health);

  useEffect(() => {
    if (!onBridgeStateChange) return;
    const previous = lastEmittedBridgeStateRef.current;
    if (
      previous &&
      previous.panelStatus === panelStatus &&
      previous.health === health &&
      previous.bridges === bridges
    ) {
      return;
    }
    const nextState = { bridges, health, panelStatus };
    lastEmittedBridgeStateRef.current = nextState;
    onBridgeStateChange(nextState);
  }, [bridges, health, panelStatus, onBridgeStateChange]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") void refreshBridgeState({ silent: true });
    };
    const timer = window.setInterval(refreshVisible, 3000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [panelStatus, refreshBridgeState]);

  const pairingCodeNeeded = shouldFetchBridgePairingCode({
    panelStatus,
    pairingStale,
    pairingAuthFailure,
    health,
    targetServerUrl: resolveBridgeServerUrl()
  });
  const refreshPairingCode = useCallback(async () => {
    if (pairingRequestRef.current) return pairingRequestRef.current;
    setPairingCodeLoading(true);
    setPairingError(null);
    const request = (createPairingCodeProp ?? createPairingCode)()
      .then((code) => {
        setPairingCode(code);
      })
      .catch((error) => {
        setPairingCode(null);
        setPairingError({ message: presentError(error, "无法生成配对码，请重试。"),
          detail: error instanceof Error ? error.message : "" });
      })
      .finally(() => {
        pairingRequestRef.current = null;
        setPairingCodeLoading(false);
      });
    pairingRequestRef.current = request;
    return request;
  }, [createPairingCodeProp]);

  useEffect(() => {
    if (pairingCodeNeeded) void refreshPairingCode();
  }, [pairingCodeNeeded, refreshPairingCode]);

  useEffect(() => {
    if (!pairingCodeNeeded || !pairingCode) return;
    const expiresIn = Date.parse(pairingCode.expiresAt) - Date.now();
    // Invalid responses are left for an explicit retry instead of an unbounded request loop.
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden") void refreshPairingCode();
    }, Math.min(expiresIn, 2_147_483_647));
    const refreshExpiredCode = () => {
      if (document.visibilityState !== "hidden" && Date.parse(pairingCode.expiresAt) <= Date.now()) void refreshPairingCode();
    };
    window.addEventListener("focus", refreshExpiredCode);
    document.addEventListener("visibilitychange", refreshExpiredCode);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshExpiredCode);
      document.removeEventListener("visibilitychange", refreshExpiredCode);
    };
  }, [pairingCode, pairingCodeNeeded, refreshPairingCode]);

  const handleRenameBridge = async (bridge: DeviceBridgeRecord) => {
    const draft = (renameDraftById[bridge.id] ?? bridge.machineLabel).trim();
    if (!draft || draft === bridge.machineLabel || bridge.revokedAt) {
      return;
    }
    setRenamingBridgeId(bridge.id);
    setPanelError(null);
    try {
      const updated = await renameBridge(bridge.id, draft);
      setBridges((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setRenameDraftById((current) => ({ ...current, [updated.id]: updated.machineLabel }));
    } catch (error) {
      setPanelError({ source: "server", error });
    } finally {
      setRenamingBridgeId(null);
    }
  };

  const handleRevokeBridge = (bridge: DeviceBridgeRecord) => {
    if (bridge.revokedAt) {
      return;
    }
    setRevokeCandidate(bridge);
  };

  const confirmRevokeBridge = async (bridge: DeviceBridgeRecord) => {
    setRevokeCandidate(null);
    setRevokingBridgeId(bridge.id);
    setPanelError(null);
    try {
      const revoked = await revokeBridge(bridge.id);
      setBridges((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
    } catch (error) {
      setPanelError({ source: "server", error });
    } finally {
      setRevokingBridgeId(null);
    }
  };

  const panelErrorMessage = panelError == null ? "" : panelError.source === "local"
    ? presentLocalBridgeError(panelError.error)
    : presentError(panelError.error, "设备代理请求失败，请刷新代理状态后重试。");
  const panelErrorDetail = panelError?.error instanceof Error ? panelError.error.message : typeof panelError?.error === "string" ? panelError.error : "";

  return (
    <section className="local-device-bridge-panel" aria-label="本地设备连接">
      <LocalDeviceBridgeWizard
        compact={compact}
        panelStatus={panelStatus}
        pairingStale={pairingStale}
        pairingAuthFailure={pairingAuthFailure}
        hasRegisteredBridge={registeredBridgeCountForHost > 0}
        bridgeListLoaded={bridgeListLoaded}
        healthReachability={healthReachability}
        protocol={protocol}
        health={health}
        bridges={activeBridges}
        recommendedVersion={recommendedVersion}
        hostRelease={hostRelease}
        installerAlternates={installerAlternates}
        portableReleases={portableReleases}
        pairingCode={pairingCode}
        pairingCodeLoading={pairingCodeLoading}
        pairingError={pairingError}
        onRefreshPairingCode={refreshPairingCode}
        checking={checking}
        detecting={detecting}
        connectError={connectError}
        localError={panelError?.source === "local" ? { message: panelErrorMessage, detail: panelErrorDetail } : null}
        onConnectError={setConnectError}
        onRefresh={async (options) => {
          const snapshot = await refreshBridgeState(options);
          return {
            connected: snapshot.connected,
            health: snapshot.health,
            registeredBridgeIds: snapshot.registeredBridgeIds,
            listingFailed: snapshot.listingFailed,
            listingError: snapshot.listingError
          };
        }}
        onDetect={onDetect}
        releasesLoading={releasesLoading}
        onLoadInstallReleases={loadInstallReleases}
      />
      {bridges.length > 0 ? (
        <details className="local-device-bridge-panel__management">
          <summary>管理设备代理</summary>
          <ul className="local-device-bridge-panel__bridge-list" aria-label="我的设备代理列表">
            {bridges.map((bridge) => {
              const draft = renameDraftById[bridge.id] ?? bridge.machineLabel;
              const isRevoked = Boolean(bridge.revokedAt);
              const saving = renamingBridgeId === bridge.id;
              const revoking = revokingBridgeId === bridge.id;
              const online = inferBridgeOnline(bridge, health);
              return (
                <li key={bridge.id} className="local-device-bridge-panel__bridge-item">
                  <div className="local-device-bridge-panel__bridge-meta">
                    <label>
                      <span>设备名</span>
                      <input
                        type="text"
                        value={draft}
                        maxLength={64}
                        disabled={isRevoked || saving || revoking}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setRenameDraftById((current) => ({ ...current, [bridge.id]: nextValue }));
                        }}
                      />
                    </label>
                    <small>
                      {bridge.platform}/{bridge.arch} · 最近在线 {formatBridgeLastSeen(bridge.lastSeenAt)}
                    </small>
                  </div>
                  <div className="local-device-bridge-panel__bridge-actions">
                    <span className={online ? "bridge-status-online" : "bridge-status-offline"}>
                      {online ? "在线" : "离线"}
                    </span>
                    {isRevoked ? <span className="bridge-status-revoked">已撤销</span> : null}
                    <button
                      className="button subtle"
                      type="button"
                      disabled={
                        isRevoked || saving || revoking || draft.trim().length === 0 || draft.trim() === bridge.machineLabel
                      }
                      onClick={() => void handleRenameBridge(bridge)}
                    >
                      {saving ? "保存中..." : "保存名称"}
                    </button>
                    <button
                      className="button subtle"
                      type="button"
                      disabled={isRevoked || revoking || saving}
                      onClick={() => void handleRevokeBridge(bridge)}
                    >
                      {revoking ? "撤销中..." : "撤销"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {panelError?.source === "server" ? (
        <div role="alert">
          <p className="node-row-error">{panelErrorMessage}</p>
          {panelErrorDetail && panelErrorDetail !== panelErrorMessage ? (
            <details>
              <summary>技术详情</summary>
              <p>{panelErrorDetail}</p>
            </details>
          ) : null}
          <button className="button subtle" type="button" disabled={checking} onClick={() => void refreshBridgeState()}>
            刷新代理状态
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={revokeCandidate !== null}
        title="撤销设备代理"
        description={revokeCandidate ? `确认撤销设备代理「${revokeCandidate.machineLabel}」吗？` : ""}
        confirmLabel="撤销"
        tone="danger"
        onConfirm={() => {
          if (revokeCandidate) {
            void confirmRevokeBridge(revokeCandidate);
          }
        }}
        onCancel={() => setRevokeCandidate(null)}
      />
    </section>
  );
}
