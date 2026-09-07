import { withSyntheticRecoveryTarget } from "./execution/authorization.fixture";
import { loadUpgradeJournal } from "../scripts/parameter-catalog-upgrade/journal";
import { RECOVERY_EXECUTION_EVENTS } from "./execution/authorization";
import { restoreRecoveryPackage } from "./execution/packageRestore";
import { mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { captureControlledRecovery } from "./controlledRecovery";
import { captureRecoveryPackage, hasUnsupportedNonDumpCapabilities, verifyRecoveryPackage, type RecoveryBootstrapIdentity, type RecoveryRole } from "./recoveryPackage";

it("requires a complete zero non-dump capability inventory and never treats absent or unknown counts as clear", () => {
  const clear = { databaseOwner: 0, databaseAcl: 0, databaseSettings: 0, databaseProperties: 0, tablespaceOwner: 0, tablespaceAcl: 0, parameterAcl: 0, builtinFunctionOwner: 0, builtinFunctionAcl: 0, baselineUnavailable: 0 };
  expect(hasUnsupportedNonDumpCapabilities(clear)).toBe(false);
  for (const key of Object.keys(clear)) expect(hasUnsupportedNonDumpCapabilities({ ...clear, [key]: 1 })).toBe(true);
  for (const value of [null, {}, [], { ...clear, other: 0 }, { ...clear, databaseAcl: "0" }, { ...clear, baselineUnavailable: -1 }]) expect(hasUnsupportedNonDumpCapabilities(value)).toBe(true);
  const { databaseSettings: _databaseSettings, ...oldInventory } = clear;
  expect(hasUnsupportedNonDumpCapabilities(oldInventory)).toBe(true);
});

it("rejects a missing backup manifest without returning an empty successful package", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try { await expect(verifyRecoveryPackage(directory, "0".repeat(64))).rejects.toThrow("recovery-package-invalid"); }
  finally { await rm(directory, { recursive: true }); }
});

it.each(["privileged-role", "role-secret", "missing-inherit", "old-format", "missing-aof-segment", "oversized-file"])("rejects unsupported or incomplete %s even with a matching external package digest", async (fault) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    await fixture(directory);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    if (fault === "privileged-role") manifest.roles[0].superuser = true;
    if (fault === "role-secret") manifest.roles[0].password = "must-never-be-a-manifest-field";
    if (fault === "missing-inherit") delete manifest.roles[0].inherit;
    if (fault === "old-format") manifest.format = "wiseeff-recovery-package-v1";
    if (fault === "missing-aof-segment") manifest.redis.files.pop();
    if (fault === "oversized-file") manifest.postgres.size = 257 * 1024 * 1024;
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(path.join(directory, "manifest.json"), bytes);
    await expect(verifyRecoveryPackage(directory, createHash("sha256").update(bytes).digest("hex"))).rejects.toThrow("recovery-package-invalid");
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["same-store", "approval-refused"])("never invokes restore for %s", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    const digest = await fixture(directory); let restored = false;
    await expect(withSyntheticRecoveryTarget(directory, digest,
      { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: fault === "same-store" ? "pg" : "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      { assertEmptyAndIsolated: async () => {}, restorePostgres: async () => { restored = true; }, restoreObjects: async () => {}, restoreRedis: async () => {} },
      port => restoreRecoveryPackage(directory, digest, port), fault !== "approval-refused",
    )).rejects.toThrow(fault === "same-store" ? "target-not-independent" : "execution-authorization-unavailable");
    expect(restored).toBe(false);
  } finally { await rm(directory, { recursive: true }); }
});

const fixtureInput = (roles: RecoveryRole[] = [{ name: "owner", login: false, inherit: false, members: [] }], bootstrap?: RecoveryBootstrapIdentity) => ({
  runId: "restore_run", target: { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "redis" },
  quiescence: { status: "quiesced" as const, writersFenced: true as const, queueDrained: true as const, proxyStopped: true as const, observedAt: new Date().toISOString() },
  postgres: Buffer.from("dump"), roles,
  ...(bootstrap ? { bootstrap } : {}),
  objects: [{ key: "one", contentType: "application/json", metadata: { tenant: "two" }, bytes: Buffer.from("null") }],
  redis: { appendonly: true as const, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") }, { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("aof") }] },
});
const fixture = (directory: string, roles?: RecoveryRole[], bootstrap?: RecoveryBootstrapIdentity) => captureRecoveryPackage(directory, fixtureInput(roles, bootstrap));

it("does not write later package bytes into a replacement directory after the first real payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "upg-package-swap-"));
  const directory = path.join(root, "package"); const moved = path.join(root, "original");
  mkdirSync(directory, { mode: 0o700 });
  const input = fixtureInput(); const objects = input.objects;
  Object.defineProperty(input, "objects", { get() {
    expect(readdirSync(directory)).toEqual(["payload-0.bin"]);
    renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 });
    return objects;
  } });
  try {
    await expect(captureRecoveryPackage(directory, input)).rejects.toThrow("recovery-package-invalid");
    expect(await readFile(path.join(moved, "payload-0.bin"), "utf8")).toBe("dump");
    expect(readdirSync(directory)).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});

it("keeps controlled capture's earliest directory identity across source export", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "upg-package-swap-"));
  const directory = path.join(root, "package"); const moved = path.join(root, "original");
  mkdirSync(directory, { mode: 0o700 });
  const input = fixtureInput(); let closed = false;
  try {
    await expect(captureControlledRecovery({ directory, runId: input.runId, target: input.target }, {
      observe: async () => input.target,
      open: async () => ({
        postgres: async () => { renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 }); return input; },
        objects: async () => input.objects, redis: async () => input.redis, close: async () => { closed = true; },
      }),
    }, {
      acquire: async () => ({ runId: input.runId, target: input.target, digest: "a".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }),
      verify: async () => {},
    })).rejects.toThrow("controlled-recovery-directory-identity-drift");
    expect(closed).toBe(true);
    expect(readdirSync(directory)).toEqual([]);
    expect(readdirSync(moved)).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});

it("rejects directory replacement after opening the actual output descriptor, before writing bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "upg-package-fd-"));
  const directory = path.join(root, "package"); const moved = path.join(root, "original");
  mkdirSync(directory, { mode: 0o700 });
  const probe = await open(path.join(root, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe); const realStat = prototype.stat;
  await probe.close();
  let replaced = false;
  // All filesystem operations and descriptors remain real. Pause only at the
  // descriptor observation to deterministically perform the namespace race.
  const observation = vi.spyOn(prototype, "stat").mockImplementation(async function (this: Awaited<ReturnType<typeof open>>, ...args: unknown[]) {
    const result = await realStat.apply(this, args);
    if (result.isFile() && !replaced) {
      replaced = true;
      renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 });
      writeFileSync(path.join(directory, "foreign.keep"), "foreign-owned-content");
    }
    return result;
  });
  try {
    await expect(fixture(directory)).rejects.toThrow("recovery-package-invalid");
    expect(replaced).toBe(true);
    expect(readdirSync(directory)).toEqual(["foreign.keep"]);
    expect(await readFile(path.join(directory, "foreign.keep"), "utf8")).toBe("foreign-owned-content");
    expect((await readFile(path.join(moved, "payload-0.bin"))).length).toBe(0);
  } finally { observation.mockRestore(); await rm(root, { recursive: true }); }
});

it("refuses an earlier expected directory identity before creating any payload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-identity-"));
  try {
    await expect(captureRecoveryPackage(directory, fixtureInput(), { dev: -1, ino: -1 })).rejects.toThrow("recovery-package-invalid");
    expect(readdirSync(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true }); }
});

it("authenticates a v3 pre-existing bootstrap identity without making it a restorable privileged role", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  const bootstrap: RecoveryBootstrapIdentity = { roleName: "wiseeff", roleOid: "10", postgresMajor: 16 };
  try {
    const digest = await fixture(directory, undefined, bootstrap);
    const backup = await verifyRecoveryPackage(directory, digest);
    expect(backup.manifest.format).toBe("wiseeff-recovery-package-v3");
    expect(backup.bootstrap).toEqual(bootstrap);
    expect(backup.roles).toEqual([{ name: "owner", login: false, inherit: false, members: [] }]);
    const events: string[] = [];
    const result = await withSyntheticRecoveryTarget(directory, digest,
      { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      { assertBootstrap: async value => { expect(value).toEqual(bootstrap); events.push("bootstrap"); },
        assertEmptyAndIsolated: async () => { events.push("empty"); },
        restorePostgres: async value => { expect(value.bootstrap).toEqual(bootstrap); expect(value.postgres.toString()).toBe("dump"); events.push("restore"); },
        restoreObjects: async () => {}, restoreRedis: async () => {} },
      port => restoreRecoveryPackage(directory, digest, port));
    expect(result.status).toBe("restore-executed-not-business-verified");
    expect(events).toEqual(["bootstrap", "empty", "restore"]);
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["unsupported", "mismatch"])("refuses v3 bootstrap %s before recording execution or restoring", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    const digest = await fixture(directory, undefined, { roleName: "wiseeff", roleOid: "10", postgresMajor: 16 });
    const events: string[] = [];
    await withSyntheticRecoveryTarget(directory, digest,
      { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      { ...(fault === "mismatch" ? { assertBootstrap: async () => { throw new Error("bootstrap-mismatch"); } } : {}),
        assertEmptyAndIsolated: async () => { events.push("empty"); }, restorePostgres: async () => { events.push("restore"); },
        restoreObjects: async () => {}, restoreRedis: async () => {} },
      async (port, consumption) => {
        await expect(restoreRecoveryPackage(directory, digest, port)).rejects.toThrow(fault === "mismatch" ? "controlled-recovery-operation-failed" : "restore-bootstrap-unsupported");
        expect(events).toEqual([]);
        const loaded = loadUpgradeJournal({ journalPath: consumption.journal.journalPath, runId: consumption.capture.runId });
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.value.record.entries.some(entry => entry.action === RECOVERY_EXECUTION_EVENTS.started)).toBe(false);
      });
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["password-hash", "wrong-oid", "wrong-major", "extra-capability", "bootstrap-in-roles", "missing-bootstrap", "downgrade", "changed-name"])("rejects v3 bootstrap %s even with a matching outer digest", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    await fixture(directory, undefined, { roleName: "wiseeff", roleOid: "10", postgresMajor: 16 });
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    if (fault === "password-hash") manifest.bootstrap.passwordHash = "never-exported";
    if (fault === "wrong-oid") manifest.bootstrap.roleOid = "11";
    if (fault === "wrong-major") manifest.bootstrap.postgresMajor = 17;
    if (fault === "extra-capability") manifest.bootstrap.superuser = true;
    if (fault === "bootstrap-in-roles") manifest.roles.push({ name: "wiseeff", login: true, inherit: true, members: [] });
    if (fault === "missing-bootstrap") delete manifest.bootstrap;
    if (fault === "downgrade") manifest.format = "wiseeff-recovery-package-v2";
    if (fault === "changed-name") manifest.bootstrap.roleName = "other_owner";
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(path.join(directory, "manifest.json"), bytes);
    await expect(verifyRecoveryPackage(directory, createHash("sha256").update(bytes).digest("hex"))).rejects.toThrow("recovery-package-invalid");
  } finally { await rm(directory, { recursive: true }); }
});

it("preserves NOINHERIT roles and independent PG16 membership inherit/set flags in authenticated package bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  const roles: RecoveryRole[] = [
    { name: "owner", login: false, inherit: false, members: [] },
    { name: "read_capability", login: false, inherit: false, members: [{ name: "reader", inherit: true, set: false }] },
    { name: "explicit_capability", login: false, inherit: false, members: [{ name: "reader", inherit: false, set: true }] },
    { name: "reader", login: true, inherit: true, members: [] },
  ];
  try {
    const digest = await fixture(directory, roles);
    const backup = await verifyRecoveryPackage(directory, digest);
    expect(backup.roles).toEqual(roles);
    expect(backup.manifest.format).toBe("wiseeff-recovery-package-v2");
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["admin", "missing-set", "unknown-member", "duplicate-member", "cycle", "role-settings", "password-hash"])("rejects unsupported %s role input before capture writes", async fault => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  const roles = [
    { name: "capability", login: false, inherit: false, members: [{ name: "reader", inherit: true, set: false }] },
    { name: "reader", login: true, inherit: true, members: [] },
  ];
  try {
    const input = JSON.parse(JSON.stringify(roles));
    if (fault === "admin") input[0].members[0].admin = true;
    if (fault === "missing-set") delete input[0].members[0].set;
    if (fault === "unknown-member") input[0].members[0].name = "outside_package";
    if (fault === "duplicate-member") input[0].members.push(input[0].members[0]);
    if (fault === "cycle") input[1].members.push({ name: "capability", inherit: false, set: true });
    if (fault === "role-settings") input[0].settings = {};
    if (fault === "password-hash") input[1].passwordHash = "not-a-package-field";
    await expect(fixture(directory, input)).rejects.toThrow("recovery-package-invalid");
    await expect(readFile(path.join(directory, "payload-0.bin"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(directory, { recursive: true }); }
});

it("retains append-only unknown outcome and refuses a blind retry after a partial restore", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    const digest = await fixture(directory); let restores = 0;
    await withSyntheticRecoveryTarget(directory, digest,
      { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      { assertEmptyAndIsolated: async () => {},
        restorePostgres: async backup => { restores++; expect(backup.postgres.toString()).toBe("dump"); throw new Error("unknown commit"); },
        restoreObjects: async () => {}, restoreRedis: async () => {} },
      async (port, consumption) => {
        await expect(restoreRecoveryPackage(directory, digest, port)).rejects.toThrow("outcome-unknown");
        const before = await readFile(consumption.journal.journalPath, "utf8");
        expect(JSON.parse(before).entries.map((entry: { action: string }) => entry.action)).toContain(RECOVERY_EXECUTION_EVENTS.unknown);
        await expect(restoreRecoveryPackage(directory, digest, port)).rejects.toThrow("execution-authorization-unavailable");
        expect(await readFile(consumption.journal.journalPath, "utf8")).toBe(before);
        expect(restores).toBe(1);
      });
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["missing", "symlink", "digest"])("rejects %s package material", async (fault) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    const digest = await fixture(directory);
    if (fault !== "digest") await rm(path.join(directory, "payload-0.bin"));
    if (fault === "symlink") await symlink(path.join(directory, "payload-1.bin"), path.join(directory, "payload-0.bin"));
    await expect(verifyRecoveryPackage(directory, fault === "digest" ? "0".repeat(64) : digest)).rejects.toThrow("recovery-package-invalid");
  } finally { await rm(directory, { recursive: true }); }
});

it("restores only authenticated package bytes and refuses tampering before target mutations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  const target = { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "redis" };
  try {
    const digest = await captureRecoveryPackage(directory, {
      runId: "run1", target, quiescence: { status: "quiesced", writersFenced: true, queueDrained: true, proxyStopped: true, observedAt: new Date().toISOString() },
      postgres: Buffer.from("dump"), roles: [{ name: "reader", login: true, inherit: true, members: [] }],
      objects: [{ key: "one", contentType: "application/json", metadata: { tenant: "two" }, bytes: Buffer.from("null") }],
      redis: { appendonly: true, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") }, { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("aof") }] },
    });
    let mutated = false;
    await withSyntheticRecoveryTarget(directory, digest,
      { ...target, deploymentId: "restore", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      { assertEmptyAndIsolated: async () => {}, restorePostgres: async () => { mutated = true; }, restoreObjects: async () => {}, restoreRedis: async () => {} },
      async port => {
        await writeFile(path.join(directory, "payload-0.bin"), "tampered");
        await expect(restoreRecoveryPackage(directory, digest, port)).rejects.toThrow("recovery-package-invalid");
        expect(mutated).toBe(false);
      });
  } finally { await rm(directory, { recursive: true }); }
});
