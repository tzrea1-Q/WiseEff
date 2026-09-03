import type pg from "pg";

import type { ProjectValueConflict } from "../values";
import { appendProjectValue } from "../values";

import {
  blocked,
  requireBinding,
  toProtectedReferenceDto,
  type ProtectedReferenceBlock,
  type ProtectedWritebackCommand,
  type ProtectedReferenceWritebackResult,
} from "./dto";

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const mapWriteConflict = (error: ProjectValueConflict): ProtectedReferenceBlock => {
  switch (error.kind) {
    case "cas-mismatch":
      return {
        kind: "typed-block",
        reason: "cas-conflict",
        bindingId: error.bindingId,
        expectedTip: error.expectedTip,
        actualTip: error.actualTip,
      };
    case "source-conflict":
      return {
        kind: "typed-block",
        reason: "source-conflict",
        bindingId: error.bindingId,
        sourceReason: error.reason,
        existingSourceRef: error.existingSourceRef,
        attemptedSourceRef: error.attemptedSourceRef,
      };
    case "agreement-conflict":
      if (error.reason === "binding-not-found" || error.reason === "binding-identity") {
        return { kind: "typed-block", reason: "missing-binding" };
      }
      return { kind: "typed-block", reason: "revision-disagreement" };
    case "owner-conflict":
      return { kind: "typed-block", reason: "missing-binding" };
    case "invalid-command":
      return { kind: "typed-block", reason: "invalid-command", field: error.reason };
    case "immutable-value":
      return { kind: "typed-block", reason: "invalid-command", field: "immutable-value" };
  }
};

export const writebackProtectedReference = async (
  pool: pg.Pool,
  command: ProtectedWritebackCommand,
): Promise<ProtectedReferenceWritebackResult> => {
  const binding = requireBinding(command);
  if (!binding.ok) {
    return binding;
  }
  if (!controlFree(command.expectedTip)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "expectedTip" });
  }
  if (!controlFree(command.source.sourceRef)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "sourceRef" });
  }
  if (!controlFree(command.source.configRevisionId)) {
    return blocked({ kind: "typed-block", reason: "invalid-command", field: "configRevisionId" });
  }

  const appended = await appendProjectValue(pool, {
    snapshot: command.snapshot,
    binding: binding.value,
    definitionRevisionId: command.definitionRevisionId,
    source: command.source,
    payload: command.payload,
    expectedTip: command.expectedTip,
  });
  if (!appended.ok) {
    return blocked(mapWriteConflict(appended.error));
  }

  const value = appended.value.value;
  if (
    value.bindingId !== binding.value.id ||
    value.definitionId !== binding.value.definitionId ||
    value.definitionRevisionId !== binding.value.effectiveRevisionId ||
    value.id !== appended.value.currentTip
  ) {
    return blocked({ kind: "typed-block", reason: "revision-disagreement" });
  }

  return {
    ok: true,
    value: {
      outcome: appended.value.outcome,
      pin: toProtectedReferenceDto(binding.value, value),
      value,
      currentTip: appended.value.currentTip,
    },
  };
};
