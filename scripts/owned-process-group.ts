import { spawn, type ChildProcess } from "node:child_process";
import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

type ProcessGroupSignal = (pid: number, signal: NodeJS.Signals) => void | Promise<void>;
type ProcessGroupProbe = (pid: number) => boolean | Promise<boolean>;

export type StopOwnedProcessGroupOptions = {
  terminateGraceMs?: number;
  verifyGraceMs?: number;
  signalProcessGroup?: ProcessGroupSignal;
  processGroupExists?: ProcessGroupProbe;
  wait?: (delayMs: number) => Promise<void>;
  expectedProcessIdentity?: ProcessStartIdentity;
  readProcessIdentity?: (pid: number) => ProcessStartIdentity | undefined;
};

export type WaitForOwnedProcessGroupExitOptions = StopOwnedProcessGroupOptions & {
  signal?: AbortSignal;
};

const defaultTerminateGraceMs = 5_000;
const defaultVerifyGraceMs = 1_000;

/**
 * Stops and verifies one exact detached process group. Only ESRCH proves that
 * the group no longer exists; permission and signaling failures propagate.
 */
export async function stopOwnedProcessGroup(
  childOrPid: ChildProcess | number,
  options: StopOwnedProcessGroupOptions = {},
) {
  const pid = typeof childOrPid === "number" ? childOrPid : childOrPid.pid;
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Owned process group did not expose a positive PID.");
  }
  const signalProcessGroup = options.signalProcessGroup ?? defaultSignalProcessGroup;
  const processGroupExists = options.processGroupExists ?? defaultProcessGroupExists;
  const wait = options.wait ?? waitFor;
  const child = typeof childOrPid === "number" ? undefined : childOrPid;
  if (!(await probeProcessGroupUntilClassified(
    pid,
    options.verifyGraceMs ?? defaultVerifyGraceMs,
    processGroupExists,
    wait,
  ))) return;

  assertExpectedProcessIdentity(pid, options);
  await signalProcessGroup(pid, "SIGTERM");
  await waitForChildExitOpportunity(child, options.terminateGraceMs ?? defaultTerminateGraceMs, wait);
  if (await waitUntilAbsent(pid, options.terminateGraceMs ?? defaultTerminateGraceMs, processGroupExists, wait)) {
    return;
  }

  assertExpectedProcessIdentity(pid, options);
  await signalProcessGroup(pid, "SIGKILL");
  await waitForChildExitOpportunity(child, options.verifyGraceMs ?? defaultVerifyGraceMs, wait);
  if (await waitUntilAbsent(pid, options.verifyGraceMs ?? defaultVerifyGraceMs, processGroupExists, wait)) {
    return;
  }
  throw new Error(`Owned process group ${pid} is still alive after SIGKILL.`);
}

function assertExpectedProcessIdentity(pid: number, options: StopOwnedProcessGroupOptions) {
  if (!options.expectedProcessIdentity) return;
  const current = (options.readProcessIdentity ?? readProcessStartIdentity)(pid);
  if (!sameProcessStartIdentity(options.expectedProcessIdentity, current)) {
    throw new Error(`Owned process-start identity changed for PID ${pid}; refusing signal.`);
  }
}

/**
 * Waits for a child command. An abort does not settle until exact process-group
 * termination has itself settled, so cleanup failures cannot become unhandled.
 */
export function waitForOwnedProcessGroupExit(
  child: ChildProcess,
  options: WaitForOwnedProcessGroupExitOptions = {},
) {
  return new Promise<number | null>((resolve, reject) => {
    let settled = false;
    let terminating = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      child.removeListener("close", close);
      child.removeListener("error", childError);
      callback();
    };
    const close = (status: number | null) => {
      if (!terminating) finish(() => resolve(status));
    };
    const childError = (error: Error) => {
      if (!terminating) finish(() => reject(error));
    };
    const abort = () => {
      if (terminating || settled) return;
      terminating = true;
      const reason = options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("Owned process-group operation aborted.");
      void stopOwnedProcessGroup(child, options).then(
        () => finish(() => reject(reason)),
        (cleanupError) => finish(() => reject(new AggregateError(
          [reason, asError(cleanupError)],
          `${reason.message} Owned process-group abort cleanup failed.`,
        ))),
      );
    };

    child.once("close", close);
    child.once("error", childError);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}

async function waitUntilAbsent(
  pid: number,
  graceMs: number,
  processGroupExists: ProcessGroupProbe,
  wait: (delayMs: number) => Promise<void>,
) {
  const deadline = Date.now() + Math.max(0, graceMs);
  while (await probeProcessGroupUntilClassified(
    pid,
    Math.max(0, deadline - Date.now()),
    processGroupExists,
    wait,
  )) {
    if (Date.now() >= deadline) return false;
    await wait(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return true;
}

async function probeProcessGroupUntilClassified(
  pid: number,
  graceMs: number,
  processGroupExists: ProcessGroupProbe,
  wait: (delayMs: number) => Promise<void>,
) {
  const deadline = Date.now() + Math.max(0, graceMs);
  while (true) {
    try {
      return await processGroupExists(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM" || Date.now() >= deadline) throw error;
      await wait(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
}

async function waitForChildExitOpportunity(
  child: Pick<ChildProcess, "exitCode" | "once" | "removeListener"> | undefined,
  graceMs: number,
  wait: (delayMs: number) => Promise<void>,
) {
  if (!child) {
    await wait(Math.min(25, Math.max(1, graceMs)));
    return;
  }
  if (child.exitCode != null) return;
  let close: (() => void) | undefined;
  await Promise.race([
    new Promise<void>((resolve) => {
      close = resolve;
      child.once("close", resolve);
    }),
    wait(Math.max(1, graceMs)),
  ]);
  if (close) child.removeListener("close", close);
}

async function defaultSignalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32") {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      const status = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      if (status !== 0 && await defaultProcessGroupExists(pid)) {
        throw new Error(`taskkill failed for owned process group ${pid} with status ${status ?? "unknown"}.`);
      }
      return;
    }
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function defaultProcessGroupExists(pid: number) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function waitFor(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
