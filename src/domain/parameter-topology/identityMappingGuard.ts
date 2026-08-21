import type { DomainGuardResult } from "../guardResult";
import type {
  IdentityMappingTaskKind,
  IdentityMappingTaskStatus,
  ResolveMappingInput
} from "./types";

type IdentityMappingGuardInput = {
  taskId: string;
  status?: IdentityMappingTaskStatus;
  taskKind?: IdentityMappingTaskKind;
  decision?: ResolveMappingInput["decision"];
  selectedLogicalNodeId?: string;
  priorSelectedLogicalNodeId?: string | null;
  previousLogicalNodeId?: string | null;
  candidateLogicalNodeIds?: readonly string[];
};

function missingTask(taskId: string): DomainGuardResult {
  return {
    ok: false,
    code: "NOT_FOUND",
    message: "Identity mapping task was not found.",
    details: { taskId }
  };
}

export function guardResolveIdentityMapping(input: IdentityMappingGuardInput): DomainGuardResult {
  if (input.status === undefined) {
    return missingTask(input.taskId);
  }
  if (input.taskKind === "singleton-cardinality") {
    return {
      ok: false,
      code: "CONFLICT",
      message:
        "Singleton-per-project conflicts must be fixed in the registration or topology; identity decisions cannot discard instances.",
      details: { code: "singleton-cardinality-conflict", taskId: input.taskId }
    };
  }
  if (input.status === "open") {
    return { ok: true };
  }
  if (input.status === "resolved" && input.decision === "resolved") {
    if (
      input.priorSelectedLogicalNodeId &&
      input.priorSelectedLogicalNodeId === input.selectedLogicalNodeId
    ) {
      return { ok: true };
    }
    if (
      !input.priorSelectedLogicalNodeId ||
      !input.previousLogicalNodeId ||
      !input.selectedLogicalNodeId ||
      !input.candidateLogicalNodeIds?.includes(input.selectedLogicalNodeId)
    ) {
      return {
        ok: false,
        code: "CONFLICT",
        message:
          "Completed mapping lacks reversible continuity evidence; an explicit migration is required.",
        details: { code: "identity-mapping-migration-required", taskId: input.taskId }
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    code: "CONFLICT",
    message: "Identity mapping task is not open.",
    details: { taskId: input.taskId }
  };
}

export function guardReopenIdentityMapping(input: IdentityMappingGuardInput): DomainGuardResult {
  if (input.status === undefined) {
    return missingTask(input.taskId);
  }
  if (input.status === "resolved") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Resolved identity mapping tasks cannot be reopened.",
      details: { taskId: input.taskId }
    };
  }
  if (input.status === "open") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Identity mapping task is already open.",
      details: { taskId: input.taskId }
    };
  }
  return { ok: true };
}
