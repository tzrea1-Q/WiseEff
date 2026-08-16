import type { DomainGuardResult } from "../guardResult";
import type { IdentityMappingTaskStatus } from "./types";

type IdentityMappingGuardInput = {
  taskId: string;
  status?: IdentityMappingTaskStatus;
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
  if (input.status !== "open") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Identity mapping task is not open.",
      details: { taskId: input.taskId }
    };
  }
  return { ok: true };
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
