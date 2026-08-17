/**
 * DTS reload run session — the orchestration state machine behind `/dts-reload`
 * (`DtsReloadPage`), extracted per TD-069 on the Workbench-session precedent
 * (`src/application/project-configuration/structuredEditSession.ts`).
 *
 * Owns candidate loading, reload-batch editing/validation state, run start, the deploy
 * confirmation flow, the restore-baseline flow, run-id-in-URL rehydration, and
 * run/history/residue loading with pagination. Framework-free: snapshot + subscribe +
 * command verbs, with narrow `Pick<DtsReloadRepository, …>` dependencies per method.
 * React adapts through `useDtsReloadRunSession`.
 *
 * Confirmation-token invariants (ADR-0019/0020 client side):
 * - `confirm-dts-reload` is attached in exactly one place — the explicit `confirmDeploy`
 *   command backing the deploy confirmation dialog. No other command may deploy.
 * - `confirm-sensitive-reload` is attached only after the explicit critical confirmation
 *   commands (`setCriticalConfirmed` for start, `setRestoreCriticalConfirmed` for restore).
 */

import {
  bridgeTargetSelectionFrom,
  defaultDeviceId,
  pickPreferredBridgeId,
  type BridgeHealthSummary,
  type BridgeSummary,
  type DebugConnectionProtocol
} from "@/application/bridge/bridgeTargetSession";
import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import { hasMeaningfulDebugChange, validateDebugValue } from "@/domain/dtsReload/debugValue";
import {
  DTS_RELOAD_CONFIRMATION_TOKEN,
  SENSITIVE_RELOAD_CONFIRMATION_TOKEN
} from "@/domain/dtsReload/types";
import type {
  DtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListItem
} from "@/domain/dtsReload/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { DEVICE_BRIDGE_RELEASES_PATH } from "@wiseeff/device-command-core/bridgeApiPaths";

export type DtsReloadDeployProtocol = DebugConnectionProtocol;
export type DtsReloadBridgeSummary = BridgeSummary;
export type DtsReloadBridgeHealthSummary = BridgeHealthSummary;

export type DtsReloadRunSessionSnapshot = {
  projectId: string;
  candidates: DtsReloadCandidate[];
  loading: boolean;
  errorMessage: string;
  selectedBindingIds: string[];
  debugValues: Record<string, string>;
  criticalConfirmed: boolean;
  run: DtsReloadRun | null;
  starting: boolean;
  bridges: DtsReloadBridgeSummary[];
  bridgeHealth: DtsReloadBridgeHealthSummary;
  bridgeId: string;
  targetRef: string;
  protocol: DtsReloadDeployProtocol;
  deviceId: string;
  deployConfirmOpen: boolean;
  pendingDeployRun: DtsReloadRun | null;
  deploying: boolean;
  deployError: string;
  deployUpgradeReleasesPath: string | null;
  residue: DtsReloadResidue | null;
  residueLoading: boolean;
  restoreConfirmOpen: boolean;
  restoring: boolean;
  restoreError: string;
  restoreCriticalConfirmed: boolean;
  historyItems: DtsReloadRunListItem[];
  historyNextCursor: string | null;
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyError: string;
  historyFilterDevice: boolean;
  /** Selected candidates in reload-batch insertion order. */
  selectedCandidates: DtsReloadCandidate[];
  selectedHasSensitive: boolean;
  selectedHasCriticalSensitive: boolean;
  selectedHasMeaningfulDebugChange: boolean;
  deployReady: boolean;
  /**
   * The device a deploy writes to is derived server-side from the selected bridge
   * (`bridge:<bridgeId>`); mirrored here so the confirmation and request always show the
   * device the server will actually target, even after a historical run pinned another id.
   */
  deployDeviceId: string;
  residueSensitiveCandidates: DtsReloadCandidate[];
  restoreHasSensitive: boolean;
  restoreHasCriticalSensitive: boolean;
  canRetryDeploy: boolean;
};

export type DtsReloadRunSessionOptions = {
  initialProjectId?: string;
  initialBridges?: DtsReloadBridgeSummary[];
  initialTargetRef?: string;
  /** URL seams for run-id rehydration; default to `window.location` / `history.replaceState`. */
  readRunId?: () => string | null;
  writeRunId?: (runId: string | null) => void;
};

export type DtsReloadRunSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DtsReloadRunSessionSnapshot;
  selectProject(projectId: string): void;
  loadCandidates(repository: Pick<DtsReloadRepository, "listCandidates" | "getRun">): Promise<void>;
  toggleCandidate(bindingId: string): void;
  removeFromBatch(bindingId: string): void;
  clearBatch(): void;
  resetBatchToBaseline(): void;
  setDebugValue(bindingId: string, value: string): void;
  /** Validate and persist a debug value from the edit sheet; returns an error to keep it open. */
  confirmCandidateDebugValue(bindingId: string, debugValue: string): string | null;
  setCriticalConfirmed(value: boolean): void;
  start(repository: Pick<DtsReloadRepository, "startRun">): Promise<void>;
  openDeployConfirm(run: DtsReloadRun): void;
  closeDeployConfirm(): void;
  confirmDeploy(repository: Pick<DtsReloadRepository, "deployRun" | "getResidue">): Promise<void>;
  openRestoreConfirm(): void;
  closeRestoreConfirm(): void;
  setRestoreCriticalConfirmed(value: boolean): void;
  confirmRestore(repository: Pick<DtsReloadRepository, "restoreBaseline">): Promise<void>;
  loadResidue(repository: Pick<DtsReloadRepository, "getResidue">): Promise<void>;
  refreshHistory(repository: Pick<DtsReloadRepository, "listRuns">): Promise<void>;
  loadMoreHistory(repository: Pick<DtsReloadRepository, "listRuns">): Promise<void>;
  setHistoryFilterDevice(value: boolean): void;
  openHistoryRun(repository: Pick<DtsReloadRepository, "getRun">, runId: string): Promise<void>;
  downloadArtifact(
    repository: Pick<DtsReloadRepository, "downloadArtifact">
  ): Promise<{ blob: Blob; fileName: string } | null>;
  syncBridges(bridges: DtsReloadBridgeSummary[], health: DtsReloadBridgeHealthSummary): void;
  setProtocol(protocol: DtsReloadDeployProtocol): void;
  setTargetRef(targetRef: string): void;
  setDeviceId(deviceId: string): void;
};

function defaultReadRunId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("run") || null;
}

function defaultWriteRunId(runId: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (runId) {
    url.searchParams.set("run", runId);
  } else {
    url.searchParams.delete("run");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function readBridgeUpgradeReleasesPath(error: unknown): string | null {
  if (!(error instanceof WiseEffApiError)) return null;
  if (error.details?.code !== "bridge-upgrade-required") return null;
  const path = error.details.releasesPath;
  return typeof path === "string" && path.trim() ? path.trim() : DEVICE_BRIDGE_RELEASES_PATH;
}

export function createDtsReloadRunSession(
  options: DtsReloadRunSessionOptions = {}
): DtsReloadRunSession {
  const readRunId = options.readRunId ?? defaultReadRunId;
  const writeRunId = options.writeRunId ?? defaultWriteRunId;
  const listeners = new Set<() => void>();

  let projectId = options.initialProjectId ?? "";
  let candidates: DtsReloadCandidate[] = [];
  let loading = false;
  let errorMessage = "";
  let selectedBindingIds: string[] = [];
  let debugValues: Record<string, string> = {};
  let criticalConfirmed = false;
  let run: DtsReloadRun | null = null;
  let starting = false;
  let bridges: DtsReloadBridgeSummary[] = options.initialBridges ?? [];
  let bridgeHealth: DtsReloadBridgeHealthSummary = null;
  let bridgeId = "";
  let targetRef = options.initialTargetRef ?? "";
  let protocol: DtsReloadDeployProtocol = "hdc";
  let deviceId = "";
  let deviceIdTouched = false;
  let deployConfirmOpen = false;
  let pendingDeployRun: DtsReloadRun | null = null;
  let deploying = false;
  let deployError = "";
  let deployUpgradeReleasesPath: string | null = null;
  let residue: DtsReloadResidue | null = null;
  let residueLoading = false;
  let restoreConfirmOpen = false;
  let restoring = false;
  let restoreError = "";
  let restoreCriticalConfirmed = false;
  let historyItems: DtsReloadRunListItem[] = [];
  let historyNextCursor: string | null = null;
  let historyLoading = false;
  let historyLoadingMore = false;
  let historyError = "";
  let historyFilterDevice = false;

  let candidatesGeneration = 0;
  let residueGeneration = 0;
  let historyGeneration = 0;

  function selectedCandidatesNow(): DtsReloadCandidate[] {
    return selectedBindingIds
      .map((bindingId) => candidates.find((candidate) => candidate.bindingId === bindingId))
      .filter((candidate): candidate is DtsReloadCandidate => Boolean(candidate));
  }

  function rebuildSnapshot(): DtsReloadRunSessionSnapshot {
    // Mirrors the page-era reactive default: `bridge:<bridgeId>` until the user (or a
    // rehydrated run) pins an explicit device id.
    if (bridgeId && !deviceIdTouched) {
      deviceId = defaultDeviceId(bridgeId);
    }

    const selectedCandidates = selectedCandidatesNow();
    const selectedHasCriticalSensitive = selectedCandidates.some(
      (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
    );
    // Mirrors the page-era effect: the confirmation cannot outlive a critical selection.
    if (!selectedHasCriticalSensitive) {
      criticalConfirmed = false;
    }
    const selectedHasSensitive = selectedCandidates.some((candidate) =>
      Boolean(candidate.sensitiveMatch)
    );
    const selectedHasMeaningfulDebugChange = selectedCandidates.some((candidate) =>
      hasMeaningfulDebugChange(debugValues[candidate.bindingId] ?? "", candidate.baselineValue)
    );

    const residueBindingIds = new Set(residue?.parameters.map((entry) => entry.bindingId) ?? []);
    const residueSensitiveCandidates = residue
      ? candidates.filter((candidate) => residueBindingIds.has(candidate.bindingId))
      : [];

    return {
      projectId,
      candidates,
      loading,
      errorMessage,
      selectedBindingIds,
      debugValues,
      criticalConfirmed,
      run,
      starting,
      bridges,
      bridgeHealth,
      bridgeId,
      targetRef,
      protocol,
      deviceId,
      deployConfirmOpen,
      pendingDeployRun,
      deploying,
      deployError,
      deployUpgradeReleasesPath,
      residue,
      residueLoading,
      restoreConfirmOpen,
      restoring,
      restoreError,
      restoreCriticalConfirmed,
      historyItems,
      historyNextCursor,
      historyLoading,
      historyLoadingMore,
      historyError,
      historyFilterDevice,
      selectedCandidates,
      selectedHasSensitive,
      selectedHasCriticalSensitive,
      selectedHasMeaningfulDebugChange,
      deployReady: Boolean(bridgeId.trim() && targetRef.trim() && deviceId.trim()),
      deployDeviceId: bridgeId.trim() ? defaultDeviceId(bridgeId.trim()) : deviceId.trim(),
      residueSensitiveCandidates,
      restoreHasSensitive: residueSensitiveCandidates.some((candidate) =>
        Boolean(candidate.sensitiveMatch)
      ),
      restoreHasCriticalSensitive: residueSensitiveCandidates.some(
        (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
      ),
      canRetryDeploy: run?.status === "validated" || run?.status === "failed"
    };
  }

  let cachedSnapshot = rebuildSnapshot();

  function emit(): void {
    cachedSnapshot = rebuildSnapshot();
    for (const listener of listeners) listener();
  }

  function adoptRunTarget(existing: DtsReloadRun): void {
    const selection = bridgeTargetSelectionFrom(existing, protocol);
    if (existing.bridgeId) bridgeId = selection.bridgeId;
    if (existing.targetRef) targetRef = selection.targetRef;
    if (existing.deviceId) {
      deviceId = existing.deviceId;
      deviceIdTouched = true;
    }
    protocol = selection.protocol;
  }

  function openDeployConfirmInternal(validatedRun: DtsReloadRun): void {
    pendingDeployRun = validatedRun;
    deployError = "";
    deployUpgradeReleasesPath = null;
    deployConfirmOpen = true;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cachedSnapshot;
    },

    selectProject(nextProjectId) {
      if (projectId === nextProjectId) return;
      projectId = nextProjectId;
      // Invalidate any in-flight candidate load for the previous project immediately.
      candidatesGeneration += 1;
      emit();
    },

    async loadCandidates(repository) {
      const generation = ++candidatesGeneration;
      const requestedProjectId = projectId;
      if (!requestedProjectId) {
        candidates = [];
        emit();
        return;
      }
      loading = true;
      errorMessage = "";
      emit();
      try {
        const result = await repository.listCandidates(requestedProjectId);
        if (generation !== candidatesGeneration) return;
        candidates = result.items;
        const firstDebuggable = result.items.find((item) => item.debuggable);
        if (firstDebuggable) {
          selectedBindingIds = [firstDebuggable.bindingId];
          debugValues = { [firstDebuggable.bindingId]: firstDebuggable.baselineValue ?? "" };
        } else {
          selectedBindingIds = [];
          debugValues = {};
        }
        const existingRunId = readRunId();
        if (existingRunId) {
          try {
            const existing = await repository.getRun(existingRunId);
            if (generation !== candidatesGeneration) return;
            if (existing.projectId === requestedProjectId) {
              run = existing;
              adoptRunTarget(existing);
              emit();
              return;
            }
          } catch {
            writeRunId(null);
          }
          if (generation !== candidatesGeneration) return;
        }
        run = null;
        emit();
      } catch (error: unknown) {
        if (generation !== candidatesGeneration) return;
        errorMessage = error instanceof Error ? error.message : "加载参数候选失败。";
        emit();
      } finally {
        if (generation === candidatesGeneration) {
          loading = false;
          emit();
        }
      }
    },

    toggleCandidate(bindingId) {
      const candidate = candidates.find((item) => item.bindingId === bindingId);
      if (!candidate || !candidate.debuggable) return;
      errorMessage = "";
      if (selectedBindingIds.includes(candidate.bindingId)) {
        selectedBindingIds = selectedBindingIds.filter((id) => id !== candidate.bindingId);
      } else {
        debugValues = {
          ...debugValues,
          [candidate.bindingId]: debugValues[candidate.bindingId] ?? candidate.baselineValue ?? ""
        };
        selectedBindingIds = [...selectedBindingIds, candidate.bindingId];
      }
      emit();
    },

    removeFromBatch(bindingId) {
      errorMessage = "";
      selectedBindingIds = selectedBindingIds.filter((id) => id !== bindingId);
      emit();
    },

    clearBatch() {
      errorMessage = "";
      selectedBindingIds = [];
      criticalConfirmed = false;
      emit();
    },

    resetBatchToBaseline() {
      errorMessage = "";
      const next = { ...debugValues };
      for (const candidate of selectedCandidatesNow()) {
        next[candidate.bindingId] = candidate.baselineValue ?? "";
      }
      debugValues = next;
      emit();
    },

    setDebugValue(bindingId, value) {
      debugValues = { ...debugValues, [bindingId]: value };
      emit();
    },

    confirmCandidateDebugValue(bindingId, debugValue) {
      const candidate = candidates.find((item) => item.bindingId === bindingId);
      if (!candidate) return "参数不存在或不可调试。";
      if (!hasMeaningfulDebugChange(debugValue, candidate.baselineValue)) {
        return debugValue.trim()
          ? "调试值与库基线相同，无需加入本轮。"
          : "请输入调试值。";
      }
      const constraintError = validateDebugValue(debugValue, candidate);
      if (constraintError) return constraintError;
      errorMessage = "";
      debugValues = { ...debugValues, [candidate.bindingId]: debugValue };
      selectedBindingIds = selectedBindingIds.includes(candidate.bindingId)
        ? selectedBindingIds
        : [...selectedBindingIds, candidate.bindingId];
      emit();
      return null;
    },

    setCriticalConfirmed(value) {
      criticalConfirmed = value;
      emit();
    },

    async start(repository) {
      const selected = cachedSnapshot.selectedCandidates;
      if (starting || selected.length === 0) return;

      if (!cachedSnapshot.selectedHasMeaningfulDebugChange) {
        errorMessage = "本轮调试值均与库基线相同或为空，请先修改后再下发。";
        emit();
        return;
      }

      for (const candidate of selected) {
        const constraintError = validateDebugValue(
          debugValues[candidate.bindingId] ?? "",
          candidate
        );
        if (constraintError) {
          errorMessage = `${candidate.displayName || candidate.propertyKey}：${constraintError}`;
          emit();
          return;
        }
      }

      const criticalSelected = cachedSnapshot.selectedHasCriticalSensitive;
      if (criticalSelected && !criticalConfirmed) {
        errorMessage = "所选参数包含 critical 敏感节点，请先勾选明确确认后再启动。";
        emit();
        return;
      }

      starting = true;
      errorMessage = "";
      emit();
      try {
        const started = await repository.startRun({
          projectId,
          targets: selected.map((candidate) => ({
            bindingId: candidate.bindingId,
            debugValue: (debugValues[candidate.bindingId] ?? "").trim()
          })),
          ...(criticalSelected && criticalConfirmed
            ? { confirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN }
            : {})
        });
        run = started;
        writeRunId(started.id);
        if (started.status === "validated" && cachedSnapshot.deployReady) {
          openDeployConfirmInternal(started);
        } else if (started.status === "validated" && !cachedSnapshot.deployReady) {
          errorMessage = "预检已通过。请先连接 Bridge 并检测设备目标后再确认部署。";
        }
        emit();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "下发参数失败。";
        emit();
      } finally {
        starting = false;
        emit();
      }
    },

    openDeployConfirm(validatedRun) {
      openDeployConfirmInternal(validatedRun);
      emit();
    },

    closeDeployConfirm() {
      if (deploying) return;
      deployConfirmOpen = false;
      pendingDeployRun = null;
      deployError = "";
      deployUpgradeReleasesPath = null;
      emit();
    },

    async confirmDeploy(repository) {
      const deployRun =
        pendingDeployRun ?? (run?.status === "validated" || run?.status === "failed" ? run : null);
      if (!deployRun || !cachedSnapshot.deployReady) return;

      deploying = true;
      deployError = "";
      deployUpgradeReleasesPath = null;
      emit();
      try {
        const deployed = await repository.deployRun({
          runId: deployRun.id,
          deviceId: cachedSnapshot.deployDeviceId,
          bridgeId: bridgeId.trim(),
          targetRef: targetRef.trim(),
          protocol,
          // The one and only place this token may be attached (explicit confirm command).
          confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
        });
        run = deployed;
        writeRunId(deployed.id);
        deployConfirmOpen = false;
        pendingDeployRun = null;
        const postWrite =
          deployed.status === "unverifiable" ||
          deployed.status === "verified" ||
          deployed.status === "contradicted";
        if (postWrite && deployed.purpose === "restore-baseline") {
          // Optimistic clear so a failed residue refresh cannot leave a stale banner.
          residue = null;
        }
        emit();
        try {
          const nextResidue = await repository.getResidue(deviceId.trim());
          residue = nextResidue;
          emit();
        } catch {
          // Restore already cleared optimistically. Ordinary deploys keep prior residue on refresh failure.
        }
      } catch (error) {
        deployError = error instanceof Error ? error.message : "部署到设备失败。";
        deployUpgradeReleasesPath = readBridgeUpgradeReleasesPath(error);
        emit();
      } finally {
        deploying = false;
        emit();
      }
    },

    openRestoreConfirm() {
      restoreError = "";
      restoreCriticalConfirmed = false;
      restoreConfirmOpen = true;
      emit();
    },

    closeRestoreConfirm() {
      if (restoring) return;
      restoreConfirmOpen = false;
      restoreError = "";
      restoreCriticalConfirmed = false;
      emit();
    },

    setRestoreCriticalConfirmed(value) {
      restoreCriticalConfirmed = value;
      emit();
    },

    async confirmRestore(repository) {
      if (!projectId || !deviceId.trim()) return;
      const restoreCritical = cachedSnapshot.restoreHasCriticalSensitive;
      if (restoreCritical && !restoreCriticalConfirmed) {
        restoreError = "critical 敏感参数恢复基线前须明确确认。";
        emit();
        return;
      }
      restoring = true;
      restoreError = "";
      emit();
      try {
        const restoreRun = await repository.restoreBaseline({
          projectId,
          deviceId: deviceId.trim(),
          ...(restoreCritical && restoreCriticalConfirmed
            ? { confirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN }
            : {})
        });
        run = restoreRun;
        writeRunId(restoreRun.id);
        restoreConfirmOpen = false;
        restoreCriticalConfirmed = false;
        if (restoreRun.status === "validated") {
          openDeployConfirmInternal(restoreRun);
        }
        emit();
      } catch (error) {
        restoreError = error instanceof Error ? error.message : "启动基线恢复运行失败。";
        emit();
      } finally {
        restoring = false;
        emit();
      }
    },

    async loadResidue(repository) {
      const generation = ++residueGeneration;
      const requestedDeviceId = deviceId.trim();
      if (!requestedDeviceId) {
        residue = null;
        emit();
        return;
      }
      residueLoading = true;
      emit();
      try {
        const item = await repository.getResidue(requestedDeviceId);
        if (generation !== residueGeneration || requestedDeviceId !== deviceId.trim()) return;
        residue = item;
        emit();
      } catch {
        // Keep any previously shown bookkeeping if the lookup fails transiently.
      } finally {
        if (generation === residueGeneration) {
          residueLoading = false;
          emit();
        }
      }
    },

    async refreshHistory(repository) {
      if (!projectId) {
        historyItems = [];
        historyNextCursor = null;
        emit();
        return;
      }
      const filterByDevice = historyFilterDevice && Boolean(deviceId.trim());
      if (historyFilterDevice && !deviceId.trim()) {
        historyFilterDevice = false;
        emit();
        return;
      }
      const queryKey = ++historyGeneration;
      const requestedProjectId = projectId;
      const requestedDeviceId = deviceId.trim();
      historyLoading = true;
      historyNextCursor = null;
      historyItems = [];
      historyError = "";
      emit();
      try {
        const result = await repository.listRuns({
          projectId: requestedProjectId,
          ...(filterByDevice ? { deviceId: requestedDeviceId } : {}),
          limit: 10
        });
        if (queryKey !== historyGeneration) return;
        historyItems = result.items;
        historyNextCursor = result.nextCursor;
        emit();
      } catch (error) {
        if (queryKey !== historyGeneration) return;
        historyItems = [];
        historyNextCursor = null;
        historyError = error instanceof Error ? error.message : "加载运行历史失败。";
        emit();
      } finally {
        if (queryKey === historyGeneration) {
          historyLoading = false;
          emit();
        }
      }
    },

    async loadMoreHistory(repository) {
      if (!projectId || !historyNextCursor || historyLoadingMore || historyLoading) return;
      const queryKey = historyGeneration;
      const cursor = historyNextCursor;
      const filterByDevice = historyFilterDevice && Boolean(deviceId.trim());
      historyLoadingMore = true;
      historyError = "";
      emit();
      try {
        const result = await repository.listRuns({
          projectId,
          ...(filterByDevice ? { deviceId: deviceId.trim() } : {}),
          cursor,
          limit: 10
        });
        if (queryKey !== historyGeneration) return;
        historyItems = [...historyItems, ...result.items];
        historyNextCursor = result.nextCursor;
        emit();
      } catch (error) {
        if (queryKey !== historyGeneration) return;
        historyError = error instanceof Error ? error.message : "加载更多运行历史失败。";
        emit();
      } finally {
        if (queryKey === historyGeneration) {
          historyLoadingMore = false;
          emit();
        }
      }
    },

    setHistoryFilterDevice(value) {
      if (!deviceId.trim()) return;
      historyFilterDevice = value;
      emit();
    },

    async openHistoryRun(repository, runId) {
      errorMessage = "";
      emit();
      try {
        const existing = await repository.getRun(runId);
        run = existing;
        writeRunId(existing.id);
        adoptRunTarget(existing);
        // Cross-project deep links (e.g. knowledge-entry source links land on
        // /dts-reload?runId=… for a run of another project) follow the run's
        // project. This also invalidates any in-flight candidate load for the
        // old project, which would otherwise clear the freshly opened run when
        // its project check ran against the stale project id.
        if (existing.projectId && existing.projectId !== projectId) {
          projectId = existing.projectId;
          candidatesGeneration += 1;
        }
        emit();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "加载运行详情失败。";
        emit();
      }
    },

    async downloadArtifact(repository) {
      if (!run?.artifact) return null;
      if (run.artifactRetentionExpired) {
        errorMessage = "该运行的编译产物已超过保留期，无法下载（元数据与摘要仍可查看）。";
        emit();
        return null;
      }
      try {
        const blob = await repository.downloadArtifact(run.id);
        return { blob, fileName: run.artifact.fileName };
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "下载产物失败。";
        emit();
        return null;
      }
    },

    syncBridges(nextBridges, health) {
      const sameBridges =
        bridges.length === nextBridges.length &&
        bridges.every(
          (bridge, index) =>
            bridge.id === nextBridges[index]?.id &&
            bridge.machineLabel === nextBridges[index]?.machineLabel &&
            bridge.lastSeenAt === nextBridges[index]?.lastSeenAt
        );
      const sameHealth =
        bridgeHealth?.connected === health?.connected &&
        bridgeHealth?.bridgeId === health?.bridgeId &&
        Boolean(bridgeHealth) === Boolean(health);
      const nextBridgeId = pickPreferredBridgeId(nextBridges, health, bridgeId);
      if (sameBridges && sameHealth && nextBridgeId === bridgeId) return;
      if (!sameBridges) bridges = nextBridges;
      if (!sameHealth) bridgeHealth = health;
      bridgeId = nextBridgeId;
      emit();
    },

    setProtocol(nextProtocol) {
      protocol = nextProtocol;
      emit();
    },

    setTargetRef(nextTargetRef) {
      targetRef = nextTargetRef;
      emit();
    },

    setDeviceId(nextDeviceId) {
      deviceId = nextDeviceId;
      deviceIdTouched = true;
      emit();
    }
  };
}
