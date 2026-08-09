import type { AuditEventView } from "@/domain/audit/types";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { formatWorkbenchPath } from "@/application/project-configuration/workbenchPath";
import { resolveWorkbenchActivityTarget } from "@/components/project-configuration-workbench/workbenchActivityModel";
import type { InspectorLevel } from "@/components/project-configuration-workbench/workbenchInspectorModel";
import type { WorkbenchActivitySession } from "./workbenchActivitySession";
import type { ConflictLocateFacade } from "./conflictLocateFacade";
import type { ReleaseBaselineSession } from "./releaseBaselineSession";
import type { WorkbenchNavigationSession } from "./workbenchNavigationSession";

export type WorkbenchActivityNavigationCatalog = {
  configSetIds: Set<string>;
  fileIds: Set<string>;
  candidateIds: Set<string>;
  baselineIds: Set<string>;
  knownNodePathsByFileId: Map<string, Set<string>>;
};

export type NavigateWorkbenchActivityEventParams = {
  event: AuditEventView;
  catalog: WorkbenchActivityNavigationCatalog;
  projectId: string;
  search: string;
  selectedConfigSetId: string;
  selectedMemberFileId: string | null;
  onNavigate: (path: string) => void;
  activitySession: Pick<WorkbenchActivitySession, "setMissingNotice">;
  releaseBaselineSession: Pick<ReleaseBaselineSession, "selectBaseline">;
  navigationSession: Pick<WorkbenchNavigationSession, "setStructureSelection">;
  conflictLocateFacade: Pick<
    ConflictLocateFacade,
    "openArbitration"
  >;
  fileRepository: ParameterFileRepository;
  selectStructureTarget: (
    fileId: string,
    nodePath: string | null,
    propertyName: string | null
  ) => void;
  setInspectorLevelOverride: (level: InspectorLevel | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setTasksOpen: (open: boolean) => void;
};

export function navigateWorkbenchActivityEvent(params: NavigateWorkbenchActivityEventParams): void {
  const {
    event,
    catalog,
    projectId,
    search,
    selectedConfigSetId,
    selectedMemberFileId,
    onNavigate,
    activitySession,
    releaseBaselineSession,
    navigationSession,
    conflictLocateFacade,
    fileRepository,
    selectStructureTarget,
    setInspectorLevelOverride,
    setInspectorOpen,
    setTasksOpen
  } = params;

  const resolved = resolveWorkbenchActivityTarget(event, catalog);
  if (resolved.missing) {
    activitySession.setMissingNotice(resolved.missingReason ?? "该活动目标已不可用。");
    return;
  }
  activitySession.setMissingNotice("");
  setInspectorLevelOverride(null);
  setInspectorOpen(true);

  if (resolved.kind === "config-set" && resolved.configSetId) {
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: resolved.configSetId,
        file: null,
        node: null,
        property: null,
        sourceMode: null,
        version: null,
        candidate: null,
        inspector: null
      })
    );
    setInspectorLevelOverride("config-set");
    return;
  }

  if (resolved.kind === "candidate" && resolved.candidateId) {
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSetId,
        file: resolved.fileId ?? selectedMemberFileId ?? null,
        node: null,
        property: null,
        sourceMode: "candidate",
        version: null,
        candidate: resolved.candidateId,
        inspector: null
      })
    );
    return;
  }

  if (resolved.kind === "baseline") {
    if (resolved.missing) {
      activitySession.setMissingNotice(
        resolved.missingReason ?? "发布基线已不存在；事件仍可作为只读证据。"
      );
      return;
    }
    if (resolved.baselineId) {
      activitySession.setMissingNotice("");
      releaseBaselineSession.selectBaseline(resolved.baselineId);
      setInspectorOpen(true);
      onNavigate(
        formatWorkbenchPath(projectId, search, {
          configSet: selectedConfigSetId,
          file: selectedMemberFileId ?? null,
          baseline: resolved.baselineId,
          inspector: null
        })
      );
    }
    return;
  }

  if (resolved.kind === "conflict") {
    setTasksOpen(true);
    activitySession.setMissingNotice("");
    void conflictLocateFacade.openArbitration(projectId, fileRepository, {
      fileId: resolved.fileId,
      nodePath: resolved.nodePath ?? null,
      propertyName: resolved.propertyName ?? null
    });
    if (resolved.fileId) {
      selectStructureTarget(
        resolved.fileId,
        resolved.nodePath ?? null,
        resolved.propertyName ?? null
      );
    }
    return;
  }

  if (resolved.fileId) {
    navigationSession.setStructureSelection(
      resolved.nodePath ?? null,
      resolved.propertyName ?? null
    );
    onNavigate(
      formatWorkbenchPath(projectId, search, {
        configSet: selectedConfigSetId,
        file: resolved.fileId,
        node: resolved.nodePath ?? null,
        property: resolved.propertyName ?? null,
        sourceMode: null,
        version: null,
        candidate: null,
        inspector: null
      })
    );
  }
}

export function buildWorkbenchActivityCatalog(input: {
  configSetIds: string[];
  fileIds: string[];
  candidateIds: string[];
  baselineIds: string[];
  selectedMemberFileId: string | null;
  structureNodePaths: string[];
}): WorkbenchActivityNavigationCatalog {
  return {
    configSetIds: new Set(input.configSetIds),
    fileIds: new Set(input.fileIds),
    candidateIds: new Set(input.candidateIds),
    baselineIds: new Set(input.baselineIds),
    knownNodePathsByFileId: new Map([
      [input.selectedMemberFileId ?? "", new Set(input.structureNodePaths)]
    ])
  };
}
