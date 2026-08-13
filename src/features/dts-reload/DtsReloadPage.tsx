import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Search, X } from "lucide-react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { isReloadRunDistillable } from "@/domain/knowledge/distillReload";
import { dtsReloadBlockReasonLabels } from "@/domain/dtsReload/types";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import { describeReloadValueShapeAuthoring } from "@/domain/dtsReload/valueShape";
import { useDtsReloadRunSession } from "@/application/dts-reload/useDtsReloadRunSession";
import type { DtsReloadDeployProtocol } from "@/application/dts-reload/dtsReloadRunSession";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ColumnFilter } from "@/components/ColumnFilter";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { inferBridgeOnline } from "@/components/bridgeOnline";
import {
  LocalDeviceBridgePanel,
  type LocalDeviceBridgePanelState
} from "@/components/LocalDeviceBridgePanel";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
import { DtsReloadCandidateEditDialog } from "@/features/dts-reload/DtsReloadCandidateEditDialog";
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
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { resolveParameterModuleRegistryRepository } from "@/application/parameters/parameterModuleRegistryResolve";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import type {
  DeviceBridgePairingCode,
  LocalBridgeHealthState
} from "@/infrastructure/http/deviceBridgeClient";
import { cn } from "@/lib/utils";

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
  bridges?: DtsReloadBridgeOption[];
  listBridges?: () => Promise<DtsReloadBridgeOption[]>;
  /** Optional local health probe — defaults to deviceBridgeClient.probeLocalBridgeHealth. */
  probeBridgeHealth?: () => Promise<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>;
  /** Optional pairing-code seam for the bridge panel — defaults to the HTTP client. */
  createBridgePairingCode?: () => Promise<DeviceBridgePairingCode>;
  /** Optional reachable-target detection (same seam as /node-debugging detectTargets). */
  detectTargets?: (protocol: DtsReloadDeployProtocol) => Promise<DtsReloadReachableTarget[]>;
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
};

export function DtsReloadPage({
  projects,
  initialProjectId,
  repository,
  canStartRun,
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
  initialRunId
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
    canRetryDeploy
  } = useDtsReloadRunSession({
    initialProjectId: initialProjectId ?? projects[0]?.id ?? "",
    initialBridges: bridgesProp ?? [],
    initialTargetRef: initialTargetRef ?? ""
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
  const [distilPending, setDistilPending] = useState(false);
  const [distilError, setDistilError] = useState("");
  const openedInitialRunRef = useRef(false);

  const selectedBridge = useMemo(
    () => bridges.find((bridge) => bridge.id === bridgeId) ?? null,
    [bridges, bridgeId]
  );

  const targetsForSelectedBridge = useMemo(
    () =>
      reachableTargets.filter(
        (target) => !target.bridgeId || !bridgeId || target.bridgeId === bridgeId
      ),
    [reachableTargets, bridgeId]
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

  const moduleTree = useMemo(
    () => buildReloadModuleTree({ candidates, modules: moduleRegistry.modules }),
    [candidates, moduleRegistry.modules]
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
    return candidates.filter((candidate) => {
      if (selectedModuleBindingIds && !selectedModuleBindingIds.has(candidate.bindingId)) return false;
      if (!normalizedQuery) return true;
      const haystack = [candidate.displayName, candidate.propertyKey].join(" ").toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [candidates, nameQuery, selectedModuleBindingIds]);

  const moduleFilterOptions = useMemo(
    () =>
      Array.from(new Set(scopedCandidates.map((candidate) => candidateModuleLabel(candidate)))).sort((left, right) =>
        left.localeCompare(right, "zh-Hans-CN")
      ),
    [scopedCandidates]
  );

  const activeModuleColumnFilter = useMemo(
    () => moduleColumnFilter.filter((name) => moduleFilterOptions.includes(name)),
    [moduleColumnFilter, moduleFilterOptions]
  );

  const filtered = useMemo(() => {
    if (activeModuleColumnFilter.length === 0) return scopedCandidates;
    const selected = new Set(activeModuleColumnFilter);
    return scopedCandidates.filter((candidate) => selected.has(candidateModuleLabel(candidate)));
  }, [activeModuleColumnFilter, scopedCandidates]);

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

  const runDetectTargets = useCallback(async () => {
    if (!detectTargets) {
      setReachableTargets([]);
      return;
    }
    setDetectingTargets(true);
    try {
      const targets = await detectTargets(protocol);
      setReachableTargets(targets);
      if (targets.length === 1) {
        const only = targets[0]!.targetRef.trim();
        if (only && !session.getSnapshot().targetRef.trim()) {
          session.setTargetRef(only);
        }
      }
    } catch {
      setReachableTargets([]);
    } finally {
      setDetectingTargets(false);
    }
  }, [detectTargets, protocol, session]);

  useEffect(() => {
    if (!detectTargets || bridges.length === 0) {
      setReachableTargets([]);
      return;
    }
    void runDetectTargets();
  }, [detectTargets, protocol, bridges.length, runDetectTargets]);

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

  useEffect(() => {
    setDistilError("");
  }, [run?.id]);

  const confirmRun = pendingDeployRun ?? run;

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

        {errorMessage ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            {errorMessage}
          </p>
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
                onClick={() => session.setProtocol(item)}
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
          target={targetRef.trim() || undefined}
          detecting={detectingTargets}
          protocol={protocol}
          onDetect={() => void runDetectTargets()}
          bridgesOverride={bridgesOverride}
          listBridges={listBridgesForPanel}
          probeHealth={probeHealthForPanel}
          createPairingCode={createBridgePairingCode}
          onBridgeStateChange={handleBridgeStateChange}
        />

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
              <section className="parameters-table" aria-label="可调试参数">
                <div className="parameters-table-toolbar dts-reload-candidates-toolbar">
                  <label className="parameters-table-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="按名称搜索参数"
                      value={nameQuery}
                      onChange={(event) => setNameQuery(event.target.value)}
                      placeholder="参数名"
                    />
                  </label>
                  <span className="parameters-table-count">
                    显示 {filtered.length} / {candidates.length} 项
                  </span>
                </div>

            <div className="parameters-table-scroll table-wrap">
              <table className="parameters-table-grid dts-reload-candidates-grid">
                <colgroup>
                  <col className="dts-reload-col-select" />
                  <col className="dts-reload-col-param" />
                  <col className="dts-reload-col-module" />
                  <col className="dts-reload-col-baseline" />
                  <col className="dts-reload-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>选择</th>
                    <th>参数</th>
                    <th scope="col">
                      <div className="parameters-table-head-cell">
                        <span>模块</span>
                        <ColumnFilter
                          label="模块"
                          groupLabel="模块筛选"
                          values={moduleFilterOptions}
                          selectedValues={activeModuleColumnFilter}
                          onToggle={(value) =>
                            setModuleColumnFilter((current) =>
                              current.includes(value)
                                ? current.filter((item) => item !== value)
                                : [...current, value]
                            )
                          }
                          onClear={() => setModuleColumnFilter([])}
                        />
                      </div>
                    </th>
                    <th>库基线</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5}>加载中…</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5}>当前筛选条件下没有可列出的参数。</td>
                    </tr>
                  ) : (
                    filtered.map((candidate) => {
                      const selected = selectedBindingIds.includes(candidate.bindingId);
                      return (
                        <tr
                          key={candidate.bindingId}
                          className={cn(
                            candidate.debuggable ? "cursor-pointer" : "opacity-80",
                            selected && "is-selected"
                          )}
                          onClick={() => session.toggleCandidate(candidate.bindingId)}
                        >
                          <td data-label="选择">
                            <input
                              type="checkbox"
                              aria-label={`选择 ${candidate.displayName || candidate.propertyKey}`}
                              checked={selected}
                              disabled={!candidate.debuggable}
                              onChange={() => session.toggleCandidate(candidate.bindingId)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </td>
                          <td data-label="参数">
                            <strong title={candidate.displayName || candidate.propertyKey}>
                              {candidate.displayName || candidate.propertyKey}
                            </strong>
                            <small title={candidate.nodePath ?? "无路径"}>
                              {candidate.nodePath ?? "无路径"}
                            </small>
                          </td>
                          <td data-label="模块" title={candidateModuleLabel(candidate)}>
                            {candidateModuleLabel(candidate)}
                          </td>
                          <td data-label="库基线">
                            <code title={candidate.baselineValue ?? undefined}>
                              {candidate.baselineValue ?? "—"}
                            </code>
                          </td>
                          <td
                            data-label="操作"
                            className="parameter-row-actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {candidate.debuggable ? (
                              <button
                                type="button"
                                className="button subtle dts-parameter-workbench-table__icon-action"
                                aria-label={`编辑 ${candidate.displayName || candidate.propertyKey}`}
                                title="编辑"
                                onClick={() => openCandidateEditor(candidate)}
                              >
                                <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                              </button>
                            ) : (
                              <span
                                className="dts-reload-status-text"
                                title={
                                  dtsReloadBlockReasonLabels[
                                    candidate.blockReason ?? "unsupported-value-shape"
                                  ]
                                }
                              >
                                {
                                  dtsReloadBlockReasonLabels[
                                    candidate.blockReason ?? "unsupported-value-shape"
                                  ]
                                }
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
                </div>
              </section>
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
      </div>
    </div>
  );
}