import { SelectControl } from "@/components/common/SelectControl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ViewSwitch } from "@/components/ui/view-switch";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { Button } from "@/components/ui/button";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { isReloadRunDistillable } from "@/domain/knowledge/distillReload";
import { isReloadRunPromotable } from "@/domain/dtsReload/promote";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { useDtsReloadRunSession } from "@/application/dts-reload/useDtsReloadRunSession";
import type { DtsReloadDeployProtocol } from "@/application/dts-reload/dtsReloadRunSession";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import {
  LocalDeviceBridgePanel,
  type LocalDeviceBridgePanelState
} from "@/components/LocalDeviceBridgePanel";
import { useTopBarActions } from "@/components/layout";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
import { useModuleNodeSelection } from "@/hooks/useModuleNodeSelection";
import { DtsReloadCandidateEditDialog } from "@/features/dts-reload/DtsReloadCandidateEditDialog";
import { DtsReloadCandidateTable } from "@/features/dts-reload/DtsReloadCandidateTable";
import {
  adaptProbeBridgeHealth,
  asDeviceBridgeRecords,
  BRIDGE_UPGRADE_ENTRY_PATH,
  candidateModuleLabel,
  DeployConfirmBody,
  findWorkbenchTreeNode,
  ResidueIndicator,
  RestoreConfirmBody,
  RunHistorySection,
  RunResultSection,
  sensitiveBadgeLabel
} from "@/features/dts-reload/dtsReloadPresentation";
import {
  buildReloadModuleTree,
  collectSubtreeBindingIds
} from "@/application/parameters/buildReloadModuleTree";
import { filterItems } from "@/lib/search";
import { dtsReloadCandidateSearchProfile } from "@/lib/search/profiles";
import { buildParameterModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import {
  canonicalizeTreeFilterSelection,
  collectTreeFilterSelectedDescendantIds
} from "@/domain/tree-filter/treeFilter";
import type {
  DeviceBridgePairingCode,
  LocalBridgeHealthState
} from "@/infrastructure/http/deviceBridgeClient";
import { DEVICE_UNAVAILABLE_MESSAGE, toUserErrorMessage } from "@/infrastructure/http/userErrorMessage";
import { cn } from "@/lib/utils";
import "./dts-reload-refinement.css";

function dtsReloadModuleFilterId(candidate: Pick<DtsReloadCandidate, "bindingId" | "moduleId">): string {
  const moduleId = candidate.moduleId?.trim();
  // Legacy candidate payloads may not have a module id. Keep those rows
  // independently addressable rather than turning a display name into identity.
  return moduleId || `legacy-binding:${candidate.bindingId}`;
}

export type DtsReloadBridgeOption = {
  id: string;
  machineLabel: string;
  lastSeenAt?: string | null;
};

export type DtsReloadReachableTarget = {
  targetRef: string;
  label?: string;
  bridgeId?: string;
};

export type DtsReloadPageProps = {
  projects: Array<{ id: string; name: string }>;
  initialProjectId?: string;
  /** Resolved per runtime mode by the composition root (ADR-0002); never null. */
  repository: DtsReloadRepository;
  canStartRun: boolean;
  /** Reload write or Admin plus parameter:edit; UI gate only. */
  canPromoteToDrafts?: boolean;
  bridges?: DtsReloadBridgeOption[];
  listBridges?: () => Promise<DtsReloadBridgeOption[]>;
  /** Optional local health probe — defaults to deviceBridgeClient.probeLocalBridgeHealth. */
  probeBridgeHealth?: () => Promise<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>;
  /** Optional pairing-code seam for the bridge panel — defaults to the HTTP client. */
  createBridgePairingCode?: () => Promise<DeviceBridgePairingCode>;
  /** Optional reachable-target detection (same seam as /node-debugging detectTargets). */
  detectTargets?: (
    protocol: DtsReloadDeployProtocol,
    bridgeId?: string
  ) => Promise<DtsReloadReachableTarget[]>;
  /** Test/demo seam: seed deploy target without the removed manual targetRef field. */
  initialTargetRef?: string;
  /** Optional module registry for navigator nesting (defaults to runtime resolve). */
  moduleRegistryRepository?: ParameterModuleRegistryRepository | null;
  /** Knowledge port for distil-to-knowledge; absent hides the affordance. */
  knowledgeRepository?: KnowledgeRepository | null;
  /** knowledge:edit gates the distil affordance (deferred roadmap item 3). */
  knowledgeCapability?: KnowledgeCapability;
  /** Router navigation for the /knowledge draft-editor handoff. */
  onNavigate?: (path: string) => void;
  /** Deep link (`/dts-reload?runId=…`): opens this history run on mount. */
  initialRunId?: string | null;
  /** Workbench hand-off (`/dts-reload?bindingIds=`). */
  initialBindingIds?: string[] | null;
};

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
  canPromoteToDrafts = false,
  bridges: bridgesProp,
  listBridges,
  probeBridgeHealth,
  createBridgePairingCode,
  detectTargets,
  initialTargetRef,
  moduleRegistryRepository,
  knowledgeRepository,
  knowledgeCapability,
  onNavigate,
  initialRunId,
  initialBindingIds
}: DtsReloadPageProps) {
  const {
    session,
    projectId,
    candidates,
    loading,
    errorMessage,
    statusMessage,
    hasUnsavedBatch,
    historyRunLoading,
    residueError,
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
    deployReady,
    deployDeviceId,
    residueSensitiveCandidates,
    restoreHasSensitive,
    restoreHasCriticalSensitive,
    canRetryDeploy,
    handoffBindingIds
  } = useDtsReloadRunSession({
    // A run deep link is authoritative about its project. Start without a
    // guessed/default project so the mount effects cannot query another
    // project's candidates or history before `openHistoryRun` resolves it.
    initialProjectId: initialRunId ? "" : initialProjectId ?? projects[0]?.id ?? "",
    initialBridges: bridgesProp ?? [],
    initialTargetRef: initialTargetRef ?? "",
    initialBindingIds: initialBindingIds?.length ? initialBindingIds : undefined
  });

  const moduleRegistryRepo = useMemo(
    () =>
      moduleRegistryRepository === null
        ? null
        : (moduleRegistryRepository ?? resolveParameterModuleRegistryRepository()),
    [moduleRegistryRepository]
  );
  const [moduleRegistry, setModuleRegistry] = useState<ParameterModuleRegistry>(
    EMPTY_PARAMETER_MODULE_REGISTRY
  );
  const [nameQuery, setNameQuery] = useState("");
  const [moduleColumnFilter, setModuleColumnFilter] = useState<string[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const editorDirtyRef = useRef(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [discardBatch, setDiscardBatch] = useState(false);
  const leaveDecisionRef = useRef<((allowed: boolean) => void) | null>(null);
  const [pendingEditorAction, setPendingEditorAction] = useState<(() => void) | null>(null);
  const handleEditorDirtyChange = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, []);
  const guardEditorChange = (action: () => void) => {
    if (editingBindingId && editorDirtyRef.current) setPendingEditorAction(() => action);
    else action();
  };
  const guardBatchChange = (action: () => void) => {
    if (editorDirtyRef.current || hasUnsavedBatch) {
      setDiscardBatch(true);
      setPendingEditorAction(() => action);
    } else action();
  };
  useEffect(() => {
    if (!editorDirty && !hasUnsavedBatch) return;
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented || (!editorDirtyRef.current && !session.getSnapshot().hasUnsavedBatch)) return;
      event.preventDefault();
      const request = event as CustomEvent<SettingsLeaveRequest>;
      if (starting || deploying || restoring) {
        request.detail.decision = Promise.resolve(false);
        return;
      }
      if (leaveDecisionRef.current) {
        request.detail.decision = Promise.resolve(false);
        return;
      }
      request.detail.decision = new Promise<boolean>((resolve) => {
        leaveDecisionRef.current = resolve;
        setDiscardBatch(true);
        setPendingEditorAction(() => () => {
          leaveDecisionRef.current = null;
          resolve(true);
        });
      });
    };
    const guardUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      window.removeEventListener("beforeunload", guardUnload);
    };
  }, [editorDirty, hasUnsavedBatch, starting, deploying, restoring, session]);
  useEffect(() => () => leaveDecisionRef.current?.(false), []);
  const resultRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [reachableTargets, setReachableTargets] = useState<DtsReloadReachableTarget[]>([]);
  const [detectingTargets, setDetectingTargets] = useState(false);
  const [targetDetectionError, setTargetDetectionError] = useState("");
  const [distilPending, setDistilPending] = useState(false);
  const [distilError, setDistilError] = useState("");
  const [promotePending, setPromotePending] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const [promoteConfirmOpen, setPromoteConfirmOpen] = useState(false);
  const openedInitialRunRef = useRef(false);
  const detectRequestSeqRef = useRef(0);
  const previousConnectedBridgeIdRef = useRef("");
  const lastDetectedProtocolRef = useRef<DtsReloadDeployProtocol | null>(null);
  const candidateTableRef = useRef<HTMLElement>(null);
  const pendingBatchFocusRef = useRef<string | null>(null);

  useEffect(() => {
    const bindingId = pendingBatchFocusRef.current;
    if (bindingId === null) return;
    pendingBatchFocusRef.current = null;
    queueMicrotask(() => {
      const checkbox = Array.from(candidateTableRef.current?.querySelectorAll<HTMLInputElement>("input[data-binding-id]") ?? [])
        .find((input) => input.dataset.bindingId === bindingId);
      (checkbox ?? candidateTableRef.current?.querySelector<HTMLInputElement>('input[type="search"]'))?.focus();
    });
  }, [selectedBindingIds]);

  const selectedBridge = useMemo(
    () => bridges.find((bridge) => bridge.id === bridgeId) ?? null,
    [bridges, bridgeId]
  );

  const connectedBridgeId = useMemo(() => {
    const healthBridgeId = bridgeHealth?.connected ? bridgeHealth.bridgeId?.trim() : "";
    return healthBridgeId && bridges.some((bridge) => bridge.id === healthBridgeId)
      ? healthBridgeId
      : "";
  }, [bridgeHealth, bridges]);

  const targetsForSelectedBridge = useMemo(
    () =>
      connectedBridgeId
        ? reachableTargets.filter(
            (target) => !target.bridgeId || target.bridgeId === connectedBridgeId
          )
        : [],
    [connectedBridgeId, reachableTargets]
  );

  useEffect(() => {
    if (!moduleRegistryRepo) {
      setModuleRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      return undefined;
    }
    let cancelled = false;
    moduleRegistryRepo
      .getRegistry()
      .then((registry) => {
        if (!cancelled) setModuleRegistry(registry);
      })
      .catch(() => {
        if (!cancelled) setModuleRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleRegistryRepo]);

  const handoffFilteredCandidates = useMemo(() => {
    if (!handoffBindingIds || handoffBindingIds.length === 0) return candidates;
    const handoffSet = new Set(handoffBindingIds);
    return candidates.filter((candidate) => handoffSet.has(candidate.bindingId));
  }, [candidates, handoffBindingIds]);

  const moduleTree = useMemo(
    () => buildReloadModuleTree({ candidates: handoffFilteredCandidates, modules: moduleRegistry.modules }),
    [handoffFilteredCandidates, moduleRegistry.modules]
  );

  const [selectedModuleNodeId, setSelectedModuleNodeId] = useModuleNodeSelection((nodeId) => Boolean(findWorkbenchTreeNode(moduleTree, nodeId)));
  const selectedModuleNode = useMemo(
    () =>
      selectedModuleNodeId ? findWorkbenchTreeNode(moduleTree, selectedModuleNodeId) : null,
    [moduleTree, selectedModuleNodeId]
  );

  const selectedModuleBindingIds = useMemo(
    () => (selectedModuleNode ? collectSubtreeBindingIds(selectedModuleNode) : null),
    [selectedModuleNode]
  );

  const scopedCandidates = useMemo(() => {
    const scoped = handoffFilteredCandidates.filter((candidate) => {
      if (selectedModuleBindingIds && !selectedModuleBindingIds.has(candidate.bindingId)) return false;
      return true;
    });
    return filterItems(scoped, nameQuery, dtsReloadCandidateSearchProfile);
  }, [handoffFilteredCandidates, nameQuery, selectedModuleBindingIds]);

  const moduleFilterNodes = useMemo(
    () =>
      buildParameterModuleFilterNodes(
        scopedCandidates.map((candidate) => ({
          moduleId: dtsReloadModuleFilterId(candidate),
          moduleName: candidateModuleLabel(candidate)
        })),
        moduleRegistry.modules
      ),
    [moduleRegistry.modules, scopedCandidates]
  );

  const activeModuleColumnFilter = useMemo(
    () => {
      const nodeIds = new Set(moduleFilterNodes.map((node) => node.id));
      return canonicalizeTreeFilterSelection(moduleFilterNodes, moduleColumnFilter).filter((id) => nodeIds.has(id));
    },
    [moduleColumnFilter, moduleFilterNodes]
  );

  const filtered = useMemo(() => {
    if (activeModuleColumnFilter.length === 0) return scopedCandidates;
    const selected = collectTreeFilterSelectedDescendantIds(moduleFilterNodes, activeModuleColumnFilter);
    return scopedCandidates.filter((candidate) =>
      selected.has(dtsReloadModuleFilterId(candidate))
    );
  }, [activeModuleColumnFilter, moduleFilterNodes, scopedCandidates]);

  const handoffSummary = useMemo(() => {
    if (!handoffBindingIds || handoffBindingIds.length === 0) return null;
    const foundIds = new Set(candidates.map((candidate) => candidate.bindingId));
    const missingCount = handoffBindingIds.filter((id) => !foundIds.has(id)).length;
    const blockedCount = candidates.filter(
      (candidate) => handoffBindingIds.includes(candidate.bindingId) && !candidate.debuggable
    ).length;
    return {
      requested: handoffBindingIds.length,
      missingCount,
      blockedCount
    };
  }, [candidates, handoffBindingIds]);

  const clearHandoffFilter = () => {
    session.clearHandoff();
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("bindingIds");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  const editingCandidate = useMemo(
    () =>
      editingBindingId
        ? candidates.find(
            (candidate) => candidate.bindingId === editingBindingId
          ) ?? null
        : null,
    [candidates, editingBindingId]
  );

  useEffect(() => {
    if (editingBindingId && !editingCandidate) {
      setEditingBindingId(null);
    }
  }, [editingBindingId, editingCandidate]);

  const bridgesOverride = useMemo(
    () => (bridgesProp ? asDeviceBridgeRecords(bridgesProp) : undefined),
    [bridgesProp]
  );

  const listBridgesForPanel = useMemo(
    () =>
      listBridges
        ? async () => asDeviceBridgeRecords(await listBridges())
        : undefined,
    [listBridges]
  );

  const probeHealthForPanel = useMemo(
    () => (probeBridgeHealth ? adaptProbeBridgeHealth(probeBridgeHealth) : undefined),
    [probeBridgeHealth]
  );

  const handleBridgeStateChange = useCallback(
    (state: LocalDeviceBridgePanelState) => {
      session.syncBridges(
        state.bridges
          .filter((bridge) => !bridge.revokedAt)
          .map((bridge) => ({
            id: bridge.id,
            machineLabel: bridge.machineLabel,
            lastSeenAt: bridge.lastSeenAt
          })),
        state.health
          ? { connected: state.health.connected, bridgeId: state.health.bridgeId }
          : null
      );
    },
    [session]
  );

  useEffect(() => {
    const previousBridgeId = previousConnectedBridgeIdRef.current;
    if (previousBridgeId && previousBridgeId !== connectedBridgeId) {
      detectRequestSeqRef.current += 1;
      setReachableTargets([]);
      setDetectingTargets(false);
      if (session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      setTargetDetectionError(
        connectedBridgeId
          ? "本地 Device Bridge 已切换，请重新检测设备。"
          : "本地 Device Bridge 已断开，请重新连接后再检测。"
      );
    }
    previousConnectedBridgeIdRef.current = connectedBridgeId;
  }, [connectedBridgeId, session]);

  const runDetectTargets = useCallback(async (options: { manual?: boolean } = {}) => {
    if (historyRunLoading) return;
    const requestSeq = detectRequestSeqRef.current + 1;
    detectRequestSeqRef.current = requestSeq;
    const requestProtocol = protocol;
    const requestBridgeId = connectedBridgeId;

    if (!detectTargets) {
      setReachableTargets([]);
      return;
    }

    if (!requestBridgeId) {
      setReachableTargets([]);
      if (session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      if (options.manual) {
        setTargetDetectionError("本地 Device Bridge 未连接，请先连接本机后重新检测。");
      }
      setDetectingTargets(false);
      return;
    }

    if (
      lastDetectedProtocolRef.current &&
      lastDetectedProtocolRef.current !== requestProtocol &&
      session.getSnapshot().targetRef.trim()
    ) {
      session.setTargetRef("");
    }
    lastDetectedProtocolRef.current = requestProtocol;
    setTargetDetectionError("");
    setDetectingTargets(true);
    try {
      const targets = await detectTargets(requestProtocol, requestBridgeId);
      if (detectRequestSeqRef.current !== requestSeq || session.getSnapshot().historyRunLoading) return;

      const scopedTargets = targets.filter(
        (target) => !target.bridgeId || target.bridgeId === requestBridgeId
      );
      setReachableTargets(scopedTargets);
      if (scopedTargets.length === 0) {
        setTargetDetectionError(
          `未检测到 ${requestProtocol.toUpperCase()} 设备，请检查设备连接与调试授权后重新检测。`
        );
        if (session.getSnapshot().targetRef.trim()) {
          session.setTargetRef("");
        }
      } else {
        setTargetDetectionError("");
        const currentTargetRef = session.getSnapshot().targetRef.trim();
        const currentTargetStillAvailable = scopedTargets.some(
          (target) => target.targetRef.trim() === currentTargetRef
        );
        if (currentTargetRef && !currentTargetStillAvailable) {
          session.setTargetRef("");
        }
        if (scopedTargets.length === 1) {
          const only = scopedTargets[0]!.targetRef.trim();
          if (only && !currentTargetStillAvailable) {
            session.setTargetRef(only);
          }
        }
      }
    } catch (error) {
      if (detectRequestSeqRef.current !== requestSeq || session.getSnapshot().historyRunLoading) return;
      setReachableTargets([]);
      if (session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      const message = toUserErrorMessage(error, "设备检测失败，请稍后重试。");
      setTargetDetectionError(message.startsWith(DEVICE_UNAVAILABLE_MESSAGE) ? "" : message);
    } finally {
      if (detectRequestSeqRef.current === requestSeq) {
        setDetectingTargets(false);
      }
    }
  }, [connectedBridgeId, detectTargets, historyRunLoading, protocol, session]);

  useEffect(() => {
    if (historyRunLoading) {
      detectRequestSeqRef.current += 1;
      setDetectingTargets(false);
      return;
    }
    if (!detectTargets || !connectedBridgeId) {
      setReachableTargets([]);
      if (detectTargets && session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      return;
    }
    void runDetectTargets();
  }, [connectedBridgeId, detectTargets, historyRunLoading, protocol, runDetectTargets]);

  const handleProtocolChange = useCallback(
    (nextProtocol: DtsReloadDeployProtocol) => {
      if (nextProtocol === protocol) return;
      detectRequestSeqRef.current += 1;
      lastDetectedProtocolRef.current = null;
      setReachableTargets([]);
      setTargetDetectionError("");
      setDetectingTargets(false);
      if (session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      session.setProtocol(nextProtocol);
    },
    [protocol, session]
  );

  const connectedTargetRef = connectedBridgeId ? targetRef.trim() : "";
  const connectedTargetLabel =
    targetsForSelectedBridge.find((target) => target.targetRef === connectedTargetRef)?.label?.trim()
    || connectedTargetRef;

  useTopBarActions(
    <div className="device-pill">
      <span className={connectedTargetRef ? "live-dot" : "idle-dot"} />
      {connectedTargetRef
        ? `已连接：${connectedTargetLabel}`
        : detectingTargets
          ? "检测中..."
          : `未连接 ${protocol.toUpperCase()} 设备`}
      <button
        className="link-button"
        type="button"
        disabled={!detectTargets || historyRunLoading || deploying || restoring}
        onClick={() => void runDetectTargets({ manual: true })}
      >
        重新检测
      </button>
    </div>,
    [connectedTargetLabel, connectedTargetRef, detectTargets, detectingTargets, protocol, runDetectTargets, historyRunLoading, deploying, restoring]
  );

  useEffect(() => {
    void session.loadResidue(repository);
  }, [repository, session, projectId, protocol, targetRef, deviceId, run?.id]);

  useEffect(() => {
    void session.refreshHistory(repository);
  }, [repository, session, projectId, protocol, targetRef, historyFilterDevice, historyFilterDevice ? deviceId : ""]);

  useEffect(() => {
    void session.loadCandidates(repository);
  }, [repository, session, projectId]);

  const openCandidateEditor = (candidate: DtsReloadCandidate) => {
    if (candidate.bindingId === editingBindingId) return;
    guardEditorChange(() => setEditingBindingId(candidate.bindingId));
  };

  const onStart = () => {
    if (!canStartRun) return;
    guardEditorChange(() => {
      setEditingBindingId(null);
      void session.start(repository).then(() => resultRef.current?.scrollIntoView?.({ block: "start" }));
    });
  };

  const onDownload = async () => {
    const result = await session.downloadArtifact(repository);
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onOpenHistoryRun = (runId: string) => {
    guardBatchChange(() => {
      setEditingBindingId(null);
      session.clearBatch();
      void session.openHistoryRun(repository, runId).then(() => resultRef.current?.scrollIntoView?.({ block: "start" }));
    });
  };

  // Deep link (`/dts-reload?runId=…`): open the referenced history run once,
  // so knowledge-entry source links land on the run detail.
  useEffect(() => {
    if (!initialRunId || openedInitialRunRef.current) {
      return;
    }
    openedInitialRunRef.current = true;
    void session.openHistoryRun(repository, initialRunId);
  }, [initialRunId, repository, session]);

  // Distil-to-knowledge (design deferred roadmap item 3): pre-fills a draft
  // from the terminal run and hands off into the /knowledge draft editor,
  // exactly like the logs page pattern. Server-side gates stay authoritative.
  const canDistilRun = Boolean(
    knowledgeRepository && knowledgeCapability?.canEdit && onNavigate && run && isReloadRunDistillable(run.status)
  );
  const onDistil = useCallback(async () => {
    if (!knowledgeRepository || !onNavigate || !run || distilPending) {
      return;
    }
    setDistilPending(true);
    setDistilError("");
    const batch = session.getSnapshot();
    const batchSnapshot = JSON.stringify([batch.projectId, batch.selectedBindingIds, batch.debugValues]);
    try {
      const draft = await knowledgeRepository.distillFromReloadRun(run.id);
      const currentBatch = session.getSnapshot();
      if (batchSnapshot === JSON.stringify([currentBatch.projectId, currentBatch.selectedBindingIds, currentBatch.debugValues])) {
        session.clearBatch();
      }
      onNavigate(`/knowledge?entryId=${encodeURIComponent(draft.id)}`);
    } catch (error) {
      setDistilError(
        error instanceof Error && error.message ? `沉淀为知识失败:${error.message}` : "沉淀为知识失败,请稍后重试"
      );
    } finally {
      setDistilPending(false);
    }
  }, [distilPending, knowledgeRepository, onNavigate, run, session]);

  const canPromoteRun = Boolean(canPromoteToDrafts && onNavigate && run && isReloadRunPromotable(run));
  const executePromote = useCallback(
    async (unverifiableAcknowledged?: boolean) => {
      if (!onNavigate || !run || promotePending) {
        return;
      }
      setPromotePending(true);
      setPromoteError("");
      const batch = session.getSnapshot();
      const batchSnapshot = JSON.stringify([batch.projectId, batch.selectedBindingIds, batch.debugValues]);
      try {
        const result = await repository.promoteToDrafts({
          runId: run.id,
          bindingIds: run.targets.map((target) => target.bindingId),
          ...(unverifiableAcknowledged ? { unverifiableAcknowledged: true } : {})
        });
        setPromoteConfirmOpen(false);
        const currentBatch = session.getSnapshot();
        if (batchSnapshot === JSON.stringify([currentBatch.projectId, currentBatch.selectedBindingIds, currentBatch.debugValues])) {
          session.clearBatch();
        }
        onNavigate(result.workbenchHref);
      } catch (error) {
        setPromoteError(
          error instanceof Error && error.message ? `晋升为草稿失败:${error.message}` : "晋升为草稿失败,请稍后重试"
        );
      } finally {
        setPromotePending(false);
      }
    },
    [onNavigate, promotePending, repository, run, session]
  );
  const onPromote = useCallback(() => {
    if (!run || !canPromoteRun) {
      return;
    }
    if (run.status === "unverifiable") {
      setPromoteConfirmOpen(true);
      return;
    }
    void executePromote();
  }, [canPromoteRun, executePromote, run]);

  useEffect(() => {
    setDistilError("");
    setPromoteError("");
    setPromoteConfirmOpen(false);
  }, [run?.id]);

  const confirmRun = pendingDeployRun ?? run;
  const visiblePageError = errorMessage.startsWith(DEVICE_UNAVAILABLE_MESSAGE) ? "" : errorMessage;

  const projectName = projects.find((project) => project.id === projectId)?.name ?? projectId;

  return (
    <div className="workbench-page dts-reload-page">
      <div className="debugging-workbench-content">
        {!canStartRun ? (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            当前账号仅有调试查看权限：可浏览参数详情、运行历史与上次重载状态。启动、部署或恢复基线前，请联系管理员开通调试操作权限。
          </p>
        ) : null}

        {visiblePageError ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            {visiblePageError}
            {candidates.length === 0 ? <button type="button" className="button subtle" disabled={loading} onClick={() => void session.loadCandidates(repository)}>重新加载参数</button> : null}
          </p>
        ) : null}
        {statusMessage ? <p role="status" className="dts-reload-info">{statusMessage}</p> : null}

        {handoffSummary ? (
          <div
            className="dts-reload-residue-banner dts-reload-handoff-banner"
            role="status"
            aria-label="工作台带入的参数"
          >
            <span>
              已从参数工作台带入 {handoffSummary.requested} 个参数
              {handoffSummary.missingCount > 0
                ? `，其中 ${handoffSummary.missingCount} 个未在本项目候选中找到`
                : ""}
              {handoffSummary.blockedCount > 0
                ? `，其中 ${handoffSummary.blockedCount} 个当前不可调试`
                : ""}
              。本轮托盘未自动勾选，以免带入未改动的基线值。
            </span>
            <button type="button" className="button subtle" onClick={clearHandoffFilter}>
              显示全部
            </button>
          </div>
        ) : null}

        <NavigatorWorkbench pageKey="dts-reload"
          panelId={`dts-reload-${protocol}-panel`} tabId={`dts-reload-${protocol}-tab`}
          toolbar={(primaryAction) => <div className="dts-reload-taskbar">
            <label className="dts-reload-project-select">
              <span>项目</span>
              <SelectControl size="filter" ariaLabel="选择项目" value={projectId}
                disabled={starting || deploying || restoring || historyRunLoading}
                onValueChange={(value) => {
                  if (value === projectId) return;
                  guardBatchChange(() => {
                    setEditingBindingId(null);
                    setNameQuery("");
                    setModuleColumnFilter([]);
                    setSelectedModuleNodeId(null);
                    session.selectProject(value);
                  });
                }}
                options={projects.map((project) => ({ value: project.id, label: project.name }))} />
            </label>
          <ViewSwitch variant="tabs" ariaLabel="连接协议" value={protocol}
            onValueChange={(value) => {
              if (value === protocol) return;
              guardEditorChange(() => {
                setEditingBindingId(null);
                handleProtocolChange(value as DtsReloadDeployProtocol);
              });
            }}
            items={(["hdc", "adb"] as const).map((value) => ({ value, label: value.toUpperCase(), disabled: !canStartRun || starting || deploying || restoring || historyRunLoading,
              id: `dts-reload-${value}-tab`, panelId: `dts-reload-${value}-panel` }))} />
            <span className="dts-reload-selection-count">已选 {selectedCandidates.length} 项</span>
            {primaryAction}
          </div>}
          primaryAction={canStartRun ? <Button
                  data-primary-action="true"
                  aria-label={
                    starting ? "预检中" : `启动预检（${selectedCandidates.length}）`
                  }
                  onClick={onStart}
                  disabled={
                    !canStartRun || selectedCandidates.length === 0 ||
                    starting || loading || historyRunLoading || deploying || restoring ||
                    !selectedHasMeaningfulDebugChange ||
                    (selectedHasCriticalSensitive && !criticalConfirmed)
                  }
                  title={
                    !selectedHasMeaningfulDebugChange
                      ? "本轮调试值均与库基线相同或为空"
                      : undefined
                  }
                >
                  {starting ? "预检中…" : `启动预检（${selectedCandidates.length}）`}
                </Button> : undefined}
          context={<>
        <LocalDeviceBridgePanel
          compact
          target={connectedBridgeId ? targetRef.trim() || undefined : undefined}
          detecting={detectingTargets}
          protocol={protocol}
          onDetect={() => void runDetectTargets({ manual: true })}
          bridgesOverride={bridgesOverride}
          listBridges={listBridgesForPanel}
          probeHealth={probeHealthForPanel}
          createPairingCode={createBridgePairingCode}
          onBridgeStateChange={handleBridgeStateChange}
        />

        {targetDetectionError && !targetDetectionError.startsWith(DEVICE_UNAVAILABLE_MESSAGE) ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            {targetDetectionError}
          </p>
        ) : null}

        {targetsForSelectedBridge.length > 1 ? (
          <section className="bridge-target-picker" aria-label="设备代理目标选择">
            <div className="bridge-target-picker__head">
              <strong>检测到多个设备代理目标</strong>
              <small>请选择要部署的设备后再启动重载。</small>
            </div>
            <ul className="bridge-target-picker__list">
              {targetsForSelectedBridge.map((target) => (
                <li key={`${target.bridgeId ?? "any"}:${target.targetRef}`}>
                  <button
                    type="button"
                    className={cn("button subtle", targetRef === target.targetRef ? "is-active" : undefined)}
                    disabled={!canStartRun}
                    aria-pressed={targetRef === target.targetRef}
                    onClick={() => session.setTargetRef(target.targetRef)}
                  >
                    {target.label?.trim() || target.targetRef}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {residueError ? <p role="alert" className="dts-reload-info dts-reload-info--error">
          残留状态未知：{residueError}
          <button type="button" className="button subtle" onClick={() => void session.loadResidue(repository)}>重试查询残留</button>
        </p> : null}
        {residue && !residueLoading && !residueError ? (
          <div className="dts-reload-residue-banner" role="region" aria-label="重载残留">
            <ResidueIndicator residue={residue} deviceId={deviceId.trim()} />
            <button
              type="button"
              className="button subtle"
              disabled={!canStartRun || restoring || !deviceId.trim()}
              onClick={() => session.openRestoreConfirm()}
            >
              恢复基线（补偿性重载）
            </button>
          </div>
        ) : null}

          </>}
          navigatorLabel="模块导航" taskLabel="DTS 重载任务" taskClassName="dts-reload-task"
          navigator={<DtsTopologyNavigator
                view="effective"
                nodes={moduleTree}
                selectedNodeId={selectedModuleNode?.id ?? null}
                defaultExpandDepth={2}
                labelKind="text"
                emptyMessage="暂无模块分组"
                ariaLabel="业务模块树"
                onSelectNode={(nodeId) =>
                  setSelectedModuleNodeId((current) => (current === nodeId ? null : nodeId))
                }
              />}
        >
        <nav className="dts-reload-section-nav" aria-label="调试区段">
          <a href="#reload-candidates">参数目录</a>
          {selectedCandidates.length > 0 ? <a href="#reload-batch">本轮变更 · {selectedCandidates.length}</a> : null}
          {run ? <a href="#reload-result">运行结果</a> : null}
          <button type="button" onClick={() => {
            const details = historyRef.current?.querySelector("details");
            if (details) details.open = true;
            historyRef.current?.scrollIntoView?.({ block: "start" });
          }}>运行历史 · {historyItems.length}</button>
        </nav>
        {selectedCandidates.length > 0 ? (
          <details id="reload-batch" className="dts-parameter-workbench__current-edits dts-draft-tray dts-reload-run-tray-slot" open={trayOpen} onToggle={(event) => setTrayOpen(event.currentTarget.open)}>
            <summary className="dts-reload-run-tray__summary"><strong>本轮重载 · {selectedCandidates.length} 项</strong><span>{selectedHasMeaningfulDebugChange ? "核对调试值后启动预检" : "修改调试值后启动预检"}</span></summary>
            {selectedHasSensitive ? (
              <div role="status" className="dts-reload-sensitive-banner">
                本轮包含敏感参数，请核对目标设备和参数范围。
                {selectedHasCriticalSensitive ? "关键风险参数还需额外授权，并在本轮明确确认。" : "这些参数需要额外授权。"}
                部署到设备前仍需人工确认。
                <details><summary>权限说明</summary>
                {Array.from(
                  new Set(
                    selectedCandidates
                      .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                      .filter((value): value is string => Boolean(value))
                  )
                ).join(" / ") || "parameter:edit-critical"}
                </details>
              </div>
            ) : null}

            <section
              className="dts-reload-run-tray dts-binding-draft-tray dts-draft-tray"
              aria-label="本轮重载"
            >
              <header>
                <div>
                  <h3>本轮重载</h3>
                  <p>
                    {deployReady
                      ? "核对基线 → 调试值后启动预检；通过后需再确认部署到设备。调试值不会写回参数库。"
                      : "可先编辑调试值并启动预检；部署需先完成 Bridge 连接与目标检测。"}
                  </p>
                </div>
              </header>

              <div className="dts-binding-draft-tray__items dts-reload-run-tray__items">
                {selectedCandidates.map((candidate) => {
                  const sensitiveLabel = sensitiveBadgeLabel(candidate);
                  const debugValue = debugValues[candidate.bindingId] ?? "";
                  const baselineValue = candidate.baselineValue ?? "—";
                  return (
                    <article className="dts-binding-draft-tray__item" key={candidate.bindingId}>
                      <div className="dts-binding-draft-tray__item-heading">
                        <div>
                          <strong>{candidate.displayName || candidate.propertyKey}</strong>
                          <span>{candidateModuleLabel(candidate)}</span>
                          {sensitiveLabel ? (
                            <span
                              className={cn(
                                "dts-reload-sensitive-badge",
                                candidate.sensitiveMatch?.riskTier === "critical" && "is-critical"
                              )}
                            >
                              {sensitiveLabel}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="button subtle"
                          aria-label={`移出本轮重载 ${candidate.displayName || candidate.propertyKey}`}
                          disabled={starting || !canStartRun}
                          onClick={() => {
                            const remove = () => {
                              pendingBatchFocusRef.current = candidate.bindingId;
                              session.removeFromBatch(candidate.bindingId);
                            };
                            if (candidate.bindingId === editingBindingId) guardEditorChange(() => {
                              setEditingBindingId(null);
                              remove();
                            });
                            else remove();
                          }}
                        >
                          <X size={15} strokeWidth={1.9} aria-hidden="true" />
                          移除
                        </button>
                      </div>
                      <div
                        className="dts-binding-draft-tray__diff"
                        aria-label={`${candidate.displayName || candidate.propertyKey} 值变更`}
                      >
                        <ParameterValueDiff baseValue={baselineValue} targetValue={debugValue || "—"} />
                      </div>
                      <p className="dts-reload-run-tray__meta">
                        {candidate.nodePath ?? "无路径"}
                      </p>
                      {candidate.sensitiveMatch ? (
                        <p className="dts-reload-run-tray__meta">
                          此参数需要额外授权{candidate.sensitiveMatch.requiresConfirmation ? "，并需明确确认" : ""}。
                        </p>
                      ) : null}
                      <button type="button" className="button subtle" disabled={starting || !canStartRun}
                        aria-label={`编辑本轮 ${candidate.displayName || candidate.propertyKey}`}
                        onClick={() => openCandidateEditor(candidate)}>编辑调试值</button>
                    </article>
                  );
                })}
              </div>

              {selectedHasCriticalSensitive ? (
                <label className="dts-reload-critical-confirm">
                  <input
                    type="checkbox"
                    checked={criticalConfirmed}
                    onChange={(event) => session.setCriticalConfirmed(event.target.checked)}
                    aria-label="确认关键风险参数重载"
                  />
                  <span>
                    我确认本轮包含关键风险参数。调试值不会写回参数库；设备部署仍需单独确认。
                  </span>
                </label>
              ) : null}

              <div className="binding-draft-submission__actions dts-reload-run-tray__actions">
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={() => guardBatchChange(() => {
                    setEditingBindingId(null);
                    session.resetBatchToBaseline();
                  })}
                >
                  重置为基线
                </button>
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={() => guardBatchChange(() => {
                    setEditingBindingId(null);
                    pendingBatchFocusRef.current = "";
                    session.clearBatch();
                  })}
                >
                  清空本轮
                </button>
              </div>
            </section>
          </details>
        ) : null}

        <section id="reload-candidates" ref={candidateTableRef} className="debug-table dts-reload-candidates">
          <div className="panel-header">
            <strong>可调试参数</strong>
            <span>
              {projectName}
            </span>
          </div>

              <DtsReloadCandidateTable
                rows={filtered}
                selectedBindingIds={selectedBindingIds}
                canSelect={canStartRun && !starting && !deploying && !restoring && !historyRunLoading}
                debugValues={debugValues}
                hasActiveFilters={Boolean(nameQuery.trim() || selectedModuleNode || activeModuleColumnFilter.length || handoffBindingIds?.length)}
                filterSummary={[
                  selectedModuleNode ? `模块范围：${selectedModuleNode.label}` : "",
                  activeModuleColumnFilter.length ? `模块筛选：${activeModuleColumnFilter.length} 项` : "",
                  nameQuery.trim() ? `搜索：${nameQuery.trim()}` : "",
                  handoffBindingIds?.length ? `工作台带入：${handoffBindingIds.length} 项` : ""
                ].filter(Boolean).join(" · ")}
                onClearFilters={() => {
                  setNameQuery(""); setModuleColumnFilter([]); setSelectedModuleNodeId(null); clearHandoffFilter();
                }}
                loading={loading}
                nameQuery={nameQuery}
                onNameQueryChange={setNameQuery}
                listedCount={filtered.length}
                totalCount={handoffFilteredCandidates.length}
                moduleFilterNodes={moduleFilterNodes}
                selectedModuleFilterIds={activeModuleColumnFilter}
                onChangeModuleFilter={setModuleColumnFilter}
                onToggleModuleFilter={(value) =>
                  setModuleColumnFilter((current) =>
                    current.includes(value)
                      ? current.filter((item) => item !== value)
                      : [...current, value]
                  )
                }
                onClearModuleFilter={() => setModuleColumnFilter([])}
                onToggle={(bindingId) => {
                  const toggle = () => {
                    session.toggleCandidate(bindingId);
                    setTrayOpen(true);
                  };
                  if (bindingId === editingBindingId) guardEditorChange(() => {
                    setEditingBindingId(null);
                    toggle();
                  });
                  else toggle();
                }}
                onEdit={openCandidateEditor}
              />
        </section>
        {historyRunLoading ? <p role="status" className="dts-reload-info">正在加载运行详情…</p> : null}
        {run ? (
          <div id="reload-result" ref={resultRef} className="dts-reload-result-anchor" aria-busy={historyRunLoading}>
            {distilError ? (
              <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                {distilError}
              </p>
            ) : null}
            {promoteError ? (
              <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                {promoteError}
              </p>
            ) : null}
            <RunResultSection
              run={run}
              candidates={candidates}
              deviceId={deviceId}
              targetRef={targetRef}
              canStartRun={canStartRun}
              canRetryDeploy={canRetryDeploy}
              deployReady={deployReady}
              deploying={deploying}
              onDownload={() => void onDownload()}
              onDeploy={() => session.openDeployConfirm(run)}
              onDistil={canDistilRun ? () => guardBatchChange(() => {
                setEditingBindingId(null);
                void onDistil();
              }) : undefined}
              distilPending={distilPending}
              onPromote={canPromoteRun ? () => guardBatchChange(() => {
                setEditingBindingId(null);
                onPromote();
              }) : undefined}
              promotePending={promotePending}
            />
          </div>
        ) : null}

        <div ref={historyRef} className="dts-reload-history-anchor">
        <RunHistorySection
          candidates={candidates}
          historyRunLoading={historyRunLoading}
          historyItems={historyItems}
          historyLoading={historyLoading}
          historyLoadingMore={historyLoadingMore}
          historyError={historyError}
          historyNextCursor={historyNextCursor}
          historyFilterDevice={historyFilterDevice}
          deviceId={deviceId}
          activeRunId={run?.id ?? null}
          onFilterDeviceChange={(value) => session.setHistoryFilterDevice(value)}
          onOpenRun={onOpenHistoryRun}
          onLoadMore={() => void session.loadMoreHistory(repository)}
          onRetry={() => void session.refreshHistory(repository)}
        />
        </div>

        </NavigatorWorkbench>
        <div role="tabpanel" id={`dts-reload-${protocol === "hdc" ? "adb" : "hdc"}-panel`}
          aria-labelledby={`dts-reload-${protocol === "hdc" ? "adb" : "hdc"}-tab`} hidden />

        {editingCandidate ? (
          <DtsReloadCandidateEditDialog
            key={editingCandidate.bindingId}
            candidate={editingCandidate}
            canEdit={canStartRun && !starting && !deploying && !restoring && !historyRunLoading}
            initialDebugValue={
              debugValues[editingCandidate.bindingId] ?? editingCandidate.baselineValue ?? ""
            }
            alreadyInBatch={selectedBindingIds.includes(editingCandidate.bindingId)}
            onClose={() => guardEditorChange(() => setEditingBindingId(null))}
            onDirtyChange={handleEditorDirtyChange}
            onConfirm={(debugValue) => {
              const error = session.confirmCandidateDebugValue(editingCandidate.bindingId, debugValue);
              if (!error) {
                editorDirtyRef.current = false;
                setEditorDirty(false);
                setTrayOpen(true);
              }
              return error;
            }}
            onOpenHistoryRun={onOpenHistoryRun}
          />
        ) : null}

        <ConfirmDialog
          open={pendingEditorAction !== null}
          title="放弃未保存的修改？"
          description={discardBatch
            ? "本轮仍有未完成的调试值。继续将放弃这些修改；已保存的运行记录不会受到影响。"
            : "此次编辑尚未加入本轮重载。放弃后将恢复打开编辑器时的值。"}
          confirmLabel="放弃修改"
          cancelLabel="继续编辑"
          tone="danger"
          onCancel={() => {
            leaveDecisionRef.current?.(false); leaveDecisionRef.current = null;
            setPendingEditorAction(null); setDiscardBatch(false);
          }}
          onConfirm={() => {
            editorDirtyRef.current = false;
            setEditorDirty(false);
            setPendingEditorAction(null);
            setDiscardBatch(false);
            pendingEditorAction?.();
          }}
        />

        <ConfirmDialog
          open={deployConfirmOpen}
          title={confirmRun?.purpose === "restore-baseline" ? "确认补偿性恢复基线部署" : "确认部署到设备"}
          description={
            confirmRun ? (
              <DeployConfirmBody
                run={confirmRun}
                deviceId={deployDeviceId}
                targetRef={targetRef.trim()}
                bridgeMachineLabel={selectedBridge?.machineLabel ?? confirmRun.bridgeMachineLabel ?? "—"}
                residue={residue}
              />
            ) : null
          }
          confirmLabel={confirmRun?.purpose === "restore-baseline" ? "确认补偿性部署" : "确认部署"}
          tone="danger"
          pending={deploying}
          pendingLabel="部署中…"
          error={
            deployError ? (
              <span className="flex flex-col gap-2">
                <span>{deployError}</span>
                {deployUpgradeReleasesPath ? (
                  <span>
                    Bridge 版本过旧或缺少所需 RPC。请{" "}
                    <a className="font-medium underline" href={BRIDGE_UPGRADE_ENTRY_PATH}>
                      下载或升级 Bridge
                    </a>
                    （发布元数据：<code className="rounded bg-rose-100 px-1">{deployUpgradeReleasesPath}</code>）。
                  </span>
                ) : null}
              </span>
            ) : (
              ""
            )
          }
          onCancel={() => session.closeDeployConfirm()}
          onConfirm={() => void session.confirmDeploy(repository)}
        />

        <ConfirmDialog
          open={restoreConfirmOpen}
          title="确认恢复基线（补偿性重载）"
          description={
            residue ? (
              <RestoreConfirmBody
                residue={residue}
                deviceId={deviceId.trim()}
                restoreHasSensitive={restoreHasSensitive}
                restoreHasCriticalSensitive={restoreHasCriticalSensitive}
                restoreCriticalConfirmed={restoreCriticalConfirmed}
                residueSensitiveCandidates={residueSensitiveCandidates}
                onRestoreCriticalConfirmedChange={(value) =>
                  session.setRestoreCriticalConfirmed(value)
                }
              />
            ) : null
          }
          confirmLabel="启动补偿性恢复"
          tone="danger"
          pending={restoring}
          pendingLabel="启动中…"
          error={restoreError}
          onCancel={() => session.closeRestoreConfirm()}
          onConfirm={() => void session.confirmRestore(repository)}
        />

        <ConfirmDialog
          open={promoteConfirmOpen}
          title="确认晋升不可验证的运行"
          description="平台未能确认驱动观察到这些调试值。晋升只会创建参数草稿，不会提交变更请求，也不会改写库中的当前值。"
          confirmLabel="晋升为草稿"
          acknowledgement="我理解本次运行不可验证，仍要将调试值写成草稿"
          pending={promotePending}
          pendingLabel="晋升中…"
          error={promoteError}
          onCancel={() => setPromoteConfirmOpen(false)}
          onConfirm={() => void executePromote(true)}
        />
      </div>
    </div>
  );
}
