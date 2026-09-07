import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { captureControlledRecovery, type ControlledRecoveryBoundary, type ControlledRecoverySource } from "../../storage/controlledRecovery";
import type { RecoveryTargetIdentity } from "../../storage/recoveryPoint";
import { assertHostOperationLock, type HostOperationLock } from "./handoff";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed,
  type RecoveryCaptureEvent, type RecoveryCaptureRecord, type UpgradeJournal } from "./journal";

const refuse = (): never => { throw new Error("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE"); };

/** Controller-side capture producer. It calls the existing S11-RP capture/check
 * implementation, persists its returned record, and never imports restore code.
 * Source and writer-boundary adapters belong to the fixed management root; this
 * function does not turn JSON identities into those adapters or approve restore.
 */
export async function recordControlledRecoveryCapture(input: {
  journal: UpgradeJournal; attemptId: string; directory: string; operationRoot: string;
  target: RecoveryTargetIdentity; lock: HostOperationLock;
}, source: ControlledRecoverySource, boundary: ControlledRecoveryBoundary): Promise<RecoveryCaptureRecord> {
  const { journal, lock } = input;
  const fixed = { attemptId: input.attemptId, directory: input.directory, operationRoot: input.operationRoot,
    runId: journal.record.runId, target: structuredClone(input.target) };
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  let operationDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let journalDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let journalLocationIntact = async () => false;
  let pending: RecoveryCaptureEvent | undefined;
  let committed = false;
  try {
    if (typeof fixed.attemptId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(fixed.attemptId) || !path.isAbsolute(fixed.directory) ||
      !path.isAbsolute(fixed.operationRoot) || !journal.journalPath.startsWith(`${fixed.operationRoot}${path.sep}`)) refuse();
    await assertHostOperationLock(lock, fixed.operationRoot);
    if (await realpath(fixed.directory) !== fixed.directory || await realpath(fixed.operationRoot) !== fixed.operationRoot ||
      await realpath(journal.journalPath) !== journal.journalPath) refuse();
    operationDirectory = await open(fixed.operationRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    journalDirectory = await open(path.dirname(journal.journalPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const locations = [
      { name: fixed.operationRoot, handle: operationDirectory, identity: await operationDirectory.stat() },
      { name: path.dirname(journal.journalPath), handle: journalDirectory, identity: await journalDirectory.stat() },
    ];
    journalLocationIntact = async () => {
      for (const location of locations) {
        const named = await lstat(location.name).catch(() => undefined), descriptor = await location.handle.stat();
        if (!named?.isDirectory() || named.isSymbolicLink() || named.dev !== location.identity.dev || named.ino !== location.identity.ino ||
          descriptor.dev !== location.identity.dev || descriptor.ino !== location.identity.ino || named.uid !== process.getuid?.() ||
          (named.mode & 0o777) !== 0o700 || await realpath(location.name) !== location.name) return false;
      }
      return true;
    };
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: fixed.runId, requireSettled: true });
    if (!loaded.ok || loaded.value.record.journalDigest !== journal.record.journalDigest ||
      loaded.value.record.entries.some(entry => entry.recoveryCapture || entry.action === "recovery-package-captured")) refuse();
    // A pending/unknown capture is never retried, even with a new attempt id.
    // Inspect/reconcile retains the original directory and partial artifacts.
    directory = await open(fixed.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const identity = await directory.stat();
    const check = async () => {
      if (!await journalLocationIntact()) refuse();
      const current = await lstat(fixed.directory);
      const descriptor = await directory!.stat();
      if (!current.isDirectory() || current.isSymbolicLink() || !descriptor.isDirectory() ||
        current.dev !== identity.dev || current.ino !== identity.ino || descriptor.dev !== identity.dev || descriptor.ino !== identity.ino ||
        current.uid !== process.getuid?.() || (current.mode & 0o777) !== 0o700 || await realpath(fixed.directory) !== fixed.directory) refuse();
      await assertHostOperationLock(lock, fixed.operationRoot);
    };
    await check();
    if ((await readdir(fixed.directory)).length) refuse();
    pending = { attemptId: fixed.attemptId, runId: fixed.runId, outcome: "pending", source: fixed.target,
      directory: { path: fixed.directory, device: String(identity.dev), inode: String(identity.ino) } };
    const append = (event: RecoveryCaptureEvent) => {
      const result = commitJournalTransition(journal, {
        action: event.outcome === "pending" ? "recovery-capture-pending" : "recovery-package-captured",
        inputDigest: sha256Prefixed(canonicalJson(event.capture ?? event)),
        toState: journal.record.state, nextAction: journal.record.nextAction,
        outcome: event.outcome === "pending" ? "crashed" : "committed", recoveryCapture: event,
      });
      if (!result.ok || result.value.replayed) refuse();
    };
    await check();
    append(pending);
    const guardedSource: ControlledRecoverySource = {
      async observe() { await check(); const value = await source.observe(); await check(); return value; },
      async open() {
        await check();
        const opened = await source.open();
        // capture owns this lease as soon as open returns, including check failure.
        return {
          async postgres() { await check(); const value = await opened.postgres(); await check(); return value; },
          async objects() { await check(); const value = await opened.objects(); await check(); return value; },
          async redis() { await check(); const value = await opened.redis(); await check(); return value; },
          close: () => opened.close(),
        };
      },
    };
    const captured = await captureControlledRecovery({ directory: fixed.directory, runId: fixed.runId, target: fixed.target,
      expectedDirectoryIdentity: { dev: identity.dev, ino: identity.ino } }, guardedSource, {
      async acquire(binding) { await check(); const receipt = await boundary.acquire(binding); await check(); return receipt; },
      async verify(receipt) { await check(); await boundary.verify(receipt); await check(); },
    });
    await check();
    const record: RecoveryCaptureRecord = { runId: fixed.runId, packageDigest: captured.packageDigest,
      recoveryPointDigest: captured.manifest.recoveryPointDigest, source: captured.manifest.target, boundaryDigest: captured.boundaryDigest };
    append({ ...pending, outcome: "committed", capture: record });
    committed = true;
    return structuredClone(record);
  } catch {
    if (pending && !committed && await journalLocationIntact().catch(() => false)) {
      const event: RecoveryCaptureEvent = { ...pending, outcome: "unknown" };
      // CAS or fsync failure leaves the last durable intent intact. No resetting,
      // deleting partial files, reopening writers, or guessing that capture failed.
      commitJournalTransition(journal, { action: "recovery-capture-unknown", inputDigest: sha256Prefixed(canonicalJson(event)),
        toState: journal.record.state, nextAction: journal.record.nextAction, outcome: "crashed", recoveryCapture: event });
    }
    return refuse();
  } finally {
    await Promise.all([directory, operationDirectory, journalDirectory].map(handle => handle?.close().catch(() => undefined)));
  }
}
