import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
  type CutoverPlan,
  type ExecuteCutoverInput,
  type InspectCutoverInput,
  type PlanCutoverInput,
  type RecoverCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import type { PrepareVerificationInput } from "../../../../server/modules/release-verification/core";

import { inspectActionGuards, type CutoverPorts, type VerificationPorts } from "./actions";
import { createBindingCutoverJournal } from "./bindingJournal";
import { readManagementMigrationAttempt } from "./managementJournal";
import type { HostOperationLock } from "./handoff";
import {
  canonicalJson,
  commitJournalTransition,
  hasCommittedReplay,
  loadUpgradeJournal,
  openUpgradeJournal,
  sha256Prefixed,
  type JournalSnapshot,
  type UpgradeJournal,
} from "./journal";
import {
  failClosed,
  nextActionFor,
  resolveAction,
  transition,
  type ControllerResult,
  type ControllerState,
} from "./stateMachine";

export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixId, ThreatMatrixRow } from "./threatMatrix";

export type ControllerCommand = {
  readonly action: string;
  readonly input?: unknown;
};

export type ControllerSnapshot = JournalSnapshot & {
  readonly replayed: boolean;
};

export type ControllerDeps = {
  readonly journalPath: string;
  readonly runId: string;
  readonly cutover: CutoverPorts;
  readonly verification: VerificationPorts;
  readonly now?: () => Date;
  readonly operationLock?: HostOperationLock;
  readonly bindingJournalScope?: {
    readonly operationRoot: string;
    readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  };
};

export type CatalogUpgradeController = {
  dispatch(command: ControllerCommand): Promise<ControllerResult<ControllerSnapshot>>;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const digestOf = (value: unknown): string => sha256Prefixed(canonicalJson(value));

const inputDigestFor = (
  action: string,
  input: unknown,
  journal: UpgradeJournal,
): string => {
  const record = asRecord(input);
  if (action === "plan") {
    return digestOf({
      action: "plan",
      targetArtifactSha: record?.targetArtifactSha ?? null,
      targetCatalogReleaseDigest: record?.targetCatalogReleaseDigest ?? null,
      graph: record?.graph ?? null,
      conversionManifest: record?.conversionManifest ?? null,
      bindingImportIntent: record?.bindingImportIntent ?? null,
      bindingArchiveRetainUntil: record?.bindingArchiveRetainUntil ?? null,
      managementMigrationReceiptDigest: record?.managementMigrationReceiptDigest ?? null,
    });
  }
  if (action === "execute") {
    const plan = asRecord(record?.plan);
    return digestOf({
      action: "execute",
      planDigest: typeof plan?.planDigest === "string" ? plan.planDigest : null,
    });
  }
  if (action === "recover") {
    return digestOf({
      action: "recover",
      runId: record?.runId ?? journal.record.cutoverRunId,
      recordedAction: record?.recordedAction ?? null,
      runBoundToken: record?.runBoundToken ?? null,
    });
  }
  if (action === "prepareVerification") {
    return digestOf({
      action: "prepareVerification",
      input: record,
    });
  }
  if (action === "runVerification") {
    return digestOf({
      action: "runVerification",
      planDigest: record?.planDigest ?? journal.record.verificationPlanDigest,
    });
  }
  return digestOf({ action, input: record });
};

const withReplay = (journal: UpgradeJournal, replayed: boolean): ControllerSnapshot => ({
  ...journal.snapshot,
  replayed,
});

const phasesMatchFrozenContract = (plan: unknown): boolean => {
  const record = asRecord(plan);
  const phases = record?.phases;
  if (!Array.isArray(phases)) {
    return false;
  }
  if (phases.some((phase) => (UNAVAILABLE_PHASES as readonly string[]).includes(String(phase)))) {
    return false;
  }
  return phases.join("\0") === PRE_ACTIVATION_PHASES.join("\0");
};

const executePlanDigest = (input: unknown): string | null => {
  const record = asRecord(input);
  const plan = asRecord(record?.plan);
  return typeof plan?.planDigest === "string" ? plan.planDigest : null;
};

const recoverRunId = (input: unknown): string | null => {
  const record = asRecord(input);
  return typeof record?.runId === "string" ? record.runId : null;
};

const cutoverPinMatches = (input: unknown, planDigest: string | null): boolean => {
  if (!planDigest) {
    return false;
  }
  const record = asRecord(input);
  const pins = asRecord(record?.pins);
  const cutover = asRecord(pins?.cutover);
  return cutover?.planDigest === planDigest;
};

export const openCatalogUpgradeController = (
  deps: ControllerDeps,
): ControllerResult<CatalogUpgradeController> => {
  const opened = openUpgradeJournal({
    journalPath: deps.journalPath,
    runId: deps.runId,
    now: deps.now,
  });
  if (!opened.ok) {
    return opened;
  }
  const journal = opened.value;
  const clock = deps.now ?? (() => new Date());
  const bindingJournal = deps.bindingJournalScope ? createBindingCutoverJournal({ ...deps.bindingJournalScope, journal, assertEffectAllowed: () => {
    if (!deps.operationLock) throw new Error("handoff-lock-required");
    return deps.operationLock.assertHeld();
  } }) : undefined;

  const controller: CatalogUpgradeController = {
    async dispatch(command) {
      const current = loadUpgradeJournal({ journalPath: journal.journalPath, runId: journal.record.runId, requireSettled: true });
      if (!current.ok) return current;
      try {
        const management = readManagementMigrationAttempt(current.value.record);
        if (management.status === "pending" || management.status === "unknown") return failClosed("PCAT-UPG-UNKNOWN-OUTCOME", "management migration requires explicit reconciliation");
        // The Binding adapter reads every run under the same target admission
        // lock, including management outcomes, before any owner or replay.
        if (deps.bindingJournalScope && bindingJournal) await bindingJournal.unresolved(deps.bindingJournalScope.target);
      } catch { return failClosed("PCAT-UPG-UNKNOWN-OUTCOME", "target phase admission is unavailable"); }
      if (current.value.record.journalDigest !== journal.record.journalDigest) return failClosed("PCAT-UPG-ILLEGAL-ACTION", "journal changed; inspect before retry");
      try { await deps.operationLock?.assertHeld(); }
      catch { return failClosed("PCAT-UPG-ILLEGAL-ACTION", "handoff-lock-lost"); }
      const guard = inspectActionGuards(command.action, command.input);
      if (guard) {
        return { ok: false, error: guard };
      }
      if ((UNAVAILABLE_PHASES as readonly string[]).includes(command.action)) {
        return failClosed(
          "PCAT-UPG-ILLEGAL-ACTION",
          `activation phase ${command.action} is not a controller action`,
        );
      }

      const resolved = resolveAction(journal.record.state, command.action);
      if (!resolved.ok) {
        return resolved;
      }
      const action = resolved.value;
      const inputDigest = inputDigestFor(action, command.input, journal);
      const replayed = hasCommittedReplay(journal, action, inputDigest);
      if (replayed && action !== "execute" && action !== "plan") {
        return { ok: true, value: withReplay(journal, true) };
      }

      const legality = transition(journal.record.state, action);
      if (!legality.ok && !(replayed && (action === "execute" || action === "plan"))) {
        return legality;
      }

      if (action === "inspect") {
        if (journal.record.planDigest || journal.record.cutoverRunId) {
          const inspected = await deps.cutover.inspect({
            runId: journal.record.cutoverRunId ?? undefined,
            planDigest: journal.record.planDigest ?? undefined,
          } as InspectCutoverInput);
          if (!inspected.ok) {
            return failClosed(
              "PCAT-UPG-ILLEGAL-ACTION",
              `${inspected.error.code}: ${inspected.error.detail}`,
            );
          }
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      if (action === "plan") {
        const planned = await deps.cutover.plan(command.input as PlanCutoverInput);
        if (!planned.ok) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            `${planned.error.code}: ${planned.error.detail}`,
          );
        }
        if (replayed) {
          if (planned.value.planDigest !== journal.record.planDigest) return failClosed("PCAT-UPG-ILLEGAL-ACTION", "planned input is no longer applicable");
          return { ok: true, value: withReplay(journal, true) };
        }
        const committed = commitJournalTransition(
          journal,
          {
            action,
            inputDigest,
            toState: "planned",
            nextAction: nextActionFor("planned"),
            planDigest: planned.value.planDigest,
          },
          clock,
        );
        if (!committed.ok) {
          return committed;
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      if (action === "execute") {
        let executeInput = command.input as ExecuteCutoverInput;
        const plannedDigest = journal.record.planDigest;
        const incomingDigest = executePlanDigest(command.input);
        if (!plannedDigest || incomingDigest !== plannedDigest) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "execute plan digest must equal the journal plan digest",
          );
        }
        if (!phasesMatchFrozenContract(executeInput.plan)) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "execute plan phases must equal the frozen S7-ORC pre-activation contract",
          );
        }
        if (executeInput.bindingImportIntent || deps.bindingJournalScope || journal.record.entries.some(entry => entry.bindingPhase)) {
          if (!executeInput.bindingImportIntent || !bindingJournal || !deps.operationLock) return failClosed("PCAT-UPG-ILLEGAL-ACTION", "binding-controller-scope-and-live-lock-required");
          executeInput = { ...executeInput, bindingJournal };
        }
        try { await deps.operationLock?.assertHeld(); }
        catch { return failClosed("PCAT-UPG-ILLEGAL-ACTION", "handoff-lock-lost"); }
        const executed = await deps.cutover.execute(executeInput);
        if (!executed.ok) {
          if (executed.error.code === "PCAT-ORC-CRASH") {
            const committed = commitJournalTransition(
              journal,
              {
                action,
                inputDigest,
                toState: "executing",
                nextAction: nextActionFor("executing", "crash"),
                planDigest: executeInput.plan.planDigest,
                outcome: "crashed",
                lastFailureCode: executed.error.code,
              },
              clock,
            );
            if (!committed.ok) {
              return committed;
            }
            return { ok: true, value: withReplay(journal, false) };
          }
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            `${executed.error.code}: ${executed.error.detail}`,
          );
        }
        if (replayed) {
          if (executed.value.state !== "completed" || executed.value.runId !== journal.record.cutoverRunId || executed.value.planDigest !== journal.record.planDigest) return failClosed("PCAT-UPG-ILLEGAL-ACTION", "committed execute no longer matches live Cutover state");
          return { ok: true, value: withReplay(journal, true) };
        }
        const completed = executed.value.state === "completed";
        const toState: ControllerState = completed ? "cutover-completed" : "executing";
        const committed = commitJournalTransition(
          journal,
          {
            action,
            inputDigest,
            toState,
            nextAction: nextActionFor(toState, completed ? "ok" : undefined),
            planDigest: executed.value.planDigest,
            cutoverRunId: executed.value.runId,
          },
          clock,
        );
        if (!committed.ok) {
          return committed;
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      if (action === "recover") {
        if (
          journal.record.cutoverRunId &&
          recoverRunId(command.input) !== journal.record.cutoverRunId
        ) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "recover run identity must equal the journal cutover run",
          );
        }
        const recovered = await deps.cutover.recover(command.input as RecoverCutoverInput);
        if (!recovered.ok) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            `${recovered.error.code}: ${recovered.error.detail}`,
          );
        }
        const committed = commitJournalTransition(
          journal,
          {
            action,
            inputDigest,
            toState: "recovery-required",
            nextAction: nextActionFor("recovery-required"),
            cutoverRunId: recovered.value.runId,
            planDigest: recovered.value.planDigest,
          },
          clock,
        );
        if (!committed.ok) {
          return committed;
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      if (action === "prepareVerification") {
        if (!cutoverPinMatches(command.input, journal.record.planDigest)) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "prepareVerification cutover pin must equal the journal plan digest",
          );
        }
        const prepared = await deps.verification.prepareVerification(
          command.input as PrepareVerificationInput,
        );
        if (!prepared.ok) {
          if (
            prepared.error.kind === "caller-gate-selection-forbidden" ||
            prepared.error.kind === "waiver-forbidden"
          ) {
            return failClosed("PCAT-UPG-GATE-SELECTION-FORBIDDEN", prepared.error.detail);
          }
          return failClosed("PCAT-UPG-ILLEGAL-ACTION", prepared.error.detail);
        }
        const committed = commitJournalTransition(
          journal,
          {
            action,
            inputDigest,
            toState: "verification-prepared",
            nextAction: nextActionFor("verification-prepared"),
            verificationPlanDigest: prepared.value.digest,
          },
          clock,
        );
        if (!committed.ok) {
          return committed;
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      if (action === "runVerification") {
        const record = asRecord(command.input);
        const planDigest =
          typeof record?.planDigest === "string"
            ? record.planDigest
            : journal.record.verificationPlanDigest;
        if (!planDigest || planDigest !== journal.record.verificationPlanDigest) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "runVerification must use the journal verification plan digest",
          );
        }
        const ran = await deps.verification.runVerification(planDigest);
        if (!ran.ok) {
          if (
            ran.error.kind === "caller-gate-selection-forbidden" ||
            ran.error.kind === "waiver-forbidden"
          ) {
            return failClosed("PCAT-UPG-GATE-SELECTION-FORBIDDEN", ran.error.detail);
          }
          return failClosed("PCAT-UPG-ILLEGAL-ACTION", ran.error.detail);
        }
        const committed = commitJournalTransition(
          journal,
          {
            action,
            inputDigest,
            toState: "verification-ran",
            nextAction: nextActionFor("verification-ran"),
            verificationAttemptDigest: ran.value.digest,
          },
          clock,
        );
        if (!committed.ok) {
          return committed;
        }
        return { ok: true, value: withReplay(journal, false) };
      }

      return failClosed(
        "PCAT-UPG-ILLEGAL-ACTION",
        `action ${command.action} is not legal in state ${journal.record.state}`,
      );
    },
  };

  return { ok: true, value: controller };
};

export type ConsumedCutoverPlan = CutoverPlan;
