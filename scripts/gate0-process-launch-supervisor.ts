import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

const LAUNCH_DIRECTORY = ".gate0-owned-process-launches";
const LAUNCH_KIND = "wiseeff-gate0-owned-process-launch";
const CONTROL_PREFIX = "WISEEFF_GATE0_LAUNCH_";

export type Gate0OwnedProcessLaunchRecord = {
  version: 1;
  kind: typeof LAUNCH_KIND;
  launchId: string;
  runId: string;
  sourceCommit: string;
  label: string;
  ownerPid: number;
  ownerProcessIdentity: ProcessStartIdentity;
  state: "intent" | "claimed";
  launcherPid?: number;
  launcherProcessIdentity?: ProcessStartIdentity;
  createdAt: string;
};

export type Gate0OwnedProcessSupervision = {
  runRoot: string;
  runId: string;
  sourceCommit: string;
  label: string;
  nodeEntry?: { entry: string; args: string[] };
};

export function spawnGate0SupervisedProcess(input: {
  supervision: Gate0OwnedProcessSupervision;
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdio: SpawnOptions["stdio"];
  shell?: boolean;
}): ChildProcess {
  const ownerProcessIdentity = readProcessStartIdentity(process.pid);
  if (!ownerProcessIdentity) throw new Error("Gate0 process supervisor cannot capture the owner identity.");
  const launchId = randomUUID();
  const launchDirectory = requireLaunchDirectory(input.supervision.runRoot);
  const recordPath = path.join(launchDirectory, `${launchId}.json`);
  const ackPath = path.join(launchDirectory, `${launchId}.ack`);
  const goPath = path.join(launchDirectory, `${launchId}.go`);
  const record: Gate0OwnedProcessLaunchRecord = {
    version: 1,
    kind: LAUNCH_KIND,
    launchId,
    runId: input.supervision.runId,
    sourceCommit: input.supervision.sourceCommit,
    label: input.supervision.label,
    ownerPid: process.pid,
    ownerProcessIdentity,
    state: "intent",
    createdAt: new Date().toISOString(),
  };
  assertLaunchRecord(record, recordPath, input.supervision.runRoot);
  writeLaunchRecord(recordPath, record, true);
  const launcherPath = path.join(import.meta.dirname, "gate0-process-launcher.ts");
  const controlEnv = {
    ...input.env,
    [`${CONTROL_PREFIX}RECORD`]: recordPath,
    [`${CONTROL_PREFIX}ACK`]: ackPath,
    [`${CONTROL_PREFIX}GO`]: goPath,
    [`${CONTROL_PREFIX}CWD`]: Buffer.from(input.cwd, "utf8").toString("base64"),
    [`${CONTROL_PREFIX}COMMAND`]: Buffer.from(input.command, "utf8").toString("base64"),
    [`${CONTROL_PREFIX}ARGS`]: Buffer.from(JSON.stringify(input.args), "utf8").toString("base64"),
    [`${CONTROL_PREFIX}SHELL`]: input.shell ? "true" : "false",
    [`${CONTROL_PREFIX}MODE`]: input.supervision.nodeEntry ? "node-entry" : "child-process",
    [`${CONTROL_PREFIX}ENTRY`]: input.supervision.nodeEntry
      ? Buffer.from(input.supervision.nodeEntry.entry, "utf8").toString("base64")
      : "none",
    [`${CONTROL_PREFIX}ENTRY_ARGS`]: input.supervision.nodeEntry
      ? Buffer.from(JSON.stringify(input.supervision.nodeEntry.args), "utf8").toString("base64")
      : "W10=",
  };
  const launcher = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), launcherPath], {
    cwd: input.cwd,
    env: controlEnv,
    stdio: input.stdio,
    detached: process.platform !== "win32",
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const claimed = readGate0OwnedProcessLaunchRecord(recordPath, input.supervision.runRoot);
    if (claimed.state === "claimed") {
      if (!launcher.pid || claimed.launcherPid !== launcher.pid) {
        throw new Error("Gate0 process supervisor claim PID does not match the spawned launcher.");
      }
      writeFileSync(ackPath, `${launchId}\n`, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
      fsyncDirectory(launchDirectory);
      waitForLauncherAcknowledgement(launcher.pid, ackPath);
      waitForStableLauncherIdentity(recordPath);
      writeFileSync(goPath, `${launchId}\n`, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
      fsyncDirectory(launchDirectory);
      return launcher;
    }
    if (launcher.pid && !isProcessAlive(launcher.pid)) {
      throw new Error("Gate0 process supervisor exited before publishing its identity.");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Gate0 process supervisor identity publication timed out.");
}

export function claimGate0OwnedProcessLaunch(recordPath: string) {
  const runRoot = path.dirname(path.dirname(path.resolve(recordPath)));
  const record = readGate0OwnedProcessLaunchRecord(recordPath, runRoot);
  if (record.state !== "intent") throw new Error("Gate0 process launch intent was already claimed.");
  const launcherProcessIdentity = readProcessStartIdentity(process.pid);
  if (!launcherProcessIdentity) throw new Error("Gate0 launcher cannot capture its process-start identity.");
  const claimed: Gate0OwnedProcessLaunchRecord = {
    ...record,
    state: "claimed",
    launcherPid: process.pid,
    launcherProcessIdentity,
  };
  writeLaunchRecord(recordPath, claimed, false);
  return claimed;
}

export function refreshGate0OwnedProcessLaunchClaim(recordPath: string) {
  const runRoot = path.dirname(path.dirname(path.resolve(recordPath)));
  const record = readGate0OwnedProcessLaunchRecord(recordPath, runRoot);
  if (record.state !== "claimed" || !record.launcherPid || !record.launcherProcessIdentity) {
    throw new Error("Gate0 process launch claim cannot be refreshed before it is complete.");
  }
  const current = readProcessStartIdentity(record.launcherPid);
  if (!current || current.startToken !== record.launcherProcessIdentity.startToken) {
    throw new Error("Gate0 process launcher incarnation changed before acknowledgement.");
  }
  const refreshed: Gate0OwnedProcessLaunchRecord = {
    ...record,
    launcherProcessIdentity: current,
  };
  writeLaunchRecord(recordPath, refreshed, false);
  return refreshed;
}

export function listGate0OwnedProcessLaunches(runRoot: string) {
  const launchDirectory = path.join(path.resolve(runRoot), LAUNCH_DIRECTORY);
  if (!existsSync(launchDirectory)) return [];
  const stat = lstatSync(launchDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Gate0 process launch directory is unsafe.");
  }
  return readdirSync(launchDirectory, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error("Gate0 process launch directory contains an unsafe entry.");
      }
      if (/^[a-f0-9-]{36}\.(?:ack|go)$/iu.test(entry.name)) return false;
      if (!/^[a-f0-9-]{36}\.json$/iu.test(entry.name)) {
        throw new Error("Gate0 process launch directory contains an unknown record.");
      }
      return true;
    })
    .map((entry) => readGate0OwnedProcessLaunchRecord(path.join(launchDirectory, entry.name), runRoot));
}

export function readGate0OwnedProcessLaunchRecord(recordPath: string, runRoot: string) {
  const stat = lstatSync(recordPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Gate0 process launch record is unsafe.");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(recordPath, "utf8")) as unknown;
  } catch {
    throw new Error("Gate0 process launch record is malformed.");
  }
  assertLaunchRecord(value, recordPath, runRoot);
  return value;
}

function requireLaunchDirectory(runRoot: string) {
  const resolvedRunRoot = path.resolve(runRoot);
  const stat = lstatSync(resolvedRunRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Gate0 process launch run root is unsafe.");
  const launchDirectory = path.join(resolvedRunRoot, LAUNCH_DIRECTORY);
  mkdirSync(launchDirectory, { mode: 0o700 });
  const launchStat = lstatSync(launchDirectory);
  if (launchStat.isSymbolicLink() || !launchStat.isDirectory()) {
    throw new Error("Gate0 process launch directory is unsafe.");
  }
  return launchDirectory;
}

function writeLaunchRecord(recordPath: string, record: Gate0OwnedProcessLaunchRecord, create: boolean) {
  const candidate = `${recordPath}.${process.pid}.tmp`;
  writeFileSync(candidate, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
  if (create && existsSync(recordPath)) throw new Error("Gate0 process launch record already exists.");
  renameSync(candidate, recordPath);
  fsyncDirectory(path.dirname(recordPath));
}

function assertLaunchRecord(
  value: unknown,
  recordPath: string,
  runRoot: string,
): asserts value is Gate0OwnedProcessLaunchRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gate0 process launch identity is invalid.");
  }
  const record = value as Partial<Gate0OwnedProcessLaunchRecord>;
  const expectedDirectory = path.join(path.resolve(runRoot), LAUNCH_DIRECTORY);
  if (
    record.version !== 1 || record.kind !== LAUNCH_KIND ||
    !/^[a-f0-9-]{36}$/iu.test(record.launchId ?? "") ||
    path.resolve(recordPath) !== path.join(expectedDirectory, `${record.launchId}.json`) ||
    !record.runId || !/^[a-f0-9]{40}$/u.test(record.sourceCommit ?? "") ||
    typeof record.label !== "string" || !/^(?:root|nested):[a-z0-9_-]+:(?:migration|seed|api|frontend|visual|browser)$/u.test(record.label) ||
    !Number.isSafeInteger(record.ownerPid) || Number(record.ownerPid) <= 0 ||
    !isProcessStartIdentity(record.ownerProcessIdentity) ||
    !["intent", "claimed"].includes(record.state ?? "") ||
    typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
  ) {
    throw new Error("Gate0 process launch identity is invalid.");
  }
  const claimed = record.state === "claimed";
  if (claimed !== (
    Number.isSafeInteger(record.launcherPid) && Number(record.launcherPid) > 0 &&
    isProcessStartIdentity(record.launcherProcessIdentity)
  )) {
    throw new Error("Gate0 process launcher identity is incomplete.");
  }
}

function isProcessStartIdentity(value: unknown): value is ProcessStartIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Partial<ProcessStartIdentity>;
  return typeof identity.startToken === "string" && identity.startToken.length > 0
    && typeof identity.commandSha256 === "string" && /^[a-f0-9]{64}$/u.test(identity.commandSha256);
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

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function waitForLauncherAcknowledgement(pid: number, ackPath: string) {
  const deadline = Date.now() + 10_000;
  while (existsSync(ackPath)) {
    if (!isProcessAlive(pid)) {
      throw new Error("Gate0 process supervisor exited before acknowledging its launch claim.");
    }
    if (Date.now() >= deadline) {
      throw new Error("Gate0 process supervisor launch acknowledgement timed out.");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function waitForStableLauncherIdentity(recordPath: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const before = refreshGate0OwnedProcessLaunchClaim(recordPath);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    const current = readProcessStartIdentity(before.launcherPid!);
    if (sameProcessStartIdentity(before.launcherProcessIdentity!, current)) {
      return;
    }
  }
  throw new Error("Gate0 process launcher identity did not stabilize before execution.");
}

export function gate0LaunchControlEnvironment() {
  const value = (name: string) => {
    const result = process.env[`${CONTROL_PREFIX}${name}`];
    if (!result) throw new Error(`Gate0 process launcher is missing ${name.toLowerCase()} control data.`);
    return result;
  };
  const mode = value("MODE");
  if (mode !== "node-entry" && mode !== "child-process") {
    throw new Error("Gate0 process launcher mode is invalid.");
  }
  return {
    recordPath: value("RECORD"),
    ackPath: value("ACK"),
    goPath: value("GO"),
    cwd: Buffer.from(value("CWD"), "base64").toString("utf8"),
    command: Buffer.from(value("COMMAND"), "base64").toString("utf8"),
    args: JSON.parse(Buffer.from(value("ARGS"), "base64").toString("utf8")) as string[],
    shell: value("SHELL") === "true",
    nodeEntry: mode === "node-entry" ? {
      entry: Buffer.from(value("ENTRY"), "base64").toString("utf8"),
      args: JSON.parse(Buffer.from(value("ENTRY_ARGS"), "base64").toString("utf8")) as string[],
    } : undefined,
  };
}
