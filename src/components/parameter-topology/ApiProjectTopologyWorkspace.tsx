import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Info, LoaderCircle } from "lucide-react";
import type {
  ParameterDraftDto,
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import { resolveParameterFileRepository } from "@/application/parameters/parameterFileRuntime";
import { selectPrimaryProjectDtsFile } from "@/application/parameters/selectPrimaryProjectDtsFile";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
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
import { createHttpParameterRepository } from "@/infrastructure/http/parameterClient";
import { presentError } from "@/infrastructure/http/presentError";
import {
  mapParameterTopologyError,
  type ParameterTopologyMappedError
} from "@/infrastructure/http/parameterTopologyClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import {
  type TopologyLayoutMode
} from "./ProjectTopologyWorkspace";
import type { BindingEditValidation } from "./BindingDetailPanel";
import {
  DtsBindingDraftTray,
  type PendingTopologyDraft
} from "./DtsBindingDraftTray";
import { DtsNodeEnablementDialog } from "./DtsNodeEnablementDialog";
import type { PendingEnablementDraft } from "./draftTrayTypes";
import { DtsParameterWorkbench } from "./DtsParameterWorkbench";
import { buildDtsWorkbenchRows } from "@/application/parameters/buildDtsWorkbenchRows";
import { downloadSemanticWorkbenchCsv } from "@/application/parameters/exportSemanticWorkbenchRows";
import {
  clearUnsavedParameterWork,
  reportUnsavedParameterWork
} from "@/application/parameters/unsavedParameterWork";
import {
  filterProductWorkbenchDiagnostics,
  partitionDanglingReferenceDiagnostics
} from "@/domain/parameter-topology/toolchainDiagnostics";
import { WorkbenchDiagnosticsSection } from "./WorkbenchDiagnosticsSection";

export type ApiProjectTopologyWorkspaceProps = {
  projectId: string;
  canEdit?: boolean;
  layoutMode?: TopologyLayoutMode;
  runtimeMode?: WiseEffRuntimeMode;
  /** Test seam — inject repositories instead of constructing HTTP clients. */
  topologyRepository?: ParameterTopologyRepository;
  /** Test seam — inject the admin-maintained module registry repository. */
  moduleRegistryRepository?: ParameterModuleRegistryRepository;
  /** Test seam — inject parameter file repository instead of resolving from runtime mode. */
  parameterFileRepository?: ParameterFileRepository;
  listConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
  listDrafts?: (projectId: string) => Promise<ParameterDraftDto[]>;
  /** Server-side draft delete; tray removal must not leave the draft alive on the server. */
  deleteDraft?: (draftId: string) => Promise<void>;
  listWorkflowAssignees?: (projectId: string) => Promise<WorkflowAssigneeCandidates>;
  submitBindingChanges?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate?: (path: string) => void;
};

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
  drafts: ParameterDraftDto[],
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

    // TODO: drop optional chaining once listDrafts always returns enablement draft fields.
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
          rawText: draft.targetValue,
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
        rawText: draft.targetValue,
        action: draft.action ?? "set",
        parameterSpecId,
        projectParameterBindingId: bindingId,
        writeTarget: {
          role: "overlay",
          propertyKey: binding.propertyKey,
          targetRef: binding.instanceName ?? binding.driverModule ?? undefined
        },
        overlayFileId: "",
        overlayFileName: "",
        projectId,
        currentRawValue: draft.currentValue ?? binding.rawValue,
        reason: draft.reason,
        moduleName: moduleAssignment.moduleName
      }
    ];
  });
}

function resolveSharedWorkingTip(drafts: ParameterDraftDto[]): string | undefined {
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
    return { kind: "empty", message: "该项目尚未上传项目 DTS。请先在项目管理中上传 base 与 overlay DTS 文件。" };
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
        message: "尚未生成语义配置修订。请先上传项目 DTS（含 base 与 overlay）以触发 ingest。"
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
  canEdit = true,
  layoutMode = "desktop",
  runtimeMode = "api",
  topologyRepository,
  moduleRegistryRepository,
  parameterFileRepository,
  listConfigSets,
  listDrafts,
  deleteDraft,
  listWorkflowAssignees,
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

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
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
  const [serverDrafts, setServerDrafts] = useState<ParameterDraftDto[] | null>(null);
  const [selectedDraftBindingIds, setSelectedDraftBindingIds] = useState<Set<string>>(new Set());
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
    setServerDrafts(null);
    setSelectedDraftBindingIds(new Set());
    setSubmitSuccessNotice(null);
    setEnablementDialogTarget(null);
    setEnablementDialogError(null);
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const resolveListDrafts =
      listDraftsRef.current ??
      (runtimeMode === "api"
        ? (id: string) => createHttpParameterRepository().listDrafts(id)
        : undefined);
    if (!resolveListDrafts) {
      setServerDrafts([]);
      return undefined;
    }
    setServerDrafts(null);
    resolveListDrafts(projectId)
      .then((drafts) => {
        if (!cancelled) setServerDrafts(drafts);
      })
      .catch(() => {
        if (!cancelled) setServerDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, runtimeMode, draftsReloadToken]);

  useEffect(() => {
    if (!serverDrafts || loadState.kind !== "ready") return;
    const bindingDrafts = serverDrafts.filter(
      (draft) =>
        draft.projectId === projectId &&
        (draft.projectParameterBindingId || draft.editSubjectKind === "node-enablement")
    );
    if (bindingDrafts.length === 0) return;

    const sharedTip = resolveSharedWorkingTip(bindingDrafts);
    if (sharedTip && loadState.revisionId !== sharedTip) {
      setPreferredRevision({ projectId, revisionId: sharedTip });
      return;
    }

    if (pendingDraftsRef.current.some((draft) => draft.projectId === projectId)) return;
    const hydrated = mapServerDraftsToPending(
      projectId,
      bindingDrafts,
      loadState.bindings,
      loadState.effectiveNodes,
      moduleRegistry,
      sharedTip
    );
    setPendingDrafts(hydrated);
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
    if (!repository) {
      setLoadState({
        kind: "error",
        message: "API 模式需要拓扑仓储；禁止使用 teaching 数据回退。"
      });
      return undefined;
    }

    let cancelled = false;
    setLoadState({ kind: "loading" });

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

  const handleValidateEdit = async (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }): Promise<BindingEditValidation> => {
    const activeMutationLock = projectMutationsRef.current.get(projectId);
    const activeMutation = activeMutationLock?.kind ?? null;
    if (activeMutation) {
      return {
        valid: false,
        diagnostics: [
          {
            message: `该项目的 ${activeMutation} mutation 仍在处理中，落定前不能创建或替换草稿。`,
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
            message: "该项目已有 mutation 正在处理中，已阻止并发草稿创建。",
            code: "PROJECT_MUTATION_IN_PROGRESS"
          }
        ]
      };
    }

    try {
      const draft = await repository.createBindingDraft(requestProjectId, input.bindingId, {
        baseRevisionId: loadState.revisionId,
        targetValue,
        reason: input.reason
      });
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿响应。", code: "PROJECT_CHANGED" }]
        };
      }
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
          candidateRevisionId: tip,
          projectId: requestProjectId,
          currentRawValue: previousDraft?.kind === "binding"
            ? previousDraft.currentRawValue
            : binding.rawValue,
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
          item.projectId === requestProjectId ? { ...item, candidateRevisionId: tip } : item
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
      setEnablementDialogError(`该项目的 ${activeMutation} mutation 仍在处理中，落定前不能创建或替换草稿。`);
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
      setEnablementDialogError("该项目已有 mutation 正在处理中，已阻止并发草稿创建。");
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
    const resolveDeleteDraft =
      deleteDraftRef.current ??
      (runtimeMode === "api"
        ? (id: string) => createHttpParameterRepository().deleteDraft(id)
        : undefined);
    if (!resolveDeleteDraft) {
      throw new Error("草稿删除入口未配置，无法移除服务端草稿。");
    }
    const mutationToken = acquireProjectMutation(requestProjectId, "draft", requestGeneration);
    if (!mutationToken) {
      throw new Error("该项目已有 mutation 正在处理中，请稍后再移除草稿。");
    }
    try {
      await resolveDeleteDraft(draftId);
      if (!isCurrentProjectRequest(requestProjectId, requestGeneration)) return;
      const removed = pendingDraftsRef.current.find((draft) => draft.draftId === draftId);
      const remaining = pendingDraftsRef.current.filter((draft) => draft.draftId !== draftId);
      setPendingDrafts(remaining);
      // Keep the cached server list consistent so hydrate never revives a deleted draft.
      setServerDrafts((current) => current?.filter((draft) => draft.id !== draftId) ?? current);
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
          const activeKind = projectMutationsRef.current.get(submittingProjectId)?.kind ?? "unknown";
          return { notification: `该项目已有 ${activeKind} mutation 正在处理中，已阻止正式提交。` };
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
      if (!repository?.listBindingHistory) return Promise.resolve([]);
      return repository.listBindingHistory(projectId, bindingId);
    },
    [projectId, repository]
  );

  const loadBindingCompare = useCallback(
    (bindingId: string) => {
      if (!repository?.listBindingCompare) return Promise.resolve([]);
      return repository.listBindingCompare(projectId, bindingId);
    },
    [projectId, repository]
  );

  const loadParameterSpec = useCallback(
    (parameterSpecId: string) => {
      if (!repository?.getSpec) {
        return Promise.reject(new Error("parameter topology repository unavailable"));
      }
      return repository.getSpec(parameterSpecId);
    },
    [repository]
  );

  const loadPrimaryDtsSource = useCallback(async () => {
    const files = await parameterFileRepo.listFiles(projectId);
    const file = selectPrimaryProjectDtsFile(projectId, files);
    if (!file?.currentVersionId || file.currentVersionNumber == null) {
      throw new Error("未找到可用的项目主 DTS 文件");
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

  if (loadState.kind === "loading") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台" aria-busy="true">
        <p role="status"><LoaderCircle className="dts-status-icon dts-status-icon--spin" size={17} strokeWidth={2} aria-hidden="true" />正在加载项目拓扑与绑定…</p>
      </section>
    );
  }

  if (loadState.kind === "empty") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台">
        <div className="project-topology-workspace__empty" role="status">
          <Info className="dts-status-icon" size={17} strokeWidth={2} aria-hidden="true" />
          {loadState.message}
        </div>
      </section>
    );
  }

  if (loadState.kind === "error") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台">
        <div className="project-topology-workspace__error" role="alert">
          <AlertCircle className="dts-status-icon" size={17} strokeWidth={2} aria-hidden="true" />
          {loadState.code === "NOT_FOUND" ? "未找到拓扑资源（404）。" : null}
          {loadState.message}
          <button type="button" className="button subtle" onClick={() => setReloadToken((t) => t + 1)}>
            重试
          </button>
        </div>
      </section>
    );
  }

  const statusBanner =
    loadState.status === "needs_mapping"
      ? "修订状态：needs_mapping — 存在未解决节点对应，发布前须完成审核。"
      : loadState.status === "invalid"
        ? "修订状态：invalid — 解析/编译失败，修复后方可编辑或发布。"
        : null;

  const canEditSemantic =
    canEdit &&
    !loadState.incompleteBase &&
    loadState.status !== "invalid" &&
    loadState.status !== "needs_mapping" &&
    !projectMutationKind;

  const draftBindingIds = new Set(
    projectDrafts
      .filter((draft) => draft.kind === "binding")
      .map((draft) => draft.projectParameterBindingId)
  );
  const { other: productDiagnostics, summary: danglingSummary } =
    partitionDanglingReferenceDiagnostics(loadState.diagnostics);
  const showGovernancePanel = Boolean(
    statusBanner ||
    loadState.incompleteBase ||
    productDiagnostics.length > 0
  );
  const currentEdits = projectDrafts.length > 0 ? (
    <DtsBindingDraftTray
      projectId={projectId}
      drafts={projectDrafts}
      selectedBindingIds={selectedDraftBindingIds}
      candidates={workflowCandidates}
      candidatesError={workflowCandidatesError}
      externalBlocker={
        projectMutationKind === "draft"
          ? "该项目正在创建 typed draft，正式提交已暂时锁定。"
          : null
      }
      onRemove={handleRemoveDraft}
      onSubmit={handleSubmitBindingChanges}
      onNavigate={onNavigate}
    />
  ) : submitSuccessNotice ? (
    <section className="dts-binding-draft-tray dts-draft-tray" role="region" aria-label="参数提交结果">
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

  return (
    <>
      <DtsParameterWorkbench
        projectId={projectId}
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
              <p role="alert">缺少 base 配置，当前拓扑不完整；已阻止类型化编辑与校验。</p>
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
    </>
  );
}
