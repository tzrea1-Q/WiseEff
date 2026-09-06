import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { bindingJournalPath, createBindingCutoverJournal } from "./bindingJournal";
import { canonicalJson, commitJournalTransition, journalBytes, loadUpgradeJournal, openUpgradeJournal, sha256Prefixed } from "./journal";
import { assertNoUnresolvedManagementMigration, createManagementMigrationJournal, readManagementMigrationAttempt, verifyCommittedManagementMigration } from "./managementJournal";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const pin = (character: string) => `sha256:${character.repeat(64)}`;
const target = { systemIdentifier: "123", databaseOid: "45" };
const intent = (runId: string) => ({ version: "pcat-management-migration-intent-v1" as const, runId,
  preparationPlanDigest: pin("a"), target, sourceSnapshotDigest: pin("b"), candidateInventoryDigest: pin("c"),
  writeFenceReceiptDigest: pin("d"), recoveryManifestDigest: pin("e"), checkpointMode: "memory" as const });
function fixture(options: { operationRoot?: string; runId?: string; target?: typeof target } = {}) {
  const operationRoot = options.operationRoot ?? realpathSync(mkdtempSync(path.join(tmpdir(), "upg-management-journal-")));
  if (!options.operationRoot) roots.push(operationRoot);
  const runId = options.runId ?? "management-a";
  const scopedTarget = options.target ?? target;
  const journalPath = bindingJournalPath({ operationRoot, target: scopedTarget, runId });
  const opened = openUpgradeJournal({ journalPath, runId });
  if (!opened.ok) throw new Error("fixture-journal-open-failed");
  const journal = opened.value;
  return { journal, operationRoot, runId, target: scopedTarget, assertHeld: async () => {} };
}
const receiptOf = (command: ReturnType<typeof intent>) => ({ version: "pcat-management-migration-receipt-v1" as const,
  intentDigest: sha256Prefixed(canonicalJson(command)), sourceSnapshotDigest: command.sourceSnapshotDigest,
  candidateInventoryDigest: command.candidateInventoryDigest, verifiedRelations: 100, verifiedRows: 7,
  appliedSuffix: 11, checkpoint: { mode: "memory" as const, status: "skipped" as const } });

it("requires a fresh receipt to verify the one durable management attempt without changing controller state", async () => {
  const scope = fixture();
  const journal = createManagementMigrationJournal(scope);
  const command = intent(scope.runId);
  const receipt = receiptOf(command);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("absent");
  const attempt = await journal.begin(command);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("pending");
  await journal.finish(attempt, receipt);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("committed");
  expect(scope.journal.record.state).toBe("idle");
  expect(scope.journal.record.planDigest).toBeNull();
  expect(verifyCommittedManagementMigration(scope.journal.record, command, receipt).attemptId).toBe(attempt.attemptId);
  expect(() => verifyCommittedManagementMigration(scope.journal.record, command, { ...receipt, verifiedRows: 8 })).toThrow("management-journal-receipt-mismatch");
  await expect(journal.begin(command)).rejects.toThrow("management-journal-attempt-already-recorded");
  expect(commitJournalTransition(scope.journal, { action: "plan", inputDigest: pin("f"), planDigest: pin("f"), toState: "planned", nextAction: "execute" }).ok).toBe(true);
  expect(verifyCommittedManagementMigration(scope.journal.record, command, receipt).attemptId).toBe(attempt.attemptId);
});

it("keeps an interrupted attempt pending and rejects a UUID copied into another process", async () => {
  const scope = fixture(); const command = intent(scope.runId);
  const adapter = createManagementMigrationJournal(scope);
  const attempt = await adapter.begin(command);
  const loaded = loadUpgradeJournal({ journalPath: scope.journal.journalPath, runId: scope.runId });
  if (!loaded.ok) throw new Error("fixture-reopen-failed");
  const restarted = createManagementMigrationJournal({ ...scope, journal: loaded.value });
  await expect(restarted.begin(command)).rejects.toThrow("attempt-already-recorded");
  await expect(restarted.finish(attempt, receiptOf(command))).rejects.toThrow("attempt-not-issued");
  await expect(adapter.finish({ ...attempt }, receiptOf(command))).rejects.toThrow("attempt-not-issued");
  expect(readManagementMigrationAttempt(loaded.value.record).status).toBe("pending");
});

it("persists unknown after losing the host lock and never guesses it committed", async () => {
  const scope = fixture(); let held = true;
  const adapter = createManagementMigrationJournal({ ...scope, assertHeld: async () => { if (!held) throw new Error("private-failure-material"); } });
  const command = intent(scope.runId); const attempt = await adapter.begin(command);
  held = false;
  await expect(adapter.finish(attempt, receiptOf(command))).rejects.toThrow("management-journal-host-lock-unavailable");
  await adapter.unknown(attempt);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("unknown");
  await expect(adapter.finish(attempt, receiptOf(command))).rejects.toThrow("attempt-not-issued");
  held = true;
  await expect(adapter.begin(command)).rejects.toThrow("attempt-already-recorded");
  expect(() => assertNoUnresolvedManagementMigration(scope)).toThrow("management-journal-unresolved");
});

it.each(["pending", "unknown"] as const)("refuses another run while the target has a %s management result", async status => {
  const first = fixture(); const firstAdapter = createManagementMigrationJournal(first);
  const attempt = await firstAdapter.begin(intent(first.runId));
  if (status === "unknown") await firstAdapter.unknown(attempt);
  const second = fixture({ operationRoot: first.operationRoot, runId: "management-b" });
  const before = journalBytes(second.journal.journalPath);
  await expect(createManagementMigrationJournal(second).begin(intent(second.runId))).rejects.toThrow("management-journal-unresolved");
  expect(journalBytes(second.journal.journalPath)).toEqual(before);
});

it("allows another target while preserving the first target's pending admission", async () => {
  const first = fixture(); await createManagementMigrationJournal(first).begin(intent(first.runId));
  const second = fixture({ operationRoot: first.operationRoot, target: { ...target, databaseOid: "46" } });
  await expect(createManagementMigrationJournal(second).begin({ ...intent(second.runId), target: second.target })).resolves.toHaveProperty("attemptId");
});

it.each(["pending", "unknown"] as const)("rejects a %s Binding phase in another run", async status => {
  const first = fixture(); const binding = createBindingCutoverJournal(first);
  const attempt = await binding.begin({ target, runId: "cutover-a", planDigest: pin("a"), phase: "P2", inputDigest: pin("b") });
  if (status === "unknown") await binding.finish({ attempt, outcome: "unknown" });
  const second = fixture({ operationRoot: first.operationRoot, runId: "management-b" });
  await expect(createManagementMigrationJournal(second).begin(intent(second.runId))).rejects.toThrow("management-journal-binding-unresolved");
});

it("admits only one of two concurrent management begin calls", async () => {
  const first = fixture(); const second = fixture({ operationRoot: first.operationRoot, runId: "management-b" });
  const results = await Promise.allSettled([createManagementMigrationJournal(first).begin(intent(first.runId)), createManagementMigrationJournal(second).begin(intent(second.runId))]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});

it.each(["write", "admission"] as const)("does not clear an occupied %s lock", async kind => {
  const scope = fixture();
  const lock = kind === "write" ? `${scope.journal.journalPath}.write-lock` : path.join(path.dirname(scope.journal.journalPath), "phase-admission.write-lock");
  mkdirSync(lock, { mode: 0o700 });
  const before = journalBytes(scope.journal.journalPath);
  await expect(createManagementMigrationJournal(scope).begin(intent(scope.runId))).rejects.toThrow();
  expect(journalBytes(scope.journal.journalPath)).toEqual(before);
  // A second attempt still fails; the adapter never guesses a lock stale.
  await expect(createManagementMigrationJournal(scope).begin(intent(scope.runId))).rejects.toThrow();
});

it("refuses a run or target mismatch without recording an attempt", async () => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope);
  await expect(adapter.begin(intent("other-run"))).rejects.toThrow("intent-scope-mismatch");
  await expect(adapter.begin({ ...intent(scope.runId), target: { ...target, databaseOid: "99" } })).rejects.toThrow("intent-scope-mismatch");
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("absent");
  expect(() => createManagementMigrationJournal({ ...scope, operationRoot: path.join(scope.operationRoot, "missing") })).toThrow();
});

it("pins intent before awaiting the host probe", async () => {
  const scope = fixture(); const command = intent(scope.runId); const original = structuredClone(command);
  const adapter = createManagementMigrationJournal({ ...scope, assertHeld: async () => { command.preparationPlanDigest = pin("f"); } });
  const attempt = await adapter.begin(command);
  await adapter.finish(attempt, receiptOf(original));
  expect(() => verifyCommittedManagementMigration(scope.journal.record, command, receiptOf(command))).toThrow("receipt-mismatch");
  expect(verifyCommittedManagementMigration(scope.journal.record, original, receiptOf(original)).attemptId).toBe(attempt.attemptId);
});

it.each(["preparationPlanDigest", "sourceSnapshotDigest", "candidateInventoryDigest", "writeFenceReceiptDigest", "recoveryManifestDigest"] as const)("does not reuse a committed receipt after %s changes", async field => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope); const command = intent(scope.runId);
  const attempt = await adapter.begin(command); await adapter.finish(attempt, receiptOf(command));
  const changed = { ...command, [field]: pin("f") };
  expect(() => verifyCommittedManagementMigration(scope.journal.record, changed, receiptOf(changed))).toThrow("receipt-mismatch");
});

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid receipt count %s without closing pending", async verifiedRows => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope); const command = intent(scope.runId);
  const attempt = await adapter.begin(command);
  await expect(adapter.finish(attempt, { ...receiptOf(command), verifiedRows })).rejects.toThrow("receipt-mismatch");
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("pending");
});

it("requires a verified PostgreSQL checkpoint when the intent selected postgres", async () => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope);
  const command = { ...intent(scope.runId), checkpointMode: "postgres" as const };
  const attempt = await adapter.begin(command);
  const receipt = { ...receiptOf(intent(scope.runId)), intentDigest: sha256Prefixed(canonicalJson(command)), checkpoint: { mode: "postgres" as const, status: "skipped" as const } };
  await expect(adapter.finish(attempt, receipt)).rejects.toThrow("receipt-mismatch");
  await adapter.finish(attempt, { ...receipt, checkpoint: { mode: "postgres", status: "verified" } });
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("committed");
});

it("refuses target directory permission drift and a journal symlink", async () => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope);
  const directory = path.dirname(scope.journal.journalPath);
  chmodSync(directory, 0o755);
  await expect(adapter.begin(intent(scope.runId))).rejects.toThrow();
  chmodSync(directory, 0o700);
  symlinkSync(scope.journal.journalPath, path.join(directory, "another.json"));
  await expect(adapter.begin(intent(scope.runId))).rejects.toThrow("scope-unreadable");
});

it("refuses a stale journal handle and never writes using mutated in-memory state", async () => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope);
  scope.journal.record = { ...scope.journal.record, state: "planned" };
  await expect(adapter.begin(intent(scope.runId))).rejects.toThrow("stale-journal");
});

it("rejects orphan and duplicate terminal management events", async () => {
  const scope = fixture(); const adapter = createManagementMigrationJournal(scope); const command = intent(scope.runId);
  const attempt = await adapter.begin(command); await adapter.finish(attempt, receiptOf(command));
  const record = scope.journal.record;
  expect(() => readManagementMigrationAttempt({ ...record, entries: record.entries.slice(1) })).toThrow("attempt-conflict");
  expect(() => readManagementMigrationAttempt({ ...record, entries: [...record.entries, record.entries[1]!] })).toThrow("attempt-conflict");
});
