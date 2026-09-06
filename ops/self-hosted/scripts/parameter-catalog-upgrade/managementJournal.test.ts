import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { bindingJournalPath } from "./bindingJournal";
import { canonicalJson, commitJournalTransition, openUpgradeJournal, sha256Prefixed } from "./journal";
import { createManagementMigrationJournal, readManagementMigrationAttempt, verifyCommittedManagementMigration } from "./managementJournal";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const pin = (character: string) => `sha256:${character.repeat(64)}`;
const target = { systemIdentifier: "123", databaseOid: "45" };
const intent = (runId: string) => ({ version: "pcat-management-migration-intent-v1" as const, runId,
  planDigest: pin("a"), target, sourceSnapshotDigest: pin("b"), candidateInventoryDigest: pin("c"),
  writeFenceReceiptDigest: pin("d"), recoveryManifestDigest: pin("e"), checkpointMode: "memory" as const });
function fixture() {
  const operationRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "upg-management-journal-")));
  roots.push(operationRoot);
  const runId = "management-a";
  const journalPath = bindingJournalPath({ operationRoot, target, runId });
  const opened = openUpgradeJournal({ journalPath, runId });
  if (!opened.ok) throw new Error("fixture-journal-open-failed");
  const journal = opened.value;
  if (!commitJournalTransition(journal, { action: "plan", inputDigest: pin("a"), planDigest: pin("a"), toState: "planned", nextAction: "execute" }).ok) throw new Error("fixture-plan-failed");
  return { journal, operationRoot, runId, target, assertHeld: async () => {} };
}

it("requires a fresh receipt to verify the one durable management attempt without changing controller state", async () => {
  const scope = fixture();
  const journal = createManagementMigrationJournal(scope);
  const command = intent(scope.runId);
  const receipt = { version: "pcat-management-migration-receipt-v1" as const,
    intentDigest: sha256Prefixed(canonicalJson(command)), sourceSnapshotDigest: command.sourceSnapshotDigest,
    candidateInventoryDigest: command.candidateInventoryDigest, verifiedRelations: 100, verifiedRows: 7,
    appliedSuffix: 11, checkpoint: { mode: "memory" as const, status: "skipped" as const } };
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("absent");
  const attempt = await journal.begin(command);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("pending");
  await journal.finish(attempt, receipt);
  expect(readManagementMigrationAttempt(scope.journal.record).status).toBe("committed");
  expect(scope.journal.record.state).toBe("planned");
  expect(verifyCommittedManagementMigration(scope.journal.record, command, receipt).attemptId).toBe(attempt.attemptId);
  expect(() => verifyCommittedManagementMigration(scope.journal.record, command, { ...receipt, verifiedRows: 8 })).toThrow("management-journal-receipt-mismatch");
  await expect(journal.begin(command)).rejects.toThrow("management-journal-attempt-already-recorded");
});
