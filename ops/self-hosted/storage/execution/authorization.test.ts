import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openUpgradeJournal, commitJournalTransition, loadUpgradeJournal } from "../../scripts/parameter-catalog-upgrade/journal";
import { withHostOperationLock } from "../../scripts/parameter-catalog-upgrade/handoff";
import { captureRecoveryPackage, verifyRecoveryPackage } from "../recoveryPackage";
import { mintRestoreToken } from "../recoveryPoint";
import { createControlledRecoveryTarget, restoreRecoveryPackage } from "./packageRestore";
import { createRecoveryExecutionAuthorization, recoveryExecutionRecordDigest, RECOVERY_EXECUTION_EVENTS,
  type RecoveryCaptureRecord, type RecoveryExecutionApproval } from "./authorization";

const source = { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "aof" };
const target = { deploymentId: "target", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "aof2" };

it("refuses an empty caller authorization callback before performing restore", async () => {
  expect(() => createControlledRecoveryTarget({ target, journalPath: "/unavailable", authorize: async () => {} } as never, {
    observe: async () => target, assertEmptyAndIsolated: async () => {},
    restorePostgres: async () => { throw new Error("must not run"); }, restoreObjects: async () => {}, restoreRedis: async () => {},
  })).toThrow("execution-authorization-required");
});

it("refuses a forged target at the root execution entry before opening any package", async () => {
  await expect(restoreRecoveryPackage("/must-not-read", "a".repeat(64), {
    target, authorize: async () => {}, assertEmptyAndIsolated: async () => {}, restore: async () => {},
  } as never)).rejects.toThrow("unissued-target");
});

it.each(["valid", "unapproved", "wrong-token", "cross-run", "expired", "package-drift", "approval-revoked", "partial-failure", "lock-lost", "target-drift", "target-drift-after-empty"])("enforces persisted authorization and cross-store boundaries: %s", async fault => {
  const root = await mkdtemp(path.join(os.tmpdir(), "authorized-recovery-"));
  const runId = "synthetic_run";
  const events: string[] = [];
  try {
    const packageDigest = await captureRecoveryPackage(root, { runId, target: source,
      quiescence: { status: "quiesced", writersFenced: true, queueDrained: true, proxyStopped: true, observedAt: new Date().toISOString() },
      postgres: Buffer.from("synthetic-dump"), roles: [], objects: [{ key: "one", contentType: "text/plain", metadata: {}, bytes: Buffer.from("one") }],
      redis: { appendonly: true, files: [{ name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") },
        { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("synthetic-aof") }] } });
    const verified = await verifyRecoveryPackage(root, packageDigest);
    const opened = openUpgradeJournal({ journalPath: path.join(root, "controller.json"), runId });
    if (!opened.ok) throw new Error("fixture journal unavailable");
    const journal = opened.value;
    const capture: RecoveryCaptureRecord = { runId, packageDigest, recoveryPointDigest: verified.manifest.recovery.recoveryPointDigest,
      source, boundaryDigest: "a".repeat(64) };
    const approval: RecoveryExecutionApproval = { runId: fault === "cross-run" ? "other" : runId, attemptId: "attempt-a",
      captureDigest: recoveryExecutionRecordDigest(capture), target, approvalReference: "isolated-synthetic-operator-action",
      expiresAt: new Date(Date.now() + (fault === "expired" ? -1 : 60000)).toISOString() };
    // Fixture acceptance only: these actual journal writes exercise the consumer;
    // they are not a real controller/domain approval producer or release report.
    const record = (action: string, inputDigest: string) => {
      const result = commitJournalTransition(journal, { action, inputDigest, toState: journal.record.state, nextAction: journal.record.nextAction });
      if (!result.ok) throw new Error("fixture journal append unavailable");
    };
    record(RECOVERY_EXECUTION_EVENTS.captured, recoveryExecutionRecordDigest(capture));
    if (fault !== "unapproved") record(RECOVERY_EXECUTION_EVENTS.authorized, recoveryExecutionRecordDigest(approval));
    await withHostOperationLock(path.join(root, "locks"), async lock => {
      let held = true;
      let emptyChecked = false;
      const authorization = createRecoveryExecutionAuthorization({ journal, directory: root, capture, approval,
        restoreToken: fault === "wrong-token" ? "restore-other.invalid" : mintRestoreToken(runId, capture.recoveryPointDigest),
        lock: { assertHeld: async () => { await lock.assertHeld(); if (!held) throw new Error("simulated-lock-loss"); } } });
      const port = createControlledRecoveryTarget({ target, authorization }, {
        observe: async () => (fault === "target-drift" && events.length || fault === "target-drift-after-empty" && emptyChecked) ? { ...target, redisIdentity: "wrong" } : target,
        assertEmptyAndIsolated: async () => { emptyChecked = true; },
        restorePostgres: async () => {
          events.push("postgres");
          if (fault === "package-drift") await writeFile(path.join(root, "payload-0.bin"), "tampered");
          if (fault === "approval-revoked") record(RECOVERY_EXECUTION_EVENTS.revoked, recoveryExecutionRecordDigest(approval));
          if (fault === "partial-failure") throw new Error("private-target-connection-must-not-leak");
          if (fault === "lock-lost") held = false;
        },
        restoreObjects: async () => { events.push("objects"); }, restoreRedis: async () => { events.push("redis"); },
      });
      expect(port).not.toHaveProperty("restore");
      expect(port).not.toHaveProperty("authorize");
      await expect(restoreRecoveryPackage(root, packageDigest, { ...port })).rejects.toThrow("unissued-target");
      if (fault === "valid") {
        expect(await restoreRecoveryPackage(root, packageDigest, port)).toMatchObject({ status: "restore-executed-not-business-verified" });
        expect(events).toEqual(["postgres", "objects", "redis"]);
      } else {
        await expect(restoreRecoveryPackage(root, packageDigest, port)).rejects.toThrow(/recovery/);
        expect(events).toEqual(["package-drift", "approval-revoked", "partial-failure", "lock-lost", "target-drift"].includes(fault) ? ["postgres"] : []);
      }
      const previous = [...events];
      await expect(restoreRecoveryPackage(root, packageDigest, port)).rejects.toThrow(/recovery/);
      expect(events).toEqual(previous);
    });
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId });
    expect(loaded.ok).toBe(true);
    if (loaded.ok && events.length) {
      expect(loaded.value.record.entries.some(entry => entry.action === RECOVERY_EXECUTION_EVENTS.started)).toBe(true);
      expect(loaded.value.record.entries.some(entry => entry.action === RECOVERY_EXECUTION_EVENTS.completed)).toBe(fault === "valid");
      expect(await readFile(journal.journalPath, "utf8")).not.toContain("private-target-connection");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
