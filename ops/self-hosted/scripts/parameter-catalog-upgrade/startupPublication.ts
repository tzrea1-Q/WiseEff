import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createApplicationReadActivation, type ActivationOptions } from "../../../../server/modules/catalog-cutover/activation";
import { createVerificationReportService } from "../../../../server/modules/release-verification/report";
import { assertHostOperationLockForJournal, type HostOperationLock } from "./handoff";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed, validStartupPublicationIntent,
  type StartupPublicationEvent, type StartupPublicationIntent, type UpgradeJournal } from "./journal";

export class StartupPublicationRefusal extends Error {
  constructor(readonly reason: "boundary-unavailable" | "journal-unavailable" | "intent-mismatch" | "activation-unavailable" |
    "activation-report-unavailable" | "p13-producer-unavailable") {
    super(`PCAT-UPG-STARTUP-PUBLICATION-${reason.toUpperCase()}`); this.name = "StartupPublicationRefusal";
  }
}
const refuse = (reason: StartupPublicationRefusal["reason"]): never => { throw new StartupPublicationRefusal(reason); };
const snapshot = <T>(value: T): T => { try { return structuredClone(value); } catch { return refuse("intent-mismatch"); } };
const digest = (value: unknown) => sha256Prefixed(canonicalJson(value));
type Scope = { journal: UpgradeJournal; lock: HostOperationLock };

/** The existing host journal is the only publication store. This helper holds
 * the original directory FD across asynchronous boundary checks; it does not
 * acquire another host lock or authorize actions from its contents. */
async function withCustody<T>(scope: Scope, body: (verify: () => Promise<void>) => Promise<T>): Promise<T> {
  const journalPath = scope.journal.journalPath;
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  let failed: unknown;
  try {
    await assertHostOperationLockForJournal(scope.lock, journalPath);
    directory = await open(path.dirname(journalPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const original = await directory.stat();
    const verify = async () => {
      await assertHostOperationLockForJournal(scope.lock, journalPath);
      const held = await directory!.stat(), named = await lstat(path.dirname(journalPath));
      if (scope.journal.journalPath !== journalPath || held.dev !== original.dev || held.ino !== original.ino ||
        named.dev !== original.dev || named.ino !== original.ino) refuse("boundary-unavailable");
      await assertHostOperationLockForJournal(scope.lock, journalPath);
    };
    await verify();
    return await body(verify);
  } catch (error) {
    failed = error;
    throw error instanceof StartupPublicationRefusal ? error : new StartupPublicationRefusal("boundary-unavailable");
  } finally {
    try { await directory?.close(); } catch { if (!failed) refuse("boundary-unavailable"); }
  }
}

/** Storage-only adapter, analogous to ActivationJournal. Inputs are persistence
 * records, not evidence of P13 or approval. No production startup consumer may
 * treat its result as a StartupTarget. The public publisher below is the sole
 * admission path and deliberately cannot issue while P13's producer is absent.
 *
 * generation is local to this host journal. It does not establish a global
 * target head or runtimePinGeneration. A new process may inspect exact bytes;
 * it cannot acknowledge a predecessor's pending/unknown attempt or clear a
 * durability lock. Reconciliation with current owner state remains mandatory
 * before any future runtime action, including after a committed readback.
 */
export function openStartupPublicationStorage(options: Scope) {
  const { journal, lock } = options;
  const journalPath = journal.journalPath, hostRunId = journal.record.runId, cutoverRunId = journal.record.cutoverRunId;
  let expectedRecord = snapshot(journal.record);
  let issued: StartupPublicationIntent | undefined;
  let busy = false;
  const current = () => {
    const loaded = loadUpgradeJournal({ journalPath, runId: hostRunId, requireSettled: true });
    if (!loaded.ok || journal.journalPath !== journalPath || loaded.value.record.cutoverRunId !== cutoverRunId ||
      !isDeepStrictEqual(loaded.value.record, expectedRecord) || !isDeepStrictEqual(journal.record, expectedRecord)) return refuse("journal-unavailable");
    return journal.record.entries.filter(entry => entry.publication).at(-1)?.publication;
  };
  const guarded = async <T>(body: (verify: () => Promise<void>) => Promise<T>): Promise<T> => {
    if (busy) return refuse("boundary-unavailable");
    busy = true;
    try { return await withCustody({ journal, lock }, async verify => { current(); return body(verify); }); }
    finally { busy = false; }
  };
  const append = (event: StartupPublicationEvent) => {
    const result = commitJournalTransition(journal, { action: `startup-publication-${event.outcome}`, inputDigest: digest(event),
      toState: journal.record.state, nextAction: journal.record.nextAction,
      outcome: event.outcome === "committed" ? "committed" : "crashed", publication: event });
    if (!result.ok) refuse("journal-unavailable");
    expectedRecord = snapshot(journal.record);
  };
  const finish = (outcome: "committed" | "unknown", intentDigest: string) => guarded(async verify => {
    const event = current();
    if (!issued || issued.intentDigest !== intentDigest || !event || event.outcome !== "pending" ||
      !isDeepStrictEqual(event.intent, issued)) return refuse("intent-mismatch");
    const selected = snapshot(issued);
    await verify(); current();
    // No asynchronous work between the final held-lock check and persistence.
    append({ outcome, intent: selected });
    issued = undefined;
    await verify(); current();
  });
  return {
    async pending(input: StartupPublicationIntent) {
      const intent = snapshot(input);
      return guarded(async verify => {
        if (!validStartupPublicationIntent(intent) || intent.hostRunId !== hostRunId || intent.cutoverRunId !== cutoverRunId) refuse("intent-mismatch");
        await verify(); current();
        append({ outcome: "pending", intent });
        issued = intent;
        await verify(); current();
      });
    },
    committed: (intentDigest: string) => finish("committed", intentDigest),
    unknown: (intentDigest: string) => finish("unknown", intentDigest),
    async inspect(input: { attemptId: string; intentDigest: string }) {
      const selected = snapshot(input);
      return guarded(async verify => {
        const event = current();
        if (!event || event.intent.attemptId !== selected.attemptId || event.intent.intentDigest !== selected.intentDigest) return refuse("intent-mismatch");
        const result = snapshot(event);
        await verify();
        if (!isDeepStrictEqual(current(), result)) refuse("journal-unavailable");
        return { scope: "publication-storage-only" as const, event: result };
      });
    },
  };
}

/** Real source preconditions for the root publisher, not a callback-based
 * boundary or an environment/JSON pin loader. It does not issue a publication
 * from a login-fence fingerprint. Existing P13 completion/current-head and
 * independent complete pin producers are not implemented yet. Once supplied
 * by their real owners, publication must also use the existing runtime report
 * projection; this missing branch must not be replaced by caller booleans.
 */
export async function prepareStartupPublication(options: Scope & { activation: ActivationOptions }): Promise<never> {
  const { journal, lock } = options;
  const expected = snapshot(journal.record);
  const activationOptions = { ...options.activation, target: snapshot(options.activation.target) };
  return withCustody({ journal, lock }, async verify => {
    const verifyRecord = async () => {
      await verify();
      const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: expected.runId, requireSettled: true });
      if (!loaded.ok || !isDeepStrictEqual(loaded.value.record, expected) || !isDeepStrictEqual(journal.record, expected)) refuse("journal-unavailable");
    };
    await verifyRecord();
    const event = expected.entries.filter(entry => entry.activation).at(-1)?.activation;
    if (!event?.binding || !["committed", "reconciled"].includes(event.outcome) ||
      !isDeepStrictEqual(event.intent.target, activationOptions.target)) return refuse("activation-unavailable");
    const actual = await createApplicationReadActivation(activationOptions).inspect(event.intent);
    await verifyRecord();
    if (actual.kind !== "applied" || actual.currentHeadDigest !== event.binding.bindingDigest ||
      !isDeepStrictEqual(actual.binding, event.binding)) return refuse("activation-unavailable");
    const report = await createVerificationReportService({ db: activationOptions.reports }).readReport(event.intent.reportDigest);
    await verifyRecord();
    if (report.kind !== "present" || report.report.digest !== event.intent.reportDigest ||
      report.report.purpose !== "pre-activation") return refuse("activation-report-unavailable");
    // No full P13 effect/readback producer exists. In particular the existing
    // authentication-fenced-not-P13 outcome cannot issue runtime generation.
    return refuse("p13-producer-unavailable");
  });
}
