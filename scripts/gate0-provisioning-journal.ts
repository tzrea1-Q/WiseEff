import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ProcessStartIdentity } from "./process-start-identity";

export const GATE0_PROVISIONING_JOURNAL_FILE = "runtime-provisioning.json";
const JOURNAL_KIND = "wiseeff-owned-local-acceptance-provisioning";

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
  const parent = path.dirname(resolvedRunRoot);
  const stagingRoot = path.join(parent, `.${path.basename(resolvedRunRoot)}.${process.pid}.provisioning`);
  if (existsSync(resolvedRunRoot) || existsSync(stagingRoot)) {
    throw new Error("Gate0 provisioning run root already exists.");
  }
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
    renameSync(stagingRoot, resolvedRunRoot);
    fsyncDirectory(parent);
  } catch (error) {
    rmSync(stagingRoot, { force: true, recursive: true });
    throw error;
  }
  return path.join(resolvedRunRoot, GATE0_PROVISIONING_JOURNAL_FILE);
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
  assertGate0ProvisioningJournal(value, journalPath);
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
