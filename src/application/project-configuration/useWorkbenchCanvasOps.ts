import { useCallback, useState } from "react";

import type {
  ParameterFileRepository,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import type { WorkbenchCanvasHistorySession } from "./workbenchCanvasHistorySession";
import type { WorkbenchNavigationSession } from "./workbenchNavigationSession";
import {
  canvasModeQueryValue,
  type WorkbenchCanvasMode
} from "@/components/project-configuration-workbench/workbenchInspectorModel";
import {
  formatWorkbenchPath,
  triggerVersionDownload
} from "@/components/project-configuration-workbench/workbenchShellHelpers";

export type WorkbenchCanvasMember = {
  fileId: string;
  fileName: string;
  currentVersionId?: string;
};

export type UseWorkbenchCanvasOpsParams = {
  projectId: string;
  search: string;
  onNavigate: (path: string) => void;
  fileRepository: ParameterFileRepository;
  canvasHistorySession: WorkbenchCanvasHistorySession;
  navigationSession: WorkbenchNavigationSession;
  selectedConfigSet: { id: string } | null;
  selectedMember: WorkbenchCanvasMember | null;
  canvasMode: WorkbenchCanvasMode;
  historyVersionId: string | null;
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  lastVisibleLine: number | null;
  workingSnapshot: {
    fileId: string | null;
    nodePath: string | null;
    propertyName: string | null;
    scrollLine: number | null;
  } | null;
  fileVersions: ProjectParameterFileVersion[];
  setFocusLineOverride: (line: number | null) => void;
  setRestoredScrollLine: (line: number | null) => void;
};

export function useWorkbenchCanvasOps(params: UseWorkbenchCanvasOpsParams) {
  const {
    projectId,
    search,
    onNavigate,
    fileRepository,
    canvasHistorySession,
    navigationSession,
    selectedConfigSet,
    selectedMember,
    canvasMode,
    selectedNodePath,
    selectedPropertyName,
    lastVisibleLine,
    workingSnapshot,
    fileVersions,
    setFocusLineOverride,
    setRestoredScrollLine
  } = params;

  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadingDts, setDownloadingDts] = useState(false);

  const rememberWorkingSnapshot = useCallback(() => {
    canvasHistorySession.rememberWorkingSnapshot({
      fileId: selectedMember?.fileId ?? null,
      nodePath: selectedNodePath,
      propertyName: selectedPropertyName,
      scrollLine: lastVisibleLine,
      sourceMode: canvasModeQueryValue(canvasMode)
    });
  }, [
    canvasHistorySession,
    canvasMode,
    lastVisibleLine,
    selectedMember?.fileId,
    selectedNodePath,
    selectedPropertyName
  ]);

  const enterCanvasMode = useCallback(
    (mode: WorkbenchCanvasMode, versionId: string | null) => {
      if (!selectedConfigSet || !selectedMember) return;
      if (canvasMode === "working") {
        rememberWorkingSnapshot();
      }
      onNavigate(
        formatWorkbenchPath(projectId, search, {
          configSet: selectedConfigSet.id,
          file: selectedMember.fileId,
          node: selectedNodePath,
          property: selectedPropertyName,
          sourceMode: canvasModeQueryValue(mode),
          version: versionId,
          candidate: null
        })
      );
    },
    [
      canvasMode,
      onNavigate,
      projectId,
      rememberWorkingSnapshot,
      search,
      selectedConfigSet,
      selectedMember,
      selectedNodePath,
      selectedPropertyName
    ]
  );

  const exitSpecialCanvasMode = useCallback(() => {
    if (!selectedConfigSet) return;
    const snapshot = workingSnapshot;
    const restoreLine = snapshot?.scrollLine ?? lastVisibleLine;
    setRestoredScrollLine(restoreLine);
    if (restoreLine != null) setFocusLineOverride(restoreLine);
    navigationSession.beginSuppressScrollSync(300);
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSet.id,
        file: snapshot?.fileId ?? selectedMember?.fileId ?? null,
        node: snapshot?.nodePath ?? selectedNodePath,
        property: snapshot?.propertyName ?? selectedPropertyName,
        sourceMode: null,
        version: null,
        candidate: null
      })
    );
    window.setTimeout(() => {
      if (restoreLine != null) setFocusLineOverride(restoreLine);
      setRestoredScrollLine(null);
    }, 300);
  }, [
    lastVisibleLine,
    navigationSession,
    onNavigate,
    projectId,
    search,
    selectedConfigSet,
    selectedMember?.fileId,
    selectedNodePath,
    selectedPropertyName,
    setFocusLineOverride,
    setRestoredScrollLine,
    workingSnapshot
  ]);

  const handleDownloadVersion = useCallback(
    async (version: ProjectParameterFileVersion) => {
      if (!selectedMember) return;
      setDownloadMessage("");
      try {
        await triggerVersionDownload(
          fileRepository,
          projectId,
          selectedMember.fileId,
          version,
          selectedMember.fileName
        );
        setDownloadMessage(`已下载 ${selectedMember.fileName} 的版本 ${version.versionNumber}`);
      } catch (error: unknown) {
        setDownloadMessage(error instanceof Error ? error.message : "下载失败。");
      }
    },
    [fileRepository, projectId, selectedMember]
  );

  const downloadActiveDts = useCallback(async () => {
    if (!selectedMember?.currentVersionId || downloadingDts) return;
    const activeVersion =
      fileVersions.find((item) => item.id === selectedMember.currentVersionId) ??
      ({
        id: selectedMember.currentVersionId,
        fileId: selectedMember.fileId,
        versionNumber: 0,
        checksum: "",
        sizeBytes: 0,
        parsedIndex: {},
        origin: "upload",
        createdAt: ""
      } satisfies ProjectParameterFileVersion);
    setDownloadingDts(true);
    try {
      await handleDownloadVersion(activeVersion);
    } finally {
      setDownloadingDts(false);
    }
  }, [downloadingDts, fileVersions, handleDownloadVersion, selectedMember]);

  return {
    downloadMessage,
    downloadingDts,
    rememberWorkingSnapshot,
    enterCanvasMode,
    exitSpecialCanvasMode,
    handleDownloadVersion,
    downloadActiveDts
  };
}
