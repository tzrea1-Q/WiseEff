import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

export const GATE0_PROVISIONING_JOURNAL_FILE = "runtime-provisioning.json";
const JOURNAL_KIND = "wiseeff-owned-local-acceptance-provisioning";
const STAGING_DIRECTORY = ".gate0-acceptance-provisioning-staging";

export type Gate0ProvisioningProcessLabel = "migration" | "seed" | "api" | "frontend";
export type Gate0ProvisioningProcess = {
  state: "not-started" | "launching" | "running" | "stopped";
  operation?: string;
  pid?: number;
  processIdentity?: ProcessStartIdentity;
};

export type Gate0ProvisioningJournalV1 = {
  version: 1;
  kind: typeof JOURNAL_KIND;
  run: {
    id: string;
    sourceCommit: string;
    worktreeRoot: string;
    ownerPid: number;
    ownerProcessIdentity: ProcessStartIdentity;
    createdAt: string;
    state: "provisioning" | "runtime-descriptor-published" | "failed-retained";
  };
  resources: {
    databaseName: string;
    runRoot: string;
    objectStoreRoot: string;
    nestedRuntimeManifest: string;
  };
  processes: Record<Gate0ProvisioningProcessLabel, Gate0ProvisioningProcess>;
};

export function initializeGate0ProvisioningJournal(
  runRoot: string,
  input: Omit<Gate0ProvisioningJournalV1, "version" | "kind" | "processes">,
) {
  const journalPath = path.join(runRoot, GATE0_PROVISIONING_JOURNAL_FILE);
  if (existsSync(journalPath)) throw new Error("Gate0 provisioning journal already exists.");
  const journal: Gate0ProvisioningJournalV1 = {
    version: 1,
    kind: JOURNAL_KIND,
    ...input,
    processes: {
      migration: { state: "not-started" },
      seed: { state: "not-started" },
      api: { state: "not-started" },
      frontend: { state: "not-started" },
    },
  };
  assertGate0ProvisioningJournal(journal, journalPath);
  writeJournal(journalPath, journal, true);
  return journalPath;
}

export function initializeGate0ProvisioningRun(
  runRoot: string,
  input: Omit<Gate0ProvisioningJournalV1, "version" | "kind" | "processes">,
) {
  const resolvedRunRoot = path.resolve(runRoot);
  const runsRoot = path.dirname(resolvedRunRoot);
  const stagingParent = gate0ProvisioningStagingRoot(runsRoot);
  const stagingRoot = path.join(
    stagingParent,
    `${path.basename(resolvedRunRoot)}.${process.pid}.${randomUUID()}.provisioning`,
  );
  if (existsSync(resolvedRunRoot) || existsSync(stagingRoot)) {
    throw new Error("Gate0 provisioning run root already exists.");
  }
  requirePrivateStagingDirectory(stagingParent);
  mkdirSync(stagingRoot, { mode: 0o700 });
  const stagingJournal = path.join(stagingRoot, GATE0_PROVISIONING_JOURNAL_FILE);
  const journal: Gate0ProvisioningJournalV1 = {
    version: 1,
    kind: JOURNAL_KIND,
    ...input,
    processes: {
      migration: { state: "not-started" },
      seed: { state: "not-started" },
      api: { state: "not-started" },
      frontend: { state: "not-started" },
    },
  };
  try {
    assertGate0ProvisioningJournal(journal, path.join(resolvedRunRoot, GATE0_PROVISIONING_JOURNAL_FILE));
    writeFileSync(stagingJournal, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    fsyncDirectory(stagingRoot);
    fsyncDirectory(stagingParent);
    renameSync(stagingRoot, resolvedRunRoot);
    fsyncDirectory(runsRoot);
    fsyncDirectory(stagingParent);
  } catch (error) {
    rmSync(stagingRoot, { force: true, recursive: true });
    throw error;
  }
  return path.join(resolvedRunRoot, GATE0_PROVISIONING_JOURNAL_FILE);
}

export async function recoverGate0ProvisioningStagingRuns(
  runsRoot: string,
  dependencies: {
    processExists?: (pid: number) => boolean | Promise<boolean>;
    readProcessIdentity?: (pid: number) => ProcessStartIdentity | undefined;
  } = {},
) {
  const resolvedRunsRoot = path.resolve(runsRoot);
  const stagingParent = gate0ProvisioningStagingRoot(resolvedRunsRoot);
  if (!existsSync(stagingParent)) return [];
  requirePrivateStagingDirectory(stagingParent);
  const processExists = dependencies.processExists ?? defaultProcessExists;
  const readIdentity = dependencies.readProcessIdentity ?? readProcessStartIdentity;
  const recovered: string[] = [];
  for (const entry of readdirSync(stagingParent, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory() ||
      !/^[a-z0-9_-]+\.\d+\.[a-f0-9-]{36}\.provisioning$/iu.test(entry.name)) {
      throw new Error("Gate0 provisioning staging directory contains an unsafe entry.");
    }
    const stagingRoot = path.join(stagingParent, entry.name);
    const stagingJournal = path.join(stagingRoot, GATE0_PROVISIONING_JOURNAL_FILE);
    const raw = parseGate0ProvisioningJournal(stagingJournal);
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      !(raw as Partial<Gate0ProvisioningJournalV1>).resources ||
      typeof (raw as Partial<Gate0ProvisioningJournalV1>).resources?.runRoot !== "string") {
      throw new Error("Gate0 provisioning staging journal identity is invalid.");
    }
    const canonicalRunRoot = path.resolve(
      (raw as Partial<Gate0ProvisioningJournalV1>).resources!.runRoot!,
    );
    const canonicalJournal = path.join(canonicalRunRoot, GATE0_PROVISIONING_JOURNAL_FILE);
    assertGate0ProvisioningJournal(raw, canonicalJournal);
    const journal = raw;
    const expectedName = `${journal.run.id}.${journal.run.ownerPid}.`;
    if (
      !entry.name.startsWith(expectedName) ||
      path.dirname(canonicalRunRoot) !== resolvedRunsRoot ||
      path.basename(canonicalRunRoot) !== journal.run.id ||
      journal.run.state !== "provisioning" ||
      Object.values(journal.processes).some((record) => record.state !== "not-started")
    ) {
      throw new Error("Gate0 provisioning staging identity is not safe for takeover.");
    }
    if (existsSync(canonicalRunRoot)) {
      throw new Error("Gate0 provisioning staging conflicts with an existing canonical run.");
    }
    if (await processExists(journal.run.ownerPid)) {
      const current = readIdentity(journal.run.ownerPid);
      if (!current) throw new Error("Gate0 provisioning staging owner identity is unknown.");
      if (sameProcessStartIdentity(journal.run.ownerProcessIdentity, current)) {
        throw new Error("Gate0 provisioning staging owner is still alive.");
      }
    }
    renameSync(stagingRoot, canonicalRunRoot);
    fsyncDirectory(resolvedRunsRoot);
    fsyncDirectory(stagingParent);
    recovered.push(canonicalRunRoot);
  }
  return recovered;
}

function gate0ProvisioningStagingRoot(runsRoot: string) {
  return path.join(path.dirname(path.resolve(runsRoot)), STAGING_DIRECTORY);
}

function requirePrivateStagingDirectory(stagingParent: string) {
  if (!existsSync(stagingParent)) mkdirSync(stagingParent, { mode: 0o700 });
  const stat = lstatSync(stagingParent);
  if (stat.isSymbolicLink() || !stat.isDirectory() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("Gate0 provisioning staging parent is unsafe.");
  }
}

function defaultProcessExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

export function recordGate0ProvisioningProcessLaunching(
  journalPath: string,
  label: Gate0ProvisioningProcessLabel,
  operation: string,
) {
  updateJournal(journalPath, (journal) => {
    journal.processes[label] = { state: "launching", operation };
  });
}

export function recordGate0ProvisioningProcessStarted(
  journalPath: string,
  label: Gate0ProvisioningProcessLabel,
  operation: string,
  pid: number,
  processIdentity: ProcessStartIdentity,
) {
  updateJournal(journalPath, (journal) => {
    journal.processes[label] = { state: "running", operation, pid, processIdentity };
  });
}

export function recordGate0ProvisioningProcessStopped(
  journalPath: string,
  label: Gate0ProvisioningProcessLabel,
) {
  updateJournal(journalPath, (journal) => {
    journal.processes[label] = { ...journal.processes[label], state: "stopped" };
  });
}

export function recordGate0ProvisioningState(
  journalPath: string,
  state: Gate0ProvisioningJournalV1["run"]["state"],
) {
  updateJournal(journalPath, (journal) => {
    journal.run.state = state;
  });
}

export function readGate0ProvisioningJournal(journalPath: string) {
  const value = parseGate0ProvisioningJournal(journalPath);
  assertGate0ProvisioningJournal(value, journalPath);
  return value;
}

function parseGate0ProvisioningJournal(journalPath: string) {
  const stat = lstatSync(journalPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Gate0 provisioning journal must be a regular file.");
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(journalPath, "utf8")) as unknown;
  } catch {
    throw new Error("Gate0 provisioning journal is malformed.");
  }
  return value;
}

function updateJournal(
  journalPath: string,
  update: (journal: Gate0ProvisioningJournalV1) => void,
) {
  const journal = readGate0ProvisioningJournal(journalPath);
  update(journal);
  assertGate0ProvisioningJournal(journal, journalPath);
  writeJournal(journalPath, journal, false);
}

function writeJournal(
  journalPath: string,
  journal: Gate0ProvisioningJournalV1,
  create: boolean,
) {
  const candidate = `${journalPath}.${process.pid}.tmp`;
  try {
    writeFileSync(candidate, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    if (create && existsSync(journalPath)) throw new Error("Gate0 provisioning journal already exists.");
    renameSync(candidate, journalPath);
    fsyncDirectory(path.dirname(journalPath));
  } finally {
    try {
      if (existsSync(candidate)) {
        const stat = lstatSync(candidate);
        if (!stat.isSymbolicLink() && stat.isFile()) {
          unlinkSync(candidate);
        }
      }
    } catch {
      // Preserve the primary atomic-write error; a stale private candidate is fail-closed evidence.
    }
  }
}

function fsyncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertGate0ProvisioningJournal(
  value: unknown,
  journalPath: string,
): asserts value is Gate0ProvisioningJournalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gate0 provisioning journal identity is invalid.");
  }
  const journal = value as Partial<Gate0ProvisioningJournalV1>;
  if (journal.version !== 1 || journal.kind !== JOURNAL_KIND || !journal.run || !journal.resources || !journal.processes) {
    throw new Error("Gate0 provisioning journal identity is invalid.");
  }
  if (
    !/^[a-f0-9]{40}$/u.test(journal.run.sourceCommit) ||
    !Number.isSafeInteger(journal.run.ownerPid) || journal.run.ownerPid <= 0 ||
    !isProcessStartIdentity(journal.run.ownerProcessIdentity) ||
    !["provisioning", "runtime-descriptor-published", "failed-retained"].includes(journal.run.state)
  ) {
    throw new Error("Gate0 provisioning journal owner identity is invalid.");
  }
  const runRoot = path.dirname(path.resolve(journalPath));
  if (
    path.resolve(journal.resources.objectStoreRoot) !== path.join(runRoot, "object-store") ||
    path.resolve(journal.resources.runRoot) !== runRoot ||
    path.resolve(journal.resources.nestedRuntimeManifest) !== path.join(runRoot, "nested-runtime-manifest.json") ||
    path.basename(runRoot) !== journal.run.id ||
    !path.isAbsolute(journal.run.worktreeRoot) ||
    !/^wiseeff_acceptance_full_[a-z0-9_]+$/u.test(journal.resources.databaseName)
  ) {
    throw new Error("Gate0 provisioning journal resource identity is invalid.");
  }
  for (const label of ["migration", "seed", "api", "frontend"] as const) {
    const processRecord = journal.processes[label];
    if (!processRecord || !["not-started", "launching", "running", "stopped"].includes(processRecord.state)) {
      throw new Error("Gate0 provisioning journal process state is invalid.");
    }
    const hasPid = Number.isSafeInteger(processRecord.pid) && Number(processRecord.pid) > 0;
    const hasIdentity = isProcessStartIdentity(processRecord.processIdentity);
    if (["not-started", "launching"].includes(processRecord.state) && (processRecord.pid !== undefined || processRecord.processIdentity !== undefined)) {
      throw new Error("Gate0 provisioning journal pre-launch process must not claim an identity.");
    }
    if (["running", "stopped"].includes(processRecord.state) && (!hasPid || !hasIdentity)) {
      throw new Error("Gate0 provisioning journal started process identity is incomplete.");
    }
    if ((processRecord.pid !== undefined || processRecord.processIdentity !== undefined) && (!hasPid || !hasIdentity)) {
      throw new Error("Gate0 provisioning journal process identity is incomplete.");
    }
  }
}

function isProcessStartIdentity(value: unknown): value is ProcessStartIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Partial<ProcessStartIdentity>;
  return typeof identity.startToken === "string" && identity.startToken.length > 0
    && typeof identity.commandSha256 === "string" && /^[a-f0-9]{64}$/u.test(identity.commandSha256);
}
