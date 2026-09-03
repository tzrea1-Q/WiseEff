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
import {
  canonicalJson,
  commitJournalTransition,
  hasCommittedReplay,
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
    });
  }
  if (action === "execute") {
    const plan = asRecord(record?.plan);
    return digestOf({
      action: "execute",
      planDigest: plan?.planDigest ?? journal.record.planDigest,
    });
  }
  if (action === "recover") {
    return digestOf({
      action: "recover",
      runId: record?.runId ?? journal.record.cutoverRunId,
      recordedAction: record?.recordedAction ?? null,
    });
  }
  if (action === "prepareVerification") {
    const pins = asRecord(record?.pins);
    const cutover = asRecord(pins?.cutover);
    return digestOf({
      action: "prepareVerification",
      purpose: record?.purpose ?? null,
      mode: record?.mode ?? null,
      cutoverPlanDigest: cutover?.planDigest ?? journal.record.planDigest,
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
    return true;
  }
  return phases.join("\0") === PRE_ACTIVATION_PHASES.join("\0");
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

  const controller: CatalogUpgradeController = {
    async dispatch(command) {
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
      if (hasCommittedReplay(journal, action, inputDigest)) {
        return { ok: true, value: withReplay(journal, true) };
      }

      const legality = transition(journal.record.state, action);
      if (!legality.ok) {
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
        const executeInput = command.input as ExecuteCutoverInput;
        if (!phasesMatchFrozenContract(executeInput.plan)) {
          return failClosed(
            "PCAT-UPG-ILLEGAL-ACTION",
            "execute plan phases must equal the frozen S7-ORC pre-activation contract",
          );
        }
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
