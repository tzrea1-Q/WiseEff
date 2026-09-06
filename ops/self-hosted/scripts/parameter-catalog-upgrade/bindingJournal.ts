import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BindingCutoverJournal, BindingPhaseAttempt } from "../../../../server/modules/catalog-cutover/interface";
import {
  canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed,
  withJournalWriteLock, type BindingPhaseEvent, type UpgradeJournal,
} from "./journal";

type Target = BindingPhaseEvent["target"];
type Scope = { operationRoot: string; target: Target };
function fail(reason: string): never { throw new Error(reason); }
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function targetDirectory({ operationRoot, target }: Scope): string {
  if (!path.isAbsolute(operationRoot) || !/^[0-9]+$/.test(target.systemIdentifier) || !/^[0-9]+$/.test(target.databaseOid)) fail("binding-journal-invalid-scope");
  let root: string;
  try { root = realpathSync(operationRoot); } catch { return fail("binding-journal-location-mismatch"); }
  return path.join(root, "catalog-journals", sha256Prefixed(canonicalJson(target)).slice(7));
}

/** The operation root comes from the handoff's pinned private configuration,
 * never a CLI-selected alternate run directory. All runs share this target scope. */
export function bindingJournalPath(input: Scope & { runId: string }): string {
  if (!/^[A-Za-z0-9_-]+$/.test(input.runId)) fail("binding-journal-invalid-run");
  const directory = targetDirectory(input);
  for (const current of [path.dirname(directory), directory]) {
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) fail("binding-journal-unsafe-directory");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return path.join(directory, `${input.runId}.json`);
}

export function createBindingCutoverJournal(input: Scope & { journal: UpgradeJournal; assertEffectAllowed?: () => Promise<void> }): BindingCutoverJournal {
  input = { ...input, target: { ...input.target } };
  const { journal } = input;
  const issued = new Set<string>();
  const directory = targetDirectory(input);
  if (journal.journalPath !== bindingJournalPath({ ...input, runId: journal.record.runId })) fail("binding-journal-location-mismatch");
  const assertDirectory = () => {
    for (const current of [path.dirname(directory), directory]) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) fail("binding-journal-unsafe-directory");
    }
  };
  const assertTarget = (target: Target) => { if (!same(target, input.target)) fail("binding-journal-target-mismatch"); };
  const latest = (): Map<string, BindingPhaseEvent> => {
    assertDirectory();
    const events = new Map<string, BindingPhaseEvent>();
    for (const name of readdirSync(directory).sort()) {
      if (name.endsWith(".json.write-lock")) fail("binding-journal-write-outcome-unavailable");
      if (!name.endsWith(".json")) continue;
      const loaded = loadUpgradeJournal({ journalPath: path.join(directory, name), runId: name.slice(0, -5) });
      if (!loaded.ok) fail("binding-journal-scope-unreadable");
      for (const entry of loaded.value.record.entries) {
        const event = entry.bindingPhase;
        if (!event) continue;
        assertTarget(event.target);
        const previous = events.get(event.attemptId);
        if (!previous && event.outcome !== "pending") fail("binding-journal-orphan-outcome");
        if (previous && (previous.outcome !== "pending" || !same({ ...previous, outcome: event.outcome }, event))) fail("binding-journal-event-conflict");
        events.set(event.attemptId, event);
      }
    }
    return events;
  };
  const unresolved = () => [...latest().values()].filter(event => event.outcome === "pending" || event.outcome === "unknown");
  const attemptOf = (event: BindingPhaseEvent): BindingPhaseAttempt => ({ attemptId: event.attemptId, runId: event.runId, planDigest: event.planDigest, phase: event.phase });
  const append = (event: BindingPhaseEvent) => {
    const committed = commitJournalTransition(journal, {
      action: `binding-phase-${event.outcome}`, inputDigest: sha256Prefixed(canonicalJson(event)),
      toState: journal.record.state, nextAction: journal.record.nextAction,
      outcome: event.outcome === "committed" || event.outcome === "failed" ? "committed" : "crashed",
      cutoverRunId: event.runId, bindingPhase: event,
    });
    if (!committed.ok) fail("binding-journal-append-unavailable");
  };
  // This serializes target admission, including different run files. It does not
  // replace the deployment lock or the database advisory lock held by Cutover.
  const locked = <T>(action: () => T): T => { assertDirectory(); return withJournalWriteLock(path.join(directory, "phase-admission"), action); };
  return {
    async unresolved(target) {
      assertTarget(target);
      return locked(() => unresolved().map(event => ({ ...attemptOf(event), outcome: event.outcome as "pending" | "unknown" })));
    },
    async begin(intent) {
      await input.assertEffectAllowed?.();
      assertTarget(intent.target);
      if (!/^[A-Za-z0-9_-]+$/.test(intent.runId) || !/^P(?:[0-9]|10)$/.test(intent.phase) ||
          !/^sha256:[a-f0-9]{64}$/.test(intent.planDigest) || !/^sha256:[a-f0-9]{64}$/.test(intent.inputDigest)) fail("binding-journal-invalid-intent");
      const attempt = locked(() => {
        if (unresolved().length) fail("binding-journal-unresolved");
        const event: BindingPhaseEvent = { ...intent, target: { ...intent.target }, attemptId: randomUUID(), outcome: "pending" };
        append(event);
        issued.add(event.attemptId);
        return attemptOf(event);
      });
      await input.assertEffectAllowed?.();
      return attempt;
    },
    async finish({ attempt, outcome }) {
      if (!["committed", "failed", "unknown"].includes(outcome)) fail("binding-journal-invalid-outcome");
      if (!issued.has(attempt.attemptId)) {
        if (journal.record.entries.some(entry => entry.bindingPhase?.attemptId === attempt.attemptId)) fail("binding-journal-reconciliation-required");
        fail("binding-journal-attempt-mismatch");
      }
      if (outcome === "committed") await input.assertEffectAllowed?.();
      return locked(() => {
        if (!journal.record.entries.some(entry => entry.bindingPhase?.attemptId === attempt.attemptId)) fail("binding-journal-attempt-mismatch");
        const event = latest().get(attempt.attemptId);
        if (!event || !same(attemptOf(event), attempt)) fail("binding-journal-attempt-mismatch");
        if (event.outcome === outcome) return;
        if (event.outcome !== "pending") fail("binding-journal-outcome-conflict");
        append({ ...event, outcome });
      });
    },
  };
}
