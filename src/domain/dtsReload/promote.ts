import type { DtsReloadRun, DtsReloadRunPurpose, DtsReloadRunStatus } from "./types";

export const RELOAD_PROMOTABLE_STATUSES = ["verified", "unverifiable"] as const;

export type ReloadPromotableStatus = (typeof RELOAD_PROMOTABLE_STATUSES)[number];

/**
 * ADR-0035: only ordinary verified runs, or ordinary unverifiable runs after
 * acknowledgement, may become parameter drafts. Restore-baseline, contradicted,
 * failed, and non-terminal runs stay hidden from the promote affordance.
 */
export function isReloadRunPromotable(
  run: Pick<DtsReloadRun, "status" | "purpose"> | { status: DtsReloadRunStatus; purpose: DtsReloadRunPurpose }
): boolean {
  if (run.purpose === "restore-baseline") {
    return false;
  }
  return (RELOAD_PROMOTABLE_STATUSES as readonly DtsReloadRunStatus[]).includes(run.status);
}
