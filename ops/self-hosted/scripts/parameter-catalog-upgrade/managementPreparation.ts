import path from "node:path";
import { verifyControlledManagementMigrations, type ControlledManagementVerificationInput } from "../../../../scripts/migrate";
import type { ExecuteCutoverInput } from "../../../../server/modules/catalog-cutover/interface";
import { bindingJournalPath } from "./bindingJournal";
import { canonicalJson, loadUpgradeJournal, withJournalWriteLock } from "./journal";
import { assertNoUnresolvedManagementMigration, readManagementMigrationAttempt, verifyCommittedManagementMigration } from "./managementJournal";

/** Composition-root bridge, not a replacement verifier or release approval.
 * Secrets stay in the private management closure. P4 receives only pinned
 * metadata recomputed from the real target and its existing durable journal. */
export function createManagementMigrationPreparation(input: {
  environment: NodeJS.ProcessEnv;
  context: ControlledManagementVerificationInput;
  operationRoot: string;
  journalPath: string;
}): NonNullable<ExecuteCutoverInput["managementMigrations"]> {
  const environment = { DATABASE_URL: input.environment.DATABASE_URL, XIAOZE_CHECKPOINTER: input.environment.XIAOZE_CHECKPOINTER };
  const context = { ...input.context, intent: structuredClone(input.context.intent), descriptor: structuredClone(input.context.descriptor) };
  const scope = { operationRoot: input.operationRoot, target: context.intent.target };
  const journalPath = bindingJournalPath({ ...scope, runId: context.intent.runId });
  if (journalPath !== input.journalPath) throw new Error("management-preparation-journal-scope-mismatch");
  const observeJournal = () => withJournalWriteLock(path.join(path.dirname(journalPath), "phase-admission"), () => {
    assertNoUnresolvedManagementMigration(scope);
    const loaded = loadUpgradeJournal({ journalPath, runId: context.intent.runId, requireSettled: true });
    if (!loaded.ok) throw new Error("management-preparation-journal-unavailable");
    return loaded.value.record;
  });
  return {
    async verify(request) {
      const fixed = structuredClone(request);
      if (canonicalJson(fixed.target) !== canonicalJson(scope.target) || !/^sha256:[a-f0-9]{64}$/.test(fixed.receiptDigest)) throw new Error("management-preparation-target-mismatch");
      if (canonicalJson(fixed.preparation) !== canonicalJson({ runId: context.intent.runId,
        planDigest: context.intent.preparationPlanDigest, candidateArtifactSha: context.intent.candidateArtifactSha,
        candidateArtifactTree: context.intent.candidateArtifactTree })) throw new Error("management-preparation-applicability-mismatch");
      await context.operationLock.assertHeld();
      const before = observeJournal();
      const state = readManagementMigrationAttempt(before);
      if (state.status !== "committed" || state.receiptDigest !== fixed.receiptDigest) throw new Error("management-preparation-receipt-unavailable");
      const receipt = await verifyControlledManagementMigrations(environment, context);
      await context.operationLock.assertHeld();
      const after = observeJournal();
      if (before.journalDigest !== after.journalDigest) throw new Error("management-preparation-journal-changed");
      verifyCommittedManagementMigration(after, context.intent, receipt);
      return { receiptDigest: fixed.receiptDigest, sourceSnapshotDigest: receipt.sourceSnapshotDigest, candidateInventoryDigest: receipt.candidateInventoryDigest };
    },
  };
}
