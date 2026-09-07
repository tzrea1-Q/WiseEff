import { canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed, validActivationBinding, validActivationIntent,
  type ActivationBindingRecord, type ActivationIntentRecord, type ActivationJournalEvent, type UpgradeJournal } from "./journal";

export type ActivationReadback =
  | { readonly kind: "applied"; readonly binding: ActivationBindingRecord; readonly currentHeadDigest: string }
  | { readonly kind: "not-applied"; readonly intent: ActivationIntentRecord; readonly currentHeadDigest: string | null };

const refuse = (): never => { throw new Error("PCAT-UPG-ACTIVATION-JOURNAL-REFUSED"); };
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const snapshot = <T>(value: T): T => { try { return structuredClone(value); } catch { return refuse(); } };

/** Persistence adapter for the formal Cutover ActivationJournal port. The
 * controller owns the live target/host lock and supplies its real boundary
 * assertion and the domain's inspectAppliedBinding readback. These are code
 * dependencies, never CLI/JSON/environment receipts. No DB, restore, runtime,
 * queue or proxy effect is performed here. A committed host record does not
 * replace the next action's live SQL observation or approval.
 *
 * pending must return before SQL begins; committed receives the exact binding
 * after the domain acknowledges SQL commit. A newly opened adapter cannot
 * manufacture that acknowledgment: pending/unknown require explicit reconcile.
 */
export function createActivationJournal(options: {
  readonly journal: UpgradeJournal;
  readonly target: ActivationIntentRecord["target"];
  readonly cutoverRunId: string;
  readonly assertBoundary: () => Promise<void>;
  readonly inspect: (intent: ActivationIntentRecord) => Promise<ActivationReadback>;
}) {
  const { journal, assertBoundary, inspect } = options;
  if (typeof assertBoundary !== "function" || typeof inspect !== "function") refuse();
  const target = snapshot(options.target);
  const hostRunId = journal.record.runId;
  const cutoverRunId = options.cutoverRunId;
  let issued: ActivationIntentRecord | undefined;
  let busy = false;
  const current = () => {
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: hostRunId, requireSettled: true });
    if (!loaded.ok || !same(loaded.value.record, journal.record) ||
      loaded.value.record.cutoverRunId !== cutoverRunId) refuse();
    return journal.record.entries.filter(entry => entry.activation).at(-1)?.activation;
  };
  const scope = (intent: ActivationIntentRecord) => {
    if (!validActivationIntent(intent) || intent.runId !== cutoverRunId || !same(intent.target, target)) refuse();
  };
  const append = (event: ActivationJournalEvent) => {
    const result = commitJournalTransition(journal, { action: `activation-${event.outcome}`,
      inputDigest: sha256Prefixed(canonicalJson(event)), toState: journal.record.state, nextAction: journal.record.nextAction,
      outcome: ["pending", "unknown"].includes(event.outcome) ? "crashed" : "committed", activation: event });
    if (!result.ok) refuse();
  };
  const guarded = async (body: () => Promise<void>) => {
    if (busy) refuse();
    busy = true;
    try { await assertBoundary(); current(); await body(); }
    catch { refuse(); }
    finally { busy = false; }
  };
  return {
    async pending(value: ActivationIntentRecord) {
      const intent = snapshot(value);
      return guarded(async () => {
        scope(intent);
        append({ hostRunId, outcome: "pending", intent });
        issued = intent;
      });
    },
    async committed(value: ActivationBindingRecord) {
      const binding = snapshot(value);
      return guarded(async () => {
        if (!validActivationBinding(binding) || !issued || !same(issued, binding.intent)) refuse();
        scope(binding.intent);
        const event = current();
        if (!event || !["pending", "committed"].includes(event.outcome) || !same(event.intent, issued)) refuse();
        append({ hostRunId, outcome: "committed", intent: binding.intent, binding });
      });
    },
    async unknown(value: ActivationIntentRecord) {
      const intent = snapshot(value);
      return guarded(async () => {
        scope(intent);
        if (!issued || !same(issued, intent)) refuse();
        append({ hostRunId, outcome: "unknown", intent });
        issued = undefined;
      });
    },
    async reconcile() {
      return guarded(async () => {
        const event = current();
        if (!event || !["pending", "unknown"].includes(event.outcome)) return refuse();
        const intent = structuredClone(event.intent);
        scope(intent);
        const expectedJournalDigest = journal.record.journalDigest;
        const inspection = structuredClone(await inspect(structuredClone(intent)));
        // The readback may take time. Keep the host boundary and full-record
        // CAS applicable; no changed observation or journal is guessed safe.
        await assertBoundary(); current();
        if (journal.record.journalDigest !== expectedJournalDigest) refuse();
        if (inspection?.kind === "applied" && Object.keys(inspection).sort().join(",") === "binding,currentHeadDigest,kind" &&
          validActivationBinding(inspection.binding) && same(inspection.binding.intent, intent) &&
          inspection.currentHeadDigest === inspection.binding.bindingDigest) {
          append({ hostRunId, outcome: "reconciled", intent, binding: inspection.binding });
        } else if (inspection?.kind === "not-applied" && Object.keys(inspection).sort().join(",") === "currentHeadDigest,intent,kind" &&
          same(inspection.intent, intent) && inspection.currentHeadDigest === intent.predecessorBindingDigest) {
          append({ hostRunId, outcome: "not-applied", intent });
        } else refuse();
        issued = undefined;
      });
    },
  };
}
