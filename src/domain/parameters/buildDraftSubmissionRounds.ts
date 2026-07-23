import type { ParameterDraftDto, ProjectSummary } from "@/application/ports/ParameterRepository";

import type { ParameterRecord, ParameterSubmissionItem, ParameterSubmissionRound } from "./types";

/**
 * Project API drafts into synthetic "已暂存" submission rounds for history UI.
 * Prefer draft-provided baseline/currentValue (write-lock base raw) over catalog tip lookup.
 */
export function buildDraftSubmissionRounds(
  drafts: ParameterDraftDto[] | undefined,
  parameters: ParameterRecord[],
  apiProjects: ProjectSummary[],
  submitter: string
): ParameterSubmissionRound[] {
  if (!drafts?.length) {
    return [];
  }

  const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const parameterByBindingId = new Map(
    parameters
      .filter((parameter) => parameter.projectParameterBindingId)
      .map((parameter) => [parameter.projectParameterBindingId!, parameter])
  );
  const projectById = new Map(apiProjects.map((project) => [project.id, project]));

  return drafts.map((draft) => {
    const bindingId = draft.projectParameterBindingId;
    const parameter =
      parameterById.get(draft.parameterId) ??
      (bindingId ? parameterByBindingId.get(bindingId) ?? parameterById.get(bindingId) : undefined);
    const project = projectById.get(draft.projectId);
    const item: ParameterSubmissionItem = {
      requestId: "",
      parameterId: draft.parameterId,
      name: draft.name ?? parameter?.name ?? draft.parameterId,
      // Prefer API draft module (binding business module) over catalog tip lookup.
      module: draft.module || parameter?.module || "",
      currentValue: draft.currentValue ?? parameter?.currentValue ?? "",
      targetValue: draft.targetValue,
      unit: parameter?.unit ?? "",
      risk: parameter?.risk ?? "Medium",
      valueKind: parameter?.valueKind ?? "scalar",
      reason: draft.reason,
      ...(bindingId ? { projectParameterBindingId: bindingId } : {})
    };

    return {
      id: `draft-${draft.id}`,
      projectId: draft.projectId,
      projectName: project?.name ?? draft.projectId,
      submitter,
      createdAt: draft.updatedAt,
      status: "已暂存",
      summary: "API draft contains 1 parameter change",
      items: [item]
    };
  });
}
