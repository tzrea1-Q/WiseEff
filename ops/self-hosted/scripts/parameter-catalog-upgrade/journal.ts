import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BindingPhaseAttempt } from "../../../../server/modules/catalog-cutover/interface";

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

export type BindingPhaseEvent = BindingPhaseAttempt & {
  readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  readonly inputDigest: string;
  readonly outcome: "pending" | "committed" | "failed" | "unknown";
};

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
  readonly bindingPhase?: BindingPhaseEvent;
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
  readonly bindingPhase?: BindingPhaseEvent;
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

// This short filesystem critical section supplements the deployment operation
// lock. A leftover lock is never guessed stale or removed by another process.
class JournalDurabilityError extends Error {}
const ensureDurableDirectory = (directory: string): void => {
  if (existsSync(directory)) {
    const physical = realpathSync(directory);
    if (physical !== directory) return ensureDurableDirectory(physical);
  }
  const parent = path.dirname(directory);
  if (parent === directory) return;
  ensureDurableDirectory(parent);
  if (!existsSync(directory)) {
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  // Retry must repair an earlier failed parent fsync even if mkdir succeeded.
  const fd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
};
export const withJournalWriteLock = <T>(journalPath: string, action: () => T): T => {
  ensureDurableDirectory(path.dirname(journalPath));
  const lockPath = `${journalPath}.write-lock`;
  mkdirSync(lockPath, { mode: 0o700 });
  let uncertain = false;
  try { return action(); }
  catch (error) { uncertain = error instanceof JournalDurabilityError; throw error; }
  finally { if (!uncertain) rmdirSync(lockPath); }
};

const persist = (journalPath: string, record: JournalRecord): void => {
  const tempPath = `${journalPath}.${randomUUID()}.tmp`;
  const fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    renameSync(tempPath, journalPath);
    const directory = openSync(path.dirname(journalPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch { throw new JournalDurabilityError("journal-durability-unknown"); }
  finally { if (existsSync(tempPath)) unlinkSync(tempPath); }
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
  for (const [index, entry] of candidate.entries.entries()) {
    if (!entry || entry.seq !== index + 1 || typeof entry.action !== "string" ||
        typeof entry.inputDigest !== "string" || !["committed", "crashed"].includes(entry.outcome) ||
        !parseControllerState(entry.fromState).ok || !parseControllerState(entry.toState).ok ||
        entry.fromState !== (index === 0 ? "idle" : candidate.entries[index - 1].toState)) {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal entry sequence is invalid");
    }
    const phase = entry.bindingPhase;
    if (phase && (!/^P(?:[0-9]|10)$/.test(phase.phase) || !RUN_ID.test(phase.runId) ||
        !RUN_ID.test(phase.attemptId) || !/^sha256:[a-f0-9]{64}$/.test(phase.planDigest) ||
        !/^sha256:[a-f0-9]{64}$/.test(phase.inputDigest) ||
        !/^[0-9]+$/.test(phase.target?.systemIdentifier) || !/^[0-9]+$/.test(phase.target?.databaseOid) ||
        !["pending", "committed", "failed", "unknown"].includes(phase.outcome))) {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal phase event is invalid");
    }
    if (entry.action.startsWith("binding-phase-") !== Boolean(phase)) {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal phase event is missing or misplaced");
    }
  }
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

export const journalBytes = (journalPath: string): Buffer => {
  const fd = openSync(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > 16 * 1024 * 1024) throw new Error("unsafe-journal-file");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("journal-file-truncated");
      offset += count;
    }
    if (fstatSync(fd).size !== stat.size) throw new Error("journal-file-changed");
    return bytes;
  } finally { closeSync(fd); }
};

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
    parsed = JSON.parse(journalBytes(input.journalPath).toString("utf8"));
  } catch {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal is not valid JSON");
  }
  let record: ControllerResult<JournalRecord>;
  try { record = parseRecord(parsed); }
  catch { return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal payload is invalid"); }
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
  try {
    return withJournalWriteLock(input.journalPath, () => {
      if (existsSync(input.journalPath)) return loadUpgradeJournal(input);
      persist(input.journalPath, record);
      return { ok: true, value: wrap(input.journalPath, record) };
    });
  } catch { return failClosed("PCAT-UPG-ILLEGAL-ACTION", "journal creation failed or writer lock occupied"); }
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
  try {
    return withJournalWriteLock(journal.journalPath, () => {
      const current = loadUpgradeJournal({ journalPath: journal.journalPath, runId: journal.record.runId });
      if (!current.ok) return current;
      if (current.value.record.journalDigest !== journal.record.journalDigest) {
        return failClosed("PCAT-UPG-ILLEGAL-ACTION", "journal changed; inspect before retry");
      }
      return appendTransition(journal, draft, now);
    });
  } catch { return failClosed("PCAT-UPG-ILLEGAL-ACTION", "journal commit unavailable; outcome must be inspected"); }
};

const appendTransition = (
  journal: UpgradeJournal,
  draft: JournalTransitionDraft,
  now: () => Date,
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
    ...(draft.bindingPhase ? { bindingPhase: draft.bindingPhase } : {}),
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
