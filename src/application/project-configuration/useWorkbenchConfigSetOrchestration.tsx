import { useCallback, useEffect, useState } from "react";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileRepository,
  ProjectParameterFile
} from "@/application/ports/ParameterFileRepository";
import type { ConfigSetOpsSession } from "./configSetOpsSession";
import type { ConflictLocateFacade } from "./conflictLocateFacade";
import type { WorkbenchNavigationSession } from "./workbenchNavigationSession";
import type { WorkbenchWorkspaceLoadSession } from "./workbenchWorkspaceLoadSession";
import {
  canvasModeQueryValue,
  type WorkbenchCanvasMode
} from "@/components/project-configuration-workbench/workbenchInspectorModel";
import {
  ROLE_LABELS,
  defaultRoleForFile,
  downloadExportBundle,
  formatWorkbenchPath,
  type PendingConfirmation
} from "@/components/project-configuration-workbench/workbenchShellHelpers";

export type WorkbenchConfigSetMember = DtsConfigSetMemberFile & {
  fileName: string;
  format?: string;
  currentVersionId?: string;
  currentVersionNumber?: number;
};

export type UseWorkbenchConfigSetOrchestrationParams = {
  projectId: string;
  search: string;
  onNavigate: (path: string) => void;
  canAdmin: boolean;
  dtsRepository: DtsStructuredRepository;
  fileRepository: ParameterFileRepository;
  configSetOpsSession: ConfigSetOpsSession;
  workspaceLoadSession: WorkbenchWorkspaceLoadSession;
  navigationSession: WorkbenchNavigationSession;
  conflictLocateFacade: ConflictLocateFacade;
  configSets: DtsConfigSet[];
  members: DtsConfigSetMemberFile[];
  projectFiles: ProjectParameterFile[];
  selectedConfigSet: { id: string; name: string } | null;
  selectedMember: WorkbenchConfigSetMember | null;
  selectedMembers: WorkbenchConfigSetMember[];
  ungroupedFiles: ProjectParameterFile[];
  canvasMode: WorkbenchCanvasMode;
  historyVersionId: string | null;
  runAction: (key: string, action: () => Promise<void>) => Promise<void>;
  setInspectorLevelOverride: (level: "config-set" | "file" | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setTasksOpen: (open: boolean) => void;
  setConfirmation: (value: PendingConfirmation | null) => void;
};

export function useWorkbenchConfigSetOrchestration(params: UseWorkbenchConfigSetOrchestrationParams) {
  const {
    projectId,
    search,
    onNavigate,
    canAdmin,
    dtsRepository,
    fileRepository,
    configSetOpsSession,
    workspaceLoadSession,
    navigationSession,
    conflictLocateFacade,
    configSets,
    members,
    projectFiles,
    selectedConfigSet,
    selectedMember,
    selectedMembers,
    ungroupedFiles,
    canvasMode,
    historyVersionId,
    runAction,
    setInspectorLevelOverride,
    setInspectorOpen,
    setTasksOpen,
    setConfirmation
  } = params;

  const [memberFileId, setMemberFileId] = useState("");
  const [memberRole, setMemberRole] = useState<ConfigSetRole>("base");
  const [memberSortOrder, setMemberSortOrder] = useState(0);
  const [syncEvidence, setSyncEvidence] = useState("");
  const [exportEvidence, setExportEvidence] = useState("");

  useEffect(() => {
    const available = ungroupedFiles[0]?.id ?? "";
    setMemberFileId((current) =>
      current && ungroupedFiles.some((item) => item.id === current) ? current : available
    );
  }, [ungroupedFiles]);

  useEffect(() => {
    setMemberSortOrder(selectedMembers.length);
  }, [selectedMembers.length]);

  const handleCreateConfigSet = useCallback(
    async (name: string): Promise<string | null | undefined> => {
      if (!canAdmin) return undefined;
      const result = await configSetOpsSession.create(
        projectId,
        { name, existingNames: configSets.map((item) => item.name) },
        dtsRepository
      );
      if (!result.ok) {
        return result.kind === "validation" ? result.message : undefined;
      }
      workspaceLoadSession.setConfigSets([
        result.item,
        ...configSets.filter((item) => item.id !== result.item.id)
      ]);
      workspaceLoadSession.setMembers([], result.item.id);
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(projectId, search, {
          configSet: result.item.id,
          file: null,
          node: null,
          property: null,
          sourceMode: null,
          version: null,
          candidate: null
        })
      );
      return null;
    },
    [
      canAdmin,
      configSetOpsSession,
      configSets,
      dtsRepository,
      onNavigate,
      projectId,
      search,
      setInspectorLevelOverride,
      setInspectorOpen,
      workspaceLoadSession
    ]
  );

  const submitCreateConfigSet = useCallback(
    async (name: string): Promise<string | null | undefined> => {
      let result: string | null | undefined = undefined;
      await runAction("create-config-set", async () => {
        result = await handleCreateConfigSet(name);
      });
      return result;
    },
    [handleCreateConfigSet, runAction]
  );

  const addMemberToConfigSet = useCallback(
    async (fileId: string, role: ConfigSetRole, sortOrder: number) => {
      if (!canAdmin || !selectedConfigSet) return;
      const file = projectFiles.find((item) => item.id === fileId);
      const result = await configSetOpsSession.addMember(
        projectId,
        selectedConfigSet.id,
        { fileId, role, sortOrder, file },
        dtsRepository
      );
      if (!result.ok) return;
      workspaceLoadSession.setMembers([
        ...members.filter((item) => item.fileId !== result.membership.fileId),
        {
          ...result.membership,
          fileName: result.fileName,
          format: result.format,
          currentVersionId: result.currentVersionId,
          currentVersionNumber: result.currentVersionNumber
        }
      ]);
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      workspaceLoadSession.retryMembers();
    },
    [
      canAdmin,
      configSetOpsSession,
      dtsRepository,
      members,
      projectId,
      projectFiles,
      selectedConfigSet,
      setInspectorLevelOverride,
      setInspectorOpen,
      workspaceLoadSession
    ]
  );

  const assignUngroupedFile = useCallback(
    async (file: ProjectParameterFile) => {
      const role = defaultRoleForFile(file, selectedMembers.length > 0);
      await addMemberToConfigSet(file.id, role, selectedMembers.length);
    },
    [addMemberToConfigSet, selectedMembers.length]
  );

  const removeMemberFromConfigSet = useCallback(
    async (fileId: string) => {
      if (!canAdmin || !selectedConfigSet) return;
      const result = await configSetOpsSession.removeMember(
        projectId,
        selectedConfigSet.id,
        fileId,
        dtsRepository
      );
      if (!result.ok) return;
      workspaceLoadSession.setMembers(members.filter((item) => item.fileId !== fileId));
      if (selectedMember?.fileId === fileId) {
        onNavigate(
          formatWorkbenchPath(projectId, search, {
            configSet: selectedConfigSet.id,
            file: null,
            node: null,
            property: null,
            sourceMode: null,
            version: null
          })
        );
      }
      workspaceLoadSession.retryMembers();
    },
    [
      canAdmin,
      configSetOpsSession,
      dtsRepository,
      members,
      onNavigate,
      projectId,
      search,
      selectedConfigSet,
      selectedMember?.fileId,
      workspaceLoadSession
    ]
  );

  const requestRemoveMember = useCallback(
    (member: DtsConfigSetMemberFile) => {
      if (!canAdmin || !selectedConfigSet) return;
      setConfirmation({
        key: `remove-member-${member.fileId}`,
        title: "移除配置集成员",
        description: (
          <p>
            将把 <code>{member.fileName}</code>（角色：
            {ROLE_LABELS[member.role] ?? member.role}）从配置集「{selectedConfigSet.name}」中移除。该文件本身不会被删除，但基于此配置集的后续基线与导出将不再包含它。
          </p>
        ),
        confirmLabel: "确认移除",
        pendingLabel: "移除中…",
        tone: "danger",
        run: () => removeMemberFromConfigSet(member.fileId)
      });
    },
    [canAdmin, removeMemberFromConfigSet, selectedConfigSet, setConfirmation]
  );

  const syncSelectedFile = useCallback(async () => {
    if (!canAdmin || !selectedMember) return;
    const result = await configSetOpsSession.syncFile(
      projectId,
      { fileId: selectedMember.fileId, fileName: selectedMember.fileName },
      fileRepository
    );
    if (!result.ok) return;
    setSyncEvidence(result.evidence);
    setTasksOpen(true);
    workspaceLoadSession.setProjectFiles(result.files);
    conflictLocateFacade.setOpenConflicts(result.conflicts);
    workspaceLoadSession.retryMembers();
    workspaceLoadSession.retryFiles();
  }, [
    canAdmin,
    configSetOpsSession,
    conflictLocateFacade,
    fileRepository,
    projectId,
    selectedMember,
    setTasksOpen,
    workspaceLoadSession
  ]);

  const exportSelectedConfigSet = useCallback(async () => {
    if (!canAdmin || !selectedConfigSet) return;
    const result = await configSetOpsSession.exportConfigSet(
      projectId,
      selectedConfigSet.id,
      selectedConfigSet.name,
      dtsRepository
    );
    if (!result.ok) return;
    downloadExportBundle(selectedConfigSet.name, result.export);
    setExportEvidence(result.evidence);
    setTasksOpen(true);
  }, [canAdmin, configSetOpsSession, dtsRepository, projectId, selectedConfigSet, setTasksOpen]);

  const selectConfigSet = useCallback(
    (configSetId: string) => {
      setInspectorLevelOverride("config-set");
      setInspectorOpen(true);
      onNavigate(navigationSession.selectConfigSet(projectId, search, configSetId));
    },
    [navigationSession, onNavigate, projectId, search, setInspectorLevelOverride, setInspectorOpen]
  );

  const selectMember = useCallback(
    (fileId: string) => {
      if (!selectedConfigSet) return;
      setInspectorLevelOverride("file");
      onNavigate(
        navigationSession.selectMember(projectId, search, {
          configSetId: selectedConfigSet.id,
          fileId,
          currentFileId: selectedMember?.fileId ?? null,
          sourceMode: canvasModeQueryValue(canvasMode),
          versionId: historyVersionId,
          workingMode: canvasMode === "working"
        })
      );
    },
    [
      canvasMode,
      historyVersionId,
      navigationSession,
      onNavigate,
      projectId,
      search,
      selectedConfigSet,
      selectedMember?.fileId,
      setInspectorLevelOverride
    ]
  );

  return {
    memberFileId,
    memberRole,
    memberSortOrder,
    syncEvidence,
    exportEvidence,
    setMemberFileId,
    setMemberRole,
    setMemberSortOrder,
    submitCreateConfigSet,
    addMemberToConfigSet,
    assignUngroupedFile,
    requestRemoveMember,
    syncSelectedFile,
    exportSelectedConfigSet,
    selectConfigSet,
    selectMember
  };
}
