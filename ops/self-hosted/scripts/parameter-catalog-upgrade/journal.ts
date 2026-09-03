import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  failClosed,
  parseControllerState,
  type ControllerResult,
  type ControllerState,
  type LegalAction,
} from "./stateMachine";

export const UPGRADE_CONTROLLER_SCHEMA_VERSION = "s11-upg-v1" as const;

const RUN_ID = /^[A-Za-z0-9_-]+$/;

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Upgrade journal rejected a non-JSON number");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Upgrade journal rejected ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: unknown };
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};

export const sha256Prefixed = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export type JournalOutcome = "committed" | "crashed";

export type JournalEntry = {
  readonly seq: number;
  readonly at: string;
  readonly action: string;
  readonly inputDigest: string;
  readonly fromState: ControllerState;
  readonly toState: ControllerState;
  readonly nextAction: LegalAction | "none";
  readonly outcome: JournalOutcome;
  readonly planDigest: string | null;
  readonly lastFailureCode: string | null;
};

export type JournalRecord = {
  readonly schemaVersion: typeof UPGRADE_CONTROLLER_SCHEMA_VERSION;
  readonly runId: string;
  readonly state: ControllerState;
  readonly nextAction: LegalAction | "none";
  readonly planDigest: string | null;
  readonly cutoverRunId: string | null;
  readonly verificationPlanDigest: string | null;
  readonly verificationAttemptDigest: string | null;
  readonly lastFailureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly entries: readonly JournalEntry[];
  readonly journalDigest: string;
};

export type JournalSnapshot = {
  readonly runId: string;
  readonly state: ControllerState;
  readonly nextAction: LegalAction | "none";
  readonly planDigest: string | null;
  readonly cutoverRunId: string | null;
  readonly verificationPlanDigest: string | null;
  readonly verificationAttemptDigest: string | null;
  readonly lastFailureCode: string | null;
  readonly journalDigest: string;
  readonly entryCount: number;
};

export type UpgradeJournal = {
  readonly journalPath: string;
  record: JournalRecord;
  readonly snapshot: JournalSnapshot;
};

export type JournalTransitionDraft = {
  readonly action: string;
  readonly inputDigest: string;
  readonly toState: ControllerState;
  readonly nextAction: LegalAction | "none";
  readonly planDigest?: string | null;
  readonly cutoverRunId?: string | null;
  readonly verificationPlanDigest?: string | null;
  readonly verificationAttemptDigest?: string | null;
  readonly outcome?: JournalOutcome;
  readonly lastFailureCode?: string | null;
};

export type JournalCommit = {
  readonly snapshot: JournalSnapshot;
  readonly replayed: boolean;
};

const snapshotOf = (record: JournalRecord): JournalSnapshot => ({
  runId: record.runId,
  state: record.state,
  nextAction: record.nextAction,
  planDigest: record.planDigest,
  cutoverRunId: record.cutoverRunId,
  verificationPlanDigest: record.verificationPlanDigest,
  verificationAttemptDigest: record.verificationAttemptDigest,
  lastFailureCode: record.lastFailureCode,
  journalDigest: record.journalDigest,
  entryCount: record.entries.length,
});

const digestRecord = (record: Omit<JournalRecord, "journalDigest">): string =>
  sha256Prefixed(canonicalJson(record));

const withDigest = (record: Omit<JournalRecord, "journalDigest">): JournalRecord => ({
  ...record,
  journalDigest: digestRecord(record),
});

const persist = (journalPath: string, record: JournalRecord): void => {
  mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const tempPath = `${journalPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "w",
  });
  const fd = openSync(tempPath, "r+");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tempPath, journalPath);
};

const parseRecord = (value: unknown): ControllerResult<JournalRecord> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal is not an object");
  }
  const record = value as Partial<JournalRecord>;
  if (record.schemaVersion !== UPGRADE_CONTROLLER_SCHEMA_VERSION) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal schema is not s11-upg-v1");
  }
  if (typeof record.runId !== "string" || !RUN_ID.test(record.runId)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal run identity is invalid");
  }
  if (typeof record.state !== "string") {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal state is missing");
  }
  const state = parseControllerState(record.state);
  if (!state.ok) {
    return state;
  }
  if (typeof record.journalDigest !== "string" || !Array.isArray(record.entries)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal digest or entries are missing");
  }
  const candidate = value as JournalRecord;
  const expected = digestRecord({
    schemaVersion: candidate.schemaVersion,
    runId: candidate.runId,
    state: candidate.state,
    nextAction: candidate.nextAction,
    planDigest: candidate.planDigest,
    cutoverRunId: candidate.cutoverRunId,
    verificationPlanDigest: candidate.verificationPlanDigest,
    verificationAttemptDigest: candidate.verificationAttemptDigest,
    lastFailureCode: candidate.lastFailureCode,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    entries: candidate.entries,
  });
  if (expected !== candidate.journalDigest) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal digest mismatch");
  }
  return { ok: true, value: candidate };
};

const wrap = (journalPath: string, record: JournalRecord): UpgradeJournal => ({
  journalPath,
  record,
  get snapshot(): JournalSnapshot {
    return snapshotOf(this.record);
  },
});

const idleRecord = (runId: string, now: Date): JournalRecord =>
  withDigest({
    schemaVersion: UPGRADE_CONTROLLER_SCHEMA_VERSION,
    runId,
    state: "idle",
    nextAction: "plan",
    planDigest: null,
    cutoverRunId: null,
    verificationPlanDigest: null,
    verificationAttemptDigest: null,
    lastFailureCode: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    entries: [],
  });

const requireRunId = (runId: string): ControllerResult<string> => {
  if (!RUN_ID.test(runId)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "runId must be a durable token");
  }
  return { ok: true, value: runId };
};

export const journalBytes = (journalPath: string): Buffer => readFileSync(journalPath);

export const loadUpgradeJournal = (input: {
  readonly journalPath: string;
  readonly runId: string;
}): ControllerResult<UpgradeJournal> => {
  const runId = requireRunId(input.runId);
  if (!runId.ok) {
    return runId;
  }
  if (!existsSync(input.journalPath)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal was not found");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(input.journalPath, "utf8"));
  } catch {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal is not valid JSON");
  }
  const record = parseRecord(parsed);
  if (!record.ok) {
    return record;
  }
  if (record.value.runId !== runId.value) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "journal run identity does not match");
  }
  return { ok: true, value: wrap(input.journalPath, record.value) };
};

export const openUpgradeJournal = (input: {
  readonly journalPath: string;
  readonly runId: string;
  readonly now?: () => Date;
}): ControllerResult<UpgradeJournal> => {
  if (existsSync(input.journalPath)) {
    return loadUpgradeJournal(input);
  }
  const runId = requireRunId(input.runId);
  if (!runId.ok) {
    return runId;
  }
  const now = input.now ? input.now() : new Date();
  const record = idleRecord(runId.value, now);
  persist(input.journalPath, record);
  return { ok: true, value: wrap(input.journalPath, record) };
};

const isReplay = (record: JournalRecord, draft: JournalTransitionDraft): boolean =>
  record.entries.some(
    (entry) =>
      entry.action === draft.action &&
      entry.inputDigest === draft.inputDigest &&
      entry.outcome === "committed",
  );

export const hasCommittedReplay = (
  journal: UpgradeJournal,
  action: string,
  inputDigest: string,
): boolean =>
  isReplay(journal.record, {
    action,
    inputDigest,
    toState: journal.record.state,
    nextAction: journal.record.nextAction,
  });

export const commitJournalTransition = (
  journal: UpgradeJournal,
  draft: JournalTransitionDraft,
  now: () => Date = () => new Date(),
): ControllerResult<JournalCommit> => {
  if (isReplay(journal.record, draft)) {
    return { ok: true, value: { snapshot: snapshotOf(journal.record), replayed: true } };
  }
  const at = now().toISOString();
  const entry: JournalEntry = {
    seq: journal.record.entries.length + 1,
    at,
    action: draft.action,
    inputDigest: draft.inputDigest,
    fromState: journal.record.state,
    toState: draft.toState,
    nextAction: draft.nextAction,
    outcome: draft.outcome ?? "committed",
    planDigest: draft.planDigest ?? journal.record.planDigest,
    lastFailureCode: draft.lastFailureCode ?? null,
  };
  const record = withDigest({
    schemaVersion: journal.record.schemaVersion,
    runId: journal.record.runId,
    state: draft.toState,
    nextAction: draft.nextAction,
    planDigest: draft.planDigest ?? journal.record.planDigest,
    cutoverRunId: draft.cutoverRunId ?? journal.record.cutoverRunId,
    verificationPlanDigest: draft.verificationPlanDigest ?? journal.record.verificationPlanDigest,
    verificationAttemptDigest:
      draft.verificationAttemptDigest ?? journal.record.verificationAttemptDigest,
    lastFailureCode: draft.lastFailureCode ?? journal.record.lastFailureCode,
    createdAt: journal.record.createdAt,
    updatedAt: at,
    entries: [...journal.record.entries, entry],
  });
  persist(journal.journalPath, record);
  journal.record = record;
  return { ok: true, value: { snapshot: snapshotOf(record), replayed: false } };
};
