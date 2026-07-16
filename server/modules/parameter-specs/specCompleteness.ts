import { ApiError } from "../../shared/http/errors";
import type { ParameterSpecDetailRow } from "./repository";

export type StoredValueShape = Record<string, unknown> & { kind?: string };

export const DRAFT_PROVENANCE_KEY = "_draftProvenance";

export function isUnsupportedShape(valueShape: unknown): boolean {
  const kind = shapeKind(valueShape);
  return kind === "unknown" || kind === "mixed";
}

export function shapeKind(valueShape: unknown): string | null {
  if (!valueShape || typeof valueShape !== "object" || Array.isArray(valueShape)) return null;
  const kind = (valueShape as StoredValueShape).kind;
  return typeof kind === "string" ? kind : null;
}

export function hasCompleteConstraints(valueShape: unknown, constraints: Record<string, unknown> | null): boolean {
  const kind = shapeKind(valueShape);
  const rules = constraints ?? {};
  if (isUnsupportedShape(valueShape)) return false;

  switch (kind) {
    case "bool":
    case "empty":
    case "string":
      return true;
    case "string-list":
      return typeof rules.minItems === "number" || typeof rules.maxItems === "number" || Object.keys(rules).length === 0;
    case "bytes":
      return typeof rules.minLength === "number" || typeof rules.length === "number";
    case "cells":
    case "u32-array":
    case "phandle-list":
      return typeof rules.cells === "number" && Number.isFinite(rules.cells);
    default:
      return false;
  }
}

export function hasActivationDocumentation(documentation: string | null): boolean {
  return Boolean(documentation?.trim());
}

export function assertSpecActivatable(input: {
  valueShape: unknown;
  constraints: Record<string, unknown> | null;
  documentation: string | null;
  parameterSpecId: string;
}): void {
  if (isUnsupportedShape(input.valueShape)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Unsupported draft value shapes cannot be activated.",
      400,
      { parameterSpecId: input.parameterSpecId, valueShapeKind: shapeKind(input.valueShape) },
    );
  }
  if (!hasCompleteConstraints(input.valueShape, input.constraints)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter spec constraints are incomplete for activation.",
      400,
      { parameterSpecId: input.parameterSpecId, valueShapeKind: shapeKind(input.valueShape) },
    );
  }
  if (!hasActivationDocumentation(input.documentation)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter spec documentation is required before activation.",
      400,
      { parameterSpecId: input.parameterSpecId },
    );
  }
}

export function assertSpecResolvable(
  spec: Pick<
    ParameterSpecDetailRow,
    "id" | "lifecycle" | "valueShape" | "constraints" | "documentation" | "currentVersionId"
  >,
): void {
  if (!spec.currentVersionId) {
    throw new ApiError("VALIDATION_FAILED", "Parameter spec has no current version to bind.", 400, {
      parameterSpecId: spec.id,
    });
  }
  if (spec.lifecycle !== "active") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Only active parameter specs can resolve review tasks.",
      400,
      { parameterSpecId: spec.id, lifecycle: spec.lifecycle },
    );
  }
  if (isUnsupportedShape(spec.valueShape)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Unsupported parameter spec value shapes cannot be used for resolve.",
      400,
      { parameterSpecId: spec.id, valueShapeKind: shapeKind(spec.valueShape) },
    );
  }
  if (!hasCompleteConstraints(spec.valueShape, spec.constraints)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter spec constraints are incomplete; resolve is fail-closed.",
      400,
      { parameterSpecId: spec.id, valueShapeKind: shapeKind(spec.valueShape) },
    );
  }
}
