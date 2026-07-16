import { parseDtsValue } from "../dts/valueAst";
import type { DtsValue } from "../dts/types";

export type DraftValueShape =
  | { kind: "bool" }
  | { kind: "empty" }
  | { kind: "string" }
  | { kind: "string-list" }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; groups: number; cellsPerGroup: number }
  | { kind: "bytes"; length: number }
  | { kind: "phandle-list"; cells: number }
  | { kind: "u32-array"; cells: number }
  | { kind: "mixed" }
  | { kind: "unknown" };

function asDtsValue(ast: unknown, propertyKey: string, rawText: string | null): DtsValue | null {
  if (ast && typeof ast === "object" && !Array.isArray(ast) && "kind" in ast) {
    return ast as DtsValue;
  }
  if (rawText != null) {
    try {
      return parseDtsValue(propertyKey, rawText).value;
    } catch {
      return null;
    }
  }
  return null;
}

function inferFromDtsValue(value: DtsValue): DraftValueShape {
  switch (value.kind) {
    case "boolean":
      return { kind: "bool" };
    case "empty":
      return { kind: "empty" };
    case "strings":
      return value.values.length <= 1 ? { kind: "string" } : { kind: "string-list" };
    case "bytes":
      return { kind: "bytes", length: value.values.length };
    case "cells": {
      const groups = value.groups.length;
      const cellsPerGroup = value.groups[0]?.length ?? 0;
      const hasPhandle = value.groups.some((group) => group.some((cell) => cell.kind === "phandle"));
      const hasInteger = value.groups.some((group) => group.some((cell) => cell.kind === "integer"));
      if (hasPhandle && !hasInteger) {
        return { kind: "phandle-list", cells: cellsPerGroup };
      }
      return { kind: "cells", bits: value.bits, groups, cellsPerGroup };
    }
    case "mixed":
      return { kind: "mixed" };
    default: {
      const exhaustive: never = value;
      void exhaustive;
      return { kind: "unknown" };
    }
  }
}

/** Infer an initial draft value shape from occurrence AST or raw text. */
export function inferDraftValueShapeFromOccurrence(input: {
  propertyKey: string;
  astJson: unknown;
  rawText: string | null;
}): DraftValueShape {
  const value = asDtsValue(input.astJson, input.propertyKey, input.rawText);
  if (!value) {
    return { kind: "unknown" };
  }
  return inferFromDtsValue(value);
}

export function draftValueShapeToJson(shape: DraftValueShape): Record<string, unknown> {
  return { ...shape };
}
