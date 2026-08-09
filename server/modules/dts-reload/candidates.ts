import type { ReloadCandidateBlockReason, ReloadCandidateDto } from "./types";

/**
 * A synthesised dangling-label anchor is a single root segment with no unit address
 * (shape `/label`). Real hardware nodes usually carry `@unit`; descendants hanging under
 * a synthesised parent (e.g. `/amba/i2c@…`) keep multi-segment absolute paths and stay
 * debuggable — only the parameter's *own* locator being that synthesised shape is refused.
 */
export function isSynthesisedAnchorLocator(nodePath: string | null | undefined): boolean {
  if (!nodePath) return false;
  return /^\/[A-Za-z_][\w-]*$/.test(nodePath);
}

export type CandidateValueShape = {
  kind?: string;
  bits?: number;
  cellsPerGroup?: number;
  groups?: number;
} | null;

/**
 * This ticket supports exactly one unsigned 32-bit cell. Anything else is listed as
 * not-debuggable so later tickets can widen the shape matrix without silently guessing.
 */
export function isSupportedReloadValueShape(valueShape: CandidateValueShape): boolean {
  if (!valueShape || typeof valueShape !== "object") return false;
  if (valueShape.kind !== "cells") return false;
  if (valueShape.bits !== 32) return false;
  if (valueShape.cellsPerGroup !== 1) return false;
  if (valueShape.groups !== undefined && valueShape.groups !== 1) return false;
  return true;
}

export type CandidateClassificationInput = {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  nodePath: string | null;
  baselineValue: string | null;
  valueShape: CandidateValueShape;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
};

export function classifyReloadCandidate(input: CandidateClassificationInput): ReloadCandidateDto {
  const base = {
    bindingId: input.bindingId,
    projectId: input.projectId,
    propertyKey: input.propertyKey,
    displayName: input.displayName,
    module: input.module,
    nodePath: input.nodePath,
    baselineValue: input.baselineValue,
    valueShapeKind: input.valueShapeKind,
    unit: input.unit,
    constraints: input.constraints
  };

  const blockReason = classifyBlockReason(input);
  if (blockReason) {
    return { ...base, debuggable: false, blockReason };
  }

  return { ...base, debuggable: true };
}

function classifyBlockReason(input: CandidateClassificationInput): ReloadCandidateBlockReason | undefined {
  if (!input.nodePath || input.nodePath.trim().length === 0) {
    return "no-node-path";
  }
  if (isSynthesisedAnchorLocator(input.nodePath)) {
    return "synthesised-anchor";
  }
  if (!isSupportedReloadValueShape(input.valueShape)) {
    return "unsupported-value-shape";
  }
  if (input.baselineValue === null || input.baselineValue.trim().length === 0) {
    return "no-baseline-value";
  }
  return undefined;
}
