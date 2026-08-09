import { useCallback, useState } from "react";

import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { CandidateVersionFlow } from "./candidateVersionFlow";
import type { WorkbenchWorkspaceLoadSession } from "./workbenchWorkspaceLoadSession";
import { formatWorkbenchPath } from "@/components/project-configuration-workbench/workbenchShellHelpers";

export type UseWorkbenchCandidateOrchestrationParams = {
  projectId: string;
  search: string;
  onNavigate: (path: string) => void;
  fileRepository: ParameterFileRepository;
  candidateFlow: CandidateVersionFlow;
  workspaceLoadSession: WorkbenchWorkspaceLoadSession;
  selectedConfigSet: { id: string } | null;
  selectedMemberFileId: string | null;
  activeCandidate: { id: string; status: string } | null;
  activatingCandidate: boolean;
  notifyMutation: (message: string) => void;
  setInspectorOpen: (open: boolean) => void;
  setBaselinesRetry: (value: number | ((prev: number) => number)) => void;
};

export function useWorkbenchCandidateOrchestration(params: UseWorkbenchCandidateOrchestrationParams) {
  const {
    projectId,
    search,
    onNavigate,
    fileRepository,
    candidateFlow,
    workspaceLoadSession,
    selectedConfigSet,
    selectedMemberFileId,
    activeCandidate,
    activatingCandidate,
    notifyMutation,
    setInspectorOpen,
    setBaselinesRetry
  } = params;

  const [activateConfirmOpen, setActivateConfirmOpen] = useState(false);

  const handleCandidateFileChange = useCallback(
    (file: File) => {
      if (!selectedConfigSet) return;
      void (async () => {
        try {
          const created = await candidateFlow.create(
            projectId,
            { file, fileId: selectedMemberFileId ?? undefined },
            fileRepository
          );
          setInspectorOpen(true);
          onNavigate(
            formatWorkbenchPath(projectId, search, {
              configSet: selectedConfigSet.id,
              file: selectedMemberFileId ?? null,
              sourceMode: "candidate",
              candidate: created.id,
              version: null,
              node: null,
              property: null
            })
          );
          notifyMutation(
            created.status === "failed"
              ? "候选解析失败，活跃源码未改动；可查看诊断后放弃。"
              : "候选已创建，工作配置与活跃版本未改动。"
          );
        } catch {
          // candidateFlow.error already set
        }
      })();
    },
    [
      candidateFlow,
      fileRepository,
      notifyMutation,
      onNavigate,
      projectId,
      search,
      selectedConfigSet,
      selectedMemberFileId,
      setInspectorOpen
    ]
  );

  const handleRecomputeCandidate = useCallback(() => {
    void (async () => {
      try {
        const updated = await candidateFlow.recompute(projectId, fileRepository);
        notifyMutation(
          updated.status === "ready"
            ? "已按当前基重算候选影响，可再次审查后激活。"
            : "已按当前阻断条件重算候选影响。"
        );
      } catch {
        // candidateFlow.error already set
      }
    })();
  }, [candidateFlow, fileRepository, notifyMutation, projectId]);

  const handleOpenActivateCandidate = useCallback(() => {
    candidateFlow.setActivateRole("overlay");
    setActivateConfirmOpen(true);
  }, [candidateFlow]);

  const handleAbandonCandidate = useCallback(() => {
    void (async () => {
      try {
        await candidateFlow.abandon(projectId, fileRepository);
        notifyMutation("候选已放弃；工作配置与配置集成员未改动。");
        if (selectedConfigSet) {
          onNavigate(
            formatWorkbenchPath(projectId, search, {
              configSet: selectedConfigSet.id,
              file: selectedMemberFileId ?? null,
              sourceMode: null,
              candidate: null,
              version: null
            })
          );
        }
      } catch {
        // candidateFlow.error already set
      }
    })();
  }, [
    candidateFlow,
    fileRepository,
    notifyMutation,
    onNavigate,
    projectId,
    search,
    selectedConfigSet,
    selectedMemberFileId
  ]);

  const handleConfirmActivateCandidate = useCallback(() => {
    if (!activeCandidate || activeCandidate.status !== "ready") return;
    void (async () => {
      try {
        const result = await candidateFlow.activate(
          projectId,
          { configSetId: selectedConfigSet?.id },
          fileRepository
        );
        notifyMutation("候选已激活；工作源码、成员与历史已刷新。");
        setActivateConfirmOpen(false);
        workspaceLoadSession.retryFiles();
        workspaceLoadSession.retryMembers();
        workspaceLoadSession.retrySource();
        setBaselinesRetry((value) => value + 1);
        if (selectedConfigSet) {
          onNavigate(
            formatWorkbenchPath(projectId, search, {
              configSet: selectedConfigSet.id,
              file: result.file.id,
              sourceMode: null,
              candidate: null,
              version: null
            })
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "激活候选失败。";
        if (/stale/i.test(message)) {
          setActivateConfirmOpen(false);
          notifyMutation("基版本已变更，候选已标为过期；请重算影响后再激活。");
        }
      }
    })();
  }, [
    activeCandidate,
    candidateFlow,
    fileRepository,
    notifyMutation,
    onNavigate,
    projectId,
    search,
    selectedConfigSet,
    setBaselinesRetry,
    workspaceLoadSession
  ]);

  const handleCancelActivateCandidate = useCallback(() => {
    if (!activatingCandidate) {
      setActivateConfirmOpen(false);
    }
  }, [activatingCandidate]);

  return {
    activateConfirmOpen,
    handleCandidateFileChange,
    handleRecomputeCandidate,
    handleOpenActivateCandidate,
    handleAbandonCandidate,
    handleConfirmActivateCandidate,
    handleCancelActivateCandidate
  };
}
