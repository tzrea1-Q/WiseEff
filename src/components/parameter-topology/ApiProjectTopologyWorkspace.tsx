import { useEffect, useMemo, useRef, useState } from "react";
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
  ProjectTopologyWorkspace,
  type TopologyLayoutMode
} from "./ProjectTopologyWorkspace";
import type { BindingEditValidation } from "./BindingDetailPanel";
import {
  BindingDraftSubmissionPanel,
  type PendingBindingDraft
} from "./BindingDraftSubmissionPanel";

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
  const [pendingDraft, setPendingDraft] = useState<PendingBindingDraft | null>(null);
  const [workflowCandidates, setWorkflowCandidates] = useState<WorkflowAssigneeCandidates | null>(null);
  const [workflowCandidatesError, setWorkflowCandidatesError] = useState<string | null>(null);

  useEffect(() => {
    setPreferredRevision(null);
    setPendingDraft(null);
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
    setPublishMessage(null);
    setMappingMessage(null);
  }, [projectId]);

  useEffect(() => {
    if (!pendingDraft) return undefined;
    if (!listWorkflowAssignees) {
      setWorkflowCandidates(null);
      setWorkflowCandidatesError("正式提交入口未配置项目角色候选人，已阻止提交。");
      return undefined;
    }
    let cancelled = false;
    setWorkflowCandidates(null);
    setWorkflowCandidatesError(null);
    listWorkflowAssignees(projectId)
      .then((candidates) => {
        if (!cancelled) setWorkflowCandidates(candidates);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setWorkflowCandidatesError(error instanceof Error ? error.message : "无法加载项目角色候选人。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listWorkflowAssignees, pendingDraft, projectId]);

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

    try {
      const draft = await repository.createBindingDraft(projectId, input.bindingId, {
        baseRevisionId: loadState.revisionId,
        targetValue,
        reason: input.reason
      });
      setPendingDraft({ ...draft, reason: input.reason });
      setPreferredRevision({ projectId, revisionId: draft.candidateRevisionId });
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
    }
  };

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
      <section className="project-topology-workspace" aria-label="项目拓扑工作区" aria-busy="true">
        <p role="status">正在加载项目拓扑与绑定…</p>
      </section>
    );
  }

  if (loadState.kind === "empty") {
    return (
      <section className="project-topology-workspace" aria-label="项目拓扑工作区">
        <div className="project-topology-workspace__empty" role="status">
          {loadState.message}
        </div>
      </section>
    );
  }

  if (loadState.kind === "error") {
    return (
      <section className="project-topology-workspace" aria-label="项目拓扑工作区">
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

  return (
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
      <ProjectTopologyWorkspace
        projectId={projectId}
        configSetId={loadState.configSetId}
        revisionId={loadState.revisionId}
        sourceNodes={loadState.sourceNodes}
        effectiveNodes={loadState.effectiveNodes}
        bindings={loadState.bindings}
        mappingTasks={loadState.mappingTasks}
        diagnostics={loadState.diagnostics}
        incompleteBase={loadState.incompleteBase}
        canEdit={canEdit && loadState.status !== "invalid"}
        canPublish={canPublish}
        publishActionLabel="校验"
        layoutMode={layoutMode}
        onValidateEdit={handleValidateEdit}
        onPublish={() => {
          void handleValidate();
        }}
        onResolveMapping={(taskId, input) => {
          void handleResolveMapping(taskId, input);
        }}
      />
      {pendingDraft ? (
        <BindingDraftSubmissionPanel
          key={pendingDraft.draftId}
          projectId={projectId}
          draft={pendingDraft}
          candidates={workflowCandidates}
          candidatesError={workflowCandidatesError}
          onSubmit={async (input) => {
            if (!submitBindingChanges) {
              return { notification: "正式 binding 提交入口未配置，已阻止提交。" };
            }
            return submitBindingChanges(input);
          }}
          onNavigate={onNavigate}
        />
      ) : null}
    </>
  );
}
