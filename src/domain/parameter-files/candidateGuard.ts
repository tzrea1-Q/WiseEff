import type { DomainGuardResult } from "../guardResult";

const ABANDON_OR_RECOMPUTE_STATUSES = new Set(["ready", "blocked", "failed", "stale"]);

const CANDIDATE_BASE_STALE_FAILURE = {
  ok: false,
  code: "CONFLICT",
  message: "Candidate base is stale; Working configuration was preserved. Recompute impact before activating.",
  details: {}
} as const satisfies DomainGuardResult;

export function guardAbandonCandidate(status: string): DomainGuardResult {
  if (!ABANDON_OR_RECOMPUTE_STATUSES.has(status)) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Cannot abandon candidate in status ${status}`,
      details: { status }
    };
  }
  return { ok: true };
}

export function guardRecomputeCandidate(status: string): DomainGuardResult {
  if (!ABANDON_OR_RECOMPUTE_STATUSES.has(status)) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Cannot recompute candidate in status ${status}`,
      details: { status }
    };
  }
  return { ok: true };
}

export function guardActivateCandidate(status: string): DomainGuardResult {
  if (status !== "ready") {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Cannot activate candidate in status ${status}`,
      details: { status }
    };
  }
  return { ok: true };
}

export function guardCandidateBaseFresh(input: {
  actualCurrentVersionId: string | null;
  expectedCurrentVersionId: string | null;
  candidateBaseVersionId: string | null;
}): DomainGuardResult {
  if (
    input.actualCurrentVersionId !== input.expectedCurrentVersionId ||
    input.candidateBaseVersionId !== input.expectedCurrentVersionId
  ) {
    return CANDIDATE_BASE_STALE_FAILURE;
  }
  return { ok: true };
}

export function guardNewFileActivation(input: {
  configSetId?: string | null;
  role?: string | null;
}): DomainGuardResult {
  if (!input.configSetId || !input.role) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "New file activation requires configSetId and role",
      details: {}
    };
  }
  return { ok: true };
}
