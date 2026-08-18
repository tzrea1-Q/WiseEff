import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { formatWorkbenchPath } from "@/application/project-configuration/workbenchPath";

export type PropertyKeyCutoverWorkbenchHrefInput = {
  projectId: string | null;
  configSetId?: string | null;
  candidateId: string;
  fileId?: string | null;
  nodePath?: string | null;
};

const MERGEABLE_CANDIDATE_STATUSES = new Set(["ready", "uploading", "parsing"]);

export function formatPropertyKeyCutoverWorkbenchHref(
  input: PropertyKeyCutoverWorkbenchHrefInput,
): string | null {
  const projectId = input.projectId?.trim() ?? "";
  const configSetId = input.configSetId?.trim() ?? "";
  const candidateId = input.candidateId.trim();
  if (!projectId || !configSetId || !candidateId) return null;
  return formatWorkbenchPath(projectId, "", {
    configSet: configSetId,
    file: input.fileId?.trim() || null,
    node: input.nodePath?.trim() || null,
    sourceMode: "candidate",
    candidate: candidateId,
    inspector: "file",
  });
}

export function propertyKeyCutoverHandoffIsOpenable(status: string): boolean {
  return status !== "missing";
}

export function propertyKeyCutoverHandoffLinkLabel(fileName: string | null, status = "ready"): string {
  const name = fileName?.trim();
  if (MERGEABLE_CANDIDATE_STATUSES.has(status)) {
    return name
      ? `在配置工作台审阅并合入 ${name}`
      : PARAMETER_ADMIN_UI.propertyKeyCutoverHandoffUnnamedLink;
  }
  return name
    ? `在配置工作台查看 ${name}`
    : PARAMETER_ADMIN_UI.propertyKeyCutoverHandoffUnnamedViewLink;
}

export function presentFileCandidateHandoffStatus(status: string): string {
  switch (status) {
    case "ready":
    case "uploading":
    case "parsing":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateStaged;
    case "active":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateActivated;
    case "abandoned":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateAbandoned;
    case "stale":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateStale;
    case "blocked":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateBlocked;
    case "failed":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateFailed;
    case "missing":
      return PARAMETER_ADMIN_UI.propertyKeyCutoverCandidateMissing;
    default:
      return PARAMETER_ADMIN_UI.propertyKeyCutoverUnknownStatus;
  }
}
