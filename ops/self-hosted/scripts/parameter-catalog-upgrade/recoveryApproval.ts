import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertIncidentRestoreConfirmationCurrent, type IncidentRestoreConfirmation } from "./deploymentAuthority";
import { assertHostOperationLock, type HostOperationLock } from "./handoff";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, type UpgradeJournal } from "./journal";
import { RECOVERY_EXECUTION_EVENTS, recoveryExecutionRecordDigest, type RecoveryExecutionApproval } from "../../storage/execution/authorization";
import { recoveryPackageStorePorts, verifyRecoveryPackage } from "../../storage/recoveryPackage";
import { restoreCheck } from "../../storage/recoveryPoint";

const refuse = (): never => { throw new Error("PCAT-UPG-RECOVERY-APPROVAL-UNAVAILABLE"); };

/** An authenticated approval producer, not a recovery executor. The existing
 * journal remains authoritative; a returned approval is useful only while its
 * committed digest, package, lock and target remain accepted by the consumer. */
export async function recordRecoveryExecutionApproval(input: {
  journal: UpgradeJournal; operationRoot: string; lock: HostOperationLock;
  confirmation: IncidentRestoreConfirmation; restoreToken: string;
}): Promise<RecoveryExecutionApproval> {
  const { journal, lock, confirmation } = input;
  const operationRoot = input.operationRoot, restoreToken = input.restoreToken;
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  try {
    await assertIncidentRestoreConfirmationCurrent(confirmation);
    if (!path.isAbsolute(operationRoot) || path.dirname(journal.journalPath) !== operationRoot
      || confirmation.runId !== journal.record.runId || !/^[A-Za-z0-9_-]+$/.test(confirmation.attemptId)) refuse();
    await assertHostOperationLock(lock, operationRoot);
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: confirmation.runId, requireSettled: true });
    if (!loaded.ok || loaded.value.record.journalDigest !== journal.record.journalDigest) return refuse();
    const entries = loaded.value.record.entries;
    const phases = new Map(entries.flatMap(entry => entry.bindingPhase ? [[entry.bindingPhase.attemptId,entry.bindingPhase] as const] : []));
    const event = entries.filter(entry => entry.action === RECOVERY_EXECUTION_EVENTS.captured).at(-1);
    const captured = event?.recoveryCapture;
    if (event?.outcome !== "committed" || captured?.outcome !== "committed" || !captured.capture
      || event.inputDigest !== confirmation.captureDigest || recoveryExecutionRecordDigest(captured.capture) !== confirmation.captureDigest
      || captured.runId !== confirmation.runId || captured.capture.runId !== confirmation.runId
      || entries.some(entry => entry.action.startsWith("recovery-execution-") || entry.action === "recovery-capture-unknown")
      || [...phases.values()].some(phase => ["pending","unknown"].includes(phase.outcome))) return refuse();
    const capture = structuredClone(captured.capture), directory = captured.directory.path;
    const identities: { name: string; handle: Awaited<ReturnType<typeof open>>; identity: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>> }[] = [];
    for (const name of [...new Set([operationRoot,path.dirname(journal.journalPath),directory])]) {
      if (!path.isAbsolute(name) || await realpath(name) !== name) refuse();
      const handle = await open(name,constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(handle);
      const identity = await handle.stat();
      if (!identity.isDirectory() || identity.uid !== process.getuid?.() || (identity.mode & 0o777) !== 0o700) refuse();
      if (name === directory && (String(identity.dev) !== captured.directory.device || String(identity.ino) !== captured.directory.inode)) refuse();
      identities.push({ name,handle,identity });
    }
    const check = async () => {
      for (const { name,handle,identity } of identities) {
        const named = await lstat(name), descriptor = await handle.stat();
        if (!named.isDirectory() || named.isSymbolicLink() || named.dev !== identity.dev || named.ino !== identity.ino
          || descriptor.dev !== identity.dev || descriptor.ino !== identity.ino || named.uid !== identity.uid
          || (named.mode & 0o777) !== 0o700 || await realpath(name) !== name) refuse();
      }
      const current = loadUpgradeJournal({ journalPath: journal.journalPath, runId: confirmation.runId, requireSettled: true });
      if (!current.ok || current.value.record.journalDigest !== loaded.value.record.journalDigest) refuse();
      await assertHostOperationLock(lock,operationRoot);
    };
    const verifyPackage = async () => {
      await check();
      const verified = await verifyRecoveryPackage(directory,capture.packageDigest);
      if (verified.manifest.recovery.recoveryPointDigest !== capture.recoveryPointDigest
        || verified.manifest.recovery.runId !== capture.runId || canonicalJson(verified.manifest.recovery.target) !== canonicalJson(capture.source)) refuse();
      const checked = await restoreCheck({ manifest: verified.manifest.recovery, restoreToken, restoreTargets: {},
        stores: recoveryPackageStorePorts(verified.manifest,verified.manifest.recovery.target) });
      if (!checked.ok) refuse();
      await check();
    };
    await verifyPackage();
    await assertIncidentRestoreConfirmationCurrent(confirmation,capture.source);
    const approval: RecoveryExecutionApproval = { runId: confirmation.runId, attemptId: confirmation.attemptId,
      captureDigest: confirmation.captureDigest, target: structuredClone(confirmation.target),
      approvalReference: confirmation.approvalReference, expiresAt: confirmation.expiresAt };
    // Reread actual package bytes after authentication, then recheck custody and
    // the real host lock immediately before the existing synchronous CAS commit.
    await verifyPackage();
    await assertIncidentRestoreConfirmationCurrent(confirmation,capture.source);
    await check();
    const result = commitJournalTransition(journal,{ action: RECOVERY_EXECUTION_EVENTS.authorized,
      inputDigest: recoveryExecutionRecordDigest(approval), toState: journal.record.state,
      nextAction: journal.record.nextAction, outcome: "committed",
      recoveryApproval: { approval, assignmentDigest: confirmation.assignmentDigest, principal: confirmation.principal, traceId: confirmation.traceId } });
    if (!result.ok || result.value.replayed) refuse();
    return structuredClone(approval);
  } catch { return refuse(); }
  finally { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); }
}
