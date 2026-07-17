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
  storedValueShape?: unknown;
}): void {
  if (isUnsupportedShape(input.valueShape)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Unsupported draft value shapes cannot be activated.",
      400,
      { parameterSpecId: input.parameterSpecId, valueShapeKind: shapeKind(input.valueShape) },
    );
  }
  const shape = input.valueShape;
  if (!shape || typeof shape !== "object" || Array.isArray(shape) || !("kind" in shape)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Activation requires a complete valueShape object.",
      400,
      { parameterSpecId: input.parameterSpecId },
    );
  }
  const kind = shapeKind(shape);
  if (kind === "cells" || kind === "phandle-list" || kind === "u32-array") {
    const record = shape as Record<string, unknown>;
    const cellsPerGroup =
      typeof record.cellsPerGroup === "number"
        ? record.cellsPerGroup
        : typeof record.cells === "number"
          ? record.cells
          : null;
    if (cellsPerGroup == null || !Number.isFinite(cellsPerGroup) || cellsPerGroup < 1) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Cell-array valueShape must include cellsPerGroup or cells.",
        400,
        { parameterSpecId: input.parameterSpecId, valueShapeKind: kind },
      );
    }
    if (
      typeof record.bits !== "number" ||
      ![8, 16, 32, 64].includes(record.bits) ||
      typeof record.groups !== "number" ||
      !Number.isInteger(record.groups) ||
      record.groups < 1
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Cell-array valueShape must include valid bits and groups.",
        400,
        { parameterSpecId: input.parameterSpecId, valueShapeKind: kind },
      );
    }
    if (typeof input.constraints?.cells === "number" && input.constraints.cells !== cellsPerGroup) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Cell constraint conflicts with inferred cellsPerGroup.",
        400,
        {
          parameterSpecId: input.parameterSpecId,
          inferredCellsPerGroup: cellsPerGroup,
          constraintCells: input.constraints.cells,
        },
      );
    }
  }
  if (kind === "bytes") {
    const length = (shape as Record<string, unknown>).length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Byte-array valueShape must include an exact length.",
        400,
        { parameterSpecId: input.parameterSpecId, valueShapeKind: kind },
      );
    }
  }
  if (input.storedValueShape && typeof input.storedValueShape === "object" && !Array.isArray(input.storedValueShape)) {
    const stored = input.storedValueShape as Record<string, unknown>;
    const incoming = shape as Record<string, unknown>;
    for (const key of ["kind", "bits", "groups", "cellsPerGroup", "length", "cells"] as const) {
      if (stored[key] != null && incoming[key] !== stored[key]) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Activation valueShape conflicts with inferred draft shape.",
          400,
          { parameterSpecId: input.parameterSpecId, field: key, stored: stored[key], incoming: incoming[key] },
        );
      }
    }
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
