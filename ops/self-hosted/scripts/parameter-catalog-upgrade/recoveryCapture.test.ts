import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { withHostOperationLock, type HostOperationLock } from "./handoff";
import { openUpgradeJournal, loadUpgradeJournal, journalBytes } from "./journal";
import { recordControlledRecoveryCapture } from "./recoveryCapture";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import type { ControlledRecoveryBoundary, ControlledRecoverySource } from "../../storage/controlledRecovery";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "upg-capture-unit-")));
  onTestFinished(() => rm(root, { recursive: true }));
  const directory = path.join(root, "package"); await mkdir(directory, { mode: 0o700 });
  const operationRoot = path.join(root, "operation"); await mkdir(operationRoot, { mode: 0o700 });
  const opened = openUpgradeJournal({ journalPath: path.join(operationRoot, "run.json"), runId: "synthetic-run" });
  if (!opened.ok) throw new Error("fixture-journal-failed");
  const target = { deploymentId: "owned-fixture", hostFingerprint: "host", postgresIdentity: "postgres", objectStoreIdentity: "objects", redisIdentity: "redis" };
  const calls: string[] = [];
  const source: ControlledRecoverySource = {
    observe: async () => target,
    open: async () => ({
      async postgres() { calls.push("postgres"); return { postgres: Buffer.from("unit-only-dump"), roles: [{ name: "unit_reader", login: true, inherit: false, members: [] }] }; },
      async objects() { calls.push("objects"); return [{ key: "one.txt", contentType: "text/plain", metadata: { version: "17" }, bytes: Buffer.from("unit-only-object") }]; },
      async redis() { calls.push("redis"); return { appendonly: true, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") }, { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("unit-only-aof") }] }; },
      async close() { calls.push("close"); },
    }),
  };
  const boundary: ControlledRecoveryBoundary = {
    acquire: async () => ({ runId: "synthetic-run", target, digest: "a".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }),
    verify: async () => {},
  };
  return { root, directory, operationRoot, journal: opened.value, target, calls, source, boundary, attemptId: "capture-one" };
}

it("records actual capture output under the real host lock without issuing restore or phase approval", async () => {
  const f = await fixture();
  const captured = await withHostOperationLock(f.operationRoot, lock => recordControlledRecoveryCapture({ ...f, lock }, f.source, f.boundary));
  expect(f.calls).toEqual(["postgres", "objects", "redis", "close"]);
  const loaded = loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "synthetic-run", requireSettled: true });
  if (!loaded.ok) throw new Error("fixture-reload-failed");
  expect(loaded.value.record.state).toBe("idle");
  expect(loaded.value.record.entries.map(e => e.action)).toEqual(["recovery-capture-pending", "recovery-package-captured"]);
  expect(loaded.value.record.entries.at(-1)?.recoveryCapture?.capture).toEqual(captured);
  const backup = await verifyRecoveryPackage(f.directory, captured.packageDigest);
  expect(backup.objects[0].metadata).toEqual({ version: "17" });
  expect(backup.manifest.recovery.recoveryPointDigest).toBe(captured.recoveryPointDigest);
  await expect(withHostOperationLock(f.operationRoot, lock => recordControlledRecoveryCapture({ ...f, lock, attemptId: "new-attempt" }, f.source, f.boundary)))
    .rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  expect(f.calls).toHaveLength(4);
});

it.each(["structural", "wrong-root", "released", "nonempty", "replaced-root"])("rejects %s before capture or journal effects", async fault => {
  const f = await fixture();
  const before = journalBytes(f.journal.journalPath);
  const run = (lock: HostOperationLock) => recordControlledRecoveryCapture({ ...f, lock }, f.source, f.boundary);
  if (fault === "nonempty") await writeFile(path.join(f.directory, "unowned"), "do-not-overwrite");
  if (fault === "structural") await expect(run({ assertHeld: async () => {} })).rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  if (fault === "wrong-root") await expect(withHostOperationLock(path.join(f.root, "other-lock"), run)).rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  if (fault === "released") {
    let previous!: HostOperationLock;
    await withHostOperationLock(f.operationRoot, async lock => { previous = lock; });
    await expect(run(previous)).rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  }
  if (fault === "nonempty") await expect(withHostOperationLock(f.operationRoot, run)).rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  if (fault === "replaced-root") {
    await expect(withHostOperationLock(f.operationRoot, async lock => {
      await rename(f.operationRoot, `${f.operationRoot}-retained`);
      await mkdir(f.operationRoot, { mode: 0o700 });
      await writeFile(f.journal.journalPath, before, { mode: 0o600 });
      await writeFile(path.join(f.operationRoot, ".operation.lock.owner"), "foreign-owner");
      await run(lock);
    })).rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
    expect(await readFile(path.join(f.operationRoot, ".operation.lock.owner"), "utf8")).toBe("foreign-owner");
    expect(await readFile(path.join(`${f.operationRoot}-retained`, "run.json"))).toEqual(before);
  }
  expect(f.calls).toEqual([]);
  expect(journalBytes(f.journal.journalPath)).toEqual(before);
});

it.each(["export-failed", "directory-drift", "lock-lost"])("keeps %s unknown and rejects a blind new attempt", async fault => {
  const f = await fixture();
  const originalOpen = f.source.open;
  f.source.open = async () => {
    const original = await originalOpen();
    return { ...original, async postgres() {
      const value = await original.postgres();
      if (fault === "export-failed") throw new Error("private-database-secret-must-not-appear");
      if (fault === "directory-drift") { await rename(f.directory, `${f.directory}-retained`); await mkdir(f.directory, { mode: 0o700 }); }
      if (fault === "lock-lost") {
        const owner = await readFile(path.join(f.operationRoot, ".operation.lock.owner"), "utf8")
          .catch(() => readFile(path.join(f.operationRoot, ".operation.lock.d", "owner"), "utf8"));
        const pid = Number(/^pid=(\d+)$/m.exec(owner)?.[1]);
        if (!pid || !owner.includes("operation=catalog-handoff\n")) throw new Error("fixture-lock-owner-missing");
        process.kill(pid, "SIGTERM");
      }
      return value;
    } };
  };
  await expect(withHostOperationLock(f.operationRoot, lock => recordControlledRecoveryCapture({ ...f, lock }, f.source, f.boundary)))
    .rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  const loaded = loadUpgradeJournal({ journalPath: f.journal.journalPath, runId: "synthetic-run" });
  expect(loaded.ok && loaded.value.record.entries.at(-1)?.recoveryCapture?.outcome).toBe("unknown");
  expect(f.calls).toEqual(["postgres", "close"]);
  const persisted = journalBytes(f.journal.journalPath);
  await expect(withHostOperationLock(f.operationRoot, lock => recordControlledRecoveryCapture({ ...f, lock, attemptId: "new" }, f.source, f.boundary)))
    .rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  expect(journalBytes(f.journal.journalPath)).toEqual(persisted);
  expect(persisted.toString()).not.toContain("secret");
});

it("retains the original pending journal without writing a replacement operation directory", async () => {
  const f = await fixture();
  const originalOpen = f.source.open;
  let pendingBytes!: Buffer;
  f.source.open = async () => {
    const original = await originalOpen();
    return { ...original, async postgres() {
      const value = await original.postgres();
      pendingBytes = journalBytes(f.journal.journalPath);
      await rename(f.operationRoot, `${f.operationRoot}-retained`);
      await mkdir(f.operationRoot, { mode: 0o700 });
      await writeFile(f.journal.journalPath, pendingBytes, { mode: 0o600 });
      return value;
    } };
  };
  await expect(withHostOperationLock(f.operationRoot, lock => recordControlledRecoveryCapture({ ...f, lock }, f.source, f.boundary)))
    .rejects.toThrow("PCAT-UPG-RECOVERY-CAPTURE-UNAVAILABLE");
  expect(f.calls).toEqual(["postgres", "close"]);
  expect(journalBytes(f.journal.journalPath)).toEqual(pendingBytes);
  expect(await readFile(path.join(`${f.operationRoot}-retained`, "run.json"))).toEqual(pendingBytes);
  expect(JSON.parse(pendingBytes.toString()).entries.at(-1).recoveryCapture.outcome).toBe("pending");
});
