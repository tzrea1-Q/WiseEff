import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSeedMaintenance, openSeedRebuildJournal } from "./seedRebuildJournal";
import { rebuildSeedProjects, type SeedRebuildState } from "./seedRebuild";

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
      const state = { phase: "planned" } as SeedRebuildState;
      await journal.save(state);
      expect(await journal.read()).toEqual(state);
      await rm(path.join(dir, "core-state.json"));
      await writeFile(path.join(dir, "target"), "{}", { mode: 0o600 });
      await symlink(path.join(dir, "target"), path.join(dir, "core-state.json"));
      await expect(journal.read()).rejects.toThrow("private-state");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("requires the exact run, recovery point and observed isolation before mutation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seed-maintenance-"));
    const state = { runId: "run", plan: { digest: "plan", candidateSha: "sha", organizationId: "org" } } as SeedRebuildState;
    const proof = { schemaVersion: 1, runId: "run", planDigest: "plan", candidateSha: "sha", organizationId: "org",
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
});
