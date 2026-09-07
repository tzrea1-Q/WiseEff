import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, open } from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import { withHostOperationLock } from "../../scripts/parameter-catalog-upgrade/handoff";
import { createControlledRecoveryTarget, type RecoveryPackageTarget } from "./packageRestore";
import type { ControlledRecoveryTarget } from "./controlledRestore";
import { openUpgradeJournal, commitJournalTransition } from "../../scripts/parameter-catalog-upgrade/journal";
import { verifyRecoveryPackage } from "../recoveryPackage";
import { mintRestoreToken, type RecoveryTargetIdentity } from "../recoveryPoint";
import { createRecoveryExecutionAuthorization, recoveryExecutionRecordDigest, RECOVERY_EXECUTION_EVENTS,
  type RecoveryCaptureRecord, type RecoveryExecutionApproval } from "./authorization";

/** Keeps all private evidence. No deletion operation is exposed. The marker is
 * written only through the original open descriptor, never a substituted path. */
export async function createSyntheticRecoveryEvidence() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-live-"));
  const identity = await lstat(directory);
  const markerPath = path.join(directory, "retained-evidence.json");
  const marker = await open(markerPath, "wx", 0o600);
  let markerIdentity: Stats;
  try { markerIdentity = await marker.stat(); }
  catch (error) { await marker.close().catch(() => undefined); throw error; }
  const same = (current: Stats | undefined, original: Stats, mode: number) => current
    && current.dev === original.dev && current.ino === original.ino && current.uid === original.uid
    && (current.mode & 0o777) === mode;
  const assertIdentity = async () => {
    const current = await lstat(directory).catch(() => undefined);
    if (!current?.isDirectory() || current.isSymbolicLink() || !same(current, identity, 0o700)) {
      throw new Error("synthetic-evidence-identity-drift");
    }
    const named = await lstat(markerPath).catch(() => undefined);
    const descriptor = await marker.stat();
    if (!named?.isFile() || named.isSymbolicLink() || named.nlink !== 1 || !same(named, markerIdentity, 0o600)
      || !descriptor.isFile() || descriptor.nlink !== 1 || !same(descriptor, markerIdentity, 0o600)) {
      throw new Error("synthetic-evidence-identity-drift");
    }
  };
  let settled = false;
  return {
    directory,
    async finish(outcome: "accepted" | "failed") {
      if (settled) throw new Error("synthetic-evidence-already-settled-or-invalid");
      settled = true;
      let failed = false;
      try {
        if (!["accepted", "failed"].includes(outcome)) throw new Error("synthetic-evidence-already-settled-or-invalid");
        await assertIdentity();
        await marker.writeFile(JSON.stringify({ status: "private-synthetic-evidence-retained", outcome }) + "\n");
        await marker.sync();
        // A race cannot redirect the descriptor's write. Rechecking the names
        // prevents returning a locator that is already known to be substituted.
        await assertIdentity();
        return { retained: true as const, directory };
      } catch (error) { failed = true; throw error; }
      finally {
        try { await marker.close(); }
        catch { if (!failed) throw new Error("synthetic-evidence-marker-close-failed"); }
      }
    },
  };
}

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
