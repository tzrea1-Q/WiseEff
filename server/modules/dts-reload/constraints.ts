import type { DtsValue } from "../dts";
import { ApiError } from "../../shared/http/errors";

/**
 * Constraint check for a debug value. Mirrors the schema gate used by typed binding edit
 * (`editService.assertSchemaAllows`) without coupling this module to that service's internals.
 */
export function assertDebugValueConstraints(value: DtsValue, constraints: unknown): void {
  const expectedCells = asConstraintCells(constraints);
  if (expectedCells !== undefined) {
    const sizes = cellGroupSizes(value);
    if (sizes.length === 0 || sizes.some((size) => size !== expectedCells)) {
      throw new ApiError("VALIDATION_FAILED", `cell count must be ${expectedCells}`, {
        reason: "schema-failure",
        code: "SCHEMA_CELL_COUNT",
        expectedCells,
        actualCells: sizes
      });
    }
  }

  const min = asConstraintNumber(constraints, "min");
  const max = asConstraintNumber(constraints, "max");
  if (min === undefined && max === undefined) return;

  for (const numeric of cellIntegerValues(value)) {
    if (min !== undefined && numeric < min) {
      throw new ApiError("VALIDATION_FAILED", "Value is below schema minimum.", {
        reason: "schema-failure",
        min,
        value: numeric
      });
    }
    if (max !== undefined && numeric > max) {
      throw new ApiError("VALIDATION_FAILED", "Value exceeds schema maximum.", {
        reason: "schema-failure",
        max,
        value: numeric
      });
    }
  }
}

function asConstraintNumber(constraints: unknown, key: "min" | "max"): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cellIntegerValues(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  const out: number[] = [];
  for (const group of value.groups) {
    for (const cell of group) {
      if (cell.kind === "integer") {
        const parsed = Number(cell.value);
        if (Number.isFinite(parsed)) out.push(parsed);
      }
    }
  }
  return out;
}

function cellGroupSizes(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  return value.groups.map((group) => group.length);
}

function asConstraintCells(constraints: unknown): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>).cells;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
