import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
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

/** Host persistence shape, structurally matching the Cutover activation public
 * interface. This record is neither SQL commit proof nor release approval. */
export type ActivationIntentRecord = {
  readonly runId: string;
  readonly attemptId: string;
  readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  readonly planDigest: string;
  readonly predecessorBindingDigest: string | null;
  readonly reportDigest: string;
  readonly expectedObservationDigest: string;
  readonly inputDigest: string;
};
export type ActivationBindingRecord = {
  readonly version: "pcat-activation-v1";
  readonly intent: ActivationIntentRecord;
  readonly mode: "canonical";
  readonly sourceSnapshotFingerprint: string;
  readonly catalog: { readonly releaseId: string; readonly releaseDigest: string; readonly compiledFingerprint: string; readonly databaseFingerprint: string };
  readonly mapping: { readonly epoch: string; readonly headDigest: string };
  readonly comparisonReportDigest: string;
  readonly bindingDigest: string;
};
export type ActivationJournalEvent = {
  readonly hostRunId: string;
  readonly intent: ActivationIntentRecord;
  readonly outcome: "pending" | "committed" | "unknown" | "reconciled" | "not-applied";
  readonly binding?: ActivationBindingRecord;
};

// Persistence types live with the journal, never in the execution layer: check
// modules must not acquire an indirect import of restore mechanisms.
export type RecoveryCaptureRecord = {
  runId: string; packageDigest: string; recoveryPointDigest: string;
  source: { deploymentId: string; hostFingerprint: string; postgresIdentity: string; objectStoreIdentity: string; redisIdentity: string };
  boundaryDigest: string;
};
export type RecoveryCaptureEvent = {
  readonly attemptId: string;
  readonly outcome: "pending" | "committed" | "unknown";
  readonly runId: string;
  readonly source: RecoveryCaptureRecord["source"];
  readonly directory: { readonly path: string; readonly device: string; readonly inode: string };
  readonly capture?: RecoveryCaptureRecord;
};
export type RecoveryExecutionApprovalRecord = {
  runId: string; attemptId: string; captureDigest: string; target: RecoveryCaptureRecord["source"];
  approvalReference: string; expiresAt: string;
};
export type RecoveryApprovalEvent = {
  readonly approval: RecoveryExecutionApprovalRecord;
  readonly assignmentDigest: string;
  readonly principal: { readonly userId: string; readonly organizationId: string };
  readonly traceId: string;
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
  readonly activation?: ActivationJournalEvent;
  readonly recoveryCapture?: RecoveryCaptureEvent;
  readonly recoveryApproval?: RecoveryApprovalEvent;
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
  readonly activation?: ActivationJournalEvent;
  readonly recoveryCapture?: RecoveryCaptureEvent;
  readonly recoveryApproval?: RecoveryApprovalEvent;
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
  const captures = new Map<string, RecoveryCaptureEvent>();
  let activation: ActivationJournalEvent | undefined;
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
    if (entry.activation || entry.action.startsWith("activation-")) {
      if (!validActivationEvent(entry, candidate, index, activation)) {
        return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal activation event is invalid");
      }
      activation = entry.activation;
    }
    if (entry.recoveryCapture) {
      const event = entry.recoveryCapture;
      if (!validRecoveryCapture(event, entry, candidate.runId, captures.get(event.attemptId))) {
        return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal capture event is invalid");
      }
      captures.set(event.attemptId, event);
    } else if (entry.action === "recovery-capture-pending" || entry.action === "recovery-capture-unknown") {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal capture event is missing");
    }
    // Historical recovery-package-captured hashes remain diagnostic evidence.
    // A new producer/consumer must separately require the typed record.
    if (entry.recoveryApproval && !validRecoveryApproval(entry.recoveryApproval, entry, candidate.runId, candidate.entries.slice(0, index))) {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "upgrade journal recovery approval is invalid");
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

const exactKeys = (value: unknown, keys: readonly string[]): boolean => typeof value === "object" && value !== null &&
  !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const activationDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const activationToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
export function validActivationIntent(value: ActivationIntentRecord): boolean {
  if (!exactKeys(value, ["runId", "attemptId", "target", "planDigest", "predecessorBindingDigest", "reportDigest", "expectedObservationDigest", "inputDigest"]) ||
    !activationToken(value.runId) || !activationToken(value.attemptId) || !exactKeys(value.target, ["systemIdentifier", "databaseOid"]) ||
    ![value.target.systemIdentifier, value.target.databaseOid].every(part => typeof part === "string" && /^[0-9]{1,24}$/.test(part)) ||
    ![value.planDigest, value.reportDigest, value.expectedObservationDigest, value.inputDigest].every(activationDigest) ||
    value.predecessorBindingDigest !== null && !activationDigest(value.predecessorBindingDigest)) return false;
  const { inputDigest, ...body } = value;
  return inputDigest === sha256Prefixed(canonicalJson(body));
}
export function validActivationBinding(value: ActivationBindingRecord): boolean {
  if (!exactKeys(value, ["version", "intent", "mode", "sourceSnapshotFingerprint", "catalog", "mapping", "comparisonReportDigest", "bindingDigest"]) ||
    value.version !== "pcat-activation-v1" || value.mode !== "canonical" || !validActivationIntent(value.intent) ||
    !exactKeys(value.catalog, ["releaseId", "releaseDigest", "compiledFingerprint", "databaseFingerprint"]) ||
    !exactKeys(value.mapping, ["epoch", "headDigest"]) ||
    !activationToken(value.catalog.releaseId) || !activationDigest(value.mapping.epoch) ||
    ![value.sourceSnapshotFingerprint, value.catalog.releaseDigest, value.catalog.compiledFingerprint, value.catalog.databaseFingerprint,
      value.mapping.headDigest, value.comparisonReportDigest, value.bindingDigest].every(activationDigest)) return false;
  const { bindingDigest, ...body } = value;
  return bindingDigest === sha256Prefixed(canonicalJson(body));
}
function validActivationEvent(entry: JournalEntry, record: JournalRecord, index: number, previous?: ActivationJournalEvent): boolean {
  const event = entry.activation;
  if (!event) return false;
  const applied = event.outcome === "committed" || event.outcome === "reconciled";
  if (!exactKeys(event, ["hostRunId", "intent", "outcome", ...(applied ? ["binding"] : [])]) || event.hostRunId !== record.runId ||
    !validActivationIntent(event.intent) || event.intent.runId !== record.cutoverRunId ||
    !["pending", "committed", "unknown", "reconciled", "not-applied"].includes(event.outcome) ||
    entry.action !== `activation-${event.outcome}` || entry.inputDigest !== sha256Prefixed(canonicalJson(event)) ||
    entry.outcome !== (applied || event.outcome === "not-applied" ? "committed" : "crashed") ||
    entry.fromState !== entry.toState || entry.nextAction !== (record.entries[index - 1]?.nextAction ?? "plan") ||
    entry.planDigest !== (record.entries[index - 1]?.planDigest ?? null)) return false;
  if (event.outcome === "pending") {
    return !previous || previous.outcome === "not-applied" && previous.intent.attemptId !== event.intent.attemptId &&
      canonicalJson(previous.intent.target) === canonicalJson(event.intent.target) &&
      !record.entries.slice(0, index).some(item => item.activation?.intent.attemptId === event.intent.attemptId);
  }
  if (!previous || canonicalJson(previous.intent) !== canonicalJson(event.intent)) return false;
  if (event.outcome === "committed" || event.outcome === "unknown") {
    if (previous.outcome !== "pending") return false;
  } else if (!["pending", "unknown"].includes(previous.outcome)) return false;
  return !applied || Boolean(event.binding && validActivationBinding(event.binding) && canonicalJson(event.binding.intent) === canonicalJson(event.intent));
}
const validRecoverySource = (value: RecoveryCaptureRecord["source"]): boolean =>
  exactKeys(value, ["deploymentId", "hostFingerprint", "postgresIdentity", "objectStoreIdentity", "redisIdentity"]) &&
  Object.values(value).every(part => typeof part === "string" && part.trim() === part && part.length > 0 && part.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(part));
function validRecoveryCapture(event: RecoveryCaptureEvent, entry: JournalEntry, runId: string, previous?: RecoveryCaptureEvent): boolean {
  if (!exactKeys(event, ["attemptId", "outcome", "runId", "source", "directory", ...(event.outcome === "committed" ? ["capture"] : [])]) ||
    typeof event.attemptId !== "string" || !RUN_ID.test(event.attemptId) || event.runId !== runId || !validRecoverySource(event.source) ||
    !exactKeys(event.directory, ["path", "device", "inode"]) || typeof event.directory.path !== "string" || !path.isAbsolute(event.directory.path) ||
    typeof event.directory.device !== "string" || !/^[0-9]+$/.test(event.directory.device) ||
    typeof event.directory.inode !== "string" || !/^[0-9]+$/.test(event.directory.inode)) return false;
  const action = event.outcome === "pending" ? "recovery-capture-pending" : event.outcome === "committed" ? "recovery-package-captured" :
    event.outcome === "unknown" ? "recovery-capture-unknown" : "";
  if (!action || entry.action !== action || entry.fromState !== entry.toState ||
    entry.outcome !== (event.outcome === "committed" ? "committed" : "crashed")) return false;
  if (event.outcome === "pending") return !previous && entry.inputDigest === sha256Prefixed(canonicalJson(event));
  if (!previous || previous.outcome !== "pending") return false;
  if (canonicalJson({ attemptId: event.attemptId, runId: event.runId, source: event.source, directory: event.directory }) !==
    canonicalJson({ attemptId: previous.attemptId, runId: previous.runId, source: previous.source, directory: previous.directory })) return false;
  if (event.outcome === "unknown") return entry.inputDigest === sha256Prefixed(canonicalJson(event));
  const capture = event.capture!;
  return exactKeys(capture, ["runId", "packageDigest", "recoveryPointDigest", "source", "boundaryDigest"]) &&
    capture.runId === runId && canonicalJson(capture.source) === canonicalJson(event.source) &&
    typeof capture.packageDigest === "string" && /^[a-f0-9]{64}$/.test(capture.packageDigest) &&
    typeof capture.recoveryPointDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(capture.recoveryPointDigest) &&
    typeof capture.boundaryDigest === "string" && /^[a-f0-9]{64}$/.test(capture.boundaryDigest) && entry.inputDigest === sha256Prefixed(canonicalJson(capture));
}

function validRecoveryApproval(event: RecoveryApprovalEvent, entry: JournalEntry, runId: string, previous: readonly JournalEntry[]): boolean {
  const digest = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:@-]{1,180}$/.test(value);
  if (!exactKeys(event, ["approval", "assignmentDigest", "principal", "traceId"]) ||
    !exactKeys(event.approval, ["runId", "attemptId", "captureDigest", "target", "approvalReference", "expiresAt"]) ||
    !exactKeys(event.principal, ["userId", "organizationId"]) || !identifier(event.principal.userId) || !identifier(event.principal.organizationId) ||
    !identifier(event.traceId) || !digest(event.assignmentDigest)) return false;
  const approval = event.approval;
  if (approval.runId !== runId || !identifier(approval.attemptId) || !RUN_ID.test(approval.attemptId) || !digest(approval.captureDigest) ||
    !digest(approval.approvalReference) || !validRecoverySource(approval.target) || typeof approval.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(approval.expiresAt)) || entry.action !== "recovery-execution-authorized" ||
    entry.outcome !== "committed" || entry.fromState !== entry.toState ||
    entry.nextAction !== (previous.at(-1)?.nextAction ?? "plan") || entry.planDigest !== (previous.at(-1)?.planDigest ?? null)) return false;
  const captured = previous.filter(item => item.action === "recovery-package-captured").at(-1);
  if (captured?.recoveryCapture?.outcome !== "committed" || captured.inputDigest !== approval.captureDigest ||
    previous.some(item => item.seq > captured.seq && ["recovery-capture-pending", "recovery-capture-unknown"].includes(item.action)) ||
    previous.some(item => item.recoveryApproval?.approval.attemptId === approval.attemptId) ||
    previous.some(item => ["recovery-execution-started", "recovery-execution-completed", "recovery-execution-outcome-unknown", "recovery-execution-revoked"].includes(item.action))) return false;
  const { approvalReference, ...scope } = approval;
  return entry.inputDigest === sha256Prefixed(canonicalJson(approval)) && approvalReference === sha256Prefixed(canonicalJson({
    ...scope, assignmentDigest: event.assignmentDigest, principal: event.principal, traceId: event.traceId,
  }));
}

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
  /** Domain dispatch must reject a persisted/active write outcome before effects.
   * Diagnostic readers may still inspect the bytes without authorizing actions. */
  readonly requireSettled?: boolean;
}): ControllerResult<UpgradeJournal> => {
  if (input.requireSettled) {
    try {
      lstatSync(`${input.journalPath}.write-lock`);
      return failClosed("PCAT-UPG-UNKNOWN-OUTCOME", "journal write outcome requires explicit reconciliation");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return failClosed("PCAT-UPG-UNKNOWN-OUTCOME", "journal write outcome is unavailable");
    }
  }
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
      if (current.value.record.journalDigest !== journal.record.journalDigest ||
          canonicalJson(current.value.record) !== canonicalJson(journal.record)) {
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
  if ((draft.recoveryCapture || draft.recoveryApproval || draft.activation) && (draft.toState !== journal.record.state || draft.nextAction !== journal.record.nextAction ||
    draft.lastFailureCode !== undefined && draft.lastFailureCode !== journal.record.lastFailureCode ||
    (["planDigest", "cutoverRunId", "verificationPlanDigest", "verificationAttemptDigest"] as const)
      .some(key => draft[key] !== undefined && draft[key] !== journal.record[key]))) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", "recovery evidence cannot change controller state or pins");
  }
  if (isReplay(journal.record, draft)) {
    if (draft.activation || draft.action.startsWith("activation-")) {
      const latest = journal.record.entries.filter(entry => entry.activation).at(-1);
      if (!draft.activation || latest?.action !== draft.action || latest.inputDigest !== draft.inputDigest ||
        latest.outcome !== "committed" || canonicalJson(latest.activation) !== canonicalJson(draft.activation)) {
        return failClosed("PCAT-UPG-ILLEGAL-ACTION", "activation replay requires the current exact typed record");
      }
    }
    if (draft.recoveryApproval) {
      const current = journal.record.entries.filter(entry => entry.action === "recovery-execution-authorized").at(-1);
      const captured = journal.record.entries.filter(entry => entry.action === "recovery-package-captured").at(-1);
      if (!current?.recoveryApproval || current.inputDigest !== draft.inputDigest || current.outcome !== "committed" ||
        canonicalJson(current.recoveryApproval) !== canonicalJson(draft.recoveryApproval) || captured?.inputDigest !== draft.recoveryApproval.approval.captureDigest ||
        journal.record.entries.some(entry => ["recovery-execution-started", "recovery-execution-completed", "recovery-execution-outcome-unknown", "recovery-execution-revoked"].includes(entry.action) ||
          entry.seq > current.seq && ["recovery-capture-pending", "recovery-capture-unknown"].includes(entry.action))) {
        return failClosed("PCAT-UPG-ILLEGAL-ACTION", "approval replay requires the current unconsumed typed record");
      }
    }
    if (draft.recoveryCapture && !journal.record.entries.some(entry => entry.action === draft.action &&
      entry.inputDigest === draft.inputDigest && entry.outcome === "committed" && entry.recoveryCapture &&
      canonicalJson(entry.recoveryCapture) === canonicalJson(draft.recoveryCapture))) {
      return failClosed("PCAT-UPG-ILLEGAL-ACTION", "capture replay requires the original typed record");
    }
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
    ...(draft.activation ? { activation: structuredClone(draft.activation) } : {}),
    ...(draft.recoveryCapture ? { recoveryCapture: structuredClone(draft.recoveryCapture) } : {}),
    ...(draft.recoveryApproval ? { recoveryApproval: structuredClone(draft.recoveryApproval) } : {}),
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
  if (draft.recoveryCapture || draft.recoveryApproval || draft.activation || draft.action.startsWith("activation-") || draft.action === "recovery-capture-pending" || draft.action === "recovery-capture-unknown") {
    const parsed = parseRecord(record);
    if (!parsed.ok) return parsed;
  }
  persist(journal.journalPath, record);
  journal.record = record;
  return { ok: true, value: { snapshot: snapshotOf(record), replayed: false } };
};
