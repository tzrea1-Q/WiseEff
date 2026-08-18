import type { DomainGuardResult } from "../guardResult";
import type { SpecLifecycle } from "./types";

/** ADR-0032: PATCH must not rewrite semantic fields on a governed definition. */
export const SEMANTIC_EDIT_REQUIRES_SUCCESSOR = "semantic-edit-requires-successor";

export type SpecSemanticFields = {
  valueShape: unknown;
  constraints: unknown;
  units: string | null;
};

export type SpecSemanticPatch = {
  valueShape?: unknown;
  constraints?: unknown;
  units?: string | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

/** Structural JSON equality for semantic fields; omitted patch keys are not compared. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value ?? null));
}

export function semanticPatchFieldsChanged(stored: SpecSemanticFields, patch: SpecSemanticPatch): boolean {
  if (patch.valueShape !== undefined && stableJson(patch.valueShape) !== stableJson(stored.valueShape)) {
    return true;
  }
  if (
    patch.constraints !== undefined &&
    stableJson(patch.constraints ?? {}) !== stableJson(stored.constraints ?? {})
  ) {
    return true;
  }
  if (patch.units !== undefined && (patch.units ?? null) !== (stored.units ?? null)) {
    return true;
  }
  return false;
}

export function guardActivateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "draft" && lifecycle !== "active") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be activated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardSemanticFieldPatch(
  lifecycle: SpecLifecycle,
  specId: string,
  stored: SpecSemanticFields,
  patch: SpecSemanticPatch,
): DomainGuardResult {
  if (lifecycle !== "active" && lifecycle !== "deprecated") {
    return { ok: true };
  }
  if (!semanticPatchFieldsChanged(stored, patch)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "CONFLICT",
    message: "Semantic fields on an active or deprecated definition must change through activate → successor.",
    details: {
      specId,
      parameterSpecId: specId,
      code: SEMANTIC_EDIT_REQUIRES_SUCCESSOR,
      reason: SEMANTIC_EDIT_REQUIRES_SUCCESSOR
    }
  };
}

export function guardUpdateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle === "draft") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Draft specs must be activated, not updated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardDeprecateParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "draft" && lifecycle !== "active") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be deprecated.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function guardRestoreParameterSpec(lifecycle: SpecLifecycle, specId: string): DomainGuardResult {
  if (lifecycle !== "deprecated") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only deprecated parameter specs can be restored.",
      details: { specId }
    };
  }
  return { ok: true };
}

export function nextSpecLifecycleAfterRestore(activatedAt: string | null | undefined): SpecLifecycle {
  return activatedAt ? "active" : "draft";
}
