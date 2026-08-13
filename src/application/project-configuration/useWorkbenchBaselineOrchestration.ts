import { useCallback, useEffect, useState } from "react";

import type {
  DtsBaselineMemberComparison,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type { ReleaseBaselineSession } from "./releaseBaselineSession";
import type { WorkbenchWorkspaceLoadSession } from "./workbenchWorkspaceLoadSession";
import { queryValue } from "@/application/project-configuration/workbenchPath";
import {
  canvasModeQueryValue,
  type WorkbenchCanvasMode
} from "@/components/project-configuration-workbench/workbenchInspectorModel";
import { formatWorkbenchPath } from "@/components/project-configuration-workbench/workbenchShellHelpers";

export type UseWorkbenchBaselineOrchestrationParams = {
  projectId: string;
  search: string;
  onNavigate: (path: string) => void;
  canAdmin: boolean;
  dtsRepository: DtsStructuredRepository;
  releaseBaselineSession: ReleaseBaselineSession;
  workspaceLoadSession: WorkbenchWorkspaceLoadSession;
  selectedConfigSet: { id: string } | null;
  selectedMemberFileId: string | null;
  selectedBaselineId: string | null;
  baselines: Array<{ id: string; name: string }>;
  acknowledgedWarningIds: ReadonlySet<string>;
  canvasMode: WorkbenchCanvasMode;
  historyVersionId: string | null;
  candidateId: string | null;
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  sessionDraftsDirty: boolean;
  notifyMutation: (message: string) => void;
  setInspectorOpen: (open: boolean) => void;
  setTasksOpen: (open: boolean) => void;
};

export function useWorkbenchBaselineOrchestration(params: UseWorkbenchBaselineOrchestrationParams) {
  const {
    projectId,
    search,
    onNavigate,
    canAdmin,
    dtsRepository,
    releaseBaselineSession,
    workspaceLoadSession,
    selectedConfigSet,
    selectedMemberFileId,
    selectedBaselineId,
    baselines,
    acknowledgedWarningIds,
    canvasMode,
    historyVersionId,
    candidateId,
    selectedNodePath,
    selectedPropertyName,
    sessionDraftsDirty,
    notifyMutation,
    setInspectorOpen,
    setTasksOpen
  } = params;

  const [createBaselineOpen, setCreateBaselineOpen] = useState(false);
  const [newBaselineName, setNewBaselineName] = useState("");
  const [releaseBaselineOpen, setReleaseBaselineOpen] = useState(false);
  const [restoreBaselineOpen, setRestoreBaselineOpen] = useState(false);
  const [workingReturnPath, setWorkingReturnPath] = useState<string | null>(null);
  const [baselinesRetry, setBaselinesRetry] = useState(0);
  const [readinessRetry, setReadinessRetry] = useState(0);

  useEffect(() => {
    void releaseBaselineSession.loadBaselines(
      projectId,
      selectedConfigSet?.id ?? null,
      dtsRepository
    );
  }, [baselinesRetry, dtsRepository, projectId, releaseBaselineSession, selectedConfigSet]);

  useEffect(() => {
    void releaseBaselineSession.refreshReadiness(
      projectId,
      selectedConfigSet?.id ?? null,
      { canAdmin },
      dtsRepository
    );
  }, [
    acknowledgedWarningIds,
    canAdmin,
    dtsRepository,
    projectId,
    readinessRetry,
    releaseBaselineSession,
    selectedConfigSet
  ]);

  useEffect(() => {
    const requested = queryValue(search, "baseline");
    if (requested && baselines.some((item) => item.id === requested)) {
      releaseBaselineSession.selectBaseline(requested);
      return;
    }
    if (!requested) {
      if (selectedBaselineId && baselines.some((item) => item.id === selectedBaselineId)) {
        return;
      }
      releaseBaselineSession.selectBaseline(null);
    }
  }, [baselines, releaseBaselineSession, search, selectedBaselineId]);

  useEffect(() => {
    void releaseBaselineSession.loadPinnedMembers(projectId, dtsRepository);
  }, [dtsRepository, projectId, releaseBaselineSession, selectedBaselineId, selectedConfigSet]);

  const handleOpenCreateBaseline = useCallback(() => {
    releaseBaselineSession.clearActionError();
    setCreateBaselineOpen(true);
  }, [releaseBaselineSession]);

  const createWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet) return;
    try {
      const created = await releaseBaselineSession.create(
        projectId,
        selectedConfigSet.id,
        { name: newBaselineName, localSessionDirty: sessionDraftsDirty },
        dtsRepository
      );
      setNewBaselineName("");
      setCreateBaselineOpen(false);
      setReadinessRetry((value) => value + 1);
      setBaselinesRetry((value) => value + 1);
      notifyMutation(`已创建基线「${created.name}」。`);
    } catch {
      // ReleaseBaselineSession writes actionError for every failure path
      // (gates and repo throws); the create dialog stays open and renders it.
    }
  }, [
    canAdmin,
    dtsRepository,
    newBaselineName,
    notifyMutation,
    projectId,
    releaseBaselineSession,
    selectedConfigSet,
    sessionDraftsDirty
  ]);

  const selectWorkbenchBaseline = useCallback(
    (baselineId: string) => {
      if (!selectedConfigSet) return;
      releaseBaselineSession.selectBaseline(baselineId);
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(projectId, search, {
          configSet: selectedConfigSet.id,
          file: selectedMemberFileId ?? null,
          baseline: baselineId,
          sourceMode: canvasModeQueryValue(canvasMode),
          version: historyVersionId,
          candidate: candidateId
        })
      );
    },
    [
      candidateId,
      canvasMode,
      historyVersionId,
      onNavigate,
      projectId,
      releaseBaselineSession,
      search,
      selectedConfigSet,
      selectedMemberFileId,
      setInspectorOpen
    ]
  );

  const compareWorkbenchBaseline = useCallback(
    async (against: "working" | "released") => {
      if (!selectedConfigSet || !selectedBaselineId) return;
      releaseBaselineSession.clearActionError();
      setWorkingReturnPath(
        formatWorkbenchPath(projectId, search, {
          configSet: selectedConfigSet.id,
          file: selectedMemberFileId ?? null,
          node: selectedNodePath,
          property: selectedPropertyName,
          sourceMode: null,
          version: null,
          candidate: null,
          baseline: selectedBaselineId
        })
      );
      let result;
      try {
        result = await releaseBaselineSession.compare(projectId, against, dtsRepository);
      } catch {
        // Failure is projected through the session actionError in the baseline dock.
        return;
      }
      const firstDrift = result.members.find(
        (member) => member.status === "version_changed" && member.baselineVersionId
      );
      if (firstDrift?.baselineVersionId && firstDrift.fileId) {
        onNavigate(
          formatWorkbenchPath(projectId, search, {
            configSet: selectedConfigSet.id,
            file: firstDrift.fileId,
            sourceMode: "unified-diff",
            version: firstDrift.baselineVersionId,
            baseline: selectedBaselineId,
            node: null,
            property: null,
            candidate: null
          })
        );
      }
      notifyMutation(
        against === "released" ? "已对比基线与已发布 tip。" : "已对比基线与 Working 配置。"
      );
    },
    [
      dtsRepository,
      notifyMutation,
      onNavigate,
      projectId,
      releaseBaselineSession,
      search,
      selectedBaselineId,
      selectedConfigSet,
      selectedMemberFileId,
      selectedNodePath,
      selectedPropertyName
    ]
  );

  const exitBaselineCompare = useCallback(() => {
    releaseBaselineSession.clearCompare();
    if (workingReturnPath) {
      onNavigate(workingReturnPath);
      setWorkingReturnPath(null);
      return;
    }
    if (!selectedConfigSet) return;
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSet.id,
        file: selectedMemberFileId ?? null,
        sourceMode: null,
        version: null,
        baseline: selectedBaselineId,
        candidate: null
      })
    );
  }, [
    onNavigate,
    projectId,
    releaseBaselineSession,
    search,
    selectedBaselineId,
    selectedConfigSet,
    selectedMemberFileId,
    workingReturnPath
  ]);

  const selectBaselineCompareMember = useCallback(
    (member: DtsBaselineMemberComparison) => {
      if (!selectedConfigSet || !member.baselineVersionId) return;
      onNavigate(
        formatWorkbenchPath(projectId, search, {
          configSet: selectedConfigSet.id,
          file: member.fileId,
          sourceMode: canvasMode === "side-by-side" ? "side-by-side" : "unified-diff",
          version: member.baselineVersionId,
          baseline: selectedBaselineId,
          node: null,
          property: null,
          candidate: null
        })
      );
    },
    [canvasMode, onNavigate, projectId, search, selectedBaselineId, selectedConfigSet]
  );

  const releaseWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet || !selectedBaselineId) return;
    try {
      const result = await releaseBaselineSession.release(
        projectId,
        selectedConfigSet.id,
        { localSessionDirty: sessionDraftsDirty },
        dtsRepository
      );
      setReleaseBaselineOpen(false);
      setReadinessRetry((value) => value + 1);
      setBaselinesRetry((value) => value + 1);
      notifyMutation(`已发布基线「${result.item.name}」。`);
    } catch (error: unknown) {
      // Session actionError renders inside the still-open release dialog;
      // unacknowledged-warning failures additionally open the Issues dock.
      const message = error instanceof Error ? error.message : "";
      if (message.includes("确认策略允许的警告")) {
        setTasksOpen(true);
      }
    }
  }, [
    canAdmin,
    dtsRepository,
    notifyMutation,
    projectId,
    releaseBaselineSession,
    selectedBaselineId,
    selectedConfigSet,
    sessionDraftsDirty,
    setTasksOpen
  ]);

  const openRestoreWorkbenchBaseline = useCallback(async () => {
    if (!selectedBaselineId) return;
    releaseBaselineSession.clearActionError();
    try {
      await releaseBaselineSession.previewRestore(projectId, dtsRepository);
    } catch {
      // Preview failed: keep the dialog closed; actionError renders in the dock.
      return;
    }
    setRestoreBaselineOpen(true);
  }, [dtsRepository, projectId, releaseBaselineSession, selectedBaselineId]);

  const restoreWorkbenchBaseline = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet || !selectedBaselineId) return;
    releaseBaselineSession.clearActionError();
    let restored;
    try {
      restored = await releaseBaselineSession.restore(
        projectId,
        selectedConfigSet.id,
        dtsRepository
      );
    } catch {
      // Restore failed: the confirm dialog stays open and renders actionError.
      return;
    }
    const { result, tipUnchanged } = restored;
    setRestoreBaselineOpen(false);
    workspaceLoadSession.retryMembers();
    setBaselinesRetry((value) => value + 1);
    setReadinessRetry((value) => value + 1);
    workspaceLoadSession.retrySource();
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSet.id,
        file: selectedMemberFileId ?? null,
        sourceMode: null,
        version: null,
        baseline: selectedBaselineId,
        candidate: null
      })
    );
    notifyMutation(
      tipUnchanged
        ? `已恢复基线成员（${result.restored} 项）；已发布 tip 未变。`
        : `已恢复基线成员（${result.restored} 项）。`
    );
  }, [
    canAdmin,
    dtsRepository,
    notifyMutation,
    onNavigate,
    projectId,
    releaseBaselineSession,
    search,
    selectedBaselineId,
    selectedConfigSet,
    selectedMemberFileId,
    workspaceLoadSession
  ]);

  return {
    createBaselineOpen,
    setCreateBaselineOpen,
    newBaselineName,
    setNewBaselineName,
    releaseBaselineOpen,
    setReleaseBaselineOpen,
    restoreBaselineOpen,
    setRestoreBaselineOpen,
    baselinesRetry,
    setBaselinesRetry,
    readinessRetry,
    setReadinessRetry,
    handleOpenCreateBaseline,
    createWorkbenchBaseline,
    selectWorkbenchBaseline,
    compareWorkbenchBaseline,
    exitBaselineCompare,
    selectBaselineCompareMember,
    releaseWorkbenchBaseline,
    openRestoreWorkbenchBaseline,
    restoreWorkbenchBaseline
  };
}
