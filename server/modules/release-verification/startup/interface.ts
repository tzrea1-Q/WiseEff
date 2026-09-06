import type { Database } from "../../../shared/database/client";
import type { RuntimePinQuery } from "../report/index";
import type { PointerRollbackStatus } from "../core/types";

/** The controller derives this from current target state, never from a report.
 * P12 execution and P13 retirement remain prerequisites of that producer.
 * A CLI flag, environment payload or P10 checkpoint cannot implement this port.
 */
export type StartupBoundary = RuntimePinQuery & {
  readonly reportDigest: string;
  readonly phaseSnapshot: string;
  readonly predecessorReportDigests: readonly string[];
  readonly pointerRollbackStatus: PointerRollbackStatus;
  readonly trafficIsolationState: "isolated" | "public";
};

export type StartupTarget = {
  /** Hold the real target maintenance boundary for both observations and the read. */
  withLockedBoundary<T>(body: () => Promise<T>): Promise<T>;
  observe(): Promise<StartupBoundary>;
};

export type StartupOptions = {
  /** Existing catalog_verifier_role read connection; never verification writer. */
  readonly reports: Database;
  readonly target: StartupTarget;
};

export type StartupRefusalReason = "source-unavailable" | "not-isolated" | "pre-pin" |
  "missing" | "unapproved" | "boundary-mismatch";
export type StartupResult =
  | { readonly ok: true; readonly reportDigest: string; readonly scope: "isolated-candidate-startup-only" }
  | { readonly ok: false; readonly reason: StartupRefusalReason };
