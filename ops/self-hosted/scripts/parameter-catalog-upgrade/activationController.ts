import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import type { Database } from "../../../../server/shared/database/client";
import { createApplicationReadActivation, createActivationIntent, type ActivationBinding, type ActivationIdentity,
  type ActivationInspection, type ActivationObservation } from "../../../../server/modules/catalog-cutover/activation";
import type { ComparisonReport } from "../../../../server/modules/release-verification/comparison";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import { runCatalogReleaseAction, type CatalogReleaseActionResult, type CatalogReleaseBoundary } from "../../../../scripts/run-self-hosted-release-gate";
import { createActivationJournal } from "./activationJournal";
import { assertHostOperationLockForJournal, type HostOperationLock } from "./handoff";
import { loadUpgradeJournal, type UpgradeJournal } from "./journal";

export type ActivationControllerObservation = {
  readonly activation: ActivationObservation;
  readonly phase: Pick<CatalogReleaseBoundary, "p12State" | "p13State" | "writerRetirementFingerprint" | "runtimePinGeneration">;
  readonly comparisonReport?: ComparisonReport;
};
export type ActivationControllerOptions = {
  readonly journal: UpgradeJournal;
  readonly lock: HostOperationLock;
  /** Actual management composition root; never command JSON or runtime credentials. */
  readonly owner: {
    readonly target: ActivationIdentity;
    readonly managementPool: pg.Pool;
    readonly reports: Database;
    verify(): Promise<void>;
    observe(): Promise<ActivationControllerObservation>;
  };
};
export type ActivationControllerCommand =
  | { readonly action: "activate-p12"; readonly attemptId: string; readonly reportDigest: string }
  | { readonly action: "inspect-activation"; readonly attemptId: string }
  | { readonly action: "reconcile-activation"; readonly attemptId: string };
export type ActivationControllerResult =
  | { readonly action: "activate-p12"; readonly admission: CatalogReleaseActionResult; readonly binding?: ActivationBinding }
  | { readonly action: "inspect-activation"; readonly inspection: ActivationInspection }
  | { readonly action: "reconcile-activation"; readonly outcome: "reconciled" | "not-applied" };
function refuse(): never { throw new Error("PCAT-UPG-ACTIVATION-CONTROLLER-REFUSED"); }

/** The caller already holds the genuine host lock. Nested owner callbacks only
 * verify that lease; the domain retains ownership of its own S7 SQL transaction.
 * No factory/operation override, implicit report approval or apply retry exists. */
export function openActivationController(options: ActivationControllerOptions) {
  const { journal, lock, owner } = options;
  const hostRunId = journal.record.runId;
  const journalPath = journal.journalPath;
  let busy = false;
  return {
    async dispatch(input: ActivationControllerCommand): Promise<ActivationControllerResult> {
      if (busy) refuse();
      busy = true;
      try {
        const command = structuredClone(input);
        if (!command || !["activate-p12", "inspect-activation", "reconcile-activation"].includes(command.action) ||
            typeof command.attemptId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(command.attemptId) ||
            Object.keys(command).sort().join(",") !== (command.action === "activate-p12" ? "action,attemptId,reportDigest" : "action,attemptId")) refuse();
        await assertHostOperationLockForJournal(lock, journalPath);
        const target = structuredClone(owner.target);
        const runId = journal.record.cutoverRunId, planDigest = journal.record.planDigest;
        if (!runId || !planDigest) refuse();
        let expectedRecord = structuredClone(journal.record);
        const verify = async () => {
          await assertHostOperationLockForJournal(lock, journalPath);
          const current = loadUpgradeJournal({ journalPath, runId: hostRunId, requireSettled: true });
          if (!current.ok || !isDeepStrictEqual(current.value.record, expectedRecord) || !isDeepStrictEqual(journal.record, expectedRecord) ||
              journal.record.runId !== hostRunId || journal.record.cutoverRunId !== runId || journal.record.planDigest !== planDigest ||
              journal.journalPath !== journalPath || !isDeepStrictEqual(owner.target, target)) refuse();
          const before = structuredClone(journal.record);
          await owner.verify();
          await assertHostOperationLockForJournal(lock, journalPath);
          const after = loadUpgradeJournal({ journalPath, runId: hostRunId, requireSettled: true });
          if (!after.ok || !isDeepStrictEqual(after.value.record, before) || !isDeepStrictEqual(journal.record, before)) refuse();
        };
        await verify();
        const last = journal.record.entries.filter(entry => entry.activation).at(-1)?.activation;
        if (command.action === "activate-p12" && last && last.outcome !== "not-applied") refuse();
        if (command.action !== "activate-p12" && (!last || last.intent.attemptId !== command.attemptId ||
            last.intent.runId !== runId || !isDeepStrictEqual(last.intent.target, target) || last.intent.planDigest !== planDigest)) refuse();
        if (command.action === "activate-p12" && typeof command.reportDigest !== "string") refuse();
        if (command.action === "activate-p12" && !command.reportDigest.trim()) {
          return { action: command.action, admission: { ok: false, reason: "missing-report" } };
        }
        const observe = async () => {
          await verify();
          const value = structuredClone(await owner.observe());
          await verify();
          return value;
        };
        // Reconciliation does not need a new report, comparison execution or
        // current pre-activation phase: it reads the exact already issued intent.
        const initial = command.action === "activate-p12" ? await observe() : undefined;
        let activation: ReturnType<typeof createApplicationReadActivation>;
        const activationJournal = createActivationJournal({ journal, target, cutoverRunId: runId,
          assertBoundary: verify, inspect: intent => activation.inspect(intent) });
        // Only this adapter's single append can advance the expected record.
        // A late owner observation or another component mutating the shared
        // journal object must not be silently adopted as current authority.
        const written = async (body: () => Promise<void>) => {
          const before = expectedRecord;
          await body();
          if (journal.record.entries.length !== before.entries.length + 1 ||
              !isDeepStrictEqual(journal.record.entries.slice(0, -1), before.entries) ||
              !journal.record.entries.at(-1)?.activation) refuse();
          expectedRecord = structuredClone(journal.record);
          await verify();
        };
        activation = createApplicationReadActivation({ target, managementPool: owner.managementPool, reports: owner.reports,
          comparisonReport: initial?.comparisonReport, journal: {
            pending: intent => written(() => activationJournal.pending(intent)),
            committed: binding => written(() => activationJournal.committed(binding)),
            unknown: intent => written(() => activationJournal.unknown(intent)),
          },
          boundary: {
            async withLockedBoundary(body) { await verify(); const result = await body(); await verify(); return result; },
            verify,
            async observe() {
              const current = await observe();
              if (!initial || !isDeepStrictEqual(current, initial)) refuse();
              return current.activation;
            },
          },
        });
        if (command.action === "reconcile-activation") {
          await written(() => activationJournal.reconcile());
          await verify();
          const outcome = journal.record.entries.filter(entry => entry.activation).at(-1)?.activation?.outcome;
          if (outcome !== "reconciled" && outcome !== "not-applied") refuse();
          return { action: command.action, outcome };
        }
        if (command.action === "inspect-activation") {
          const inspection = await activation.inspect(last!.intent);
          await verify();
          return { action: command.action, inspection };
        }
        const facts = await activation.inspectFacts(runId, planDigest);
        await verify();
        const intent = createActivationIntent({ runId, attemptId: command.attemptId, target, planDigest,
          reportDigest: command.reportDigest, predecessorBindingDigest: facts.currentBinding?.bindingDigest ?? null,
          expectedObservationDigest: digestOf(initial!.activation) });
        let binding: ActivationBinding | undefined;
        const admission = await runCatalogReleaseAction({ db: owner.reports, action: command.action, reportDigest: command.reportDigest,
          target: {
            async withExclusiveBoundary(body) { await verify(); const result = await body(); await verify(); return result; },
            async observeBoundary() {
              const current = await observe();
              if (!isDeepStrictEqual(current, initial)) refuse();
              return { ...current.activation, ...current.phase };
            },
            async activateP12() { await verify(); binding = await activation.apply(intent); await verify(); },
            async startCandidate() { refuse(); },
            async releasePublic() { refuse(); },
          },
        });
        await verify();
        if (admission.ok) {
          const acknowledged = journal.record.entries.filter(entry => entry.activation).at(-1)?.activation;
          if (!binding || acknowledged?.outcome !== "committed" || !isDeepStrictEqual(acknowledged.binding, binding) ||
              !isDeepStrictEqual(binding.intent, intent)) refuse();
        }
        return { action: command.action, admission, ...(admission.ok && binding ? { binding } : {}) };
      } catch { return refuse(); }
      finally { busy = false; }
    },
  };
}
