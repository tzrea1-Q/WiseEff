import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { captureRecoveryPackage, restoreRecoveryPackage, verifyRecoveryPackage, type RecoveryRole } from "./recoveryPackage";

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
    const digest = await fixture(directory);
    let restored = false;
    await expect(restoreRecoveryPackage(directory, digest, {
      target: { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: fault === "same-store" ? "pg" : "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      journalPath: path.join(directory, "journal"), authorize: async () => { throw new Error("approval-denied"); },
      assertEmptyAndIsolated: async () => {}, restore: async () => { restored = true; },
    })).rejects.toThrow(fault === "same-store" ? "target-not-independent" : "approval-denied");
    expect(restored).toBe(false);
  } finally { await rm(directory, { recursive: true }); }
});

const fixture = async (directory: string, roles: RecoveryRole[] = [{ name: "owner", login: false, inherit: false, members: [] }]) => captureRecoveryPackage(directory, {
  runId: "restore_run", target: { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "redis" },
  quiescence: { status: "quiesced", writersFenced: true, queueDrained: true, proxyStopped: true, observedAt: new Date().toISOString() },
  postgres: Buffer.from("dump"), roles,
  objects: [{ key: "one", contentType: "application/json", metadata: { tenant: "two" }, bytes: Buffer.from("null") }],
  redis: { appendonly: true, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") }, { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("aof") }] },
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

it("restores verified immutable bytes despite replacement after authorization and persists refusal after unknown outcome", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "upg-package-test-"));
  try {
    const digest = await fixture(directory);
    const target = {
      target: { deploymentId: "restore", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "redis2" },
      journalPath: path.join(directory, "journal"),
      authorize: async (binding: { packageDigest: string; runId: string }) => {
        expect(binding).toMatchObject({ packageDigest: digest, runId: "restore_run" });
        await writeFile(path.join(directory, "payload-0.bin"), "evil");
      }, assertEmptyAndIsolated: async () => {},
      restore: async (backup: { postgres: Buffer }) => { expect(backup.postgres.toString()).toBe("dump"); throw new Error("unknown commit"); },
    };
    await expect(restoreRecoveryPackage(directory, digest, target)).rejects.toThrow("outcome-unknown");
    expect(JSON.parse(await readFile(target.journalPath, "utf8")).status).toBe("started-unknown-until-completed");
    await writeFile(path.join(directory, "payload-0.bin"), "dump");
    await expect(restoreRecoveryPackage(directory, digest, { ...target, authorize: async () => {}, restore: async () => { throw new Error("must not retry"); } })).rejects.toThrow("journal-exists-or-unavailable");
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
    await writeFile(path.join(directory, "payload-0.bin"), "tampered");
    await expect(restoreRecoveryPackage(directory, digest, {
      target: { ...target, deploymentId: "restore" }, journalPath: path.join(directory, "restore.json"),
      authorize: async () => {}, assertEmptyAndIsolated: async () => {},
      restore: async () => { mutated = true; },
    })).rejects.toThrow("recovery-package-invalid");
    expect(mutated).toBe(false);
  } finally { await rm(directory, { recursive: true }); }
});
