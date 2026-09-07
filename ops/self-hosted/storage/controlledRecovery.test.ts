import { withHostOperationLock } from "../scripts/parameter-catalog-upgrade/handoff";
import { createRecoveryExecutionAuthorization } from "./execution/authorization";
import { recordSyntheticRecoveryConsumption } from "./execution/authorization.fixture";
import { createControlledRecoveryTarget } from "./execution/packageRestore";
import { restoreRecoveryPackage } from "./execution/packageRestore";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { captureControlledRecovery, type ControlledRecoverySource } from "./controlledRecovery";
import { verifyRecoveryPackage } from "./recoveryPackage";

it("refuses a different run's writer boundary before exporting or publishing a package", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-test-"));
  const target = { deploymentId: "owned-source", hostFingerprint: "daemon", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
  let exports = 0;
  const source: ControlledRecoverySource = {
    observe: async () => target,
    open: async () => { exports++; throw new Error("source must not open"); },
  };
  try {
    await expect(captureControlledRecovery({ directory, runId: "run-a", target }, source, {
      acquire: async () => ({ runId: "run-b", target, digest: "a".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }),
      verify: async () => {},
    })).rejects.toThrow("controlled-recovery-boundary-mismatch");
    expect(exports).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true }); }
});

const sourceIdentity = { deploymentId: "source", hostFingerprint: "owned-daemon", postgresIdentity: "pg-source", objectStoreIdentity: "objects-source", redisIdentity: "redis-source" };
const material = () => ({
  postgres: Buffer.from("synthetic-dump"), roles: [{ name: "reader", login: true, inherit: false, members: [] }],
  objects: [{ key: "one.json", contentType: "application/json", metadata: { revision: "4" }, bytes: Buffer.from("null") },
    { key: "two.txt", contentType: "text/plain", metadata: { revision: "9" }, bytes: Buffer.from("two") }],
  redis: { appendonly: true as const, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") },
    { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("synthetic-aof") }] },
});
const boundary = () => ({
  acquire: async () => ({ runId: "run", target: sourceIdentity, digest: "a".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }),
  verify: async () => {},
});

it("pins input identity before a caller-owned configuration can be changed during boundary acquisition", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-test-"));
  const target = { ...sourceIdentity };
  let opened = false;
  try {
    await expect(captureControlledRecovery({ directory, runId: "run", target }, {
      observe: async () => target,
      open: async () => { opened = true; throw new Error("unexpected changed-target export"); },
    }, {
      acquire: async () => { target.postgresIdentity = "other-database"; return { ...await boundary().acquire(), target }; },
      verify: async () => {},
    })).rejects.toThrow("controlled-recovery-boundary-mismatch");
    expect(opened).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["expired", "revoked-after-dump", "changed-after-objects"])("refuses %s without publishing a manifest, and releases source locks", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-test-"));
  let phase = "before"; let closed = false;
  const bytes = material();
  const authority = boundary();
  if (fault === "expired") authority.acquire = async () => ({ ...await boundary().acquire(), expiresAt: new Date(0).toISOString() });
  authority.verify = async () => { if (fault === "revoked-after-dump" && phase === "dump") throw new Error("private database URL must not leak"); };
  try {
    await expect(captureControlledRecovery({ directory, runId: "run", target: sourceIdentity }, {
      observe: async () => fault === "changed-after-objects" && phase === "objects" ? { ...sourceIdentity, objectStoreIdentity: "changed" } : sourceIdentity,
      open: async () => ({ postgres: async () => { phase = "dump"; return bytes; }, objects: async () => { phase = "objects"; return bytes.objects; },
        redis: async () => bytes.redis, close: async () => { closed = true; } }),
    }, authority)).rejects.toThrow(fault === "expired" ? "boundary-mismatch" : fault === "changed-after-objects" ? "source-identity-drift" : "controlled-recovery-operation-failed");
    expect(await readdir(directory)).toEqual([]);
    expect(closed).toBe(fault !== "expired");
  } finally { await rm(directory, { recursive: true }); }
});

it("uses the existing authenticated package for target-only restore, refusing drift between stores", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-test-"));
  const bytes = material();
  try {
    const captured = await captureControlledRecovery({ directory, runId: "run", target: sourceIdentity }, {
      observe: async () => sourceIdentity,
      open: async () => ({ postgres: async () => bytes, objects: async () => bytes.objects, redis: async () => bytes.redis, close: async () => {} }),
    }, boundary());
    expect(captured.status).toBe("captured-not-restored");
    const packageBytes = await verifyRecoveryPackage(directory, captured.packageDigest);
    expect(packageBytes.objects.map(object => ({ key: object.key, contentType: object.contentType, metadata: object.metadata, value: object.bytes.toString() }))).toEqual([
      { key: "one.json", contentType: "application/json", metadata: { revision: "4" }, value: "null" },
      { key: "two.txt", contentType: "text/plain", metadata: { revision: "9" }, value: "two" },
    ]);
    const target = { ...sourceIdentity, deploymentId: "target", postgresIdentity: "pg-target", objectStoreIdentity: "objects-target", redisIdentity: "redis-target" };
    const actions: string[] = [];
    const consumption = await recordSyntheticRecoveryConsumption(directory, captured.packageDigest, target);
    await withHostOperationLock(path.join(directory, "locks"), async lock => {
    const destination = createControlledRecoveryTarget({ target,
      authorization: createRecoveryExecutionAuthorization({ ...consumption, lock }),
    }, {
      observe: async () => actions.length ? { ...target, redisIdentity: "changed" } : target,
      assertEmptyAndIsolated: async () => {},
      restorePostgres: async data => { expect(data.postgres.toString()).toBe("synthetic-dump"); actions.push("postgres"); },
      restoreObjects: async () => { actions.push("objects"); }, restoreRedis: async () => { actions.push("redis"); },
    });
    await expect(restoreRecoveryPackage(directory, captured.packageDigest, destination)).rejects.toThrow("recovery-restore-outcome-unknown-target-must-remain-isolated");
    expect(actions).toEqual(["postgres"]);
    await expect(restoreRecoveryPackage(directory, captured.packageDigest, destination)).rejects.toThrow("controlled-recovery-restore-target-drift");
    });
  } finally { await rm(directory, { recursive: true }); }
});
