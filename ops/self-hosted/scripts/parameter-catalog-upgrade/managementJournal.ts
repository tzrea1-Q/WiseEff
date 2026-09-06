import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ManagementMigrationIntent, ManagementMigrationReceipt, ManagementMigrationAttempt, ManagementMigrationJournal } from "../../../../scripts/migrate";
import { bindingJournalPath } from "./bindingJournal";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed, withJournalWriteLock,
  type BindingPhaseEvent, type JournalRecord, type UpgradeJournal } from "./journal";

type Target = ManagementMigrationIntent["target"];
type Scope = { operationRoot: string; target: Target };
type AttemptState = { attemptId: string; intentDigest: string };
export type ManagementMigrationState = { status: "absent" } |
  (AttemptState & { status: "pending" | "unknown" }) |
  (AttemptState & { status: "committed"; receiptDigest: string });
const digest = (value: unknown) => sha256Prefixed(canonicalJson(value));
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
function fail(reason: string): never { throw new Error(`management-journal-${reason}`); }

function validateIntent(intent: ManagementMigrationIntent): void {
  if (intent.version !== "pcat-management-migration-intent-v1" || !token(intent.runId) ||
      !/^[a-f0-9]{40}$/.test(intent.candidateArtifactSha) || !/^[a-f0-9]{40}$/.test(intent.candidateArtifactTree) ||
      ![intent.preparationPlanDigest, intent.sourceSnapshotDigest, intent.candidateInventoryDigest, intent.writeFenceReceiptDigest, intent.recoveryManifestDigest].every(isDigest) ||
      !/^[0-9]+$/.test(intent.target?.systemIdentifier) || !/^[0-9]+$/.test(intent.target?.databaseOid) ||
      !["memory", "postgres"].includes(intent.checkpointMode)) fail("invalid-intent");
}
function validateReceipt(intent: ManagementMigrationIntent, receipt: ManagementMigrationReceipt): void {
  validateIntent(intent);
  if (receipt.version !== "pcat-management-migration-receipt-v1" || receipt.intentDigest !== digest(intent) ||
      !isDigest(receipt.installedStructureDigest) ||
      receipt.sourceSnapshotDigest !== intent.sourceSnapshotDigest || receipt.candidateInventoryDigest !== intent.candidateInventoryDigest ||
      ![receipt.verifiedRelations, receipt.verifiedRows, receipt.appliedSuffix].every(count => Number.isSafeInteger(count) && count >= 0) ||
      receipt.verifiedRelations === 0 || receipt.checkpoint?.mode !== intent.checkpointMode ||
      receipt.checkpoint.status !== (intent.checkpointMode === "memory" ? "skipped" : "verified")) fail("receipt-mismatch");
}

/** Decode entries already authenticated by loadUpgradeJournal. This reads no
 * approval into a digest: callers must recompute the actual migration receipt. */
export function readManagementMigrationAttempt(record: JournalRecord): ManagementMigrationState {
  let state: ManagementMigrationState = { status: "absent" };
  let originalPlanDigest: string | null = null;
  for (const entry of record.entries) {
    if (!entry.action.startsWith("management-migration")) continue;
    const match = /^management-migration-(pending|committed|unknown):([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.exec(entry.action);
    if (!match || entry.bindingPhase || !isDigest(entry.inputDigest) || (entry.planDigest !== null && !isDigest(entry.planDigest)) ||
        entry.fromState !== entry.toState ||
        entry.outcome !== (match[1] === "committed" ? "committed" : "crashed")) fail("invalid-entry");
    const status = match[1]; const attemptId = match[2]!;
    if (status === "pending") {
      if (state.status !== "absent") fail("attempt-conflict");
      originalPlanDigest = entry.planDigest;
      state = { status: "pending", attemptId, intentDigest: entry.inputDigest };
    } else {
      if (state.status !== "pending" || state.attemptId !== attemptId || originalPlanDigest !== entry.planDigest) fail("attempt-conflict");
      if (status === "unknown") {
        if (entry.inputDigest !== state.intentDigest) fail("attempt-conflict");
        state = { status: "unknown", attemptId, intentDigest: entry.inputDigest };
      } else state = { status: "committed", attemptId, intentDigest: state.intentDigest, receiptDigest: entry.inputDigest };
    }
  }
  return state;
}

/** `receipt` must come from a new real source/migration/checkpoint observation,
 * never from journal fields, a supplied passed flag or a previous process. */
export function verifyCommittedManagementMigration(record: JournalRecord, intent: ManagementMigrationIntent, receipt: ManagementMigrationReceipt): AttemptState {
  validateReceipt(intent, receipt);
  const state = readManagementMigrationAttempt(record);
  if (state.status !== "committed" || record.runId !== intent.runId ||
      state.intentDigest !== digest(intent) || state.receiptDigest !== digest({ intentDigest: state.intentDigest, receipt })) fail("receipt-mismatch");
  return { attemptId: state.attemptId, intentDigest: state.intentDigest };
}

function directoryFor(scope: Scope): string {
  const directory = path.dirname(bindingJournalPath({ ...scope, runId: "scope" }));
  for (const current of [path.dirname(directory), directory]) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) fail("unsafe-directory");
  }
  return directory;
}
function recordsInScope(scope: Scope): JournalRecord[] {
  const directory = directoryFor(scope);
  return readdirSync(directory).sort().flatMap(name => {
    if (name.endsWith(".json.write-lock")) fail("write-outcome-unavailable");
    if (!name.endsWith(".json")) return [];
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    if (stat.uid !== process.getuid?.()) fail("unsafe-file-owner");
    const loaded = loadUpgradeJournal({ journalPath: filename, runId: name.slice(0, -5) });
    if (!loaded.ok) fail("scope-unreadable");
    return [loaded.value.record];
  });
}

/** Call while holding the shared target phase-admission lock. This deliberately
 * does not acquire it again, so Binding and controller admission can reuse it. */
export function assertNoUnresolvedManagementMigration(scope: Scope): void {
  assertManagementSettled(recordsInScope(scope));
}
function assertManagementSettled(records: readonly JournalRecord[]): void {
  for (const record of records) {
    const state = readManagementMigrationAttempt(record);
    if (state.status === "pending" || state.status === "unknown") fail("unresolved");
  }
}
function assertNoUnresolvedBinding(records: readonly JournalRecord[], target: Target): void {
  const events = new Map<string, BindingPhaseEvent>();
  const origins = new Map<string, string>();
  for (const record of records) for (const entry of record.entries) {
    const event = entry.bindingPhase;
    if (!event) continue;
    if (!same(event.target, target)) fail("binding-target-mismatch");
    const previous = events.get(event.attemptId);
    if ((!previous && event.outcome !== "pending") || (previous && (origins.get(event.attemptId) !== record.runId || previous.outcome !== "pending" ||
        !same({ ...previous, outcome: event.outcome }, event)))) fail("binding-event-conflict");
    events.set(event.attemptId, event);
    origins.set(event.attemptId, record.runId);
  }
  if ([...events.values()].some(event => event.outcome === "pending" || event.outcome === "unknown")) fail("binding-unresolved");
}

/** Same target directory, same journal format and same short admission lock as
 * Binding. A process-local capability permits finishing only an attempt actually
 * issued here; restart or unknown outcome requires explicit reconciliation. */
export function createManagementMigrationJournal(input: Scope & { journal: UpgradeJournal; assertHeld(): Promise<void> }): ManagementMigrationJournal {
  const scope: Scope = { operationRoot: input.operationRoot, target: { ...input.target } };
  const journal = input.journal;
  const journalPath = bindingJournalPath({ ...scope, runId: journal.record.runId });
  if (journal.journalPath !== journalPath || typeof input.assertHeld !== "function") fail("scope-mismatch");
  const probe = input.assertHeld;
  const assertHeld = async () => { try { await probe(); } catch { fail("host-lock-unavailable"); } };
  const issued = new WeakMap<ManagementMigrationAttempt, { intent: ManagementMigrationIntent; state: JournalRecord["state"]; planDigest: string | null }>();
  const current = () => {
    if (journal.journalPath !== journalPath) fail("scope-mismatch");
    const loaded = loadUpgradeJournal({ journalPath, runId: journal.record.runId });
    if (!loaded.ok || !same(loaded.value.record, journal.record)) fail("stale-journal");
    return loaded.value.record;
  };
  const locked = <T>(action: () => T): T => withJournalWriteLock(path.join(directoryFor(scope), "phase-admission"), action);
  const append = (attemptId: string, status: "pending" | "committed" | "unknown", inputDigest: string) => {
    const record = current();
    const result = commitJournalTransition(journal, { action: `management-migration-${status}:${attemptId}`, inputDigest,
      toState: record.state, nextAction: record.nextAction,
      outcome: status === "committed" ? "committed" : "crashed" });
    if (!result.ok || result.value.replayed) fail("append-unavailable");
  };
  const pending = (attempt: ManagementMigrationAttempt) => {
    const issuance = issued.get(attempt);
    if (!issuance) fail("attempt-not-issued");
    const record = current();
    const state = readManagementMigrationAttempt(record);
    if (state.status !== "pending" || state.attemptId !== attempt.attemptId || state.intentDigest !== digest(issuance.intent) ||
        record.planDigest !== issuance.planDigest || record.state !== issuance.state) fail("attempt-not-pending");
    return issuance.intent;
  };
  return {
    async begin(rawIntent) {
      const intent = structuredClone(rawIntent);
      validateIntent(intent);
      if (intent.runId !== journal.record.runId || !same(intent.target, scope.target)) fail("intent-scope-mismatch");
      await assertHeld();
      const attempt = locked(() => {
        const record = current();
        if (readManagementMigrationAttempt(record).status !== "absent") fail("attempt-already-recorded");
        const records = recordsInScope(scope);
        assertManagementSettled(records);
        assertNoUnresolvedBinding(records, scope.target);
        const attempt = Object.freeze({ attemptId: randomUUID() });
        append(attempt.attemptId, "pending", digest(intent));
        issued.set(attempt, { intent, state: record.state, planDigest: record.planDigest });
        return attempt;
      });
      await assertHeld();
      return attempt;
    },
    async finish(attempt, rawReceipt) {
      const receipt = structuredClone(rawReceipt);
      const intent = pending(attempt);
      validateReceipt(intent, receipt);
      await assertHeld();
      locked(() => {
        pending(attempt);
        const records = recordsInScope(scope);
        assertNoUnresolvedBinding(records, scope.target);
        // Other runs must not have acquired a management attempt during this one.
        for (const record of records) if (record.runId !== intent.runId) {
          const state = readManagementMigrationAttempt(record);
          if (state.status === "pending" || state.status === "unknown") fail("unresolved");
        }
        append(attempt.attemptId, "committed", digest({ intentDigest: digest(intent), receipt }));
        issued.delete(attempt);
      });
      await assertHeld();
    },
    async unknown(attempt) {
      // Recording uncertainty is safe after a lost host lock; it never authorizes
      // another effect. A failed append leaves the durable pending entry intact.
      locked(() => {
        const intent = pending(attempt);
        recordsInScope(scope);
        append(attempt.attemptId, "unknown", digest(intent));
        issued.delete(attempt);
      });
    },
  };
}
