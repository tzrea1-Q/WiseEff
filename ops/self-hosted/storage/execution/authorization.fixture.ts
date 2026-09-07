import path from "node:path";
import { randomUUID } from "node:crypto";
import { withHostOperationLock } from "../../scripts/parameter-catalog-upgrade/handoff";
import { createControlledRecoveryTarget, type RecoveryPackageTarget } from "./packageRestore";
import type { ControlledRecoveryTarget } from "./controlledRestore";
import { openUpgradeJournal, commitJournalTransition } from "../../scripts/parameter-catalog-upgrade/journal";
import { verifyRecoveryPackage } from "../recoveryPackage";
import { mintRestoreToken, type RecoveryTargetIdentity } from "../recoveryPoint";
import { createRecoveryExecutionAuthorization, recoveryExecutionRecordDigest, RECOVERY_EXECUTION_EVENTS,
  type RecoveryCaptureRecord, type RecoveryExecutionApproval } from "./authorization";

/** Test-only consumer fixture. Explicitly registered as test ownership: live
 * capture/verify/execution modules must never import it. This is not the missing
 * controller approval producer and must not be reported as release approval. */
export async function recordSyntheticRecoveryConsumption(directory: string, packageDigest: string, target: RecoveryTargetIdentity, approved = true) {
  const backup = await verifyRecoveryPackage(directory, packageDigest);
  const runId = backup.manifest.recovery.runId;
  const opened = openUpgradeJournal({ journalPath: path.join(directory, `synthetic-controller-${randomUUID()}.json`), runId });
  if (!opened.ok) throw new Error("synthetic-controller-journal-unavailable");
  const capture: RecoveryCaptureRecord = { runId, packageDigest, recoveryPointDigest: backup.manifest.recovery.recoveryPointDigest,
    source: backup.manifest.recovery.target, boundaryDigest: "a".repeat(64) };
  const approval: RecoveryExecutionApproval = { runId, attemptId: randomUUID(), target, captureDigest: recoveryExecutionRecordDigest(capture),
    approvalReference: "synthetic-isolated-execution-consumer-only", expiresAt: new Date(Date.now() + 600000).toISOString() };
  for (const [action, record] of [[RECOVERY_EXECUTION_EVENTS.captured, capture], [RECOVERY_EXECUTION_EVENTS.authorized, approval]] as const) {
    if (!approved && action === RECOVERY_EXECUTION_EVENTS.authorized) continue;
    const result = commitJournalTransition(opened.value, { action, inputDigest: recoveryExecutionRecordDigest(record),
      toState: opened.value.record.state, nextAction: opened.value.record.nextAction });
    if (!result.ok) throw new Error("synthetic-controller-event-unavailable");
  }
  return { capture, approval, journal: opened.value, directory, restoreToken: mintRestoreToken(runId, capture.recoveryPointDigest) };
}

export async function withSyntheticRecoveryTarget<T>(directory: string, packageDigest: string, target: RecoveryTargetIdentity,
  destination: Omit<ControlledRecoveryTarget, "observe">,
  body: (port: RecoveryPackageTarget, consumption: Awaited<ReturnType<typeof recordSyntheticRecoveryConsumption>>) => Promise<T>,
  approved = true,
): Promise<T> {
  const consumption = await recordSyntheticRecoveryConsumption(directory, packageDigest, target, approved);
  return withHostOperationLock(path.join(directory, "fixture-lock"), async lock => body(createControlledRecoveryTarget({ target,
    authorization: createRecoveryExecutionAuthorization({ ...consumption, lock }),
  }, { observe: async () => target, ...destination }), consumption));
}
