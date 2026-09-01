import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { isReloadRunDistillable } from "@/domain/knowledge/distillReload";
import { isReloadRunPromotable } from "@/domain/dtsReload/promote";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import { describeReloadValueShapeAuthoring } from "@/domain/dtsReload/valueShape";
import { useDtsReloadRunSession } from "@/application/dts-reload/useDtsReloadRunSession";
import type { DtsReloadDeployProtocol } from "@/application/dts-reload/dtsReloadRunSession";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { inferBridgeOnline } from "@/components/bridgeOnline";
import {
  LocalDeviceBridgePanel,
  type LocalDeviceBridgePanelState
} from "@/components/LocalDeviceBridgePanel";
import { useTopBarActions } from "@/components/layout";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
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
    initialProjectId: initialProjectId ?? projects[0]?.id ?? "",
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
  const [selectedModuleNodeId, setSelectedModuleNodeId] = useState<string | null>(null);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
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

  const selectedModuleNode = useMemo(
    () =>
      selectedModuleNodeId ? findWorkbenchTreeNode(moduleTree, selectedModuleNodeId) : null,
    [moduleTree, selectedModuleNodeId]
  );

  useEffect(() => {
    if (selectedModuleNodeId && !selectedModuleNode) {
      setSelectedModuleNodeId(null);
    }
  }, [selectedModuleNodeId, selectedModuleNode]);

  const selectedModuleBindingIds = useMemo(
    () => (selectedModuleNode ? collectSubtreeBindingIds(selectedModuleNode) : null),
    [selectedModuleNode]
  );

  const scopedCandidates = useMemo(() => {
    const normalizedQuery = nameQuery.trim().toLocaleLowerCase();
    return handoffFilteredCandidates.filter((candidate) => {
      if (selectedModuleBindingIds && !selectedModuleBindingIds.has(candidate.bindingId)) return false;
      if (!normalizedQuery) return true;
      const haystack = [candidate.displayName, candidate.propertyKey].join(" ").toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
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
            (candidate) => candidate.bindingId === editingBindingId && candidate.debuggable
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
      if (detectRequestSeqRef.current !== requestSeq) return;

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
      if (detectRequestSeqRef.current !== requestSeq) return;
      setReachableTargets([]);
      if (session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      setTargetDetectionError(
        toUserErrorMessage(error, "设备检测失败，请稍后重试。")
      );
    } finally {
      if (detectRequestSeqRef.current === requestSeq) {
        setDetectingTargets(false);
      }
    }
  }, [connectedBridgeId, detectTargets, protocol, session]);

  useEffect(() => {
    if (!detectTargets || !connectedBridgeId) {
      setReachableTargets([]);
      if (detectTargets && session.getSnapshot().targetRef.trim()) {
        session.setTargetRef("");
      }
      return;
    }
    void runDetectTargets();
  }, [connectedBridgeId, detectTargets, protocol, runDetectTargets]);

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
        disabled={!detectTargets}
        onClick={() => void runDetectTargets({ manual: true })}
      >
        重新检测
      </button>
    </div>,
    [connectedTargetLabel, connectedTargetRef, detectTargets, detectingTargets, protocol, runDetectTargets]
  );

  useEffect(() => {
    void session.loadResidue(repository);
  }, [repository, session, deviceId]);

  useEffect(() => {
    void session.refreshHistory(repository);
  }, [repository, session, projectId, historyFilterDevice, historyFilterDevice ? deviceId : ""]);

  useEffect(() => {
    void session.loadCandidates(repository);
  }, [repository, session, projectId]);

  const openCandidateEditor = (candidate: DtsReloadCandidate) => {
    if (!candidate.debuggable) return;
    setEditingBindingId(candidate.bindingId);
  };

  const onStart = () => {
    if (!canStartRun) return;
    void session.start(repository);
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
    void session.openHistoryRun(repository, runId);
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
    try {
      const draft = await knowledgeRepository.distillFromReloadRun(run.id);
      onNavigate(`/knowledge?entryId=${encodeURIComponent(draft.id)}`);
    } catch (error) {
      setDistilError(
        error instanceof Error && error.message ? `沉淀为知识失败:${error.message}` : "沉淀为知识失败,请稍后重试"
      );
    } finally {
      setDistilPending(false);
    }
  }, [distilPending, knowledgeRepository, onNavigate, run]);

  const canPromoteRun = Boolean(canPromoteToDrafts && onNavigate && run && isReloadRunPromotable(run));
  const executePromote = useCallback(
    async (unverifiableAcknowledged?: boolean) => {
      if (!onNavigate || !run || promotePending) {
        return;
      }
      setPromotePending(true);
      setPromoteError("");
      try {
        const result = await repository.promoteToDrafts({
          runId: run.id,
          bindingIds: run.targets.map((target) => target.bindingId),
          ...(unverifiableAcknowledged ? { unverifiableAcknowledged: true } : {})
        });
        setPromoteConfirmOpen(false);
        onNavigate(result.workbenchHref);
      } catch (error) {
        setPromoteError(
          error instanceof Error && error.message ? `晋升为草稿失败:${error.message}` : "晋升为草稿失败,请稍后重试"
        );
      } finally {
        setPromotePending(false);
      }
    },
    [onNavigate, promotePending, repository, run]
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
  const bridgeStatusPill =
    bridges.length === 0
      ? "等待 Bridge"
      : selectedBridge && inferBridgeOnline(selectedBridge, bridgeHealth, { healthExclusive: true })
        ? `${selectedBridge.machineLabel} · 已连接`
        : selectedBridge
          ? `${selectedBridge.machineLabel} · 未连接`
          : "等待 Bridge";

  return (
    <div className="workbench-page dts-reload-page">
      <div className="workbench-one-col">
        {!canStartRun ? (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            当前账号仅有调试查看权限：可浏览运行历史与参数上次重载状态，但无法启动、部署或恢复基线。需要{" "}
            <code className="rounded bg-amber-100 px-1">debugging:dts-reload</code> 才能执行变更。
          </p>
        ) : null}

        {visiblePageError ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            {visiblePageError}
          </p>
        ) : null}

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

        <div className="node-debugging-controls dts-reload-controls">
          <div className="protocol-switch" role="group" aria-label="连接协议">
            {(["hdc", "adb"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={protocol === item ? "protocol-switch-button active" : "protocol-switch-button"}
                aria-pressed={protocol === item}
                disabled={!canStartRun}
                onClick={() => handleProtocolChange(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="dts-reload-project-select">
            <span>项目</span>
            <select
              aria-label="选择项目"
              value={projectId}
              onChange={(event) => session.selectProject(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <LocalDeviceBridgePanel
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

        {targetDetectionError ? (
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

        {residue && !residueLoading ? (
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

        {selectedCandidates.length > 0 ? (
          <div className="dts-parameter-workbench__current-edits dts-draft-tray dts-reload-run-tray-slot">
            {selectedHasSensitive ? (
              <p role="status" className="dts-reload-sensitive-banner">
                已选参数命中敏感节点规则：除 debugging:dts-reload 外还需要{" "}
                {Array.from(
                  new Set(
                    selectedCandidates
                      .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                      .filter((value): value is string => Boolean(value))
                  )
                ).join(" / ") || "parameter:edit-critical"}
                。
                {selectedHasCriticalSensitive ? " critical 层级还需在本轮托盘中明确确认。" : ""}
              </p>
            ) : null}

            <section
              className="dts-reload-run-tray dts-binding-draft-tray dts-draft-tray"
              role="region"
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
                <span>{`本轮 ${selectedCandidates.length} 项`}</span>
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
                          onClick={() => session.removeFromBatch(candidate.bindingId)}
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
                          需要 {candidate.sensitiveMatch.requiredCapability}
                          {candidate.sensitiveMatch.requiresConfirmation ? "，并需明确确认" : ""}
                        </p>
                      ) : null}
                      <label className="dts-reload-run-tray__value">
                        <span>调试值</span>
                        <input
                          aria-label={`${candidate.displayName || candidate.propertyKey} 调试值`}
                          className="font-mono"
                          value={debugValue}
                          onChange={(event) =>
                            session.setDebugValue(candidate.bindingId, event.target.value)
                          }
                          disabled={!canStartRun || starting}
                          placeholder={describeReloadValueShapeAuthoring(candidate.resolvedValueShape).placeholder}
                        />
                      </label>
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
                    aria-label="确认 critical 敏感节点重载"
                  />
                  <span>
                    我确认要为 critical 敏感参数下发调试值。调试值不会写回参数库；设备部署需另行确认。
                  </span>
                </label>
              ) : null}

              <div className="binding-draft-submission__actions dts-reload-run-tray__actions">
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={() => session.resetBatchToBaseline()}
                >
                  重置为基线
                </button>
                <button
                  type="button"
                  className="button subtle"
                  disabled={starting}
                  onClick={() => session.clearBatch()}
                >
                  清空本轮
                </button>
                <button
                  type="button"
                  className="button primary"
                  aria-label={
                    starting ? "下发中" : `下发参数（${selectedCandidates.length}）`
                  }
                  onClick={onStart}
                  disabled={
                    !canStartRun ||
                    starting ||
                    !selectedHasMeaningfulDebugChange ||
                    (selectedHasCriticalSensitive && !criticalConfirmed)
                  }
                  title={
                    !selectedHasMeaningfulDebugChange
                      ? "本轮调试值均与库基线相同或为空"
                      : undefined
                  }
                >
                  {starting ? "下发中…" : `下发参数（${selectedCandidates.length}）`}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <section className="debug-table dts-reload-candidates">
          <div className="panel-header">
            <strong>可调试参数</strong>
            <span>
              {projectName} · {bridgeStatusPill}
            </span>
          </div>

          <div className="dts-parameter-workbench__body dts-reload-candidates-body">
            <div
              className="dts-parameter-workbench__navigator dts-workbench-topology"
              role="region"
              aria-label="模块导航"
            >
              <div className="dts-parameter-workbench__navigator-header">
                <h3 className="dts-parameter-workbench__navigator-title">模块导航</h3>
              </div>
              <DtsTopologyNavigator
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
              />
            </div>

            <div className="dts-reload-candidates-results">
              <DtsReloadCandidateTable
                rows={filtered}
                selectedBindingIds={selectedBindingIds}
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
                onToggle={(bindingId) => session.toggleCandidate(bindingId)}
                onEdit={openCandidateEditor}
              />
            </div>
          </div>
        </section>

        {run ? (
          <>
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
              deviceId={deviceId}
              targetRef={targetRef}
              canStartRun={canStartRun}
              canRetryDeploy={canRetryDeploy}
              deployReady={deployReady}
              deploying={deploying}
              onDownload={() => void onDownload()}
              onDeploy={() => session.openDeployConfirm(run)}
              onDistil={canDistilRun ? () => void onDistil() : undefined}
              distilPending={distilPending}
              onPromote={canPromoteRun ? onPromote : undefined}
              promotePending={promotePending}
            />
          </>
        ) : null}

        <RunHistorySection
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
        />

        {editingCandidate ? (
          <DtsReloadCandidateEditDialog
            candidate={editingCandidate}
            initialDebugValue={
              debugValues[editingCandidate.bindingId] ?? editingCandidate.baselineValue ?? ""
            }
            alreadyInBatch={selectedBindingIds.includes(editingCandidate.bindingId)}
            onClose={() => setEditingBindingId(null)}
            onConfirm={(debugValue) =>
              session.confirmCandidateDebugValue(editingCandidate.bindingId, debugValue)
            }
            onOpenHistoryRun={onOpenHistoryRun}
          />
        ) : null}

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
