import type pg from "pg";

import type { Binding } from "../binding";
import type { ProjectValue, ProjectValueConflict } from "../values";
import { readProjectValueHistory } from "../values";

import {
  blocked,
  requireBinding,
  toProtectedReferenceDto,
  type ProtectedReadCommand,
  type ProtectedReferenceBlock,
  type ProtectedReferenceReadResult,
} from "./dto";

const mapHistoryConflict = (error: ProjectValueConflict): ProtectedReferenceBlock => {
  switch (error.kind) {
    case "agreement-conflict":
      if (error.reason === "binding-not-found" || error.reason === "binding-identity") {
        return { kind: "typed-block", reason: "missing-binding" };
      }
      return { kind: "typed-block", reason: "revision-disagreement" };
    case "owner-conflict":
      return { kind: "typed-block", reason: "missing-binding" };
    case "invalid-command":
      return { kind: "typed-block", reason: "invalid-command", field: error.reason };
    default:
      return { kind: "typed-block", reason: "missing-current-value" };
  }
};

const currentValueFromHistory = (
  history: readonly ProjectValue[],
  currentValueId: string,
): ProjectValue | null => history.find((value) => value.id === currentValueId) ?? null;

export const readProtectedReference = async (
  pool: Pick<pg.Pool, "query">,
  command: ProtectedReadCommand,
): Promise<ProtectedReferenceReadResult> => {
  const binding = requireBinding(command);
  if (!binding.ok) {
    return binding;
  }

  const history = await readProjectValueHistory(pool, {
    binding: binding.value,
    definitionRevisionId: command.definitionRevisionId,
  });
  if (!history.ok) {
    return blocked(mapHistoryConflict(history.error));
  }

  return toExactReference(binding.value, currentValueFromHistory(history.value, binding.value.currentValueId));
};

export const readListedProtectedReference = (
  command: ProtectedReadCommand,
  currentValues: ReadonlyMap<string, ProjectValue>,
): ProtectedReferenceReadResult => {
  const binding = requireBinding(command);
  if (!binding.ok) return binding;
  const current = currentValues.get(binding.value.currentValueId);
  // Match the binding and revision filters used by the history reader.
  return toExactReference(binding.value, current?.bindingId === binding.value.id &&
    current.definitionRevisionId === command.definitionRevisionId ? current : undefined);
};

const toExactReference = (binding: Binding, current: ProjectValue | null | undefined): ProtectedReferenceReadResult => {
  if (!current) {
    return blocked({ kind: "typed-block", reason: "missing-current-value" });
  }
  if (current.bindingId !== binding.id || current.definitionId !== binding.definitionId) {
    return blocked({ kind: "typed-block", reason: "missing-binding" });
  }
  if (current.definitionRevisionId !== binding.effectiveRevisionId) {
    return blocked({ kind: "typed-block", reason: "revision-disagreement" });
  }
  if (current.valueState === "deleted") {
    return blocked({ kind: "typed-block", reason: "missing-current-value" });
  }

  return { ok: true, value: toProtectedReferenceDto(binding, current) };
};
