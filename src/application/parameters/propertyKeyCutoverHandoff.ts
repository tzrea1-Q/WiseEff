import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

export type PropertyKeyCutoverWorkbenchHrefInput = {
  projectId: string | null;
  candidateId: string;
  fileId?: string | null;
  nodePath?: string | null;
};

export function formatPropertyKeyCutoverWorkbenchHref(
  input: PropertyKeyCutoverWorkbenchHrefInput,
): string | null {
  const projectId = input.projectId?.trim() ?? "";
  const candidateId = input.candidateId.trim();
  if (!projectId || !candidateId) return null;
  const params = new URLSearchParams();
  params.set("sourceMode", "candidate");
  params.set("candidate", candidateId);
  params.set("inspector", "file");
  if (input.fileId?.trim()) params.set("file", input.fileId.trim());
  if (input.nodePath?.trim()) params.set("node", input.nodePath.trim());
  return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration?${params.toString()}`;
}

export function propertyKeyCutoverHandoffLinkLabel(fileName: string | null): string {
  const name = fileName?.trim();
  return name
    ? `在配置工作台审阅并合入 ${name}`
    : PARAMETER_ADMIN_UI.propertyKeyCutoverHandoffUnnamedLink;
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
