import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBindingCutoverJournal, bindingJournalPath } from "./bindingJournal";
import { loadUpgradeJournal, openUpgradeJournal } from "./journal";
import { createManagementMigrationJournal } from "./managementJournal";

const target = { systemIdentifier: "123456789", databaseOid: "16384" };
const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const operationRoot = mkdtempSync(path.join(tmpdir(), "upg-phase-journal-"));
  const open = (runId: string) => {
    const journalPath = bindingJournalPath({ operationRoot, target, runId });
    const journal = openUpgradeJournal({ journalPath, runId });
    if (!journal.ok) throw new Error("fixture-open-failed");
    return { journal: journal.value, adapter: createBindingCutoverJournal({ operationRoot, target, journal: journal.value }) };
  };
  return { operationRoot, open };
}
const intent = { target, runId: "cutover_1", planDigest: digest, phase: "P9" as const, inputDigest: digest };

describe("durable controller Binding phase journal", () => {
  it("does not enter a Binding phase while another run has an unresolved management migration", async () => {
    const { operationRoot, open } = fixture();
    const source = open("management");
    const management = createManagementMigrationJournal({ operationRoot, target, journal: source.journal, assertHeld: async () => undefined });
    await management.begin({ version: "pcat-management-migration-intent-v1", runId: "management", preparationPlanDigest: digest, target,
      candidateArtifactSha: "a".repeat(40), candidateArtifactTree: "b".repeat(40),
      sourceSnapshotDigest: digest, candidateInventoryDigest: digest, writeFenceReceiptDigest: digest, recoveryManifestDigest: digest, checkpointMode: "memory" });
    await expect(open("binding").adapter.begin(intent)).rejects.toThrow("management-journal-unresolved");
  });
  it("retains pending intent after restart and blocks a different run on the same database", async () => {
    const { open } = fixture();
    const first = open("upgrade-a");
    const attempt = await first.adapter.begin(intent);
    const restarted = open("upgrade-a");
    expect(await restarted.adapter.unresolved(target)).toEqual([{ ...attempt, outcome: "pending" }]);
    const other = open("upgrade-b");
    expect(await other.adapter.unresolved(target)).toHaveLength(1);
    await expect(other.adapter.begin(intent)).rejects.toThrow("binding-journal-unresolved");
    await expect(other.adapter.finish({ attempt, outcome: "committed" })).rejects.toThrow("binding-journal-attempt-mismatch");
  });

  it("appends exact committed outcome to the existing journal and rejects altered attempts", async () => {
    const { open } = fixture();
    const { adapter, journal } = open("upgrade-a");
    const attempt = await adapter.begin(intent);
    await expect(adapter.finish({ attempt: { ...attempt, phase: "P10" }, outcome: "committed" })).rejects.toThrow("binding-journal-attempt-mismatch");
    expect(await adapter.unresolved(target)).toHaveLength(1);
    await adapter.finish({ attempt, outcome: "committed" });
    expect(await adapter.unresolved(target)).toEqual([]);
    const reloaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: "upgrade-a" });
    if (!reloaded.ok) throw new Error("fixture-load-failed");
    expect(reloaded.value.record.entries).toHaveLength(2);
    await adapter.finish({ attempt, outcome: "committed" });
    expect(journal.record.entries).toHaveLength(2);
    await expect(adapter.finish({ attempt, outcome: "failed" })).rejects.toThrow("binding-journal-outcome-conflict");
  });

  it("never upgrades unknown to committed through ordinary finish", async () => {
    const { open } = fixture();
    const { adapter } = open("upgrade-a");
    const attempt = await adapter.begin(intent);
    await adapter.finish({ attempt, outcome: "unknown" });
    await expect(adapter.finish({ attempt, outcome: "committed" })).rejects.toThrow("binding-journal-outcome-conflict");
    expect(await open("upgrade-b").adapter.unresolved(target)).toEqual([{ ...attempt, outcome: "unknown" }]);
  });

  it("cannot resolve a prior process pending attempt with ordinary finish", async () => {
    const { open } = fixture();
    await open("upgrade-a").adapter.begin(intent);
    const restarted = open("upgrade-a").adapter;
    const [pending] = await restarted.unresolved(target);
    const { outcome: _outcome, ...attempt } = pending;
    await expect(restarted.finish({ attempt, outcome: "committed" })).rejects.toThrow("binding-journal-reconciliation-required");
    expect(await restarted.unresolved(target)).toEqual([pending]);
  });

  it("loads a phase intent written by a separate process", async () => {
    const { operationRoot, open } = fixture();
    const code = `import { readFileSync } from 'node:fs';
      import { bindingJournalPath, createBindingCutoverJournal } from ${JSON.stringify(path.resolve("ops/self-hosted/scripts/parameter-catalog-upgrade/bindingJournal.ts"))};
      import { openUpgradeJournal } from ${JSON.stringify(path.resolve("ops/self-hosted/scripts/parameter-catalog-upgrade/journal.ts"))};
      const c=JSON.parse(readFileSync(0,'utf8'));
      const opened=openUpgradeJournal({journalPath:bindingJournalPath({...c,runId:'child'}),runId:'child'});
      if(!opened.ok) throw new Error('child-open-failed');
      await createBindingCutoverJournal({...c,journal:opened.value}).begin(c.intent);`;
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { input: JSON.stringify({ operationRoot, target, intent }), timeout: 5000 });
    const parent = open("parent").adapter;
    expect(await parent.unresolved(target)).toHaveLength(1);
    await expect(parent.begin(intent)).rejects.toThrow("binding-journal-unresolved");
  });

  it("rejects a different database and an arbitrary journal location", async () => {
    const { operationRoot, open } = fixture();
    const { adapter, journal } = open("upgrade-a");
    await expect(adapter.unresolved({ ...target, databaseOid: "999" })).rejects.toThrow("binding-journal-target-mismatch");
    expect(() => createBindingCutoverJournal({ operationRoot: path.join(operationRoot, "other"), target, journal })).toThrow("binding-journal-location-mismatch");
  });
});
