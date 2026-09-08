import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { purposeProfile } from "../../../../server/modules/release-verification/core/gateRegistry";
import { validPrepare } from "../../../../server/modules/release-verification/report/fixtures";
import type { VerificationPlan } from "../../../../server/modules/release-verification/core/types";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import { openUpgradeJournal, journalBytes, canonicalJson, sha256Prefixed, commitJournalTransition } from "./journal";
import { withHostOperationLock } from "./handoff";
import { recordControlledRecoveryCapture } from "./recoveryCapture";
import { createControlledBoundaryEvidenceExecution } from "./recoveryVerification";

// Real private files, package checks and host lock; source bytes and writer
// observation are unit fixtures, not database restore or full P12 evidence.
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "upg-recovery-gates-")));
  onTestFinished(() => rm(root, { recursive: true }));
  const operationRoot = path.join(root, "operation"), directory = path.join(root, "package");
  await mkdir(operationRoot, { mode: 0o700 }); await mkdir(directory, { mode: 0o700 });
  const opened = openUpgradeJournal({ journalPath: path.join(operationRoot, "run.json"), runId: "unit-run" });
  if (!opened.ok) throw new Error("fixture-journal");
  const target = { deploymentId: "unit-deployment", hostFingerprint: "unit-host", postgresIdentity: "unit-db", objectStoreIdentity: "unit-objects", redisIdentity: "unit-redis" };
  let live = true;
  const receipt = { runId: "unit-run", target, digest: "a".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const boundary = { acquire: async () => structuredClone(receipt), verify: async () => { if (!live) throw new Error("private-fence-error"); } };
  const source = { observe: async () => structuredClone(target), open: async () => ({
    postgres: async () => ({ postgres: Buffer.from("unit-not-a-dump"), roles: [] }),
    objects: async () => [{ key: "unit", contentType: "text/plain", metadata: { revision: "two" }, bytes: Buffer.from("unit") }],
    redis: async () => ({ appendonly: true as const, files: [
      { name: "appendonly.aof.manifest", bytes: Buffer.from("file appendonly.aof.1.incr.aof seq 1 type i\n") },
      { name: "appendonly.aof.1.incr.aof", bytes: Buffer.from("unit-not-an-aof") },
    ] }), close: async () => {},
  }) };
  return { root, operationRoot, directory, journal: opened.value, target, source, boundary, loseFence: () => { live = false; } };
}

it.each(["valid", "missing-capture", "package-drift", "fence-lost", "plan-target", "reused-plan", "source-drift", "wrong-purpose", "late-fence-loss", "duplicate-gate", "dotdot-journal", "symlink-parent", "new-pending-capture"])("binds the actual captured package and live fence: %s", async fault => {
  const f = await fixture();
  await withHostOperationLock(f.operationRoot, async lock => {
    const capture = await recordControlledRecoveryCapture({ ...f, lock, attemptId: "capture" }, f.source, f.boundary);
    const backup = await verifyRecoveryPackage(f.directory, capture.packageDigest);
    const prepared = validPrepare({ purpose: "pre-activation", mode: "populated" });
    const plan = { ...prepared, id: "unit-plan", digest: "sha256:unit-plan", canonicalBytes: "unit", registryDigest: "unit-registry", gateSelectionSource: "registry",
      applicabilityProfile: purposeProfile("pre-activation", "populated"), createdAt: new Date().toISOString(),
      pins: { ...prepared.pins, target: { deploymentId: f.target.deploymentId, hostFingerprint: f.target.hostFingerprint },
        database: { ...prepared.pins.database, targetIdentity: f.target.postgresIdentity },
        recovery: { recoveryPointId: backup.manifest.recovery.recoveryPointId, recoveryPointDigest: capture.recoveryPointDigest } },
      evidenceRequirements: { ...prepared.evidenceRequirements, recoveryPointDigest: capture.recoveryPointDigest },
    } as VerificationPlan;
    let journalPath = f.journal.journalPath;
    if (fault === "new-pending-capture") {
      const original = f.journal.record.entries.find(entry => entry.recoveryCapture?.outcome === "pending")!.recoveryCapture!;
      const event = { ...original, attemptId: "new-unfinished-capture" };
      const result = commitJournalTransition(f.journal, { action: "recovery-capture-pending", inputDigest: sha256Prefixed(canonicalJson(event)),
        toState: f.journal.record.state, nextAction: f.journal.record.nextAction, outcome: "crashed", recoveryCapture: event });
      expect(result.ok).toBe(true);
    }
    if (["dotdot-journal", "symlink-parent"].includes(fault)) {
      const outside = path.join(f.root, "outside"); await mkdir(outside, { mode: 0o700 });
      await writeFile(path.join(outside, "run.json"), journalBytes(f.journal.journalPath), { mode: 0o600 });
      if (fault === "dotdot-journal") journalPath = `${f.operationRoot}/../outside/run.json`;
      else { await symlink(outside, path.join(f.operationRoot, "linked")); journalPath = path.join(f.operationRoot, "linked/run.json"); }
    }
    const execution = createControlledBoundaryEvidenceExecution({ journalPath, runId: "unit-run", operationRoot: f.operationRoot,
      target: f.target, lock, boundary: f.boundary, source: f.source });
    const original = journalBytes(f.journal.journalPath);
    if (fault === "missing-capture") plan.pins.recovery = { ...plan.pins.recovery, recoveryPointId: "missing" };
    if (fault === "package-drift") await writeFile(path.join(f.directory, "payload-0.bin"), "changed");
    if (fault === "fence-lost") f.loseFence();
    if (fault === "plan-target") plan.pins.target = { ...plan.pins.target, deploymentId: "different" };
    if (fault === "source-drift") f.target.redisIdentity = "replacement";
    if (fault === "wrong-purpose") Object.assign(plan, { purpose: "public-release" });
    const results = [];
    for (const [gateId, adapter] of execution.adapters) results.push(await adapter({ gateId: gateId as never, plan }));
    if (["valid", "reused-plan", "late-fence-loss", "duplicate-gate"].includes(fault)) {
      expect(results.map(result => result.status)).toEqual(["passed", "passed"]);
      const refs = await execution.readEvidence(plan);
      expect(refs.map(ref => ref.digest)).toEqual(results.map(result => result.evidenceDigest));
      expect(refs.every(ref => ref.phaseSnapshot === plan.lineage.phaseSnapshot)).toBe(true);
      if (fault === "reused-plan") await expect(execution.readEvidence({ ...plan, digest: "sha256:another" as never })).rejects.toThrow("PCAT-UPG-RECOVERY-EVIDENCE-UNAVAILABLE");
      if (fault === "late-fence-loss") {
        f.loseFence();
        await expect(execution.readEvidence(plan)).rejects.toThrow("PCAT-UPG-RECOVERY-EVIDENCE-UNAVAILABLE");
      }
      if (fault === "duplicate-gate") {
        const [gateId, adapter] = [...execution.adapters][0];
        expect((await adapter({ gateId: gateId as never, plan })).status).toBe("failed");
        await expect(execution.readEvidence(plan)).rejects.toThrow("PCAT-UPG-RECOVERY-EVIDENCE-UNAVAILABLE");
      }
    } else {
      expect(results.every(result => result.status === "failed")).toBe(true);
      await expect(execution.readEvidence(plan)).rejects.toThrow("PCAT-UPG-RECOVERY-EVIDENCE-UNAVAILABLE");
    }
    expect(journalBytes(f.journal.journalPath)).toEqual(original);
  });
});
