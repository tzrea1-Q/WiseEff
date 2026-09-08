import { mkdtemp, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { assertOwnedLegacySourceCaptureInput } from "../../../../scripts/run-upgrade-component-tests";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { prepareHandoff, withHostOperationLock, type HandoffInputs } from "./handoff";
import { loadUpgradeJournal } from "./journal";
import { reopenApplicationArtifactSelection } from "./applicationArtifactCustody";
import { captureManagementSourceSnapshot, prepareManagementSnapshotChild, readManagementSnapshotChildDiagnostic,
  type ManagementSnapshotChild } from "./managementSnapshotChild";
const module = await import("./handoffLegacySource.fixture").catch(() => ({}));

type CleanupHandle = { close(): Promise<void> };
type CleanupResult = { cleanupRejected: boolean };

async function cleanupLegacySourceTestResources(options: {
  management?: CleanupHandle;
  managementRegistered: boolean;
  lease?: CleanupHandle;
  candidate?: CleanupHandle;
  removeFiles: () => Promise<void>;
  report?: (result: CleanupResult) => void;
}): Promise<CleanupResult> {
  const failures: Error[] = [];
  const clean = async (name: string, action: (() => Promise<void>) | undefined) => {
    if (!action) return;
    try { await action(); }
    catch { failures.push(new Error(`legacy-source-test-${name}-cleanup-failed`)); }
  };
  if (options.management && !options.managementRegistered) await clean("management-child", () => options.management!.close());
  await clean("lease", options.lease && (() => options.lease!.close()));
  if (!failures.length) await clean("candidate", options.candidate && (() => options.candidate!.close()));
  if (!failures.length) await clean("directory", options.removeFiles);
  const result = { cleanupRejected: failures.length > 0 };
  try { options.report?.(result); }
  catch { failures.push(new Error("legacy-source-test-report-failed")); }
  if (failures.length) throw new AggregateError(failures, "legacy-source-test-cleanup-failed");
  return result;
}

it("closes an untransferred child when registration refuses", async () => {
  const child = { close: vi.fn(async () => undefined) };
  let managementRegistered = false;
  const registerManagementChild = () => { throw new Error("registration-refused"); };
  try { registerManagementChild(); managementRegistered = true; } catch (error) { expect(error).toEqual(new Error("registration-refused")); }
  expect(managementRegistered).toBe(false);
  await expect(cleanupLegacySourceTestResources({ management: child, managementRegistered,
    lease: { close: vi.fn(async () => undefined) }, candidate: { close: vi.fn(async () => undefined) },
    removeFiles: vi.fn(async () => undefined) })).resolves.toEqual({ cleanupRejected: false });
  expect(child.close).toHaveBeenCalledOnce();
});

it("lets the owning lease close a transferred child exactly once", async () => {
  const child = { close: vi.fn(async () => undefined) };
  const lease = { close: vi.fn(async () => { await child.close(); }) };
  const order: string[] = [];
  const candidate = { close: vi.fn(async () => { order.push("candidate"); }) };
  const removeFiles = vi.fn(async () => { order.push("directory"); });
  await expect(cleanupLegacySourceTestResources({ management: child, managementRegistered: true, lease,
    candidate, removeFiles, report: () => { order.push("report"); } }))
    .resolves.toEqual({ cleanupRejected: false });
  expect(child.close).toHaveBeenCalledOnce();
  expect(lease.close).toHaveBeenCalledOnce();
  expect(order).toEqual(["candidate", "directory", "report"]);
});

it.each(["child", "lease", "candidate", "file"] as const)("aggregates %s close failure and retains later resources", async stage => {
  const calls: string[] = [];
  const child = { close: vi.fn(async () => { calls.push("child"); if (stage === "child") throw new Error("private-child-close"); }) };
  const lease = { close: vi.fn(async () => { calls.push("lease"); if (stage === "lease") throw new Error("private-lease-close"); }) };
  const candidate = { close: vi.fn(async () => { calls.push("candidate"); if (stage === "candidate") throw new Error("private-candidate-close"); }) };
  const removeFiles = vi.fn(async () => { calls.push("file"); if (stage === "file") throw new Error("private-file-close"); });
  let final: { cleanupRejected: boolean } | undefined;
  const outcome = cleanupLegacySourceTestResources({ management: child, managementRegistered: false, lease, candidate, removeFiles,
    report: value => { final = value; } });
  const error = await outcome.catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.message).toBe("legacy-source-test-cleanup-failed");
  expect(error.errors).toHaveLength(1);
  expect(error.errors[0]).toBeInstanceOf(Error);
  const failureName = stage === "child" ? "management-child" : stage === "file" ? "directory" : stage;
  expect(error.errors[0].message).toBe(`legacy-source-test-${failureName}-cleanup-failed`);
  expect(final).toEqual({ cleanupRejected: true });
  expect(calls).toContain("child");
  expect(calls).toContain("lease");
  if (stage === "child" || stage === "lease") {
    expect(calls).not.toContain("candidate"); expect(calls).not.toContain("file");
  } else if (stage === "candidate") expect(calls).not.toContain("file");
  else expect(calls).toEqual(["child", "lease", "candidate", "file"]);
});

it("rejects a report-only failure with a static error", async () => {
  let reported: CleanupResult | undefined;
  const error = await cleanupLegacySourceTestResources({
    managementRegistered: false, removeFiles: vi.fn(async () => undefined),
    report: result => { reported = result; throw new Error(JSON.stringify({ path: "/private/capture.json", token: "secret" })); },
  }).catch(error => error);
  expect(reported).toEqual({ cleanupRejected: false });
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toHaveLength(1);
  expect(error.errors[0].message).toBe("legacy-source-test-report-failed");
  expect(String(error)).not.toContain("/private/capture.json");
  expect(String(error)).not.toContain("secret");
});

it("keeps cleanup failure primary when reporting also fails", async () => {
  const calls: string[] = [];
  let reported: CleanupResult | undefined;
  const error = await cleanupLegacySourceTestResources({
    management: { close: vi.fn(async () => { calls.push("child"); }) }, managementRegistered: false,
    lease: { close: vi.fn(async () => { calls.push("lease"); throw new Error("postgres://private"); }) },
    candidate: { close: vi.fn(async () => { calls.push("candidate"); }) },
    removeFiles: vi.fn(async () => { calls.push("file"); }),
    report: result => { reported = result; throw new Error(JSON.stringify({ journal: "/private/journal.json" })); },
  }).catch(error => error);
  expect(reported).toEqual({ cleanupRejected: true });
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toHaveLength(2);
  expect(error.errors.map((failure: Error) => failure.message)).toEqual([
    "legacy-source-test-lease-cleanup-failed", "legacy-source-test-report-failed",
  ]);
  expect(calls).toEqual(["child", "lease"]);
  expect(String(error)).not.toContain("postgres://private");
  expect(String(error)).not.toContain("/private/journal.json");
});

describe.skipIf(process.env.UPG_HANDOFF_DOCKER_TEST !== "1")("actual fixed legacy production source", () => {
  let work: Promise<void> | undefined;
  let directory: string | undefined;
  let lease: Awaited<ReturnType<typeof import("./handoffLegacySource.fixture").prepareLegacySourceFixture>> | undefined;
  let candidateCheckout: Awaited<ReturnType<typeof import("./handoffLegacySource.fixture").prepareLegacyCandidateCheckout>> | undefined;
  let management: ManagementSnapshotChild | undefined;
  let managementRegistered = false;
  const diagnostic = () => {
    try { return management ? readManagementSnapshotChildDiagnostic(management) : undefined; }
    catch { return { diagnosticOnly: true, unavailable: true }; }
  };
  const ownedFiles: string[] = [];
  afterEach(async () => {
    // A Vitest timeout is not cancellation. Drain actual preparation before
    // releasing its resources; a later test must not race this source owner.
    await Promise.allSettled([work]);
    const cleanupBegan = performance.now();
    await cleanupLegacySourceTestResources({ management, managementRegistered, lease, candidate: candidateCheckout,
      removeFiles: async () => { for (const file of ownedFiles) await unlink(file); if (directory) await rmdir(directory); },
      report: result => { if (management) console.info(JSON.stringify({ evidence: "management-capture-cleanup",
        elapsedMs: Math.round(performance.now() - cleanupBegan), cleanupRejected: result.cleanupRejected, child: diagnostic() })); } });
  }, 120000);
  it("reads nonempty parameter revisions and values through production auth and completes an actual old worker job", async () => {
    work = Promise.resolve().then(async () => {
      assertOwnedUpgradeTestTarget();
      directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-test-")));
      const prepare = Reflect.get(module, "prepareLegacySourceFixture");
      expect(prepare).toBeTypeOf("function");
      lease = await prepare({ expectedDaemonId: createIsolatedUpgradeDocker().daemonId, privateRoot: directory });
      const observed = await lease!.observeBusiness();
      expect(observed.apiStatus).toBe("ready");
      expect(observed.workerStatus).toBe("completed-job");
      // The frozen old producer refuses its colon job ID after committing the
      // original HTTP rows. Only the explicitly synthetic producer supplies a
      // legal ID to the real old worker; this is not HTTP upload success.
      expect(observed.uploadDelivery).toBe("original-http-500-native-test-producer");
      expect(lease!.sourceEvidence).toEqual({ profile: "owned-synthetic-fixed-legacy", originalHttpUploadStatus: 500,
        logTaskProducer: "original-http-500-native-test-producer", models: "deterministic-isolation-only" });
      expect(observed.parameters).toMatchObject({ definitionLifecycle: "active", currentValue: 43,
        history: [{ fromRawValue: "42", toRawValue: "43" }, { fromRawValue: null, toRawValue: "42" }] });
      expect(observed.projectCount).toBeGreaterThan(0);
      expect(observed.logCount).toBeGreaterThan(0);
      expect(observed.modelProfile).toBe("deterministic-isolation-only");
      await expect(lease!.observeUnauthenticatedProjectStatus()).resolves.toBe(401);
      await lease!.verify();
      const stop = lease!.stopApplicationsForHandoff();
      expect(lease!.stopApplicationsForHandoff()).toBe(stop);
      await stop;
      await lease!.verify();
      await expect(lease!.observeBusiness()).rejects.toThrow("legacy-source-applications-stopped-or-stopping");
      // 050/43c actual evidence rejects empty host port mappings on this
      // internal network. This source test preserves that network; the new
      // separately accepted management child owns its internal native PG proof.
      await lease!.verify();
      await unlink(lease!.privateConfigPaths.api);
      const error = await lease!.verify().catch(error => error);
      expect(error?.message).toBe("legacy-source-observation-failed");
      expect(String(error)).not.toContain(directory);
      expect(error?.cause).toBeUndefined();
    });
    await work;
  }, 120000);

  // This opt-in local artifact case is selected through the original owned
  // runner. The private path is test input, never artifact authority. It reopens
  // the original journal/custody and never copies or deletes retained material.
  it.skipIf(!process.env.UPG_MANAGEMENT_SNAPSHOT_INPUT_FILE)("captures the actual stopped old source in a custody-bound internal management child", async () => {
    const began = performance.now();
    let phase = "input", phaseBegan = began;
    const measured = async <T,>(name: "custody" | "candidate-checkout" | "source-preparation" | "child-preparation" |
      "handoff-preparation" | "source-stop" | "capture" | "source-verification", operation: () => Promise<T>) => {
      phase = name; phaseBegan = performance.now();
      const value = await operation();
      console.info(JSON.stringify({ evidence: "management-capture-stage", phase, elapsedMs: Math.round(performance.now() - phaseBegan),
        totalElapsedMs: Math.round(performance.now() - began), settled: "fulfilled" }));
      return value;
    };
    work = Promise.resolve().then(async () => {
      assertOwnedUpgradeTestTarget();
      const inputFile = process.env.UPG_MANAGEMENT_SNAPSHOT_INPUT_FILE!;
      await assertOwnedLegacySourceCaptureInput(inputFile);
      const original = JSON.parse(await readFile(inputFile, "utf8")) as {
        root: string; source: string; journal: string; runId: string; sha: string;
      };
      const controller = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
      const git = (checkout: string, ref: string) => {
        const result = spawnSync("git", ["--no-replace-objects", "-C", checkout, "rev-parse", ref],
          { env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8" });
        if (result.status !== 0) throw new Error("legacy-management-test-git-unavailable");
        return result.stdout.trim();
      };
      await withHostOperationLock(path.dirname(original.journal), async lock => {
        const loaded = loadUpgradeJournal({ journalPath: original.journal, runId: original.runId, requireSettled: true });
        if (!loaded.ok) throw new Error("legacy-management-test-journal-unavailable");
        const selection = await measured("custody", async () => {
          const artifact = await reopenApplicationArtifactSelection({ journal: loaded.value, lock });
          return artifact.observe();
        });
        if (selection.source.gitSha !== original.sha) throw new Error("legacy-management-test-artifact-source-mismatch");
        directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-management-test-")));
        candidateCheckout = await measured("candidate-checkout", () => Reflect.get(module, "prepareLegacyCandidateCheckout")({ repository: original.source,
          sha: selection.source.gitSha, tree: selection.source.gitTree, privateRoot: directory }));
        lease = await measured("source-preparation", () => Reflect.get(module, "prepareLegacySourceFixture")({
          expectedDaemonId: createIsolatedUpgradeDocker().daemonId, privateRoot: directory,
        }));
        management = await measured("child-preparation", () => prepareManagementSnapshotChild({ journal: loaded.value, lock,
          source: lease!.source, registeredSourceContainerIds: lease!.registeredContainerIds }));
        lease!.registerManagementChild(management);
        managementRegistered = true;
        const main = path.join(directory, "management-handoff.env"), planFile = path.join(directory, "management-handoff.json");
        await writeFile(main, `WISEEFF_OPERATION_LOCK_DIR=${path.dirname(original.journal)}\nWISEEFF_API_ENV_FILE=${lease!.privateConfigPaths.api}\nWISEEFF_WORKER_ENV_FILE=${lease!.privateConfigPaths.worker}\nWISEEFF_MANAGEMENT_ENV_FILE=${lease!.privateConfigPaths.management}\n`, { flag: "wx", mode: 0o600 });
        ownedFiles.push(main);
        const input: HandoffInputs = { runId: original.runId, expectedDaemonId: createIsolatedUpgradeDocker().daemonId,
          entrypoint: { checkout: controller, sha: git(controller, "HEAD"), tree: git(controller, "HEAD^{tree}") },
          source: lease!.source,
          candidate: { checkout: candidateCheckout!.checkout, sha: selection.source.gitSha, tree: selection.source.gitTree, imageId: selection.loadedImageId },
          privateConfigPath: main, lockRoot: path.dirname(original.journal), journalPath: original.journal };
        const observer = lease!.createObserver(input);
        const plan = await measured("handoff-preparation", () => prepareHandoff(input, planFile, observer)); ownedFiles.push(planFile);
        await measured("source-stop", () => lease!.stopApplicationsForHandoff());
        const snapshot = await measured("capture", () => captureManagementSourceSnapshot(management!, { handoff: plan, expectedHandoffDigest: plan.digest, observer }));
        expect(snapshot.relations.length).toBeGreaterThan(0);
        expect(snapshot.relations.some(relation => relation.rowCount > 0)).toBe(true);
        expect(snapshot.sourceMigrations.length).toBeGreaterThan(0);
        expect(snapshot.migrationSuffix.length).toBeGreaterThan(0);
        await measured("source-verification", () => lease!.verify());
        const sourceEvidence = lease!.sourceEvidence;
        console.info(JSON.stringify({ evidence: "actual-old-source-internal-readonly-capture", sourceRelations: snapshot.relations.length,
          sourceMigrationCount: snapshot.sourceMigrations.length, pendingMigrationCount: snapshot.migrationSuffix.length,
          originalHttpUploadStatus: sourceEvidence.originalHttpUploadStatus,
          nativeTestProducerOnly: sourceEvidence.logTaskProducer === "original-http-500-native-test-producer",
          migrationExecuted: false, p0Completed: false }));
      });
    }).catch(error => {
      // Vitest timeout does not cancel work. Preserve the eventual stage and
      // only a closed refusal code while afterEach drains the actual promise.
      const codes = ["PCAT-MANAGEMENT-SNAPSHOT-EXECUTION-UNKNOWN", "PCAT-MANAGEMENT-SNAPSHOT-EXIT-UNKNOWN",
        "PCAT-MANAGEMENT-SNAPSHOT-OUTPUT-INVALID", "PCAT-MANAGEMENT-SNAPSHOT-SOURCE-CHANGED",
        "PCAT-MANAGEMENT-SNAPSHOT-CONFIG-CHANGED", "PCAT-MANAGEMENT-SNAPSHOT-UNAVAILABLE",
        "PCAT-MANAGEMENT-SNAPSHOT-CLOSING", "PCAT-MANAGEMENT-SNAPSHOT-CLEANUP-UNKNOWN"];
      const reason = codes.find(code => error instanceof Error && error.message === code) ?? "other-refusal";
      console.info(JSON.stringify({ evidence: "management-capture-stage", phase, elapsedMs: Math.round(performance.now() - phaseBegan),
        totalElapsedMs: Math.round(performance.now() - began), settled: "rejected", reason,
        ...(management ? { child: diagnostic() } : {}) }));
      throw error;
    });
    await work;
  }, 120000);
});
