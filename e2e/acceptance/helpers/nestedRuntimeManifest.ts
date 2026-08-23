import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV =
  "WISEEFF_ACCEPTANCE_NESTED_RUNTIME_MANIFEST";
export const OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV =
  "WISEEFF_ACCEPTANCE_NESTED_RUNTIME_ID";

export type NestedRuntimeState =
  | "provisioning"
  | "running"
  | "cleaned"
  | "failed-retained"
  | "cleanup-failed";

export type NestedRuntimeCleanup = {
  apiProcess: { status: "not-started" | "stopped" | "failed"; reason?: string };
  frontendProcess: { status: "not-started" | "stopped" | "failed"; reason?: string };
  database: { status: "removed" | "retained" | "failed"; reason?: string };
  objectStore: { status: "removed" | "retained" | "failed"; reason?: string };
};

export type NestedRuntimeRecord = {
  id: string;
  state: NestedRuntimeState;
  databaseName: string;
  markerPurpose: string;
  migrationRunId?: string;
  objectStoreRoot: string;
  apiUrl: string;
  frontendUrl: string;
  apiPid?: number;
  frontendPid?: number;
  startedAt: string;
  completedAt?: string;
  cleanup?: NestedRuntimeCleanup;
};

export type NestedRuntimeManifest = {
  version: 1;
  kind: "wiseeff-gate0-nested-runtime-manifest";
  parentRunId: string;
  sourceCommit: string;
  children: NestedRuntimeRecord[];
  updatedAt: string;
};

export function initializeNestedRuntimeManifest(
  manifestPath: string,
  identity: { parentRunId: string; sourceCommit: string },
) {
  if (!path.isAbsolute(manifestPath)) throw new Error("Nested runtime manifest path must be absolute.");
  if (!/^[a-f0-9]{40}$/u.test(identity.sourceCommit)) {
    throw new Error("Nested runtime manifest requires an exact source commit.");
  }
  const manifest: NestedRuntimeManifest = {
    version: 1,
    kind: "wiseeff-gate0-nested-runtime-manifest",
    parentRunId: identity.parentRunId,
    sourceCommit: identity.sourceCommit,
    children: [],
    updatedAt: new Date().toISOString(),
  };
  writeManifest(manifestPath, manifest, "wx");
  return manifestPath;
}

export function recordNestedRuntimeStart(
  manifestPath: string,
  child: Omit<NestedRuntimeRecord, "state" | "startedAt" | "completedAt"> & {
    migrationRunId: string;
    apiPid: number;
    frontendPid: number;
  },
) {
  const { migrationRunId, apiPid, frontendPid, ...provisioning } = child;
  recordNestedRuntimeProvisioning(manifestPath, provisioning);
  recordNestedRuntimeProgress(manifestPath, child.id, {
    migrationRunId,
    apiPid,
    frontendPid,
    ready: true,
  });
}

export function recordNestedRuntimeProvisioning(
  manifestPath: string,
  child: Omit<
    NestedRuntimeRecord,
    "state" | "startedAt" | "completedAt" | "migrationRunId" | "apiPid" | "frontendPid"
  >,
) {
  updateManifest(manifestPath, (manifest) => {
    if (manifest.children.some((entry) => entry.id === child.id)) {
      throw new Error(`Nested runtime ${child.id} is already registered.`);
    }
    if (!/^wiseeff_acceptance_disposable_[a-z0-9_]+$/u.test(child.databaseName)) {
      throw new Error(`Nested runtime database name is unsafe: ${child.databaseName}`);
    }
    manifest.children.push({
      ...child,
      state: "provisioning",
      startedAt: new Date().toISOString(),
    });
  });
}

export function recordNestedRuntimeProgress(
  manifestPath: string,
  childId: string,
  progress: {
    migrationRunId?: string;
    apiPid?: number;
    frontendPid?: number;
    ready?: boolean;
  },
) {
  updateManifest(manifestPath, (manifest) => {
    const child = manifest.children.find((entry) => entry.id === childId);
    if (!child) throw new Error(`Nested runtime ${childId} is not registered.`);
    if (child.state !== "provisioning") {
      throw new Error(`Nested runtime ${childId} is no longer provisioning.`);
    }
    for (const [label, pid] of [["api", progress.apiPid], ["frontend", progress.frontendPid]] as const) {
      if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
        throw new Error(`Nested ${label} PID must be a positive integer.`);
      }
    }
    if (progress.migrationRunId !== undefined) {
      if (child.migrationRunId && child.migrationRunId !== progress.migrationRunId) {
        throw new Error(`Nested runtime ${childId} migration identity cannot change.`);
      }
      child.migrationRunId = progress.migrationRunId;
    }
    if (progress.apiPid !== undefined) {
      if (child.apiPid && child.apiPid !== progress.apiPid) {
        throw new Error(`Nested runtime ${childId} API PID cannot change.`);
      }
      child.apiPid = progress.apiPid;
    }
    if (progress.frontendPid !== undefined) {
      if (child.frontendPid && child.frontendPid !== progress.frontendPid) {
        throw new Error(`Nested runtime ${childId} frontend PID cannot change.`);
      }
      child.frontendPid = progress.frontendPid;
    }
    if (progress.ready) {
      if (!child.migrationRunId || !child.apiPid || !child.frontendPid) {
        throw new Error(`Nested runtime ${childId} cannot become ready before all owned resources are recorded.`);
      }
      child.state = "running";
    }
  });
}

export function recordNestedRuntimeFinish(
  manifestPath: string,
  childId: string,
  state: Exclude<NestedRuntimeState, "running" | "provisioning">,
  cleanup: NestedRuntimeCleanup,
) {
  updateManifest(manifestPath, (manifest) => {
    const child = manifest.children.find((entry) => entry.id === childId);
    if (!child) throw new Error(`Nested runtime ${childId} is not registered.`);
    if (child.state !== "running" && child.state !== "provisioning" && child.state !== "cleanup-failed") {
      throw new Error(`Nested runtime ${childId} is already finalized.`);
    }
    child.state = state;
    child.completedAt = new Date().toISOString();
    child.cleanup = cleanup;
  });
}

export function readNestedRuntimeManifest(manifestPath: string) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NestedRuntimeManifest;
  if (
    manifest.version !== 1 ||
    manifest.kind !== "wiseeff-gate0-nested-runtime-manifest" ||
    !Array.isArray(manifest.children)
  ) {
    throw new Error("Nested runtime manifest identity is invalid.");
  }
  return manifest;
}

const readManifest = readNestedRuntimeManifest;

function writeManifest(manifestPath: string, manifest: NestedRuntimeManifest, flag: "w" | "wx" = "w") {
  manifest.updatedAt = new Date().toISOString();
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\//iu.test(serialized) || /auth.?secret|authorization|bearer/iu.test(serialized)) {
    throw new Error("Nested runtime manifest must not contain credentials.");
  }
  if (flag === "wx") {
    writeFileSync(manifestPath, serialized, { encoding: "utf8", flag });
    return;
  }
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, manifestPath);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function updateManifest(manifestPath: string, update: (manifest: NestedRuntimeManifest) => void) {
  const lockPath = `${manifestPath}.lock`;
  const deadline = Date.now() + 5_000;
  let lockFd: number | undefined;
  const lockToken = randomUUID();
  while (lockFd === undefined) {
    try {
      lockFd = openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (recoverStaleManifestLock(lockPath)) continue;
      if (Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    writeFileSync(lockFd, `${JSON.stringify({ pid: process.pid, token: lockToken })}\n`, "utf8");
  } catch (error) {
    closeSync(lockFd);
    try {
      unlinkSync(lockPath);
    } catch (unlinkError) {
      if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
    }
    throw error;
  }
  try {
    const manifest = readManifest(manifestPath);
    update(manifest);
    writeManifest(manifestPath, manifest);
  } finally {
    closeSync(lockFd);
    const owner = readManifestLockOwner(lockPath);
    if (owner?.pid === process.pid && owner.token === lockToken) {
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function recoverStaleManifestLock(lockPath: string) {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  const owner = readManifestLockOwner(lockPath);
  const ageMs = Date.now() - stat.mtimeMs;
  const invalidAndOld = !owner && ageMs > 1_000;
  const deadOwner = owner ? !isProcessAlive(owner.pid) : false;
  const expiredOwner = owner ? ageMs > 30_000 : false;
  if (!invalidAndOld && !deadOwner && !expiredOwner) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function readManifestLockOwner(lockPath: string): { pid: number; token: string } | undefined {
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown; token?: unknown };
    if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 || typeof owner.token !== "string" || !owner.token) {
      return undefined;
    }
    return { pid: Number(owner.pid), token: owner.token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
