/**
 * Fail-closed candidate config-revision state machine.
 *
 * Toolchain pass alone never promotes a candidate to draft. Semantic gates
 * (identity mapping, spec review, unmatched occurrence, ambiguous binding,
 * resolver diagnostics) must also clear. needs_mapping / invalid are never
 * overwritten to draft.
 */

import type { ConfigRevisionStatus } from "./types";

export type CandidatePromotionTarget = "draft";

export type CandidateFailureKeepStatus = Extract<
  ConfigRevisionStatus,
  "needs_mapping" | "invalid" | "resolved"
>;

export type CandidateGateFailureReason =
  | "needs-mapping"
  | "invalid-revision"
  | "unresolved-mapping"
  | "open-spec-review"
  | "unmatched-occurrence"
  | "ambiguous-binding"
  | "resolver-diagnostics"
  | "toolchain-unavailable"
  | "toolchain-version-mismatch"
  | "toolchain-compile-failed"
  | "toolchain-schema-failed"
  | "toolchain-failure"
  | "illegal-transition";

export type CandidateSemanticGateInput = {
  /** Status after candidate ingest (before draft promotion). */
  status: ConfigRevisionStatus;
  openIdentityMappings: number;
  openSpecReviews: number;
  unmatchedOccurrences: number;
  ambiguousBindings: number;
  resolverErrorDiagnostics: number;
  /** Toolchain release validate result. */
  toolchainOk: boolean;
  toolchainFailureCode?: string | null;
};

export type CandidateGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: CandidateGateFailureReason;
      /** Diagnosable status to retain — never draft / validated / published. */
      keepStatus: CandidateFailureKeepStatus;
    };

/** Ingest outcomes that may become draft only after every semantic + toolchain gate passes. */
export const CANDIDATE_PROMOTABLE_FROM: ReadonlySet<ConfigRevisionStatus> = new Set(["resolved"]);

/** Diagnosable blocked statuses — never overwrite to draft. */
export const CANDIDATE_NEVER_PROMOTE_FROM: ReadonlySet<ConfigRevisionStatus> = new Set([
  "needs_mapping",
  "invalid",
]);

type TransitionRow = {
  from: ConfigRevisionStatus;
  to: ConfigRevisionStatus;
  event: string;
  allowed: boolean;
};

/**
 * Explicit transition table for candidate revision lifecycle after typed edit.
 * Source of truth for unit tests and promotion checks.
 */
export const CANDIDATE_TRANSITION_TABLE: readonly TransitionRow[] = [
  { from: "resolving", to: "resolved", event: "ingest-ok", allowed: true },
  { from: "resolving", to: "needs_mapping", event: "ingest-ambiguous-identity", allowed: true },
  { from: "resolving", to: "invalid", event: "ingest-resolver-error", allowed: true },
  { from: "resolved", to: "draft", event: "promote-after-gates", allowed: true },
  { from: "resolved", to: "invalid", event: "toolchain-failure", allowed: true },
  { from: "needs_mapping", to: "draft", event: "promote-after-gates", allowed: false },
  { from: "invalid", to: "draft", event: "promote-after-gates", allowed: false },
  { from: "needs_mapping", to: "resolved", event: "promote-after-gates", allowed: false },
  { from: "invalid", to: "resolved", event: "promote-after-gates", allowed: false },
  { from: "draft", to: "validated", event: "release-validate", allowed: true },
  { from: "validated", to: "draft", event: "promote-after-gates", allowed: false },
  { from: "published", to: "draft", event: "promote-after-gates", allowed: false },
] as const;

export function isCandidateTransitionAllowed(
  from: ConfigRevisionStatus,
  to: ConfigRevisionStatus,
  event: string,
): boolean {
  const row = CANDIDATE_TRANSITION_TABLE.find(
    (entry) => entry.from === from && entry.to === to && entry.event === event,
  );
  return row?.allowed ?? false;
}

function toolchainFailureReason(
  code: string | null | undefined,
): CandidateGateFailureReason {
  switch (code) {
    case "toolchain-unavailable":
      return "toolchain-unavailable";
    case "version-mismatch":
      return "toolchain-version-mismatch";
    case "compile-failed":
      return "toolchain-compile-failed";
    case "schema-failed":
      return "toolchain-schema-failed";
    default:
      return "toolchain-failure";
  }
}

function keepStatusForFailure(
  status: ConfigRevisionStatus,
  preferred: CandidateFailureKeepStatus,
): CandidateFailureKeepStatus {
  if (status === "needs_mapping" || status === "invalid") {
    return status;
  }
  return preferred;
}

/**
 * Evaluate whether a candidate revision may be promoted to draft.
 * Toolchain pass is necessary but not sufficient.
 */
export function evaluateCandidateSemanticGate(
  input: CandidateSemanticGateInput,
): CandidateGateResult {
  if (input.status === "needs_mapping") {
    return { ok: false, reason: "needs-mapping", keepStatus: "needs_mapping" };
  }
  if (input.status === "invalid") {
    return { ok: false, reason: "invalid-revision", keepStatus: "invalid" };
  }

  if (input.resolverErrorDiagnostics > 0) {
    return {
      ok: false,
      reason: "resolver-diagnostics",
      keepStatus: keepStatusForFailure(input.status, "invalid"),
    };
  }

  if (input.openIdentityMappings > 0) {
    return {
      ok: false,
      reason: "unresolved-mapping",
      keepStatus: keepStatusForFailure(input.status, "needs_mapping"),
    };
  }

  if (input.ambiguousBindings > 0) {
    return {
      ok: false,
      reason: "ambiguous-binding",
      keepStatus: keepStatusForFailure(input.status, "needs_mapping"),
    };
  }

  if (input.unmatchedOccurrences > 0) {
    return {
      ok: false,
      reason: "unmatched-occurrence",
      keepStatus: keepStatusForFailure(input.status, "resolved"),
    };
  }

  if (input.openSpecReviews > 0) {
    return {
      ok: false,
      reason: "open-spec-review",
      keepStatus: keepStatusForFailure(input.status, "resolved"),
    };
  }

  if (!input.toolchainOk) {
    return {
      ok: false,
      reason: toolchainFailureReason(input.toolchainFailureCode),
      keepStatus: keepStatusForFailure(input.status, "invalid"),
    };
  }

  if (!CANDIDATE_PROMOTABLE_FROM.has(input.status)) {
    return {
      ok: false,
      reason: "illegal-transition",
      keepStatus: keepStatusForFailure(input.status, "resolved"),
    };
  }

  if (!isCandidateTransitionAllowed(input.status, "draft", "promote-after-gates")) {
    return {
      ok: false,
      reason: "illegal-transition",
      keepStatus: keepStatusForFailure(input.status, "resolved"),
    };
  }

  return { ok: true };
}

/**
 * Apply draft promotion only when the transition table and semantic gate allow it.
 * Never overwrites needs_mapping / invalid to draft.
 */
export function assertCanPromoteCandidateToDraft(
  input: CandidateSemanticGateInput,
): CandidateGateResult {
  if (CANDIDATE_NEVER_PROMOTE_FROM.has(input.status)) {
    return {
      ok: false,
      reason: input.status === "needs_mapping" ? "needs-mapping" : "invalid-revision",
      keepStatus: input.status as CandidateFailureKeepStatus,
    };
  }
  return evaluateCandidateSemanticGate(input);
}
