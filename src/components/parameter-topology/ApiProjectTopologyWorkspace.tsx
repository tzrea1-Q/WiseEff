import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileJson, SlidersHorizontal } from "lucide-react";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { SectionEmpty } from "@/components/common/SectionState";
import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { selectPrimaryProjectDtsFile } from "@/application/parameters/selectPrimaryProjectDtsFile";
import { selectPrimaryProjectJsonFile } from "@/application/parameters/selectPrimaryProjectJsonFile";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { nodeTypeKeyForNode } from "@/domain/parameter-topology/modulePlacement";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  describeModuleAssignment,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";
import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode,
  TopologyDiagnostic
} from "@/domain/parameter-topology/types";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import { measureStatusSpelling } from "@/domain/parameter-topology/enablementEdit";
import { nodeEnablementLabel } from "@/domain/parameter-topology/nodeEnablement";
import type { TopologyNodeEnablement } from "@/domain/parameter-topology/types";
import { resolveParameterTopologyRepository } from "@/application/parameters/parameterTopologyResolve";
import { presentError } from "@/infrastructure/http/presentError";
import {
  bindingFromDto,
  mapParameterTopologyError,
  type ParameterTopologyMappedError
} from "@/infrastructure/http/parameterTopologyClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import {
  type TopologyLayoutMode
} from "./ProjectTopologyWorkspace";
import type { BindingEditInput, BindingEditValidation } from "./BindingDetailPanel";
import {
  DtsBindingDraftTray,
  mixedDraftOwnerMessage,
  type PendingTopologyDraft
} from "./DtsBindingDraftTray";
import { DtsNodeEnablementDialog } from "./DtsNodeEnablementDialog";
import { isBindingDraft, type PendingEnablementDraft } from "./draftTrayTypes";
import type { TrayHydrationDraft } from "@/application/parameters/canonicalDraftTray";
import { DtsParameterWorkbench } from "./DtsParameterWorkbench";
import { buildDtsReloadHandoffPath } from "@/domain/dtsReload/handoff";
import { buildDtsWorkbenchRows } from "@/application/parameters/buildDtsWorkbenchRows";
import { loadCanonicalDtsDefinitionDetail } from "@/application/parameters/loadCanonicalDtsDefinitionDetail";
import { downloadSemanticWorkbenchCsv } from "@/application/parameters/exportSemanticWorkbenchRows";
import { downloadJsonWorkbenchCsv } from "@/application/parameters/exportJsonWorkbenchRows";
import {
  clearUnsavedParameterWork,
  reportUnsavedParameterWork
} from "@/application/parameters/unsavedParameterWork";
import {
  filterProductWorkbenchDiagnostics,
  partitionDanglingReferenceDiagnostics
} from "@/domain/parameter-topology/toolchainDiagnostics";
import { WorkbenchDiagnosticsSection } from "./WorkbenchDiagnosticsSection";
import {
  JsonBindingPanel,
  type JsonBindingHistoryEntry,
  type PrimaryJsonSource
} from "./JsonBindingPanel";

export type ApiProjectTopologyWorkspaceProps = {
  projectId: string;
  projectName?: string;
  requestedBindingId?: string;
  notice?: React.ReactNode;
  canEdit?: boolean;
  layoutMode?: TopologyLayoutMode;
  runtimeMode?: WiseEffRuntimeMode;
  /** Test seam — inject repositories instead of constructing HTTP clients. */
  topologyRepository?: ParameterTopologyRepository;
  /** Test seam — inject the admin-maintained module registry repository. */
  moduleRegistryRepository?: ParameterModuleRegistryRepository;
  /** Test seam — inject parameter file repository instead of resolving from runtime mode. */
  parameterFileRepository?: ParameterFileRepository;
  canonicalRepository?: ParameterCatalogRepository;
  listConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  listDrafts?: (projectId: string) => Promise<readonly TrayHydrationDraft[]>;
  /** Server-side draft delete; tray removal must not leave the draft alive on the server. */
  deleteDraft?: (draftId: string) => Promise<void>;
  listWorkflowAssignees?: (projectId: string) => Promise<WorkflowAssigneeCandidates>;
  canManageRoles?: boolean;
  submitBindingChanges?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate?: (path: string) => void;
};

type DraftReadState =
  | { kind: "loading" }
  | { kind: "ready"; drafts: readonly TrayHydrationDraft[] }
  | { kind: "error"; message: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string; code?: string }
  | {
      kind: "ready";
      configSetId: string;
      revisionId: string;
      status?: string;
      incompleteBase: boolean;
      sourceNodes: SourceTopologyNode[];
      effectiveNodes: EffectiveTopologyNode[];
      bindings: ProjectParameterBinding[];
      mappingTasks: IdentityMappingTask[];
      diagnostics: TopologyDiagnostic[];
    };

type ProjectMutationKind = "draft" | "submit";
type ProjectMutationLock = {
  kind: ProjectMutationKind;
  generation: number;
  token: symbol;
};

function pickConfigSet(items: Array<{ id: string; name: string }>) {
  return items.find((item) => item.name === "default") ?? items[0] ?? null;
}

function mapServerDraftsToPending(
  projectId: string,
  drafts: readonly TrayHydrationDraft[],
  bindings: ProjectParameterBinding[],
  effectiveNodes: EffectiveTopologyNode[],
  moduleRegistry: ParameterModuleRegistry,
  sharedTip?: string
): PendingTopologyDraft[] {
  const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
  const nodesByLogicalId = new Map(effectiveNodes.map((node) => [node.logicalNodeId, node]));
  return drafts.flatMap((draft): PendingTopologyDraft[] => {
    if (draft.projectId !== projectId) return [];
    const candidateRevisionId = draft.candidateConfigRevisionId?.trim() || sharedTip || "";
    if (!candidateRevisionId) return [];

    if (draft.editSubjectKind === "node-enablement") {
      const logicalNodeId = draft.logicalNodeId?.trim();
      if (!logicalNodeId) return [];
      const node = nodesByLogicalId.get(logicalNodeId);
      const nodeLabel =
        draft.nodeLabel?.trim() ||
        (node
          ? nodeEnablementLabel({
              name: node.name,
              unitAddress: node.unitAddress,
              locator: node.locator
            })
          : logicalNodeId);
      return [
        {
          kind: "enablement",
          draftId: draft.id,
          candidateRevisionId,
          rawText:
            draft.sourceFormat === "json" && draft.sourceTarget
              ? draft.sourceTarget.sourceText
              : draft.targetValue,
          action: draft.action ?? "set",
          logicalNodeId,
          target:
            draft.action === "delete"
              ? "unstated"
              : draft.targetValue.includes("disabled")
                ? "force-disabled"
                : "force-enabled",
          writeTarget: {
            role: "overlay",
            propertyKey: "status",
            targetRef: nodeLabel
          },
          overlayFileId: "",
          overlayFileName: "",
          projectId,
          reason: draft.reason,
          nodeLabel,
          currentRawValue: draft.currentValue ?? node?.enablement?.rawStatus ?? null
        } satisfies PendingEnablementDraft & { kind: "enablement" }
      ];
    }

    const bindingId = draft.projectParameterBindingId;
    if (!bindingId) return [];
    const binding = bindingById.get(bindingId);
    if (!binding) return [];
    const parameterSpecId = (draft.parameterSpecId ?? binding.parameterSpecId).trim();
    if (!parameterSpecId) return [];
    const moduleAssignment = describeModuleAssignment(
      binding.moduleId,
      {
        driverModule: binding.driverModule,
        compatible: null,
        nodeType: binding.instanceName ? nodeTypeKeyForNode({ name: binding.instanceName }) : null
      },
      moduleRegistry
    );
    return [
        {
          kind: "binding",
          draftId: draft.id,
        parameterId: draft.parameterId,
        candidateRevisionId,
        rawText:
          draft.sourceFormat === "json" && draft.sourceTarget
            ? draft.sourceTarget.sourceText
            : draft.targetValue,
        action: draft.action ?? "set",
        parameterSpecId,
        projectParameterBindingId: bindingId,
          writeTarget: {
          role: draft.baseRevisionId ? "canonical-project-value-draft" : "overlay",
          propertyKey: binding.propertyKey,
          targetRef: binding.instanceName ?? binding.driverModule ?? undefined
        },
          overlayFileId: "",
          overlayFileName: "",
          sourceFormat: draft.sourceFormat,
          sourceTarget: draft.sourceTarget,
          baseRevisionId: draft.baseRevisionId,
          sourcePinId: draft.sourcePinId,
          candidateId: draft.candidateId,
          projectId,
        currentRawValue: draft.currentValue ?? binding.rawValue,
        displayName: binding.displayName,
        effectiveValue: binding.effectiveValue,
        reason: draft.reason,
        moduleName: moduleAssignment.moduleName
      }
    ];
  });
}

function resolveSharedWorkingTip(drafts: readonly TrayHydrationDraft[]): string | undefined {
  const tips = [
    ...new Set(
      drafts
        .map((draft) => draft.candidateConfigRevisionId?.trim())
        .filter((tip): tip is string => Boolean(tip))
    )
  ];
  return tips.length === 1 ? tips[0] : undefined;
}

async function loadWorkspace(
  projectId: string,
  topology: ParameterTopologyRepository,
  listConfigSets: (projectId: string) => Promise<Array<{ id: string; name: string }>>,
  preferredRevisionId?: string
): Promise<LoadState> {
  const configSets = await listConfigSets(projectId);
  const configSet = pickConfigSet(configSets);
  if (!configSet) {
    return { kind: "empty", message: "该项目尚无参数配置，请联系项目管理员导入 DTS 文件。" };
  }

  const revisionKey = preferredRevisionId ?? "current";
  let effectiveTree;
  try {
    effectiveTree = await topology.getTopology(projectId, configSet.id, revisionKey, "effective");
  } catch (error) {
    const mapped = mapParameterTopologyError(error, "加载拓扑失败，请稍后重试。");
    if (mapped.kind === "api" && mapped.code === "NOT_FOUND") {
      return {
        kind: "empty",
        message: "项目配置尚未准备完成，请联系项目管理员检查已上传的 DTS 文件。"
      };
    }
    return {
      kind: "error",
      message: mapped.message,
      code: mapped.kind === "api" ? mapped.code : mapped.kind
    };
  }

  const revisionId = effectiveTree.revisionId;
  const [sourceTree, bindings, mappingTasks] = await Promise.all([
    topology.getTopology(projectId, configSet.id, revisionId, "source"),
    topology.listBindings(projectId, revisionId),
    topology.listMappingTasks(projectId)
  ]);

  const revisionMappings = mappingTasks.filter((task) => task.configRevisionId === revisionId);
  const diagnostics = [
    ...(effectiveTree.diagnostics ?? []),
    ...(sourceTree.diagnostics ?? [])
  ];
  // Deduplicate by code+message
  const seen = new Set<string>();
  const uniqueDiagnostics = filterProductWorkbenchDiagnostics(
    diagnostics.filter((item) => {
      const key = `${item.code ?? ""}:${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );

  return {
    kind: "ready",
    configSetId: configSet.id,
    revisionId,
    status: effectiveTree.status,
    incompleteBase: Boolean(effectiveTree.incompleteBase),
    sourceNodes: sourceTree.view === "source" ? sourceTree.nodes : [],
    effectiveNodes: effectiveTree.view === "effective" ? effectiveTree.nodes : [],
    bindings,
    mappingTasks: revisionMappings,
    diagnostics: uniqueDiagnostics
  };
}

/**
 * API-mode topology workspace: loads real config set / revision / trees / bindings.
 * Never falls back to teaching fixtures.
 */
export function ApiProjectTopologyWorkspace({
  projectId,
  projectName,
  requestedBindingId,
  notice,
  canEdit = true,
  layoutMode = "desktop",
  runtimeMode = "api",
  topologyRepository,
  moduleRegistryRepository,
  parameterFileRepository,
  canonicalRepository,
  listConfigSets,
  listDrafts,
  deleteDraft,
  listWorkflowAssignees,
  canManageRoles = false,
  submitBindingChanges,
  onNavigate = () => undefined
}: ApiProjectTopologyWorkspaceProps) {
  const repository = useMemo(
    () => topologyRepository ?? resolveParameterTopologyRepository(runtimeMode),
    [runtimeMode, topologyRepository]
  );
  const moduleRegistryRepo = useMemo(
    () =>
      moduleRegistryRepository ??
      (runtimeMode === "api" ? createHttpParameterModuleRegistryRepository() : null),
    [moduleRegistryRepository, runtimeMode]
  );
  const parameterFileRepo = useMemo(
    () => parameterFileRepository ?? resolveParameterFileRepository(runtimeMode),
    [parameterFileRepository, runtimeMode]
  );
  const [moduleRegistry, setModuleRegistry] = useState<ParameterModuleRegistry>(
    EMPTY_PARAMETER_MODULE_REGISTRY
  );
  const listConfigSetsRef = useRef(listConfigSets);
  listConfigSetsRef.current = listConfigSets;
  const listDraftsRef = useRef(listDrafts);
  listDraftsRef.current = listDrafts;
  const deleteDraftRef = useRef(deleteDraft);
  deleteDraftRef.current = deleteDraft;
  const canonicalRepositoryRef = useRef(canonicalRepository);
  canonicalRepositoryRef.current = canonicalRepository;
  const activeProjectIdRef = useRef(projectId);
  const projectGenerationRef = useRef(0);
  const lastProjectIdRef = useRef(projectId);
  if (lastProjectIdRef.current !== projectId) {
    lastProjectIdRef.current = projectId;
    projectGenerationRef.current += 1;
  }
  activeProjectIdRef.current = projectId;
  const projectMutationsRef = useRef(new Map<string, ProjectMutationLock>());

  const isCurrentProjectRequest = (requestProjectId: string, requestGeneration: number) =>
    activeProjectIdRef.current === requestProjectId && projectGenerationRef.current === requestGeneration;

  const [loadedWorkspace, setLoadedWorkspace] = useState<{ projectId: string; state: LoadState } | null>(null);
  const [workspaceRefresh, setWorkspaceRefresh] = useState<{
    projectId: string; pending: boolean; error?: string;
  } | null>(null);
  const loadState: LoadState = loadedWorkspace?.projectId === projectId
    ? loadedWorkspace.state : { kind: "loading" };
  const [protectedJson, setProtectedJson] = useState<{
    projectId: string;
    state: "loading" | "ready" | "error";
    bindings: ProjectParameterBinding[];
    message?: string;
    refreshing?: boolean;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [draftsReloadToken, setDraftsReloadToken] = useState(0);
  const [preferredRevision, setPreferredRevision] = useState<{
    projectId: string;
    revisionId: string;
  } | null>(null);
  const preferredRevisionId =
    preferredRevision?.projectId === projectId ? preferredRevision.revisionId : undefined;
  const [pendingDrafts, setPendingDrafts] = useState<PendingTopologyDraft[]>([]);
  const pendingDraftsRef = useRef(pendingDrafts);
  pendingDraftsRef.current = pendingDrafts;
  const [submitSuccessNotice, setSubmitSuccessNotice] = useState<string | null>(null);
  const [partialSubmitError, setPartialSubmitError] = useState<string | null>(null);
  const [valueDraftRead, setValueDraftRead] = useState<DraftReadState>({ kind: "loading" });
  const [enablementDraftRead, setEnablementDraftRead] = useState<DraftReadState>({ kind: "loading" });
  const [valueDraftRetryToken, setValueDraftRetryToken] = useState(0);
  const [enablementDraftRetryToken, setEnablementDraftRetryToken] = useState(0);
  const serverDrafts = useMemo(() => [
    ...(valueDraftRead.kind === "ready" ? valueDraftRead.drafts : []),
    ...(enablementDraftRead.kind === "ready" ? enablementDraftRead.drafts : [])
  ], [valueDraftRead, enablementDraftRead]);
  const removeCachedServerDraft = (draftId: string) => {
    for (const setRead of [setValueDraftRead, setEnablementDraftRead]) {
      setRead((current) => current.kind === "ready"
        ? { ...current, drafts: current.drafts.filter((draft) => draft.id !== draftId) }
        : current);
    }
  };
  const [selectedDraftBindingIds, setSelectedDraftBindingIds] = useState<Set<string>>(new Set());
  const [activeFormatTab, setActiveFormatTab] = useState<"dts" | "json">("dts");
  const [editRequest, setEditRequest] = useState<{ bindingId: string; token: number } | null>(null);
  const pendingFormatFocus = useRef<"dts" | "json" | null>(null);
  useEffect(() => {
    if (!pendingFormatFocus.current) return;
    document.getElementById(`format-tab-${pendingFormatFocus.current}`)?.focus();
    pendingFormatFocus.current = null;
  }, [activeFormatTab]);
  const [enablementDialogTarget, setEnablementDialogTarget] = useState<{
    logicalNodeId: string;
    nodeLabel: string;
    enablement: TopologyNodeEnablement;
  } | null>(null);
  const [enablementDialogBusy, setEnablementDialogBusy] = useState(false);
  const [enablementDialogError, setEnablementDialogError] = useState<string | null>(null);
  const [workflowCandidates, setWorkflowCandidates] = useState<WorkflowAssigneeCandidates | null>(null);
  const [workflowCandidatesError, setWorkflowCandidatesError] = useState<string | null>(null);
  const [projectMutationKinds, setProjectMutationKinds] = useState<ReadonlyMap<string, ProjectMutationLock>>(
    () => new Map()
  );
  const projectDrafts = pendingDrafts.filter((draft) => draft.projectId === projectId);
  const hasProjectDrafts = projectDrafts.length > 0;

  // Feed the navigation guards (top-bar project switch + beforeunload).
  useEffect(() => {
    reportUnsavedParameterWork("topology-pending-drafts", projectDrafts.length);
    return () => {
      clearUnsavedParameterWork("topology-pending-drafts");
    };
  }, [projectDrafts.length]);
  const projectMutationLock = projectMutationKinds.get(projectId);
  const projectMutationKind = projectMutationLock?.kind ?? null;

  const acquireProjectMutation = (
    mutationProjectId: string,
    kind: ProjectMutationKind,
    generation = projectGenerationRef.current
  ): symbol | null => {
    const existing = projectMutationsRef.current.get(mutationProjectId);
    if (existing) return null;
    const token = Symbol(`${mutationProjectId}:${kind}`);
    projectMutationsRef.current.set(mutationProjectId, { kind, generation, token });
    setProjectMutationKinds(new Map(projectMutationsRef.current));
    return token;
  };

  const releaseProjectMutation = (
    mutationProjectId: string,
    kind: ProjectMutationKind,
    token: symbol
  ) => {
    const lock = projectMutationsRef.current.get(mutationProjectId);
    if (!lock || lock.kind !== kind || lock.token !== token) return;
    projectMutationsRef.current.delete(mutationProjectId);
    setProjectMutationKinds(new Map(projectMutationsRef.current));
  };

  useEffect(() => {
    setPreferredRevision(null);
    setPendingDrafts([]);
    setSelectedDraftBindingIds(new Set());
    setSubmitSuccessNotice(null);
    setPartialSubmitError(null);
    setEnablementDialogTarget(null);
    setEnablementDialogError(null);
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
    setActiveFormatTab("dts");
    setEditRequest(null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const resolveListDrafts = listDraftsRef.current;
    setValueDraftRead({ kind: "loading" });
    void (resolveListDrafts?.(projectId) ?? Promise.resolve([])).then((drafts) => {
      if (!cancelled) setValueDraftRead({ kind: "ready", drafts });
    }).catch((error) => {
      if (!cancelled) setValueDraftRead({ kind: "error", message: presentError(error, "请稍后重试。") });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repository, runtimeMode, draftsReloadToken, valueDraftRetryToken]);

  useEffect(() => {
    let cancelled = false;
    setEnablementDraftRead({ kind: "loading" });
    void repository.listNodeEnablementDrafts(projectId).then((drafts) => {
      if (!cancelled) setEnablementDraftRead({ kind: "ready", drafts });
    }).catch((error) => {
      if (!cancelled) setEnablementDraftRead({ kind: "error", message: presentError(error, "请稍后重试。") });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repository, runtimeMode, draftsReloadToken, enablementDraftRetryToken]);

  useEffect(() => {
    if (!serverDrafts || loadState.kind !== "ready") return;
    const logicalNodeIds = new Set(loadState.effectiveNodes.map((node) => node.logicalNodeId));
    const bindingDrafts = serverDrafts.filter(
      (draft) =>
        draft.projectId === projectId &&
        (draft.projectParameterBindingId ||
          (draft.editSubjectKind === "node-enablement" && draft.logicalNodeId && logicalNodeIds.has(draft.logicalNodeId)))
    );
    if (bindingDrafts.length === 0) return;

    const existing = pendingDraftsRef.current.filter((draft) => draft.projectId === projectId);
    const missingDrafts = bindingDrafts.filter((draft) => !existing.some((pending) => pending.draftId === draft.id));
    if (missingDrafts.length === 0) return;
    const sharedTip = resolveSharedWorkingTip(bindingDrafts);
    if (existing.length === 0 && sharedTip && loadState.revisionId !== sharedTip) {
      setPreferredRevision({ projectId, revisionId: sharedTip });
      return;
    }

    const hydrated = mapServerDraftsToPending(
      projectId,
      missingDrafts,
      loadState.bindings,
      loadState.effectiveNodes,
      moduleRegistry,
      sharedTip
    );
    setPendingDrafts((current) => [...current, ...hydrated.filter((draft) => !current.some((pending) => pending.draftId === draft.draftId))]);
    // WYSIWYG submission: hydrated drafts start fully checked.
    const hydratedBindingIds = hydrated
      .filter((draft) => draft.kind === "binding")
      .map((draft) => (draft.kind === "binding" ? draft.projectParameterBindingId : ""));
    if (hydratedBindingIds.length > 0) {
      setSelectedDraftBindingIds((selected) => new Set([...selected, ...hydratedBindingIds]));
    }
  }, [loadState, moduleRegistry, projectId, serverDrafts]);

  useEffect(() => {
    if (!hasProjectDrafts) {
      setWorkflowCandidates(null);
      setWorkflowCandidatesError(null);
      return undefined;
    }
    if (!listWorkflowAssignees) {
      setWorkflowCandidates(null);
      setWorkflowCandidatesError("正式提交入口未配置项目角色候选人，已阻止提交。");
      return undefined;
    }
    let cancelled = false;
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
    const requestProjectId = projectId;
    listWorkflowAssignees(requestProjectId)
      .then((candidates) => {
        if (!cancelled && activeProjectIdRef.current === requestProjectId) {
          setWorkflowCandidates(candidates);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorkflowCandidatesError(presentError(error, "无法加载项目角色候选人，请稍后重试。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasProjectDrafts, listWorkflowAssignees, projectId]);

  useEffect(() => {
    const setLoadState = (state: LoadState) => {
      const authorizationFailure = state.kind === "error" && (state.code === "FORBIDDEN" || state.code === "UNAUTHENTICATED");
      setLoadedWorkspace((current) => current?.projectId === projectId && current.state.kind === "ready" && state.kind !== "ready" && !authorizationFailure
        ? current : { projectId, state });
      setWorkspaceRefresh({ projectId, pending: false,
        ...(state.kind === "error" || state.kind === "empty" ? { error: state.message } : {}) });
    };
    if (!repository) {
      setLoadState({
        kind: "error",
        message: "参数服务尚未就绪，请稍后重试。"
      });
      return undefined;
    }

    let cancelled = false;
    setWorkspaceRefresh({ projectId, pending: true });

    const resolveConfigSets =
      listConfigSetsRef.current ??
      ((id: string) => resolveDtsStructuredRepository(runtimeMode).listConfigSets(id));

    loadWorkspace(projectId, repository, resolveConfigSets, preferredRevisionId)
      .then((next) => {
        if (!cancelled) setLoadState(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const mapped = mapParameterTopologyError(error, "加载拓扑失败，请稍后重试。");
        setLoadState({
          kind: "error",
          message: mapped.message,
          code: mapped.kind === "api" ? mapped.code : mapped.kind
        });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, preferredRevisionId, repository, runtimeMode, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    const generation = projectGenerationRef.current;
    setProtectedJson((current) => current?.projectId === projectId && current.state === "ready"
      ? { ...current, refreshing: true, message: undefined }
      : { projectId, state: "loading", bindings: [] });
    const read = canonicalRepository?.listProtectedProjectBindings;
    const request = Promise.resolve().then(() => {
      if (!read) throw new Error("当前未配置受保护项目 JSON 绑定读取能力");
      return read(projectId);
    });
    request.then((response) => {
      if (cancelled || activeProjectIdRef.current !== projectId || projectGenerationRef.current !== generation) return;
      setProtectedJson({ projectId, state: "ready", bindings: response.items
        .filter((binding) => binding.projectId === projectId && binding.effectiveValue.kind === "json")
        // The protected DTO marks JSON arrays readonly; the existing adapter only copies fields.
        .map((binding) => bindingFromDto(binding as Parameters<typeof bindingFromDto>[0])) });
    }).catch((error: unknown) => {
      if (cancelled || activeProjectIdRef.current !== projectId || projectGenerationRef.current !== generation) return;
      const message = presentError(error, "加载项目 JSON 参数失败，请稍后重试。");
      const mapped = mapParameterTopologyError(error);
      const authorizationFailure = mapped.kind === "api" && (mapped.code === "FORBIDDEN" || mapped.code === "UNAUTHENTICATED");
      setProtectedJson((current) => current?.projectId === projectId && current.state === "ready" && !authorizationFailure
        ? { ...current, refreshing: false, message }
        : { projectId, state: "error", bindings: [], message });
    });
    return () => { cancelled = true; };
  }, [canonicalRepository, projectId, reloadToken]);

  const jsonState = protectedJson?.projectId === projectId ? protectedJson : null;
  const jsonBindings = jsonState?.state === "ready" ? jsonState.bindings
    : !canonicalRepository && loadState.kind === "ready"
      ? loadState.bindings.filter((binding) => binding.effectiveValue.kind === "json") : [];

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
        // Graceful degradation: fall back to driver-based grouping.
        if (!cancelled) setModuleRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleRegistryRepo, reloadToken]);

  const handleValidateEdit = async (input: BindingEditInput): Promise<BindingEditValidation> => {
    const activeMutationLock = projectMutationsRef.current.get(projectId);
    const activeMutation = activeMutationLock?.kind ?? null;
    if (activeMutation) {
      return {
        valid: false,
        diagnostics: [
          {
            message: "该项目正在保存或提交变更，请完成后再保存草稿。",
            code: "PROJECT_MUTATION_IN_PROGRESS"
          }
        ]
      };
    }
    if (!repository || loadState.kind !== "ready") {
      return {
        valid: false,
        diagnostics: [{ message: "拓扑尚未就绪，无法提交编辑。", code: "TOPOLOGY_NOT_READY" }]
      };
    }

    const binding = loadState.bindings.find((item) => item.id === input.bindingId);
    if (!binding) {
      return {
        valid: false,
        diagnostics: [{ message: "绑定不存在。", code: "BINDING_NOT_FOUND" }]
      };
    }

    let targetValue;
    let sourceTarget: { format: "json"; sourceText: string } | undefined;
    if (input.action === "delete") {
      // A tombstone has no target value. The server owns deletion semantics;
      // this request only creates the reviewable draft.
    } else if (binding.effectiveValue.kind === "json") {
      sourceTarget = { format: "json", sourceText: input.rawValue };
    } else {
      try {
        targetValue = parseDtsValue(binding.propertyKey, input.rawValue).value;
      } catch (error) {
        return {
          valid: false,
          diagnostics: [
            {
              message: error instanceof Error ? error.message : "无法解析 DTS 值。",
              code: "DTS_VALUE_PARSE"
            }
          ]
        };
      }
    }

    const requestProjectId = projectId;
    const requestGeneration = projectGenerationRef.current;
    if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
      return {
        valid: false,
        diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿请求。", code: "PROJECT_CHANGED" }]
      };
    }
    const mutationToken = acquireProjectMutation(requestProjectId, "draft", requestGeneration);
    if (!mutationToken) {
      return {
        valid: false,
        diagnostics: [
          {
            message: "该项目正在处理其他变更，请稍后再保存草稿。",
            code: "PROJECT_MUTATION_IN_PROGRESS"
          }
        ]
      };
    }

    try {
      const draft = await repository.createBindingDraft(requestProjectId, input.bindingId, {
        baseRevisionId: loadState.revisionId,
        ...(input.action === "delete"
          ? { action: "delete" as const }
          : sourceTarget
            ? { sourceTarget }
            : { targetValue }),
        reason: input.reason
      });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿响应。", code: "PROJECT_CHANGED" }]
        };
      }
      const canonicalDraft = draft.writeTarget.role.startsWith("canonical-project-value");
      setPendingDrafts((current) => {
        if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return current;
        const tip = draft.workingCandidateRevisionId ?? draft.candidateRevisionId;
        const previousDraft = current.find(
          (item) =>
            item.kind === "binding" &&
            item.projectId === requestProjectId &&
            item.projectParameterBindingId === draft.projectParameterBindingId
        );
        const moduleAssignment = describeModuleAssignment(
          binding.moduleId,
          {
            driverModule: binding.driverModule,
            compatible: null,
            nodeType: binding.instanceName ? nodeTypeKeyForNode({ name: binding.instanceName }) : null
          },
          moduleRegistry
        );
        const nextDraft: PendingTopologyDraft = {
          kind: "binding",
          ...draft,
          ...(sourceTarget ? { sourceFormat: "json" as const,sourceTarget,rawText: sourceTarget.sourceText } : {}),
          ...(canonicalDraft ? { writeTarget: { ...draft.writeTarget,propertyKey: binding.propertyKey } } : {}),
          candidateRevisionId: tip,
          projectId: requestProjectId,
          currentRawValue: previousDraft?.kind === "binding"
            ? previousDraft.currentRawValue
            : binding.rawValue,
          effectiveValue: binding.effectiveValue,
          displayName: binding.displayName,
          reason: input.reason,
          moduleName: previousDraft?.kind === "binding"
            ? previousDraft.moduleName
            : moduleAssignment.moduleName
        };
        const withoutBinding = current.filter(
          (item) =>
            !(
              item.kind === "binding" &&
              item.projectId === requestProjectId &&
              item.projectParameterBindingId === draft.projectParameterBindingId
            )
        );
        const aligned = withoutBinding.map((item) =>
          !canonicalDraft && item.projectId === requestProjectId ? { ...item, candidateRevisionId: tip } : item
        );
        return [...aligned, nextDraft];
      });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿响应。", code: "PROJECT_CHANGED" }]
        };
      }
      // WYSIWYG submission: new drafts join the checked submit scope by default.
      setSelectedDraftBindingIds((selected) =>
        selected.has(draft.projectParameterBindingId)
          ? selected
          : new Set([...selected, draft.projectParameterBindingId])
      );
      setSubmitSuccessNotice(null);
      setPreferredRevision({ projectId: requestProjectId, revisionId: draft.workingCandidateRevisionId ?? draft.candidateRevisionId });
      if (!canonicalDraft) setDraftsReloadToken((token) => token + 1);
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿响应。", code: "PROJECT_CHANGED" }]
        };
      }
      setReloadToken((token) => token + 1);
      return { valid: true, diagnostics: [] };
    } catch (error) {
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿错误。", code: "PROJECT_CHANGED" }]
        };
      }
      const mapped: ParameterTopologyMappedError = mapParameterTopologyError(
        error,
        "保存参数绑定草稿失败，请检查后重试。"
      );
      if (mapped.kind === "diagnostics") {
        const diagnostics =
          mapped.diagnostics.length > 0
            ? mapped.diagnostics
            : [{ message: mapped.message, code: "VALIDATION_FAILED" }];
        return { valid: false, diagnostics };
      }
      if (mapped.kind === "stale-revision") {
        return {
          valid: false,
          diagnostics: [
            {
              message: mapped.message,
              code: "STALE_REVISION",
              guidance: "请刷新拓扑后基于最新修订重新编辑。"
            }
          ]
        };
      }
      return {
        valid: false,
        diagnostics: [{ message: mapped.message, code: mapped.kind === "api" ? mapped.code : mapped.kind }]
      };
    } finally {
      releaseProjectMutation(requestProjectId, "draft", mutationToken);
    }
  };

  const measuredStatusSpelling = useMemo(() => {
    if (loadState.kind !== "ready") return "ok" as const;
    return measureStatusSpelling(
      loadState.effectiveNodes.map((node) => node.enablement?.rawStatus ?? null)
    );
  }, [loadState]);

  const handleOpenNodeEnablement = useCallback((logicalNodeId: string) => {
    if (loadState.kind !== "ready") return;
    const node = loadState.effectiveNodes.find((item) => item.logicalNodeId === logicalNodeId);
    if (!node) return;
    setEnablementDialogError(null);
    setEnablementDialogTarget({
      logicalNodeId,
      nodeLabel: nodeEnablementLabel({
        name: node.name,
        unitAddress: node.unitAddress,
        locator: node.locator
      }),
      enablement: node.enablement ?? {
        selfEnabled: true,
        override: "unstated",
        rawStatus: null,
        rawToken: null,
        reachable: true,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      }
    });
  }, [loadState]);

  const handleCreateEnablementDraft = async (input: {
    target: "force-enabled" | "force-disabled" | "unstated";
    reason: string;
    acknowledgeNonstandard?: boolean;
    spellingOverride?: "ok" | "okay";
  }) => {
    const activeMutationLock = projectMutationsRef.current.get(projectId);
    const activeMutation = activeMutationLock?.kind ?? null;
    if (activeMutation) {
      setEnablementDialogError("该项目正在保存或提交变更，请完成后再保存草稿。");
      return;
    }
    if (!repository || loadState.kind !== "ready" || !enablementDialogTarget) {
      setEnablementDialogError("拓扑尚未就绪，无法提交编辑。");
      return;
    }

    const requestProjectId = projectId;
    const requestGeneration = projectGenerationRef.current;
    const { logicalNodeId, nodeLabel } = enablementDialogTarget;
    if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
      setEnablementDialogError("项目已切换，已忽略上一项目的草稿请求。");
      return;
    }
    const mutationToken = acquireProjectMutation(requestProjectId, "draft", requestGeneration);
    if (!mutationToken) {
      setEnablementDialogError("该项目正在处理其他变更，请稍后再保存草稿。");
      return;
    }

    setEnablementDialogBusy(true);
    setEnablementDialogError(null);
    try {
      const draft = await repository.createNodeEnablementDraft(requestProjectId, {
        logicalNodeId,
        baseRevisionId: loadState.revisionId,
        target: input.target,
        reason: input.reason,
        acknowledgeNonstandard: input.acknowledgeNonstandard,
        spellingOverride: input.spellingOverride
      });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;

      setPendingDrafts((current) => {
        if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return current;
        const tip = draft.workingCandidateRevisionId ?? draft.candidateRevisionId;
        const previousDraft = current.find(
          (item) =>
            item.kind === "enablement" &&
            item.projectId === requestProjectId &&
            item.logicalNodeId === draft.logicalNodeId
        );
        const nextDraft: PendingTopologyDraft = {
          kind: "enablement",
          ...draft,
          candidateRevisionId: tip,
          projectId: requestProjectId,
          reason: input.reason,
          nodeLabel,
          currentRawValue:
            previousDraft?.kind === "enablement"
              ? previousDraft.currentRawValue
              : draft.previousRaw ?? enablementDialogTarget.enablement.rawStatus
        };
        const withoutNode = current.filter(
          (item) =>
            !(
              item.kind === "enablement" &&
              item.projectId === requestProjectId &&
              item.logicalNodeId === draft.logicalNodeId
            )
        );
        const aligned = withoutNode.map((item) =>
          item.projectId === requestProjectId ? { ...item, candidateRevisionId: tip } : item
        );
        return [...aligned, nextDraft];
      });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      setSubmitSuccessNotice(null);
      setPreferredRevision({ projectId: requestProjectId, revisionId: draft.workingCandidateRevisionId ?? draft.candidateRevisionId });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      setReloadToken((token) => token + 1);
      setDraftsReloadToken((token) => token + 1);
      setEnablementDialogTarget(null);
    } catch (error) {
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      const mapped: ParameterTopologyMappedError = mapParameterTopologyError(
        error,
        "保存节点使能草稿失败，请检查后重试。"
      );
      setEnablementDialogError(mapped.message);
    } finally {
      releaseProjectMutation(requestProjectId, "draft", mutationToken);
      if (isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        setEnablementDialogBusy(false);
      }
    }
  };

  const handleRemoveDraft = async (draftId: string) => {
    const requestProjectId = projectId;
    const requestGeneration = projectGenerationRef.current;
    const resolveDeleteDraft = deleteDraftRef.current;
    if (!resolveDeleteDraft) {
      throw new Error("草稿删除入口未配置，无法移除服务端草稿。");
    }
    const mutationToken = acquireProjectMutation(requestProjectId, "draft", requestGeneration);
    if (!mutationToken) {
      throw new Error("该项目正在处理其他变更，请稍后再移除草稿。");
    }
    try {
      await resolveDeleteDraft(draftId);
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      const removed = pendingDraftsRef.current.find((draft) => draft.draftId === draftId);
      const remaining = pendingDraftsRef.current.filter((draft) => draft.draftId !== draftId);
      setPendingDrafts(remaining);
      // Keep the cached server list consistent so hydrate never revives a deleted draft.
      removeCachedServerDraft(draftId);
      if (removed?.kind === "binding") {
        setSelectedDraftBindingIds((selected) => {
          if (!selected.has(removed.projectParameterBindingId)) return selected;
          const next = new Set(selected);
          next.delete(removed.projectParameterBindingId);
          return next;
        });
      }
      if (!remaining.some((draft) => draft.projectId === requestProjectId)) {
        setPreferredRevision((preferred) =>
          preferred?.projectId === requestProjectId ? null : preferred
        );
      }
      setDraftsReloadToken((token) => token + 1);
      setReloadToken((token) => token + 1);
    } catch (error) {
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      const mapped = mapParameterTopologyError(error, "移除草稿失败，请稍后重试。");
      throw new Error(`移除草稿失败：${mapped.message}`);
    } finally {
      releaseProjectMutation(requestProjectId, "draft", mutationToken);
    }
  };

  const handleSubmitBindingChanges = submitBindingChanges
    ? async (input: SubmitParameterChangesInput) => {
      const submittingProjectId = input.projectId;
        const mutationToken = acquireProjectMutation(submittingProjectId, "submit");
        if (!mutationToken) {
          return { notification: "该项目正在保存或提交变更，请完成后再提交审核。" };
        }
        const requestGeneration = projectGenerationRef.current;
        try {
          const result = await submitBindingChanges(input);
          const failed = Boolean(result && "notification" in result);
          if (!failed && isCurrentProjectRequest(submittingProjectId, requestGeneration)) {
            // Submitted drafts are consumed server-side: clear them locally so the
            // tray empties and a consumed draftId can never be submitted again.
            const submittedDraftIds = new Set(
              input.items.map((item) => ("draftId" in item ? item.draftId : null)).filter(Boolean)
            );
            const remaining = pendingDraftsRef.current.filter(
              (draft) =>
                !(draft.projectId === submittingProjectId && submittedDraftIds.has(draft.draftId))
            );
            const remainingBindingIds = new Set(
              remaining
                .filter((draft) => draft.kind === "binding" && draft.projectId === submittingProjectId)
                .map((draft) => (draft.kind === "binding" ? draft.projectParameterBindingId : ""))
            );
            setPendingDrafts(remaining);
            setSelectedDraftBindingIds((selected) => {
              const next = new Set([...selected].filter((id) => remainingBindingIds.has(id)));
              return next.size === selected.size ? selected : next;
            });
            if (!remaining.some((draft) => draft.projectId === submittingProjectId)) {
              setPreferredRevision((preferred) =>
                preferred?.projectId === submittingProjectId ? null : preferred
              );
            }
            if (submittingProjectId === activeProjectIdRef.current) {
              setSubmitSuccessNotice(
                `已提交正式审核（${submittedDraftIds.size} 项），后续阶段将在审核队列中按角色推进。`
              );
            }
            // Refresh drafts + topology so table badges and revision leave the consumed candidate.
            setDraftsReloadToken((token) => token + 1);
            setReloadToken((token) => token + 1);
          }
          return result;
        } finally {
          releaseProjectMutation(submittingProjectId, "submit", mutationToken);
        }
      }
    : undefined;

  const submitProjectValueDraft = canonicalRepository?.submitProjectValueDraft;
  const handleSubmitCanonicalDrafts = submitProjectValueDraft
    ? async (input: { projectId: string; draftIds: string[]; assignedToUserId?: string | null }) => {
        const requestGeneration = projectGenerationRef.current;
        const mutationToken = acquireProjectMutation(input.projectId, "submit", requestGeneration);
        if (!mutationToken) {
          return { notification: "该项目正在保存或提交变更，请完成后再提交审核。" };
        }
        let submittedCount = 0;
        if (isCurrentProjectRequest(input.projectId, requestGeneration)) setPartialSubmitError(null);
        try {
          const submittedDrafts = pendingDraftsRef.current.filter((draft) =>
            input.draftIds.includes(draft.draftId)
          );
          if (submittedDrafts.some((draft) => draft.kind !== "binding")) {
            return {
              notification: mixedDraftOwnerMessage
            };
          }
          const catalog = await canonicalRepository.getCatalog();
          const catalogReleaseId = catalog.item?.catalogReleaseId;
          if (!catalogReleaseId) {
            return { notification: "当前参数规范版本不可用，暂时无法提交软件审核，请稍后重试。" };
          }
          for (const draftId of input.draftIds) {
            await submitProjectValueDraft(
              input.projectId,
              draftId,
              { assignedToUserId: input.assignedToUserId ?? null },
              {
                catalogReleaseId,
                idempotencyKey:
                  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `draft-${Date.now()}-${draftId}`
              }
            );
            submittedCount += 1;
            // Preserve the server draft for rejection/withdrawal, but remove
            // each successful submission from the editable tray, even if a
            // later submission in this batch fails.
            if (isCurrentProjectRequest(input.projectId, requestGeneration)) {
              setPendingDrafts((current) => current.filter((draft) =>
                draft.projectId !== input.projectId || draft.draftId !== draftId
              ));
              removeCachedServerDraft(draftId);
              const submittedDraft = submittedDrafts.find((draft) => draft.draftId === draftId);
              if (submittedDraft?.kind === "binding") {
                setSelectedDraftBindingIds((current) => new Set(
                  [...current].filter((id) => id !== submittedDraft.projectParameterBindingId)
                ));
              }
            }
          }
          if (isCurrentProjectRequest(input.projectId, requestGeneration)) {
            setSubmitSuccessNotice(`已提交软件审核（${input.draftIds.length} 项），可在审核队列查看进度。`);
          }
        } catch (error) {
          const message = presentError(error, "提交软件审核失败，请稍后重试。");
          if (submittedCount > 0) {
            // Successful items changed the tray signature; the project owns this batch's failure feedback.
            const notification = `已提交 ${submittedCount} 项；其余草稿提交失败：${message}`;
            if (isCurrentProjectRequest(input.projectId, requestGeneration)) setPartialSubmitError(notification);
            return { notification, alreadyNotified: true };
          }
          return { notification: message };
        } finally {
          releaseProjectMutation(input.projectId, "submit", mutationToken);
        }
        return undefined;
      }
    : undefined;

  const sourceRows = useMemo(() => {
    if (loadState.kind !== "ready") return [];
    return buildDtsWorkbenchRows({
      projectId,
      configRevisionId: loadState.revisionId,
      view: "source",
      bindings: loadState.bindings,
      sourceNodes: loadState.sourceNodes,
      effectiveNodes: loadState.effectiveNodes,
      mappingTasks: loadState.mappingTasks,
      moduleRegistry
    });
  }, [loadState, projectId, moduleRegistry]);

  const effectiveRows = useMemo(() => {
    if (loadState.kind !== "ready") return [];
    return buildDtsWorkbenchRows({
      projectId,
      configRevisionId: loadState.revisionId,
      view: "effective",
      bindings: loadState.bindings,
      sourceNodes: loadState.sourceNodes,
      effectiveNodes: loadState.effectiveNodes,
      mappingTasks: loadState.mappingTasks,
      moduleRegistry
    });
  }, [loadState, projectId, moduleRegistry]);

  // Selection is owned by the semantic workbench. These stable seams allow the
  // API coordinator to add side effects later without changing row identity.
  const handleSelectBinding = useCallback((_bindingId: string) => undefined, []);
  const handleEditBinding = useCallback((_bindingId: string) => undefined, []);

  const loadBindingHistory = useCallback(
    (bindingId: string) => {
      if (!repository?.listBindingHistory) {
        return Promise.reject(new Error("canonical binding history repository unavailable"));
      }
      return repository.listBindingHistory(projectId, bindingId);
    },
    [projectId, repository]
  );

  const loadBindingCompare = useCallback(
    (bindingId: string) => {
      if (!repository?.listBindingCompare) {
        return Promise.reject(new Error("canonical binding compare repository unavailable"));
      }
      return repository.listBindingCompare(projectId, bindingId);
    },
    [projectId, repository]
  );

  const loadParameterSpec = useCallback(
    (definitionId: string, effectiveRevisionId: string, propertyKey: string) => {
      if (canonicalRepository?.getDefinitionRevision) {
        return loadCanonicalDtsDefinitionDetail(canonicalRepository, {
          definitionId,
          revisionId: effectiveRevisionId,
          propertyKey
        });
      }
      return Promise.reject(new Error("canonical definition repository unavailable"));
    },
    [canonicalRepository]
  );

  const loadPrimaryDtsSource = useCallback(async (sourceFileName?: string) => {
    const files = await parameterFileRepo.listFiles(projectId);
    const projectFiles = files.filter((file) => file.projectId === projectId && file.enabled && file.format === "dts");
    const file = sourceFileName
      ? projectFiles.find((item) => item.fileName === sourceFileName)
      : selectPrimaryProjectDtsFile(projectId, projectFiles);
    if (!file?.currentVersionId || file.currentVersionNumber == null) {
      throw new Error(sourceFileName ? `未找到参数对应的 DTS 源文件（${sourceFileName}）。` : "未找到可用的项目主 DTS 文件");
    }
    const downloaded = await parameterFileRepo.downloadVersion(
      projectId,
      file.id,
      file.currentVersionId
    );
    const text = new TextDecoder().decode(downloaded.bytes);
    return {
      fileName: downloaded.fileName ?? file.fileName,
      versionNumber: file.currentVersionNumber,
      text
    };
  }, [parameterFileRepo, projectId]);

  const loadPrimaryJsonSource = useCallback(async (): Promise<PrimaryJsonSource> => {
    const files = await parameterFileRepo.listFiles(projectId);
    const file = selectPrimaryProjectJsonFile(projectId, files);
    if (!file?.currentVersionId || file.currentVersionNumber == null) {
      throw new Error("未找到可读取的项目 JSON 源文件，请联系项目管理员检查文件。");
    }
    const downloaded = await parameterFileRepo.downloadVersion(projectId, file.id, file.currentVersionId);
    return { fileName: downloaded.fileName ?? file.fileName,
      versionNumber: file.currentVersionNumber, text: new TextDecoder().decode(downloaded.bytes) };
  }, [parameterFileRepo, projectId]);

  const exportCanonicalBinding = useCallback(
    async (bindingId: string) => {
      if (!canonicalRepository?.getCanonicalBindingExport) {
        throw new Error("当前未配置固定源导出能力");
      }
      const response = await canonicalRepository.getCanonicalBindingExport(projectId, bindingId);
      const payload = `${JSON.stringify(response.item, null, 2)}\n`;
      const fileName = `${projectId}-${bindingId}-${response.item.currentValueId}-source-export.json`;
      const url = URL.createObjectURL(new Blob([payload], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [canonicalRepository, projectId]
  );

  const loadCanonicalBindingHistory = useCallback(
    async (bindingId: string): Promise<readonly JsonBindingHistoryEntry[]> => {
      const entries = await loadBindingHistory(bindingId);
      return entries.map((entry) => ({
        id: entry.id,
        reason: entry.reason ?? "",
        createdAt: entry.changedAt,
        actor: entry.actor,
        fromRawValue: entry.fromRawValue,
        toRawValue: entry.toRawValue,
        oldCurrentValueId: entry.oldCurrentValueId ?? null,
        newCurrentValueId: entry.newCurrentValueId ?? null,
        valueState: entry.valueState
      }));
    },
    [loadBindingHistory]
  );

  const requestedBinding = requestedBindingId
    ? jsonBindings.find((binding) => binding.id === requestedBindingId)
      ?? (loadState.kind === "ready" ? loadState.bindings.find((binding) =>
        binding.id === requestedBindingId && binding.effectiveValue.kind !== "json") : undefined)
    : undefined;

  const handledBindingNavigation = useRef({ key: "", handled: false });
  useEffect(() => {
    const key = `${projectId}:${requestedBindingId ?? ""}`;
    if (handledBindingNavigation.current.key !== key) handledBindingNavigation.current = { key, handled: false };
    if (!requestedBinding || handledBindingNavigation.current.handled) return;
    handledBindingNavigation.current.handled = true;
    setActiveFormatTab(requestedBinding.effectiveValue.kind === "json" ? "json" : "dts");
  }, [projectId, requestedBindingId, requestedBinding]);

  const refreshingWorkspace = workspaceRefresh?.projectId === projectId && workspaceRefresh.pending;
  const workspaceRefreshError = workspaceRefresh?.projectId === projectId ? workspaceRefresh.error : undefined;
  const canEditSemantic = loadState.kind === "ready" && canEdit && !refreshingWorkspace && !workspaceRefreshError &&
    !loadState.incompleteBase && loadState.status !== "invalid" &&
    loadState.status !== "needs_mapping" && !projectMutationKind;
  const editableJsonBindings = canEditSemantic && !jsonState?.refreshing && !jsonState?.message && loadState.kind === "ready" ? jsonBindings.filter((binding) =>
    loadState.bindings.some((semanticBinding) => semanticBinding.id === binding.id &&
      semanticBinding.currentValueId === binding.currentValueId &&
      semanticBinding.effectiveRevisionId === binding.effectiveRevisionId &&
      semanticBinding.rawValue === binding.rawValue)) : [];
  const editableJsonIds = new Set(editableJsonBindings.map((binding) => binding.id));
  const draftBindingIds = new Set(
    projectDrafts
      .filter((draft) => draft.kind === "binding")
      .map((draft) => draft.projectParameterBindingId)
  );
  const bindingDrafts = projectDrafts.filter(isBindingDraft);
  const handleEditDraftBinding = (bindingId: string) => {
    const binding = loadState.kind === "ready" ? loadState.bindings.find((item) => item.id === bindingId) : undefined;
    if (!binding || !canEditSemantic) return;
    setActiveFormatTab(binding.effectiveValue.kind === "json" ? "json" : "dts");
    setEditRequest((current) => ({ bindingId, token: (current?.token ?? 0) + 1 }));
  };
  const draftReadNotices = [
    { label: "参数值草稿", state: valueDraftRead, retry: () => setValueDraftRetryToken((token) => token + 1) },
    { label: "节点启用草稿", state: enablementDraftRead, retry: () => setEnablementDraftRetryToken((token) => token + 1) }
  ].map(({ label, state, retry }) => state.kind === "error" ? (
    <div key={label} className="project-topology-workspace__error" role="alert" aria-label={`${label}加载失败`}>
      {label}加载失败：{state.message}
      <button type="button" className="button subtle" onClick={retry}>重试加载{label}</button>
    </div>
  ) : state.kind === "loading" ? <p key={label} role="status" aria-label={`正在加载${label}`}>正在加载{label}…</p> : null);
  const currentDraftTray = projectDrafts.length > 0 ? (
    <DtsBindingDraftTray
      projectId={projectId}
      drafts={projectDrafts}
      selectedBindingIds={selectedDraftBindingIds}
      candidates={workflowCandidates}
      candidatesError={workflowCandidatesError}
      externalBlocker={
        projectMutationKind === "draft"
          ? "正在保存草稿，完成后可提交审核。"
          : refreshingWorkspace ? "正在更新参数版本，请稍候。"
          : workspaceRefreshError ? "参数版本更新失败，请重试后提交。" : null
      }
      onRemove={handleRemoveDraft}
      onSubmit={handleSubmitBindingChanges}
      onSubmitCanonical={handleSubmitCanonicalDrafts}
      canManageRoles={canManageRoles}
      onNavigate={onNavigate}
      onEditBinding={canEditSemantic ? handleEditDraftBinding : undefined}
      canEdit={canEdit && !projectMutationKind}
    />
  ) : submitSuccessNotice ? (
    <section className="dts-binding-draft-tray dts-draft-tray" aria-label="参数提交结果">
      <p role="status">{submitSuccessNotice}</p>
      <div className="binding-draft-submission__actions">
        <button type="button" className="button subtle" onClick={() => onNavigate("/parameter-review")}>
          查看变更审阅
        </button>
        <button
          type="button"
          className="button subtle"
          aria-label="关闭提交结果提示"
          onClick={() => setSubmitSuccessNotice(null)}
        >
          知道了
        </button>
      </div>
    </section>
  ) : null;
  const currentEdits = currentDraftTray || partialSubmitError || valueDraftRead.kind !== "ready" || enablementDraftRead.kind !== "ready"
    ? <>{draftReadNotices}{partialSubmitError ? <div role="alert" aria-label="部分草稿提交失败" className="project-topology-workspace__error">
      <p>{partialSubmitError}</p>
      <button type="button" className="button subtle" onClick={() => setPartialSubmitError(null)}>关闭提交错误提示</button>
    </div> : null}{currentDraftTray}</> : null;

  const dtsBindingCount = loadState.kind === "ready" ? loadState.bindings.filter((b) => b.effectiveValue.kind !== "json").length : 0;
  const jsonBindingCount = jsonBindings.length;
  useEffect(() => {
    if (!requestedBindingId && (loadState.kind === "ready" || loadState.kind === "empty") && dtsBindingCount === 0 && jsonBindingCount > 0) {
      setActiveFormatTab("json");
    }
  }, [projectId, dtsBindingCount, jsonBindingCount, loadState.kind, requestedBindingId]);

  const formatSwitcher = jsonBindingCount > 0 ? (
    <div className="parameter-workspace-format-switch" role="tablist" aria-label="参数配置格式">
      <button
        type="button"
        role="tab"
        id="format-tab-dts"
        aria-selected={activeFormatTab === "dts"}
        aria-controls="format-panel-dts"
        className={`parameter-workspace-format-switch__tab${activeFormatTab === "dts" ? " is-active" : ""}`}
        onClick={() => { pendingFormatFocus.current = activeFormatTab === "dts" ? null : "dts"; setActiveFormatTab("dts"); }}
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>DTS 设备树参数</span>
        <span className="parameter-workspace-format-switch__badge">{dtsBindingCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        id="format-tab-json"
        aria-selected={activeFormatTab === "json"}
        aria-controls="format-panel-json"
        className={`parameter-workspace-format-switch__tab${activeFormatTab === "json" ? " is-active" : ""}`}
        onClick={() => { pendingFormatFocus.current = activeFormatTab === "json" ? null : "json"; setActiveFormatTab("json"); }}
      >
        <FileJson size={14} aria-hidden="true" />
        <span>JSON 参数</span>
        <span className="parameter-workspace-format-switch__badge">{jsonBindingCount}</span>
      </button>
    </div>
  ) : null;

  const jsonContent = jsonState?.state === "error" && (canonicalRepository || loadState.kind !== "ready" || (requestedBindingId && !requestedBinding)) ? (
    <div className="project-topology-workspace__error" role="alert">
      {jsonState.message}
      <button type="button" className="button subtle" onClick={() => setReloadToken((token) => token + 1)}>重试</button>
    </div>
  ) : jsonBindings.length > 0 ? (
    <JsonBindingPanel
      key={projectId}
      bindings={jsonBindings}
      pendingDrafts={bindingDrafts}
      requestedEditBindingId={editRequest?.bindingId}
      editRequestToken={editRequest?.token}
      requestedBindingId={requestedBinding?.effectiveValue.kind === "json" ? requestedBindingId : undefined}
      moduleRegistry={moduleRegistry}
      canEdit={canEditSemantic}
      editableBindingIds={editableJsonIds}
      draftBindingIds={draftBindingIds}
      currentEdits={loadState.kind === "ready" ? currentEdits : undefined}
      onValidateEdit={editableJsonIds.size > 0 ? handleValidateEdit : undefined}
      onExportBinding={canonicalRepository?.getCanonicalBindingExport ? exportCanonicalBinding : undefined}
      onLoadHistory={repository.listBindingHistory ? loadCanonicalBindingHistory : undefined}
      loadPrimaryJsonSource={loadPrimaryJsonSource}
      onExportRows={(bindings) => downloadJsonWorkbenchCsv(bindings, `json-parameters-${projectId}.csv`)}
      projectName={projectName ?? projectId}
      toolbarActions={activeFormatTab === "json" ? formatSwitcher : undefined}
      notice={notice}
    />
  ) : jsonState?.state === "loading" || !jsonState ? <p role="status">正在加载项目 JSON 绑定…</p> : null;
  const unavailableBinding = requestedBindingId && !requestedBinding && jsonState?.state === "ready"
    ? <p role="status">关联参数在当前项目中不可用。</p> : null;
  const jsonFormatPanel = jsonBindingCount > 0 ? (
    <div key="json" id="format-panel-json" role="tabpanel"
      aria-labelledby={loadState.kind === "ready" ? "format-tab-json" : undefined}
      aria-label={loadState.kind === "ready" ? undefined : "JSON 参数"}
      hidden={loadState.kind === "ready" && activeFormatTab !== "json"}>
      {jsonContent}
    </div>
  ) : null;

  if (loadState.kind !== "ready") {
    return (
      <div className="api-project-topology-workspace">
      <section className="dts-parameter-workbench" aria-label="DTS 参数工作台" aria-busy={loadState.kind === "loading"}>
        <NavigatorWorkbench pageKey="parameters" toolbar={null} navigatorLabel="模块导航"
          navigator={<SectionEmpty message="暂无模块分组" />} taskLabel="DTS 参数列表"
          notice={notice || unavailableBinding ? <>{notice}{unavailableBinding}</> : undefined}
          taskState={loadState.kind === "loading" ? { kind: "loading", message: "正在加载项目拓扑与绑定…" }
            : loadState.kind === "empty" ? { kind: "empty", message: loadState.message }
            : { kind: "error", message: `${loadState.code === "NOT_FOUND" ? "未找到拓扑资源（404）。" : ""}${loadState.message}`,
              onRetry: () => setReloadToken((token) => token + 1) }} />
      </section>
      {jsonFormatPanel ?? jsonContent}
      </div>
    );
  }

  const statusBanner =
    loadState.status === "needs_mapping"
      ? "部分配置的对应关系尚未确认，暂时无法修改。请联系项目管理员完成确认。"
      : loadState.status === "invalid"
        ? "项目配置未通过解析，暂时无法修改。请联系项目管理员检查文件。"
        : null;

  const { other: productDiagnostics, summary: danglingSummary } =
    partitionDanglingReferenceDiagnostics(loadState.diagnostics);
  const showGovernancePanel = Boolean(
    statusBanner ||
    loadState.incompleteBase ||
    productDiagnostics.length > 0
  );
  return (
    <div className="api-project-topology-workspace">
      {refreshingWorkspace ? <p role="status">正在更新参数版本，当前输入已保留…</p> : null}
      {workspaceRefreshError ? <div role="alert" className="project-topology-workspace__error">
        参数版本更新失败：{workspaceRefreshError}
        <button type="button" className="button subtle" onClick={() => setReloadToken((token) => token + 1)}>重试更新</button>
      </div> : null}
      {jsonState?.state === "ready" && jsonState.message ? <div role="alert" className="project-topology-workspace__error">
        {jsonState.message}
        <button type="button" className="button subtle" onClick={() => setReloadToken((token) => token + 1)}>重试 JSON 参数</button>
      </div> : null}
      {jsonFormatPanel}
        <div id="format-panel-dts" role="tabpanel" aria-labelledby="format-tab-dts" hidden={activeFormatTab === "json" && jsonBindingCount > 0}>
          <DtsParameterWorkbench
            key={projectId}
            projectId={projectId}
            projectName={projectName}
            toolbarActions={activeFormatTab === "dts" ? formatSwitcher : undefined}
            notice={notice || unavailableBinding || jsonState?.state === "error" ? <>
              {notice}{unavailableBinding}
              {jsonState?.state === "error" && (canonicalRepository || (requestedBindingId && !requestedBinding)) ? jsonContent : null}
            </> : undefined}
            requestedBindingId={requestedBinding?.effectiveValue.kind !== "json" ? requestedBindingId : undefined}
            pendingDrafts={bindingDrafts}
            requestedEditBindingId={editRequest?.bindingId}
            editRequestToken={editRequest?.token}
            configSetId={loadState.configSetId}
            revisionId={loadState.revisionId}
            layoutMode={layoutMode}
            sourceNodes={loadState.sourceNodes}
            effectiveNodes={loadState.effectiveNodes}
            sourceRows={sourceRows}
            effectiveRows={effectiveRows}
            moduleRegistry={moduleRegistry}
            draftBindingIds={draftBindingIds}
            selectedBindingIds={selectedDraftBindingIds}
            onSelectedBindingIdsChange={setSelectedDraftBindingIds}
            canEdit={canEditSemantic}
            onSelectBinding={handleSelectBinding}
            onEditBinding={handleEditBinding}
            onStartDtsReload={(bindingId) => onNavigate(buildDtsReloadHandoffPath({ projectId, bindingIds: [bindingId] }))}
            onCreateDraft={handleValidateEdit}
            onEditNodeEnablement={canEditSemantic ? handleOpenNodeEnablement : undefined}
            loadBindingHistory={loadBindingHistory}
            loadBindingCompare={loadBindingCompare}
            loadParameterSpec={loadParameterSpec}
            loadPrimaryDtsSource={loadPrimaryDtsSource}
            currentEdits={currentEdits}
            expandAllNodesByDefault
            onExportRows={(rows) => {
              downloadSemanticWorkbenchCsv(
                rows,
                `parameter-workbench-${projectId}-${loadState.revisionId}.csv`
              );
            }}
            governanceContent={showGovernancePanel ? (
              <>
                {statusBanner ? (
                  <p className="project-topology-workspace__status" role="status">
                    {statusBanner}
                  </p>
                ) : null}
                {loadState.incompleteBase ? (
                  <p role="alert">缺少基础配置，暂时无法编辑参数。请联系项目管理员补充文件。</p>
                ) : null}
                <WorkbenchDiagnosticsSection diagnostics={productDiagnostics} variant="other" />
              </>
            ) : undefined}
            footerContent={
              danglingSummary ? (
                <WorkbenchDiagnosticsSection diagnostics={loadState.diagnostics} variant="dangling" />
              ) : undefined
            }
          />
        </div>
      {enablementDialogTarget ? (
        <DtsNodeEnablementDialog
          open
          nodeLabel={enablementDialogTarget.nodeLabel}
          enablement={enablementDialogTarget.enablement}
          measuredSpelling={measuredStatusSpelling}
          busy={enablementDialogBusy}
          error={enablementDialogError}
          onClose={() => {
            if (enablementDialogBusy) return;
            setEnablementDialogTarget(null);
            setEnablementDialogError(null);
          }}
          onConfirm={handleCreateEnablementDraft}
        />
      ) : null}
    </div>
  );
}
