import {
  isScaffoldingDriverLabel,
  normalizeMatchToken,
} from "./modulePlacement";

export type IngestDriverSummary = {
  matchedRegistered: string[];
  newUnregistered: string[];
  matchedRegisteredCount: number;
  newUnregisteredCount: number;
};

/**
 * One-shot upload summary: which observed compatibles were already registered,
 * and which are newly unregistered (ADR-0007 — no persisted report entity).
 */
export function buildIngestDriverSummary(input: {
  observedCompatibles: readonly string[];
  registeredCompatibles: ReadonlySet<string>;
}): IngestDriverSummary {
  const observed = new Set<string>();
  for (const raw of input.observedCompatibles) {
    const token = normalizeMatchToken(raw);
    if (!token) continue;
    if (isScaffoldingDriverLabel(token)) continue;
    observed.add(token);
  }

  const matchedRegistered: string[] = [];
  const newUnregistered: string[] = [];
  for (const compatible of [...observed].sort()) {
    if (input.registeredCompatibles.has(compatible)) {
      matchedRegistered.push(compatible);
    } else {
      newUnregistered.push(compatible);
    }
  }

  return {
    matchedRegistered,
    newUnregistered,
    matchedRegisteredCount: matchedRegistered.length,
    newUnregisteredCount: newUnregistered.length,
  };
}
