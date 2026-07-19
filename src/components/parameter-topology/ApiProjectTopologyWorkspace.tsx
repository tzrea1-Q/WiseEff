import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { resolveDtsStructuredRepository } from "@/application/parameters/dtsStructuredRuntime";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  ResolveMappingInput,
  SourceTopologyNode,
  TopologyDiagnostic
} from "@/domain/parameter-topology/types";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import { createHttpParameterTopologyRepository } from "@/infrastructure/http/parameterTopologyClient";
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
  type PendingBindingDraft
} from "./DtsBindingDraftTray";
import { DtsParameterWorkbench } from "./DtsParameterWorkbench";
import { IdentityMappingReview } from "./IdentityMappingReview";
import { buildDtsWorkbenchRows } from "@/application/parameters/buildDtsWorkbenchRows";

export type ApiProjectTopologyWorkspaceProps = {
  projectId: string;
  canEdit?: boolean;
  canPublish?: boolean;
  layoutMode?: TopologyLayoutMode;
  runtimeMode?: WiseEffRuntimeMode;
  /** Test seam — inject repositories instead of constructing HTTP clients. */
  topologyRepository?: ParameterTopologyRepository;
  listConfigSets?: (projectId: string) => Promise<Array<{ id: string; name: string }>>;
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

function pickConfigSet(items: Array<{ id: string; name: string }>) {
  return items.find((item) => item.name === "default") ?? items[0] ?? null;
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
    return { kind: "empty", message: "该项目尚未创建 Config Set。请先在项目管理中配置 DTS Config Set。" };
  }

  const revisionKey = preferredRevisionId ?? "current";
  let effectiveTree;
  try {
    effectiveTree = await topology.getTopology(projectId, configSet.id, revisionKey, "effective");
  } catch (error) {
    const mapped = mapParameterTopologyError(error);
    if (mapped.kind === "api" && mapped.code === "NOT_FOUND") {
      return {
        kind: "empty",
        message: "尚未生成语义配置修订。请先上传完整 Config Set（含 base）以触发 ingest。"
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
  const uniqueDiagnostics = diagnostics.filter((item) => {
    const key = `${item.code ?? ""}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
  canPublish = false,
  layoutMode = "desktop",
  runtimeMode = "api",
  topologyRepository,
  listConfigSets,
  listWorkflowAssignees,
  submitBindingChanges,
  onNavigate = () => undefined
}: ApiProjectTopologyWorkspaceProps) {
  const repository = useMemo(
    () => topologyRepository ?? (runtimeMode === "api" ? createHttpParameterTopologyRepository() : null),
    [runtimeMode, topologyRepository]
  );
  const listConfigSetsRef = useRef(listConfigSets);
  listConfigSetsRef.current = listConfigSets;
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const projectMutationsRef = useRef(new Map<string, ProjectMutationKind>());

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [preferredRevision, setPreferredRevision] = useState<{
    projectId: string;
    revisionId: string;
  } | null>(null);
  const preferredRevisionId =
    preferredRevision?.projectId === projectId ? preferredRevision.revisionId : undefined;
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [mappingMessage, setMappingMessage] = useState<string | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<PendingBindingDraft[]>([]);
  const [workflowCandidates, setWorkflowCandidates] = useState<WorkflowAssigneeCandidates | null>(null);
  const [workflowCandidatesError, setWorkflowCandidatesError] = useState<string | null>(null);
  const [projectMutationKinds, setProjectMutationKinds] = useState<ReadonlyMap<string, ProjectMutationKind>>(
    () => new Map()
  );
  const projectDrafts = pendingDrafts.filter((draft) => draft.projectId === projectId);
  const hasProjectDrafts = projectDrafts.length > 0;
  const projectMutationKind = projectMutationKinds.get(projectId) ?? null;

  const acquireProjectMutation = (mutationProjectId: string, kind: ProjectMutationKind): boolean => {
    if (projectMutationsRef.current.has(mutationProjectId)) return false;
    projectMutationsRef.current.set(mutationProjectId, kind);
    setProjectMutationKinds(new Map(projectMutationsRef.current));
    return true;
  };

  const releaseProjectMutation = (mutationProjectId: string, kind: ProjectMutationKind) => {
    if (projectMutationsRef.current.get(mutationProjectId) !== kind) return;
    projectMutationsRef.current.delete(mutationProjectId);
    setProjectMutationKinds(new Map(projectMutationsRef.current));
  };

  useEffect(() => {
    setPreferredRevision(null);
    setPendingDrafts([]);
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
    setPublishMessage(null);
    setMappingMessage(null);
  }, [projectId]);

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
          setWorkflowCandidatesError(error instanceof Error ? error.message : "无法加载项目角色候选人。");
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
    setPublishMessage(null);

    const resolveConfigSets =
      listConfigSetsRef.current ??
      ((id: string) => resolveDtsStructuredRepository(runtimeMode).listConfigSets(id));

    loadWorkspace(projectId, repository, resolveConfigSets, preferredRevisionId)
      .then((next) => {
        if (!cancelled) setLoadState(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const mapped = mapParameterTopologyError(error);
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

  const handleValidateEdit = async (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }): Promise<BindingEditValidation> => {
    const activeMutation = projectMutationsRef.current.get(projectId);
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
    if (!acquireProjectMutation(requestProjectId, "draft")) {
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
      if (activeProjectIdRef.current !== requestProjectId) {
        return {
          valid: false,
          diagnostics: [{ message: "项目已切换，已忽略上一项目的草稿响应。", code: "PROJECT_CHANGED" }]
        };
      }
      setPendingDrafts((current) => {
        const previousDraft = current.find(
          (item) =>
            item.projectId === requestProjectId &&
            item.projectParameterBindingId === draft.projectParameterBindingId
        );
        const nextDraft: PendingBindingDraft = {
          ...draft,
          projectId: requestProjectId,
          currentRawValue: previousDraft?.currentRawValue ?? binding.rawValue,
          reason: input.reason
        };
        return [
          ...current.filter(
            (item) =>
              item.projectId === requestProjectId &&
              item.projectParameterBindingId !== draft.projectParameterBindingId
          ),
          nextDraft
        ];
      });
      setPreferredRevision({ projectId: requestProjectId, revisionId: draft.candidateRevisionId });
      setReloadToken((token) => token + 1);
      return { valid: true, diagnostics: [] };
    } catch (error) {
      const mapped: ParameterTopologyMappedError = mapParameterTopologyError(error);
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
      releaseProjectMutation(requestProjectId, "draft");
    }
  };

  const handleSubmitBindingChanges = submitBindingChanges
    ? async (input: SubmitParameterChangesInput) => {
      const submittingProjectId = input.projectId;
        if (!acquireProjectMutation(submittingProjectId, "submit")) {
          const activeKind = projectMutationsRef.current.get(submittingProjectId) ?? "unknown";
          return { notification: `该项目已有 ${activeKind} mutation 正在处理中，已阻止正式提交。` };
        }
        try {
          return await submitBindingChanges(input);
        } finally {
          releaseProjectMutation(submittingProjectId, "submit");
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
      mappingTasks: loadState.mappingTasks
    });
  }, [loadState, projectId]);

  const effectiveRows = useMemo(() => {
    if (loadState.kind !== "ready") return [];
    return buildDtsWorkbenchRows({
      projectId,
      configRevisionId: loadState.revisionId,
      view: "effective",
      bindings: loadState.bindings,
      sourceNodes: loadState.sourceNodes,
      effectiveNodes: loadState.effectiveNodes,
      mappingTasks: loadState.mappingTasks
    });
  }, [loadState, projectId]);

  // Selection is owned by the semantic workbench. These stable seams allow the
  // API coordinator to add side effects later without changing row identity.
  const handleSelectBinding = useCallback((_bindingId: string) => undefined, []);
  const handleEditBinding = useCallback((_bindingId: string) => undefined, []);

  /** Validate only — no publish/release transition exists on this surface. */
  const handleValidate = async () => {
    if (!repository || loadState.kind !== "ready") return;
    setPublishMessage(null);
    try {
      const run = await repository.validateRevision(projectId, loadState.revisionId);
      if (run.status === "passed") {
        setPublishMessage("校验通过，修订已具备发布条件。");
        return;
      }
      setPublishMessage(`校验未通过（${run.stage}）。`);
      if (run.diagnostics?.length) {
        setLoadState({
          ...loadState,
          diagnostics: run.diagnostics
        });
      } else {
        setReloadToken((token) => token + 1);
      }
    } catch (error) {
      const mapped = mapParameterTopologyError(error);
      if (mapped.kind === "diagnostics") {
        setLoadState({
          ...loadState,
          diagnostics: mapped.diagnostics
        });
        setPublishMessage(mapped.message);
        return;
      }
      setPublishMessage(mapped.message);
    }
  };

  const handleResolveMapping = async (taskId: string, input: ResolveMappingInput) => {
    if (!repository || loadState.kind !== "ready") return;
    setMappingMessage(null);
    try {
      await repository.resolveMapping(taskId, input);
      setMappingMessage(input.decision === "resolved" ? "映射已确认，正在刷新拓扑…" : "映射已驳回，正在刷新拓扑…");
      setPreferredRevision(null);
      setReloadToken((token) => token + 1);
    } catch (error) {
      const mapped = mapParameterTopologyError(error);
      setMappingMessage(mapped.message);
    }
  };

  if (loadState.kind === "loading") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台" aria-busy="true">
        <p role="status">正在加载项目拓扑与绑定…</p>
      </section>
    );
  }

  if (loadState.kind === "empty") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台">
        <div className="project-topology-workspace__empty" role="status">
          {loadState.message}
        </div>
      </section>
    );
  }

  if (loadState.kind === "error") {
    return (
      <section className="dts-parameter-workbench dts-parameter-workbench--status" aria-label="DTS 参数工作台">
        <div className="project-topology-workspace__error" role="alert">
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
      ? "修订状态：needs_mapping — 存在未解决身份映射，发布前须完成审核。"
      : loadState.status === "invalid"
        ? "修订状态：invalid — 解析/编译失败，修复后方可编辑或发布。"
        : null;

  const canEditSemantic =
    canEdit &&
    !loadState.incompleteBase &&
    loadState.status !== "invalid" &&
    loadState.status !== "needs_mapping" &&
    !projectMutationKind;

  const draftBindingIds = new Set(projectDrafts.map((draft) => draft.projectParameterBindingId));
  const currentEdits = projectDrafts.length > 0 ? (
    <DtsBindingDraftTray
      projectId={projectId}
      drafts={projectDrafts}
      candidates={workflowCandidates}
      candidatesError={workflowCandidatesError}
      externalBlocker={
        projectMutationKind === "draft"
          ? "该项目正在创建 typed draft，正式提交已暂时锁定。"
          : null
      }
      onRemove={(draftId) => {
        setPendingDrafts((current) => current.filter((draft) => draft.draftId !== draftId));
      }}
      onSubmit={handleSubmitBindingChanges}
      onNavigate={onNavigate}
    />
  ) : null;

  return (
      <DtsParameterWorkbench
        projectId={projectId}
        configSetId={loadState.configSetId}
        revisionId={loadState.revisionId}
        layoutMode={layoutMode}
        sourceNodes={loadState.sourceNodes}
        effectiveNodes={loadState.effectiveNodes}
        sourceRows={sourceRows}
        effectiveRows={effectiveRows}
        draftBindingIds={draftBindingIds}
        canEdit={canEditSemantic}
        onSelectBinding={handleSelectBinding}
        onEditBinding={handleEditBinding}
        onCreateDraft={handleValidateEdit}
        currentEdits={currentEdits}
        expandAllNodesByDefault
        governanceContent={(
          <>
            {statusBanner ? (
              <p className="project-topology-workspace__status" role="status">
                {statusBanner}
              </p>
            ) : null}
            {publishMessage ? (
              <p className="project-topology-workspace__publish-message" role="status">
                {publishMessage}
              </p>
            ) : null}
            {mappingMessage ? (
              <p className="project-topology-workspace__mapping-message" role="status">
                {mappingMessage}
              </p>
            ) : null}
            {loadState.incompleteBase ? (
              <p role="alert">缺少 base 配置，当前拓扑不完整；已阻止类型化编辑与校验。</p>
            ) : null}
            {loadState.diagnostics.length > 0 ? (
              <section aria-label="编译诊断">
                <ul>
                  {loadState.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.code ?? ""}:${diagnostic.message}`}>
                      {diagnostic.severity ? `[${diagnostic.severity}] ` : null}
                      {diagnostic.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <IdentityMappingReview
              tasks={loadState.mappingTasks}
              onResolve={(taskId, input) => {
                void handleResolveMapping(taskId, input);
              }}
            />
            {canPublish ? (
              <button type="button" className="button primary" disabled={!canEditSemantic} onClick={() => void handleValidate()}>
                校验
              </button>
            ) : null}
          </>
        )}
      />
  );
}
