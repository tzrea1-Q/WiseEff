import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
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
import { createSyntheticRecoveryEvidence } from "./authorization.fixture";

const source = { deploymentId: "source", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "s3", redisIdentity: "aof" };
const target = { deploymentId: "target", hostFingerprint: "host", postgresIdentity: "pg2", objectStoreIdentity: "s32", redisIdentity: "aof2" };

it.each(["accepted", "failed"] as const)("settles only its owned synthetic evidence and retains failed restore state: %s", async outcome => {
  const evidence = await createSyntheticRecoveryEvidence();
  try {
    const journalPath = path.join(evidence.directory, "controller.json");
    const opened = openUpgradeJournal({ journalPath, runId: "retention-run" });
    if (!opened.ok) throw new Error("fixture journal unavailable");
    expect(commitJournalTransition(opened.value, { action: RECOVERY_EXECUTION_EVENTS.started,
      inputDigest: "sha256:" + "a".repeat(64), toState: opened.value.record.state,
      nextAction: opened.value.record.nextAction, outcome: "crashed" }).ok).toBe(true);
    await writeFile(path.join(evidence.directory, "package.fixture"), "synthetic-package", { mode: 0o600 });
    expect((await evidence.finish(outcome)).retained).toBe(outcome === "failed");
    if (outcome === "failed") {
      expect((await stat(evidence.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(evidence.directory, "retained-evidence.json"))).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(path.join(evidence.directory, "retained-evidence.json"), "utf8")))
        .toMatchObject({ status: "private-synthetic-evidence-retained" });
      expect(await readFile(path.join(evidence.directory, "package.fixture"), "utf8")).toBe("synthetic-package");
      const loaded = loadUpgradeJournal({ journalPath, runId: "retention-run" });
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.record.entries.at(-1)).toMatchObject({ action: RECOVERY_EXECUTION_EVENTS.started, outcome: "crashed" });
      await expect(evidence.finish("accepted")).rejects.toThrow("already-settled");
      expect(await readFile(journalPath, "utf8")).toContain("recovery-execution-started");
    } else await expect(stat(evidence.directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    // This unit has now accepted the retention behavior; it owns this fixture,
    // contains no real backup, and deliberately disposes only its own directory.
    await rm(evidence.directory, { recursive: true, force: true });
  }
});

it.each(["foreign-directory", "symlink", "permissions"])("refuses changed evidence directory identity before cleanup: %s", async fault => {
  const evidence = await createSyntheticRecoveryEvidence();
  const foreign = await createSyntheticRecoveryEvidence();
  const moved = `${evidence.directory}-moved`;
  try {
    await writeFile(path.join(evidence.directory, "original.fixture"), "original-evidence");
    await writeFile(path.join(foreign.directory, "foreign.fixture"), "foreign-evidence");
    if (fault === "permissions") await chmod(evidence.directory, 0o755);
    else {
      await rename(evidence.directory, moved);
      if (fault === "foreign-directory") await rename(foreign.directory, evidence.directory);
      else await symlink(foreign.directory, evidence.directory, "dir");
    }
    await expect(evidence.finish("accepted")).rejects.toThrow("synthetic-evidence-identity-drift");
    expect(await readFile(path.join(fault === "permissions" ? evidence.directory : moved, "original.fixture"), "utf8"))
      .toBe("original-evidence");
    expect(await readFile(path.join(fault === "foreign-directory" ? evidence.directory : foreign.directory, "foreign.fixture"), "utf8"))
      .toBe("foreign-evidence");
  } finally {
    // Both directory identities and this rename/symlink were created by this
    // unit. Disposing them after the accepted refusal is explicit fixture cleanup.
    for (const directory of [evidence.directory, foreign.directory, moved]) await rm(directory, { recursive: true, force: true });
  }
});

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
