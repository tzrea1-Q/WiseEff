import type { ReloadCandidateBlockReason, ReloadCandidateDto } from "./types";
import {
  isSupportedReloadValueShape,
  resolveReloadValueShape,
  type CandidateValueShape,
  type ReloadValueShape
} from "./valueShape";

export type { CandidateValueShape } from "./valueShape";

export type CandidateClassificationInput = {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  moduleId?: string | null;
  nodePath: string | null;
  baselineValue: string | null;
  description?: string | null;
  valueShape: CandidateValueShape;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
};

export function classifyReloadCandidate(input: CandidateClassificationInput): ReloadCandidateDto {
  const resolvedShape = resolveReloadValueShape(input.valueShape, input.baselineValue);
  const base = {
    bindingId: input.bindingId,
    projectId: input.projectId,
    propertyKey: input.propertyKey,
    displayName: input.displayName,
    module: input.module,
    moduleId: input.moduleId ?? null,
    nodePath: input.nodePath,
    compatible: null as string | null,
    baselineValue: input.baselineValue,
    description: input.description?.trim() ? input.description.trim() : null,
    // Preserve catalog kind for UI/debug; resolved shape drives debuggability only.
    valueShapeKind: input.valueShapeKind,
    unit: input.unit,
    constraints: input.constraints,
    sensitiveMatch: null as ReloadCandidateDto["sensitiveMatch"],
    lastReload: null as ReloadCandidateDto["lastReload"]
  };

  const blockReason = classifyBlockReason(input, resolvedShape);
  if (blockReason) {
    return { ...base, debuggable: false, blockReason };
  }

  return { ...base, debuggable: true };
}

function classifyBlockReason(
  input: CandidateClassificationInput,
  resolvedShape: ReloadValueShape
): ReloadCandidateBlockReason | undefined {
  if (!input.nodePath || input.nodePath.trim().length === 0) {
    return "no-node-path";
  }
  if (!isSupportedReloadValueShape(resolvedShape)) {
    return "unsupported-value-shape";
  }
  if (input.baselineValue === null || input.baselineValue.trim().length === 0) {
    return "no-baseline-value";
  }
  return undefined;
}

/**
 * Collapse list rows that share the same overlay identity (propertyKey + absolute path).
 * Preference: debuggable > has absolute path > earlier list order (stable).
 * Different absolute paths for the same property stay distinct.
 */
export function normalizeReloadCandidates<T extends ReloadCandidateDto>(items: readonly T[]): T[] {
  const winners = new Map<string, T>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${item.propertyKey}\0${item.nodePath ?? ""}`;
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, item);
      order.push(key);
      continue;
    }
    if (preferCandidate(item, existing)) {
      winners.set(key, item);
    }
  }

  return order.map((key) => winners.get(key)!);
}

function preferCandidate(next: ReloadCandidateDto, current: ReloadCandidateDto): boolean {
  if (next.debuggable !== current.debuggable) return next.debuggable;
  const nextHasPath = Boolean(next.nodePath?.trim());
  const currentHasPath = Boolean(current.nodePath?.trim());
  if (nextHasPath !== currentHasPath) return nextHasPath;
  return false;
}
