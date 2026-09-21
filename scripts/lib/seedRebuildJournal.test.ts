import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSeedMaintenance, openSeedRebuildJournal, parseSeedRebuildState } from "./seedRebuildJournal";
import { rebuildSeedProjects, seedMaintenanceBaselineDigest, type SeedRebuildState } from "./seedRebuild";
import { sealSeedRebuildPlan } from "./seedRebuildPlan";

const validState = (): SeedRebuildState => {
  const digest = `sha256:${"a".repeat(64)}`;
  return { version: 1, runId: "run", phase: "planned", archives: [], publications: {},
    originalParameterDigest: digest, expectedIdentities: [],
    policy: { revision: 2, capabilityContractRevision: "catalog-capability/v1", lowRiskSingleActorPublish: false },
    baseline: { schema: { relations: [], digest }, tables: [], objects: [] },
    plan: sealSeedRebuildPlan({ version: 1, scope: "atlas-aurora-nebula", organizationId: "org", actorUserId: "actor",
      candidateSha: "a".repeat(40), database: { oid: "1", name: "fixture", serverAddress: "127.0.0.1", serverPort: 55438 },
      seedDigest: digest, sourceDigest: digest, catalog: { id: "release", digest },
      targets: ["atlas", "aurora", "nebula"], inventoryDigest: digest }),
  };
};

describe("seed rebuild interruption boundary", () => {
  it.each(["archiving", "materializing", "disposing", "recovery-required"] as const)(
    "never replays an interrupted %s stage", async (phase) => {
      await expect(rebuildSeedProjects({} as never, { phase } as SeedRebuildState,
        async () => { throw new Error("unexpected write"); })).rejects.toThrow("recovery-required");
    },
  );

  it("durably replaces a private journal and refuses a symlink read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seed-journal-"));
    try {
      const journal = await openSeedRebuildJournal(dir);
      const state = validState();
      await journal.save(state);
      expect(await journal.read()).toEqual(state);
      await rm(path.join(dir, "core-state.json"));
      await writeFile(path.join(dir, "target"), "{}", { mode: 0o600 });
      await symlink(path.join(dir, "target"), path.join(dir, "core-state.json"));
      await expect(journal.read()).rejects.toThrow("private-state");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rejects malformed journals, foreign archive projects, duplicate targets and altered plans", () => {
    const state = validState();
    expect(parseSeedRebuildState(state)).toEqual(state);
    expect(() => parseSeedRebuildState({ phase: "verified" })).toThrow();
    const archive = { projectId: "atlas", archiveId: "archive", archiveDigest: state.originalParameterDigest };
    expect(() => parseSeedRebuildState({ ...state, archives: [{ ...archive, projectId: "custom" }] })).toThrow();
    expect(() => parseSeedRebuildState({ ...state, archives: [archive, archive] })).toThrow();
    expect(() => parseSeedRebuildState({ ...state, plan: { ...state.plan, organizationId: "other" } })).toThrow();
    expect(() => parseSeedRebuildState({ ...state, preparedInputs: { vendor: { identity: {} } } })).toThrow();
    expect(() => parseSeedRebuildState({ ...state, preparedInputs: { arbitrary: {} } })).toThrow();
  });

  it("accepts a bound maintenance checkpoint and rejects tampering or a foreign run", () => {
    const state = validState();
    const checkpoint = { runId: state.runId, planDigest: state.plan.digest,
      manifestDigest: `sha256:${"b".repeat(64)}`, baseline: state.baseline };
    const withCheckpoint = { ...state, maintenanceBaseline: { ...checkpoint, digest: seedMaintenanceBaselineDigest(checkpoint) } };
    expect(parseSeedRebuildState(withCheckpoint)).toEqual(withCheckpoint);
    expect(() => parseSeedRebuildState({ ...withCheckpoint,
      maintenanceBaseline: { ...withCheckpoint.maintenanceBaseline, digest: state.plan.digest } })).toThrow("maintenance-baseline-drift");
    expect(() => parseSeedRebuildState({ ...withCheckpoint,
      maintenanceBaseline: { ...withCheckpoint.maintenanceBaseline, runId: "other" } })).toThrow("maintenance-baseline-drift");
  });

  it("requires the exact run, recovery point and observed isolation before mutation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seed-maintenance-"));
    const state = { runId: "run", plan: { digest: "plan", candidateSha: "sha", organizationId: "org" } } as SeedRebuildState;
    const proof = { schemaVersion: 1, runId: "run", planDigest: "plan", confirmedPlanDigest: "plan", candidateSha: "sha", organizationId: "org",
      phase: "maintenance-begun", recoveryPoint: { verified: true, manifestDigest: `sha256:${"a".repeat(64)}` },
      isolation: { proxyStopped: true, queuePaused: true, writersStopped: true, managerStopped: true },
      publication: { frozen: true }, queue: { drained: true } };
    const save = (value: unknown) => writeFile(path.join(dir, "wrapper-state.json"), JSON.stringify(value));
    try {
      await save(proof);
      await expect(assertSeedMaintenance(dir, state)).resolves.toEqual(proof);
      for (const changed of [
        { ...proof, runId: "other" }, { ...proof, planDigest: "other" },
        { ...proof, recoveryPoint: { ...proof.recoveryPoint, verified: false } },
        { ...proof, isolation: { ...proof.isolation, writersStopped: false } },
        { ...proof, publication: { frozen: false } }, { ...proof, queue: { drained: false } },
      ]) {
        await save(changed);
        await expect(assertSeedMaintenance(dir, state)).rejects.toThrow("verified-maintenance");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("binds an existing checkpoint to the live recovery manifest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seed-maintenance-manifest-"));
    const state = validState();
    const manifestDigest = `sha256:${"a".repeat(64)}`;
    const checkpoint = { runId: state.runId, planDigest: state.plan.digest, manifestDigest, baseline: state.baseline };
    const checkpointed = { ...state, maintenanceBaseline: { ...checkpoint, digest: seedMaintenanceBaselineDigest(checkpoint) } };
    const proof = { schemaVersion: 1, runId: state.runId, planDigest: state.plan.digest,
      confirmedPlanDigest: state.plan.digest, candidateSha: state.plan.candidateSha, organizationId: state.plan.organizationId,
      phase: "maintenance-begun", recoveryPoint: { verified: true, manifestDigest: `sha256:${"b".repeat(64)}` },
      isolation: { proxyStopped: true, queuePaused: true, writersStopped: true, managerStopped: true },
      publication: { frozen: true }, queue: { drained: true } };
    try {
      await writeFile(path.join(dir, "wrapper-state.json"), JSON.stringify(proof));
      await expect(assertSeedMaintenance(dir, checkpointed)).rejects.toThrow("maintenance-manifest-drift");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
