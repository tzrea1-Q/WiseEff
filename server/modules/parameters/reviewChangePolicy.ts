import { ApiError } from "../../shared/http/errors";

export type SemanticMergeSubject =
  | {
      kind: "binding";
      projectId: string;
      parameterId: string;
    }
  | {
      kind: "node-enablement";
      projectId: string;
      logicalNodeId: string;
    };

/**
 * Resolve the durable subject a semantic merge is allowed to write back.
 *
 * The database schema prevents project-less requests after cutover, but keeping
 * this policy in-process makes the writeback precondition explicit and testable
 * without manufacturing an invalid persisted request.
 */
export function resolveSemanticMergeSubject(input: {
  requestId: string;
  projectId?: string;
  editSubjectKind?: "binding" | "node-enablement";
  parameterId?: string;
  logicalNodeId?: string;
}): SemanticMergeSubject {
  if (!input.projectId) {
    throw new ApiError(
      "CONFLICT",
      "Semantic merge requires a project-scoped change request.",
      { requestId: input.requestId }
    );
  }

  const isEnablement = input.editSubjectKind === "node-enablement" || Boolean(input.logicalNodeId);
  if (isEnablement) {
    if (!input.logicalNodeId) {
      throw new ApiError(
        "CONFLICT",
        "Semantic enablement merge requires a logical node write lock.",
        { requestId: input.requestId }
      );
    }
    return {
      kind: "node-enablement",
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId
    };
  }

  if (!input.parameterId) {
    throw new ApiError(
      "CONFLICT",
      "Semantic merge requires a project parameter binding write lock.",
      { requestId: input.requestId }
    );
  }
  return {
    kind: "binding",
    projectId: input.projectId,
    parameterId: input.parameterId
  };
}
