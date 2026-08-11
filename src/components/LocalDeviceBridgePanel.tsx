import { useCallback, useEffect, useRef, useState } from "react";

import { LocalDeviceBridgeWizard } from "./LocalDeviceBridgeWizard";
import {
  deriveBridgePanelStatus,
  countActiveBridgesForPlatform,
  isBridgeOnlinePanelStatus,
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
import { formatDebuggingRuntimeError } from "../application/debugging/debuggingRuntime";

export type LocalDeviceBridgePanelState = {
  bridges: DeviceBridgeRecord[];
  health: LocalBridgeHealthState | null;
  panelStatus: BridgePanelStatus;
};

export type LocalDeviceBridgePanelProps = {
  target?: string;
  detecting: boolean;
  protocol: DebugConnectionProtocol;
  onDetect: () => void;
  /** When set (including `[]`), skip network listing and use these bridges. */
  bridgesOverride?: DeviceBridgeRecord[] | null;
  listBridges?: () => Promise<DeviceBridgeRecord[]>;
  probeHealth?: () => Promise<LocalBridgeProbeResult>;
  onBridgeStateChange?: (state: LocalDeviceBridgePanelState) => void;
};

export function LocalDeviceBridgePanel({
  target,
  detecting,
  protocol,
  onDetect,
  bridgesOverride,
  listBridges,
  probeHealth,
  onBridgeStateChange
}: LocalDeviceBridgePanelProps) {
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<LocalBridgeHealthState | null>(null);
  const [healthReachability, setHealthReachability] = useState<LocalBridgeReachability>("offline");
  const [bridges, setBridges] = useState<DeviceBridgeRecord[]>(bridgesOverride ?? []);
  const [hostRelease, setHostRelease] = useState<DeviceBridgeReleaseItem | null>(null);
  const [installerAlternates, setInstallerAlternates] = useState<DeviceBridgeReleaseItem[]>([]);
  const [portableReleases, setPortableReleases] = useState<DeviceBridgeReleaseItem[]>([]);
  const [pairingCode, setPairingCode] = useState<DeviceBridgePairingCode | null>(null);
  const [pairingCodeLoading, setPairingCodeLoading] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [connectError, setConnectError] = useState("");
  const [renameDraftById, setRenameDraftById] = useState<Record<string, string>>({});
  const [renamingBridgeId, setRenamingBridgeId] = useState<string | null>(null);
  const [revokingBridgeId, setRevokingBridgeId] = useState<string | null>(null);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const installReleasesLoadedRef = useRef(false);
  const lastEmittedBridgeStateRef = useRef<LocalDeviceBridgePanelState | null>(null);

  const loadInstallReleases = useCallback(async () => {
    setReleasesLoading(true);
    try {
      const manifest = await listReleases().catch(() => null);
      const hostTarget = detectBrowserBridgeTarget();
      const primary = manifest ? pickBridgeReleaseForHost(manifest.items, hostTarget) : null;
      const nextAlternates = manifest ? listInstallerBridgeReleases(manifest.items, primary) : [];
      const nextPortables = manifest ? listPortableBridgeReleases(manifest.items, null) : [];
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
  }, []);

  const refreshBridgeState = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setChecking(true);
        setPanelError("");
      }
      try {
        const probe = probeHealth ?? (() => probeLocalBridgeHealthDetailed());
        const [healthProbe, nextBridges] = await Promise.all([
          probe(),
          bridgesOverride !== undefined && bridgesOverride !== null
            ? Promise.resolve(bridgesOverride)
            : (listBridges ?? (() => listMyBridges()))().catch(() => [] as DeviceBridgeRecord[])
        ]);
        const nextHealth = healthProbe.health;
        setHealthReachability((current) =>
          current === healthProbe.reachability ? current : healthProbe.reachability
        );
        setHealth((current) =>
          current?.updatedAt === nextHealth?.updatedAt &&
          current?.connected === nextHealth?.connected &&
          current?.paired === nextHealth?.paired &&
          current?.bridgeId === nextHealth?.bridgeId &&
          current?.lastError === nextHealth?.lastError
            ? current
            : nextHealth
        );
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
          const nextDraft = Object.fromEntries(nextBridges.map((bridge) => [bridge.id, bridge.machineLabel]));
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
        const hostTarget = detectBrowserBridgeTarget();
        const registeredBridgeCountForHost = countActiveBridgesForPlatform(nextBridges, hostTarget.platform);
        // Only fetch install releases once while waiting for Bridge — silent polls must not
        // re-hit /releases every 3s (that toggles loading state and remounts CTAs → focus jump).
        if (
          !nextHealth &&
          registeredBridgeCountForHost === 0 &&
          bridgesOverride === undefined &&
          (!options?.silent || !installReleasesLoadedRef.current)
        ) {
          await loadInstallReleases();
        }
        return { nextHealth, nextBridges, connected: Boolean(nextHealth?.connected) };
      } finally {
        if (!options?.silent) {
          setChecking(false);
        }
      }
    },
    [bridgesOverride, listBridges, loadInstallReleases, probeHealth]
  );

  useEffect(() => {
    if (bridgesOverride !== undefined && bridgesOverride !== null) {
      setBridges(bridgesOverride);
      setRenameDraftById(Object.fromEntries(bridgesOverride.map((bridge) => [bridge.id, bridge.machineLabel])));
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
    if (
      panelStatus !== "missing_bridge" &&
      panelStatus !== "bridge_blocked" &&
      panelStatus !== "not_running" &&
      panelStatus !== "not_connected"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshBridgeState({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [panelStatus, refreshBridgeState]);

  useEffect(() => {
    if (
      !shouldFetchBridgePairingCode({
        panelStatus,
        pairingStale,
        pairingAuthFailure: pairingAuthFailure,
        health,
        targetServerUrl: resolveBridgeServerUrl()
      })
    ) {
      setPairingCodeLoading(false);
      return;
    }

    let cancelled = false;
    setPairingCodeLoading(true);
    void createPairingCode()
      .then((code) => {
        if (!cancelled) {
          setPairingCode(code);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPanelError(formatDebuggingRuntimeError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPairingCodeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [panelStatus, pairingStale, pairingAuthFailure, health]);

  const handleRenameBridge = async (bridge: DeviceBridgeRecord) => {
    const draft = (renameDraftById[bridge.id] ?? bridge.machineLabel).trim();
    if (!draft || draft === bridge.machineLabel || bridge.revokedAt) {
      return;
    }
    setRenamingBridgeId(bridge.id);
    setPanelError("");
    try {
      const updated = await renameBridge(bridge.id, draft);
      setBridges((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setRenameDraftById((current) => ({ ...current, [updated.id]: updated.machineLabel }));
    } catch (error) {
      setPanelError(formatDebuggingRuntimeError(error));
    } finally {
      setRenamingBridgeId(null);
    }
  };

  const handleRevokeBridge = async (bridge: DeviceBridgeRecord) => {
    if (bridge.revokedAt) {
      return;
    }
    if (!window.confirm(`确认撤销设备代理「${bridge.machineLabel}」吗？`)) {
      return;
    }
    setRevokingBridgeId(bridge.id);
    setPanelError("");
    try {
      const revoked = await revokeBridge(bridge.id);
      setBridges((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
    } catch (error) {
      setPanelError(formatDebuggingRuntimeError(error));
    } finally {
      setRevokingBridgeId(null);
    }
  };

  return (
    <section className="local-device-bridge-panel" aria-label="本地设备连接">
      <LocalDeviceBridgeWizard
        panelStatus={panelStatus}
        pairingStale={pairingStale}
        pairingAuthFailure={pairingAuthFailure}
        hasRegisteredBridge={registeredBridgeCountForHost > 0}
        healthReachability={healthReachability}
        protocol={protocol}
        health={health}
        hostRelease={hostRelease}
        installerAlternates={installerAlternates}
        portableReleases={portableReleases}
        pairingCode={pairingCode}
        pairingCodeLoading={pairingCodeLoading}
        checking={checking}
        detecting={detecting}
        connectError={connectError}
        onConnectError={setConnectError}
        onRefresh={async () => {
          const snapshot = await refreshBridgeState();
          return { connected: snapshot.connected };
        }}
        onDetect={onDetect}
        releasesLoading={releasesLoading}
        onLoadInstallReleases={loadInstallReleases}
      />
      {bridges.length > 0 ? (
        <details className="local-device-bridge-panel__management" open={!isBridgeOnlinePanelStatus(panelStatus)}>
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
      {panelError ? <p className="node-row-error">{panelError}</p> : null}
    </section>
  );
}
