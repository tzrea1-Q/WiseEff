import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  readProcessStartIdentity,
  sameProcessStartIdentity,
  type ProcessStartIdentity,
} from "../../../scripts/process-start-identity";

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

export type NestedRuntimeProcessIdentity = ProcessStartIdentity & {
  pid: number;
  port: number;
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
  apiProcessIdentity?: NestedRuntimeProcessIdentity;
  frontendProcessIdentity?: NestedRuntimeProcessIdentity;
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
    apiProcessIdentity: NestedRuntimeProcessIdentity;
    frontendProcessIdentity: NestedRuntimeProcessIdentity;
  },
) {
  const {
    migrationRunId,
    apiPid,
    frontendPid,
    apiProcessIdentity,
    frontendProcessIdentity,
    ...provisioning
  } = child;
  recordNestedRuntimeProvisioning(manifestPath, provisioning);
  recordNestedRuntimeProgress(manifestPath, child.id, {
    migrationRunId,
    apiPid,
    frontendPid,
    apiProcessIdentity,
    frontendProcessIdentity,
    ready: true,
  });
}

export function recordNestedRuntimeProvisioning(
  manifestPath: string,
  child: Omit<
    NestedRuntimeRecord,
    "state" | "startedAt" | "completedAt" | "migrationRunId" | "apiPid" | "frontendPid" |
      "apiProcessIdentity" | "frontendProcessIdentity"
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
    apiProcessIdentity?: NestedRuntimeProcessIdentity;
    frontendProcessIdentity?: NestedRuntimeProcessIdentity;
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
    for (const [label, identity, pid] of [
      ["api", progress.apiProcessIdentity, progress.apiPid],
      ["frontend", progress.frontendProcessIdentity, progress.frontendPid],
    ] as const) {
      if (identity !== undefined && (
        identity.pid !== pid ||
        !Number.isSafeInteger(identity.port) || identity.port <= 0 ||
        !identity.startToken || !/^[a-f0-9]{64}$/u.test(identity.commandSha256)
      )) {
        throw new Error(`Nested ${label} process identity is invalid or does not match its PID.`);
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
      assertPersistedProcessIdentityUnchanged(
        childId,
        "API",
        child.apiProcessIdentity,
        progress.apiProcessIdentity,
      );
      child.apiPid = progress.apiPid;
      if (progress.apiProcessIdentity) child.apiProcessIdentity = progress.apiProcessIdentity;
    }
    if (progress.frontendPid !== undefined) {
      if (child.frontendPid && child.frontendPid !== progress.frontendPid) {
        throw new Error(`Nested runtime ${childId} frontend PID cannot change.`);
      }
      assertPersistedProcessIdentityUnchanged(
        childId,
        "frontend",
        child.frontendProcessIdentity,
        progress.frontendProcessIdentity,
      );
      child.frontendPid = progress.frontendPid;
      if (progress.frontendProcessIdentity) child.frontendProcessIdentity = progress.frontendProcessIdentity;
    }
    if (progress.ready) {
      if (
        !child.migrationRunId || !child.apiPid || !child.frontendPid ||
        !child.apiProcessIdentity || !child.frontendProcessIdentity
      ) {
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
  const parentRunId = readManifest(manifestPath).parentRunId;
  const deadline = Date.now() + 5_000;
  const lockToken = randomUUID();
  const lockCandidatePath = `${lockPath}.${process.pid}.${lockToken}.candidate`;
  writeFileSync(lockCandidatePath, `${JSON.stringify({
    pid: process.pid,
    token: lockToken,
    parentRunId,
    processIdentity: readProcessStartIdentity(process.pid),
  })}\n`, { encoding: "utf8", flag: "wx" });
  let locked = false;
  try {
    while (!locked) {
      try {
        // The hard-link publish is one atomic no-replace operation, so another
        // process can never observe the empty owner window of open-then-write.
        linkSync(lockCandidatePath, lockPath);
        locked = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (recoverStaleManifestLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new Error(`Nested runtime manifest lock is held by a live owner: ${lockPath}`, { cause: error });
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    const manifest = readManifest(manifestPath);
    update(manifest);
    writeManifest(manifestPath, manifest);
  } finally {
    try {
      unlinkSync(lockCandidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const owner = locked ? readManifestLockOwner(lockPath) : undefined;
    if (locked && owner?.pid === process.pid && owner.token === lockToken) {
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

function recoverStaleManifestLock(lockPath: string) {
  const owner = readManifestLockOwner(lockPath);
  // A malformed/partially-written lock has no safe owner proof. Fail closed;
  // valid dead-owner records remain automatically recoverable below.
  if (!owner) return false;
  const deadOwner = owner ? !isProcessAlive(owner.pid) : false;
  const currentIdentity = owner?.processIdentity ? readProcessStartIdentity(owner.pid) : undefined;
  const reusedPid = owner?.processIdentity !== undefined && currentIdentity !== undefined
    ? !sameProcessStartIdentity(owner.processIdentity, currentIdentity)
    : false;
  // Lock age is never ownership proof: a live writer may be paused while it
  // holds a valid read-modify-write snapshot. Only a dead owner or a proven
  // PID reuse is stale. Parent identity is recorded
  // for audit, but even a mismatched live owner is never stolen from.
  if (!deadOwner && !reusedPid) return false;
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryOwner = acquireManifestRecoveryOwner(recoveryPath, owner);
  if (!recoveryOwner) return false;
  try {
    // A single hard-link claim closes the ABA window between observing a
    // stale owner and removing its pathname. If another waiter already owns
    // the recovery claim, this waiter fails closed instead of competing to
    // unlink a pathname that may since belong to a new live owner.
    try {
      linkSync(lockPath, recoveryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const recoveredOwner = readManifestLockOwner(recoveryPath);
    if (!sameManifestLockOwner(owner, recoveredOwner)) return false;
    const current = statSync(lockPath);
    const recovered = statSync(recoveryPath);
    if (current.dev !== recovered.dev || current.ino !== recovered.ino) return false;
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  } finally {
    unlinkIfPresent(recoveryPath);
    removeManifestRecoveryOwner(recoveryPath, recoveryOwner.token);
  }
}

type ManifestRecoveryOwner = {
  pid: number;
  token: string;
  createdAt: string;
  processIdentity?: ProcessStartIdentity;
  observedLockOwner: { pid: number; token: string };
};

const MANIFEST_RECOVERY_CLAIM_STALE_MS = 500;

function acquireManifestRecoveryOwner(
  recoveryPath: string,
  observedLockOwner: NonNullable<ReturnType<typeof readManifestLockOwner>>,
): ManifestRecoveryOwner | undefined {
  const ownerPath = `${recoveryPath}.owner`;
  const reclaimPath = `${ownerPath}.reclaim`;
  if (existsSync(reclaimPath) && !recoverStaleManifestRecoveryReclaim(ownerPath, reclaimPath)) {
    return undefined;
  }
  const owner: ManifestRecoveryOwner = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
    processIdentity: readProcessStartIdentity(process.pid),
    observedLockOwner: { pid: observedLockOwner.pid, token: observedLockOwner.token },
  };
  const candidatePath = `${ownerPath}.${process.pid}.${owner.token}.candidate`;
  writeFileSync(candidatePath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    try {
      linkSync(candidatePath, ownerPath);
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const existing = readManifestRecoveryOwner(ownerPath);
    if (!existing || !isStaleManifestRecoveryOwner(existing)) return undefined;
    try {
      linkSync(ownerPath, reclaimPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    try {
      const pinned = readManifestRecoveryOwner(reclaimPath);
      const current = readManifestRecoveryOwner(ownerPath);
      const pinnedStat = statSync(reclaimPath);
      const currentStat = statSync(ownerPath);
      if (
        !sameManifestRecoveryOwner(existing, pinned) ||
        !sameManifestRecoveryOwner(existing, current) ||
        pinnedStat.dev !== currentStat.dev ||
        pinnedStat.ino !== currentStat.ino
      ) {
        return undefined;
      }
      unlinkSync(ownerPath);
    } finally {
      unlinkIfPresent(reclaimPath);
    }
    return acquireManifestRecoveryOwner(recoveryPath, observedLockOwner);
  } finally {
    unlinkIfPresent(candidatePath);
  }
}

function recoverStaleManifestRecoveryReclaim(ownerPath: string, reclaimPath: string) {
  const pinned = readManifestRecoveryOwner(reclaimPath);
  if (!pinned || !isStaleManifestRecoveryOwner(pinned)) return false;
  try {
    const current = readManifestRecoveryOwner(ownerPath);
    if (current) {
      const pinnedStat = statSync(reclaimPath);
      const currentStat = statSync(ownerPath);
      if (
        !sameManifestRecoveryOwner(pinned, current) ||
        pinnedStat.dev !== currentStat.dev ||
        pinnedStat.ino !== currentStat.ino
      ) {
        return false;
      }
      unlinkSync(ownerPath);
    }
    const pinnedAgain = readManifestRecoveryOwner(reclaimPath);
    if (!sameManifestRecoveryOwner(pinned, pinnedAgain)) return false;
    unlinkIfPresent(reclaimPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return !existsSync(reclaimPath);
    throw error;
  }
}

function readManifestRecoveryOwner(ownerPath: string): ManifestRecoveryOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(ownerPath, "utf8")) as Partial<ManifestRecoveryOwner>;
    if (
      !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
      typeof value.token !== "string" || !value.token ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      !value.observedLockOwner || !Number.isSafeInteger(value.observedLockOwner.pid) ||
      typeof value.observedLockOwner.token !== "string" || !value.observedLockOwner.token
    ) return undefined;
    return {
      pid: Number(value.pid),
      token: value.token,
      createdAt: value.createdAt,
      processIdentity: isProcessStartIdentity(value.processIdentity) ? value.processIdentity : undefined,
      observedLockOwner: {
        pid: Number(value.observedLockOwner.pid),
        token: value.observedLockOwner.token,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isStaleManifestRecoveryOwner(owner: ManifestRecoveryOwner) {
  if (Date.now() - Date.parse(owner.createdAt) < MANIFEST_RECOVERY_CLAIM_STALE_MS) return false;
  const alive = isProcessAlive(owner.pid);
  const currentIdentity = owner.processIdentity ? readProcessStartIdentity(owner.pid) : undefined;
  const reusedPid = owner.processIdentity !== undefined && currentIdentity !== undefined
    ? !sameProcessStartIdentity(owner.processIdentity, currentIdentity)
    : false;
  return !alive || reusedPid;
}

function sameManifestRecoveryOwner(expected: ManifestRecoveryOwner, current: ManifestRecoveryOwner | undefined) {
  return current !== undefined &&
    expected.pid === current.pid &&
    expected.token === current.token &&
    expected.createdAt === current.createdAt &&
    expected.observedLockOwner.pid === current.observedLockOwner.pid &&
    expected.observedLockOwner.token === current.observedLockOwner.token &&
    (expected.processIdentity === undefined
      ? current.processIdentity === undefined
      : current.processIdentity !== undefined && sameProcessStartIdentity(expected.processIdentity, current.processIdentity));
}

function removeManifestRecoveryOwner(recoveryPath: string, token: string) {
  const ownerPath = `${recoveryPath}.owner`;
  const owner = readManifestRecoveryOwner(ownerPath);
  if (owner?.pid === process.pid && owner.token === token) unlinkIfPresent(ownerPath);
}

function assertPersistedProcessIdentityUnchanged(
  childId: string,
  label: "API" | "frontend",
  persisted: NestedRuntimeProcessIdentity | undefined,
  incoming: NestedRuntimeProcessIdentity | undefined,
) {
  if (!persisted || !incoming) return;
  if (
    persisted.pid !== incoming.pid ||
    persisted.port !== incoming.port ||
    !sameProcessStartIdentity(persisted, incoming)
  ) {
    throw new Error(`Nested runtime ${childId} ${label} process identity cannot change.`);
  }
}

function sameManifestLockOwner(
  expected: ReturnType<typeof readManifestLockOwner>,
  current: ReturnType<typeof readManifestLockOwner>,
) {
  if (!expected || !current) return false;
  return expected.pid === current.pid &&
    expected.token === current.token &&
    expected.parentRunId === current.parentRunId &&
    (expected.processIdentity === undefined
      ? current.processIdentity === undefined
      : current.processIdentity !== undefined && sameProcessStartIdentity(expected.processIdentity, current.processIdentity));
}

function unlinkIfPresent(targetPath: string) {
  try {
    unlinkSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function readManifestLockOwner(lockPath: string): {
  pid: number;
  token: string;
  parentRunId?: string;
  processIdentity?: ProcessStartIdentity;
} | undefined {
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: unknown;
      token?: unknown;
      parentRunId?: unknown;
      processIdentity?: unknown;
    };
    if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 || typeof owner.token !== "string" || !owner.token) {
      return undefined;
    }
    return {
      pid: Number(owner.pid),
      token: owner.token,
      parentRunId: typeof owner.parentRunId === "string" && owner.parentRunId ? owner.parentRunId : undefined,
      processIdentity: isProcessStartIdentity(owner.processIdentity)
        ? owner.processIdentity
        : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isProcessStartIdentity(value: unknown): value is ProcessStartIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProcessStartIdentity>;
  return typeof candidate.startToken === "string" && candidate.startToken.length > 0 &&
    typeof candidate.commandSha256 === "string" && /^[a-f0-9]{64}$/u.test(candidate.commandSha256);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
