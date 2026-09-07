import { randomUUID } from "node:crypto";
import {
  canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed,
  type UpgradeJournal, type RecoveryCaptureRecord, type RecoveryExecutionApprovalRecord,
} from "../../scripts/parameter-catalog-upgrade/journal";
import type { HostOperationLock } from "../../scripts/parameter-catalog-upgrade/handoff";
import { verifyRecoveryPackage, recoveryPackageStorePorts } from "../recoveryPackage";
import { restoreCheck } from "../recoveryPoint";
import { recoveryRefuse } from "../controlledRecovery";
import type { RecoveryRestoreBinding } from "./packageRestore";

/** These are controller-produced journal events, not CLI actions or permissions.
 * This consumer deliberately cannot create either approval or capture evidence. */
export const RECOVERY_EXECUTION_EVENTS = Object.freeze({
  captured: "recovery-package-captured", authorized: "recovery-execution-authorized",
  revoked: "recovery-execution-revoked", started: "recovery-execution-started",
  postgres: "recovery-execution-postgres-committed", objects: "recovery-execution-objects-committed",
  redis: "recovery-execution-redis-committed", completed: "recovery-execution-completed",
  unknown: "recovery-execution-outcome-unknown",
} as const);
export type { RecoveryCaptureRecord } from "../../scripts/parameter-catalog-upgrade/journal";
export type RecoveryExecutionApproval = RecoveryExecutionApprovalRecord;
export const recoveryExecutionRecordDigest = (record: RecoveryCaptureRecord | RecoveryExecutionApproval) => sha256Prefixed(canonicalJson(record));
const fail = (): never => recoveryRefuse("execution-authorization-unavailable");
type Step = "postgres" | "objects" | "redis";
const issued = new WeakSet<object>();
export type RecoveryExecutionAuthorization = {
  readonly directory: string; readonly packageDigest: string;
  assertAuthorized(binding: RecoveryRestoreBinding): Promise<void>;
  begin(binding: RecoveryRestoreBinding): Promise<void>;
  committed(step: Step): Promise<void>;
  complete(): Promise<void>;
  unknown(): void;
};
export const isRecoveryExecutionAuthorization = (value: unknown): value is RecoveryExecutionAuthorization =>
  typeof value === "object" && value !== null && issued.has(value);

/** The controller supplies its already open private journal and the live host
 * lock, both obtained through the fixed handoff. Captured source identity and
 * execution approval must ALREADY have been persisted by their respective
 * authenticated producers. JSON matching its own checksum cannot supply them.
 * The S11-RP token checks integrity/run binding; it is NOT an approval credential.
 */
export function createRecoveryExecutionAuthorization(input: {
  journal: UpgradeJournal; directory: string; restoreToken: string;
  capture: RecoveryCaptureRecord; approval: RecoveryExecutionApproval;
  lock: HostOperationLock;
}): RecoveryExecutionAuthorization {
  const capture = structuredClone(input.capture), approval = structuredClone(input.approval);
  const journal = input.journal, lock = input.lock, directory = input.directory, token = input.restoreToken;
  const captureDigest = recoveryExecutionRecordDigest(capture), approvalDigest = recoveryExecutionRecordDigest(approval);
  let begun = false; let completed = false; let stepIndex = 0;
  const sessionId = randomUUID();
  const attemptDigest = sha256Prefixed(canonicalJson({ approvalDigest, sessionId }));
  const assertRecord = () => {
    if (capture.runId !== approval.runId || capture.runId !== journal.record.runId || approval.captureDigest !== captureDigest
      || !/^[A-Za-z0-9_-]+$/.test(approval.attemptId) || !approval.approvalReference.trim()
      || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) fail();
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: capture.runId, requireSettled: true });
    if (!loaded.ok) return fail();
    const entries = loaded.value.record.entries;
    const captured = entries.filter(entry => entry.action === RECOVERY_EXECUTION_EVENTS.captured);
    const authorized = entries.filter(entry => entry.action === RECOVERY_EXECUTION_EVENTS.authorized || entry.action === RECOVERY_EXECUTION_EVENTS.revoked);
    const recordedCapture = captured.at(-1)?.recoveryCapture;
    if (recordedCapture?.outcome !== "committed" || !recordedCapture.capture || canonicalJson(recordedCapture.capture) !== canonicalJson(capture)
      || captured.at(-1)?.inputDigest !== captureDigest || captured.at(-1)?.outcome !== "committed"
      || authorized.at(-1)?.action !== RECOVERY_EXECUTION_EVENTS.authorized || authorized.at(-1)?.inputDigest !== approvalDigest
      || !authorized.at(-1)?.recoveryApproval || canonicalJson(authorized.at(-1)!.recoveryApproval!.approval) !== canonicalJson(approval)
      || authorized.at(-1)?.outcome !== "committed" || captured.at(-1)!.seq >= authorized.at(-1)!.seq) fail();
    if (entries.some(entry => entry.seq > captured.at(-1)!.seq && ["recovery-capture-pending", "recovery-capture-unknown"].includes(entry.action))) fail();
    const starts = entries.filter(entry => entry.action === RECOVERY_EXECUTION_EVENTS.started);
    // No blind retry after any dispatched restore, even when a new object is
    // created in this process. Explicit reconciliation belongs to the controller.
    if (starts.length && (!begun || starts.at(-1)?.inputDigest !== attemptDigest)) fail();
    if (entries.some(entry => entry.action === RECOVERY_EXECUTION_EVENTS.unknown || entry.action === RECOVERY_EXECUTION_EVENTS.completed)) fail();
    journal.record = loaded.value.record;
  };
  const append = (action: string, outcome: "committed" | "crashed") => {
    const result = commitJournalTransition(journal, { action, inputDigest: attemptDigest,
      toState: journal.record.state, nextAction: journal.record.nextAction, outcome });
    if (!result.ok) fail();
  };
  const assertAuthorized = async (binding: RecoveryRestoreBinding) => {
    if (completed) fail();
    await lock.assertHeld();
    assertRecord();
    if (binding.runId !== capture.runId || binding.packageDigest !== capture.packageDigest
      || canonicalJson(binding.source) !== canonicalJson(capture.source) || canonicalJson(binding.target) !== canonicalJson(approval.target)) fail();
    // Reopen and hash the actual on-disk package at EVERY cross-store boundary.
    // Continuing with an earlier in-memory copy would conceal package drift.
    const current = await verifyRecoveryPackage(directory, capture.packageDigest);
    if (current.manifest.recovery.recoveryPointDigest !== capture.recoveryPointDigest) fail();
    const checked = await restoreCheck({ manifest: current.manifest.recovery, restoreToken: token,
      restoreTargets: {}, stores: recoveryPackageStorePorts(current.manifest, current.manifest.recovery.target) });
    if (!checked.ok) fail();
    await lock.assertHeld();
    assertRecord();
  };
  const authority: RecoveryExecutionAuthorization = {
    directory, packageDigest: capture.packageDigest, assertAuthorized,
    async begin(binding) { await assertAuthorized(binding); if (begun) fail(); append(RECOVERY_EXECUTION_EVENTS.started, "crashed"); begun = true; },
    async committed(step) {
      if (!begun || completed || ["postgres", "objects", "redis"][stepIndex] !== step) fail();
      await lock.assertHeld(); assertRecord(); append(RECOVERY_EXECUTION_EVENTS[step], "committed"); stepIndex++;
    },
    async complete() {
      if (!begun || completed || stepIndex !== 3) fail();
      await lock.assertHeld(); assertRecord(); append(RECOVERY_EXECUTION_EVENTS.completed, "committed"); completed = true;
    },
    unknown() {
      if (!begun || completed) return;
      // An unknown append failure deliberately leaves the preceding started or
      // per-store record intact. Never truncate, reset, or classify it as safe.
      try { assertRecord(); append(RECOVERY_EXECUTION_EVENTS.unknown, "crashed"); } catch { /* retain last durable state */ }
    },
  };
  issued.add(authority);
  return Object.freeze(authority);
}
