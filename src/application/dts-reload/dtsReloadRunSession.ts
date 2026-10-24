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
  statusMessage: string;
  hasUnsavedBatch: boolean;
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
  residueError: string;
  restoreConfirmOpen: boolean;
  restoring: boolean;
  restoreError: string;
  restoreCriticalConfirmed: boolean;
  historyItems: DtsReloadRunListItem[];
  historyNextCursor: string | null;
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyError: string;
  historyRunLoading: boolean;
  historyFilterDevice: boolean;
  /** Selected candidates in reload-batch insertion order. */
  selectedCandidates: DtsReloadCandidate[];
  /**
   * Binding ids carried from the parameter workbench (`?bindingIds=`).
   * Null means no hand-off filter; the candidate table shows the full project list.
   */
  handoffBindingIds: string[] | null;
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
  /** Workbench hand-off (`?bindingIds=`); mount-time only. */
  initialBindingIds?: string[];
  /** URL seams for run-id rehydration; default to `window.location` / `history.replaceState`. */
  readRunId?: () => string | null;
  writeRunId?: (runId: string | null) => void;
};

export type DtsReloadRunSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DtsReloadRunSessionSnapshot;
  initializeProject(projectId: string): void;
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
  start(repository: Pick<DtsReloadRepository, "startRun"> & RunRefreshRepository): Promise<void>;
  openDeployConfirm(run: DtsReloadRun): void;
  closeDeployConfirm(): void;
  confirmDeploy(repository: Pick<DtsReloadRepository, "deployRun" | "getResidue"> & RunRefreshRepository): Promise<void>;
  openRestoreConfirm(): void;
  closeRestoreConfirm(): void;
  setRestoreCriticalConfirmed(value: boolean): void;
  confirmRestore(repository: Pick<DtsReloadRepository, "restoreBaseline"> & RunRefreshRepository): Promise<void>;
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
  clearHandoff(): void;
};

type RunRefreshRepository = Partial<Pick<DtsReloadRepository, "listRuns" | "listCandidates">>;

function defaultReadRunId(): string | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  return query.get("runId") || query.get("run") || null;
}

function defaultWriteRunId(runId: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (runId) {
    url.searchParams.set("runId", runId);
  } else {
    url.searchParams.delete("runId");
  }
  url.searchParams.delete("run");
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
  let projectInitialized = Boolean(projectId);
  let candidates: DtsReloadCandidate[] = [];
  let loading = false;
  let errorMessage = "";
  let statusMessage = "";
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
  let residueError = "";
  let restoreConfirmOpen = false;
  let restoring = false;
  let restoreError = "";
  let restoreCriticalConfirmed = false;
  let historyItems: DtsReloadRunListItem[] = [];
  let historyNextCursor: string | null = null;
  let historyLoading = false;
  let historyLoadingMore = false;
  let historyError = "";
  let historyRunLoading = false;
  let historyFilterDevice = false;
  let handoffBindingIds: string[] | null =
    options.initialBindingIds && options.initialBindingIds.length > 0
      ? [...options.initialBindingIds]
      : null;

  let candidatesGeneration = 0;
  let residueGeneration = 0;
  let historyGeneration = 0;
  let historyRunGeneration = 0;
  let contextGeneration = 0;
  let runRefreshGeneration = 0;

  function invalidateContext() {
    contextGeneration += 1;
    historyRunGeneration += 1;
    historyRunLoading = false;
    residueGeneration += 1;
    residue = null;
    residueLoading = false;
    residueError = "";
    historyGeneration += 1;
    historyLoading = false;
    historyLoadingMore = false;
    if (historyFilterDevice) {
      historyItems = [];
      historyNextCursor = null;
    }
    starting = false;
    deploying = false;
    restoring = false;
    deployConfirmOpen = false;
    pendingDeployRun = null;
    restoreConfirmOpen = false;
    restoreCriticalConfirmed = false;
    deployError = "";
    restoreError = "";
    statusMessage = "";
  }

  async function refreshAfterRun(repository: RunRefreshRepository, generation: number) {
    const requestedProjectId = projectId;
    const refreshGeneration = ++runRefreshGeneration;
    const candidateGeneration = candidatesGeneration;
    await Promise.all([
      repository.listRuns
        ? session.refreshHistory({ listRuns: repository.listRuns.bind(repository) })
        : undefined,
      repository.listCandidates
        ? repository.listCandidates(requestedProjectId).then((result) => {
            if (generation !== contextGeneration || requestedProjectId !== projectId || refreshGeneration !== runRefreshGeneration || candidateGeneration !== candidatesGeneration) return;
            const latest = new Map(result.items.map((candidate) => [candidate.bindingId, candidate]));
            candidates = candidates.map((candidate) => ({
              ...candidate,
              lastReload: latest.has(candidate.bindingId)
                ? latest.get(candidate.bindingId)!.lastReload
                : candidate.lastReload
            }));
            emit();
          }).catch(() => {
            if (generation !== contextGeneration || refreshGeneration !== runRefreshGeneration) return;
            statusMessage = "操作已完成，参数上次重载信息刷新失败，请重新加载参数。";
            emit();
          })
        : undefined
    ]);
  }

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
      hasMeaningfulDebugChange(
        debugValues[candidate.bindingId] ?? "",
        candidate.baselineValue,
        candidate.resolvedValueShape
      )
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
      statusMessage,
      hasUnsavedBatch: selectedHasMeaningfulDebugChange,
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
      residueError,
      restoreConfirmOpen,
      restoring,
      restoreError,
      restoreCriticalConfirmed,
      historyItems,
      historyNextCursor,
      historyLoading,
      historyLoadingMore,
      historyError,
      historyRunLoading,
      historyFilterDevice,
      handoffBindingIds,
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

  const session: DtsReloadRunSession = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cachedSnapshot;
    },

    initializeProject(nextProjectId) {
      if (projectInitialized || !nextProjectId) return;
      projectInitialized = true;
      if (projectId || readRunId() || historyRunLoading || run || selectedBindingIds.length) return;
      projectId = nextProjectId;
      emit();
    },

    selectProject(nextProjectId) {
      projectInitialized = true;
      if (projectId === nextProjectId) return;
      invalidateContext();
      projectId = nextProjectId;
      handoffBindingIds = null;
      candidates = [];
      selectedBindingIds = [];
      debugValues = {};
      criticalConfirmed = false;
      run = null;
      loading = false;
      errorMessage = "";
      historyItems = [];
      historyNextCursor = null;
      historyError = "";
      writeRunId(null);
      // Invalidate any in-flight candidate load for the previous project immediately.
      candidatesGeneration += 1;
      emit();
    },

    async loadCandidates(repository) {
      const generation = ++candidatesGeneration;
      const requestContext = contextGeneration;
      const requestHistory = historyRunGeneration;
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
        const candidateIds = new Set(candidates.map((candidate) => candidate.bindingId));
        selectedBindingIds = selectedBindingIds.filter((id) => candidateIds.has(id));
        const existingRunId = readRunId();
        if (existingRunId && !run && !historyRunLoading) {
          try {
            const existing = await repository.getRun(existingRunId);
            if (generation !== candidatesGeneration || requestContext !== contextGeneration || requestHistory !== historyRunGeneration) return;
            if (existing.projectId === requestedProjectId) {
              run = existing;
              adoptRunTarget(existing);
              emit();
              return;
            }
          } catch {
            if (generation !== candidatesGeneration || requestContext !== contextGeneration || requestHistory !== historyRunGeneration) return;
            writeRunId(null);
          }
          if (generation !== candidatesGeneration) return;
        }
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
      if (!candidate?.debuggable) return "参数不存在或不可调试。";
      if (!hasMeaningfulDebugChange(debugValue, candidate.baselineValue, candidate.resolvedValueShape)) {
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
      if (starting || deploying || restoring || loading || !projectId || selected.length === 0) return;
      const generation = contextGeneration;
      const requestedHistory = historyRunGeneration;
      const requestedProjectId = projectId;

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
      statusMessage = "";
      emit();
      try {
        const started = await repository.startRun({
          projectId: requestedProjectId,
          targets: selected.map((candidate) => {
            const pin = candidate.protectedReferencePin;
            return {
              bindingId: candidate.bindingId,
              debugValue: (debugValues[candidate.bindingId] ?? "").trim(),
              ...(pin?.definitionId ? { definitionId: pin.definitionId } : {}),
              ...(pin?.definitionRevisionId ? { definitionRevisionId: pin.definitionRevisionId } : {}),
              ...(pin?.currentValueId ? { currentValueId: pin.currentValueId } : {}),
              ...(pin?.catalogReleaseId ? { catalogReleaseId: pin.catalogReleaseId } : {}),
              ...(pin?.configRevisionId ? { configRevisionId: pin.configRevisionId } : {}),
              ...(pin?.sourcePinId ? { sourcePinId: pin.sourcePinId } : {}),
              ...(pin?.sourceOccurrenceId ? { sourceOccurrenceId: pin.sourceOccurrenceId } : {}),
              ...(candidate.writebackSourcePin?.sourceRef
                ? { sourceRef: candidate.writebackSourcePin.sourceRef }
                : {}),
              ...(pin?.sourceFormat ? { sourceFormat: pin.sourceFormat } : {}),
              ...(pin?.sourceLocator ? { sourceLocator: pin.sourceLocator } : {})
            };
          }),
          ...(criticalSelected && criticalConfirmed
            ? { confirmationToken: SENSITIVE_RELOAD_CONFIRMATION_TOKEN }
            : {})
        });
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        run = started;
        writeRunId(started.id);
        statusMessage = "预检流程已结束，请核对运行结果。";
        if (started.status === "validated" && cachedSnapshot.deployReady) {
          openDeployConfirmInternal(started);
        } else if (started.status === "validated" && !cachedSnapshot.deployReady) {
          statusMessage = "预检已通过。请先连接 Bridge 并检测设备目标后再确认部署。";
        }
        emit();
        await refreshAfterRun(repository, generation);
      } catch (error) {
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        errorMessage = error instanceof Error ? error.message : "启动预检失败。";
        emit();
      } finally {
        if (generation === contextGeneration) {
          starting = false;
          emit();
        }
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
      if (deploying || !deployRun || !cachedSnapshot.deployReady) return;
      const generation = contextGeneration;
      const requestedHistory = historyRunGeneration;
      const requestedDeviceId = cachedSnapshot.deployDeviceId;

      deploying = true;
      deployError = "";
      deployUpgradeReleasesPath = null;
      emit();
      try {
        const deployed = await repository.deployRun({
          runId: deployRun.id,
          deviceId: requestedDeviceId,
          bridgeId: bridgeId.trim(),
          targetRef: targetRef.trim(),
          protocol,
          // The one and only place this token may be attached (explicit confirm command).
          confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
        });
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        run = deployed;
        writeRunId(deployed.id);
        deployConfirmOpen = false;
        pendingDeployRun = null;
        statusMessage = "设备部署流程已结束，请核对运行结果与重载证据。";
        const postWrite =
          deployed.status === "unverifiable" ||
          deployed.status === "verified" ||
          deployed.status === "contradicted";
        if (postWrite && deployed.purpose === "restore-baseline") {
          // Optimistic clear so a failed residue refresh cannot leave a stale banner.
          residue = null;
        }
        emit();
        await Promise.all([
          session.loadResidue(repository),
          refreshAfterRun(repository, generation)
        ]);
      } catch (error) {
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        deployError = error instanceof Error ? error.message : "部署到设备失败。";
        deployUpgradeReleasesPath = readBridgeUpgradeReleasesPath(error);
        emit();
      } finally {
        if (generation === contextGeneration) {
          deploying = false;
          emit();
        }
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
      if (starting || deploying || restoring || !projectId || !deviceId.trim() || residueLoading || residueError) return;
      const generation = contextGeneration;
      const requestedHistory = historyRunGeneration;
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
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        run = restoreRun;
        writeRunId(restoreRun.id);
        restoreConfirmOpen = false;
        restoreCriticalConfirmed = false;
        statusMessage = restoreRun.status === "validated"
          ? "补偿性恢复预检已通过，请核对并确认部署。"
          : "补偿性恢复预检已结束，请核对运行结果。";
        if (restoreRun.status === "validated") {
          openDeployConfirmInternal(restoreRun);
        }
        emit();
        await refreshAfterRun(repository, generation);
      } catch (error) {
        if (generation !== contextGeneration || requestedHistory !== historyRunGeneration) return;
        restoreError = error instanceof Error ? error.message : "启动基线恢复运行失败。";
        emit();
      } finally {
        if (generation === contextGeneration) {
          restoring = false;
          emit();
        }
      }
    },

    async loadResidue(repository) {
      const generation = ++residueGeneration;
      const requestContext = contextGeneration;
      const requestedDeviceId = deviceId.trim();
      residue = null;
      residueError = "";
      residueLoading = false;
      if (!requestedDeviceId) {
        residue = null;
        emit();
        return;
      }
      residueLoading = true;
      emit();
      try {
        const item = await repository.getResidue(requestedDeviceId);
        if (generation !== residueGeneration || requestContext !== contextGeneration || requestedDeviceId !== deviceId.trim()) return;
        residue = item;
        emit();
      } catch (error) {
        if (generation !== residueGeneration || requestContext !== contextGeneration) return;
        residueError = error instanceof Error ? error.message : "无法确认当前设备的调试残留，请重试。";
        emit();
      } finally {
        if (generation === residueGeneration) {
          residueLoading = false;
          emit();
        }
      }
    },

    async refreshHistory(repository) {
      const queryKey = ++historyGeneration;
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
      const requestedProjectId = projectId;
      const requestedDeviceId = deviceId.trim();
      historyLoading = true;
      historyLoadingMore = false;
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
      if (historyFilterDevice === value) return;
      historyGeneration += 1;
      historyLoading = false;
      historyLoadingMore = false;
      historyFilterDevice = value;
      emit();
    },

    async openHistoryRun(repository, runId) {
      const generation = ++historyRunGeneration;
      const requestContext = contextGeneration;
      historyRunLoading = true;
      errorMessage = "";
      emit();
      try {
        const existing = await repository.getRun(runId);
        if (generation !== historyRunGeneration || requestContext !== contextGeneration) return;
        const previousProjectId = projectId;
        const selection = bridgeTargetSelectionFrom(existing, protocol);
        if (
          (existing.projectId && existing.projectId !== projectId) ||
          (existing.bridgeId && selection.bridgeId !== bridgeId) ||
          (existing.targetRef && selection.targetRef !== targetRef) ||
          (existing.deviceId && existing.deviceId !== deviceId) ||
          selection.protocol !== protocol
        ) invalidateContext();
        historyRunLoading = false;
        statusMessage = "";
        run = existing;
        writeRunId(existing.id);
        adoptRunTarget(existing);
        // Cross-project deep links (e.g. knowledge-entry source links land on
        // /dts-reload?runId=… for a run of another project) follow the run's
        // project. This also invalidates any in-flight candidate load for the
        // old project, which would otherwise clear the freshly opened run when
        // its project check ran against the stale project id.
        if (existing.projectId && existing.projectId !== previousProjectId) {
          projectId = existing.projectId;
          candidatesGeneration += 1;
          candidates = [];
          selectedBindingIds = [];
          debugValues = {};
          criticalConfirmed = false;
          handoffBindingIds = null;
          historyItems = [];
          historyNextCursor = null;
          historyError = "";
          loading = false;
        }
        emit();
      } catch (error) {
        if (generation !== historyRunGeneration || requestContext !== contextGeneration) return;
        historyRunLoading = false;
        errorMessage = error instanceof Error ? error.message : "加载运行详情失败。";
        emit();
      }
    },

    async downloadArtifact(repository) {
      if (!run?.artifact) return null;
      const requestedRun = run;
      const generation = contextGeneration;
      if (run.artifactRetentionExpired) {
        errorMessage = "该运行的编译产物已超过保留期，无法下载（元数据与摘要仍可查看）。";
        emit();
        return null;
      }
      try {
        const blob = await repository.downloadArtifact(requestedRun.id);
        if (generation !== contextGeneration || requestedRun.id !== run?.id) return null;
        return { blob, fileName: requestedRun.artifact!.fileName };
      } catch (error) {
        if (generation !== contextGeneration || requestedRun.id !== run?.id) return null;
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
      if (nextBridgeId !== bridgeId) {
        const previousBridgeId = bridgeId;
        // Initial bridge discovery must not cancel an authoritative run deep link.
        if (previousBridgeId || !historyRunLoading) invalidateContext();
        if (!deviceIdTouched) deviceId = nextBridgeId ? defaultDeviceId(nextBridgeId) : "";
        if (previousBridgeId) targetRef = "";
      }
      bridgeId = nextBridgeId;
      emit();
    },

    setProtocol(nextProtocol) {
      if (protocol === nextProtocol) return;
      invalidateContext();
      protocol = nextProtocol;
      emit();
    },

    setTargetRef(nextTargetRef) {
      if (targetRef === nextTargetRef) return;
      invalidateContext();
      targetRef = nextTargetRef;
      emit();
    },

    setDeviceId(nextDeviceId) {
      if (deviceId === nextDeviceId) return;
      invalidateContext();
      deviceId = nextDeviceId;
      deviceIdTouched = true;
      emit();
    },

    clearHandoff() {
      if (handoffBindingIds === null) return;
      handoffBindingIds = null;
      emit();
    }
  };
  return session;
}
