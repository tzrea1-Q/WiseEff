import type {
  CutoverPlan,
  CutoverResult,
  CutoverRunSnapshot,
  ExecuteCutoverInput,
  InspectCutoverInput,
  PlanCutoverInput,
  RecoverCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import type {
  PrepareVerificationInput,
  ReleaseVerificationService,
} from "../../../../server/modules/release-verification/core";

import { failClosed, type ControllerRefusal } from "./stateMachine";

export type CutoverPorts = {
  readonly plan: (input: PlanCutoverInput) => Promise<CutoverResult<CutoverPlan>>;
  readonly execute: (input: ExecuteCutoverInput) => Promise<CutoverResult<CutoverRunSnapshot>>;
  readonly inspect: (input: InspectCutoverInput) => Promise<CutoverResult<CutoverRunSnapshot>>;
  readonly recover: (input: RecoverCutoverInput) => Promise<CutoverResult<CutoverRunSnapshot>>;
};

export type VerificationPorts = {
  readonly prepareVerification: ReleaseVerificationService["prepareVerification"];
  readonly runVerification: ReleaseVerificationService["runVerification"];
};

export type ConsumedS7OrcPlanInput = PlanCutoverInput;
export type ConsumedS7OrcExecuteInput = ExecuteCutoverInput;
export type ConsumedS7OrcInspectInput = InspectCutoverInput;
export type ConsumedS7OrcRecoverInput = RecoverCutoverInput;
export type ConsumedS10PerPrepareInput = PrepareVerificationInput;

const GATE_CONTROL_KEYS = new Set([
  "gates",
  "gateIds",
  "gateList",
  "gateSelection",
  "waiver",
  "waive",
  "waived",
  "skip",
  "skipped",
  "skippedAsWaived",
]);

const API_MIGRATE_KEYS = new Set([
  "migrateViaApi",
  "startupMigration",
  "apiMigration",
  "migrateThroughApi",
  "startupMigrate",
]);

const GUESS_KEYS = new Set([
  "guessedCommit",
  "guessedOutcome",
  "unknownCommitGuess",
  "guessedCommitOutcome",
]);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const collectKeys = (value: unknown, found: string[]): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    found.push(key);
    collectKeys(child, found);
  }
};

export const asPrepareVerificationCutover = (
  plan: CutoverPlan,
): PrepareVerificationInput["pins"]["cutover"] => ({
  planDigest: plan.planDigest,
  contractVersion: plan.migrationContractVersion,
  sourceSnapshotFingerprint: plan.sourceSnapshotFingerprint,
});

export const inspectActionGuards = (
  action: string,
  input: unknown,
): ControllerRefusal | null => {
  if (action === "selectGates") {
    return failClosed(
      "PCAT-UPG-GATE-SELECTION-FORBIDDEN",
      "caller supplied gate selection",
    ).error;
  }
  if (action === "migrateViaApi") {
    return failClosed(
      "PCAT-UPG-API-MIGRATE-FORBIDDEN",
      "API startup migration is not a controller action",
    ).error;
  }
  if (action === "guessUnknownCommit") {
    return failClosed(
      "PCAT-UPG-UNKNOWN-OUTCOME",
      "Unknown commit outcome cannot be guessed",
    ).error;
  }

  const found: string[] = [];
  collectKeys(input, found);
  if (found.some((key) => API_MIGRATE_KEYS.has(key))) {
    return failClosed(
      "PCAT-UPG-API-MIGRATE-FORBIDDEN",
      `caller supplied ${found.filter((key) => API_MIGRATE_KEYS.has(key)).join(",")}`,
    ).error;
  }
  if (found.some((key) => GUESS_KEYS.has(key))) {
    return failClosed(
      "PCAT-UPG-UNKNOWN-OUTCOME",
      `caller supplied ${found.filter((key) => GUESS_KEYS.has(key)).join(",")}`,
    ).error;
  }
  if (found.some((key) => GATE_CONTROL_KEYS.has(key))) {
    return failClosed(
      "PCAT-UPG-GATE-SELECTION-FORBIDDEN",
      `caller supplied ${found.filter((key) => GATE_CONTROL_KEYS.has(key)).join(",")}`,
    ).error;
  }

  const record = asRecord(input);
  if (record && "gateSelectionSource" in record && record.gateSelectionSource !== "registry") {
    return failClosed(
      "PCAT-UPG-GATE-SELECTION-FORBIDDEN",
      "caller supplied gateSelectionSource",
    ).error;
  }
  return null;
};
