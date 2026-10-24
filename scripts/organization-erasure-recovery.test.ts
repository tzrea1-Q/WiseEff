import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runOrganizationErasureRecovery } from "./organization-erasure-recovery";

describe("Organization deletion recovery CLI protected state", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
  it("retains the latest verified snapshot without recapturing an older restored database", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "org1399-journal-")); const file = path.join(directory, "organization-erasures.json");
    const state = JSON.stringify({ version: 1, capturedAt: "2026-10-23T00:00:00Z", checkpointStore: { kind: "postgres", id: "recorded-physical-store" }, receipts: [{
      id: "original-intent", targetOrganizationId: "B", actorUserId: "original-operator", status: "deleted", counts: { files: 2 }, createdAt: "2026-10-22T00:00:00Z", completedAt: "2026-10-23T00:00:00Z"
    }] });
    await writeFile(file, state, { mode: 0o600 });
    // No DB/env is available after replacement; verified capture must survive it.
    expect(await runOrganizationErasureRecovery(["capture", "--file", file], {})).toEqual({ captured: 1, retained: true });
    expect(await readFile(file, "utf8")).toBe(state);
  });
  it("refuses partial or payload-bearing capture rather than overwriting it", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "org1399-journal-")); const file = path.join(directory, "organization-erasures.json");
    for (const state of ["{partial", '{"version":1,"businessPayload":"untrusted"}']) {
      await writeFile(file, state);
      await expect(runOrganizationErasureRecovery(["capture", "--file", file], {})).rejects.toBeDefined();
      expect(await readFile(file, "utf8")).toBe(state);
    }
  });
  it("requires an explicit real replay actor and accepts no arbitrary command options", async () => {
    await expect(runOrganizationErasureRecovery(["replay", "--file", "/unopened"], {})).rejects.toThrow(/CURRENT_PLATFORM_USER/);
    await expect(runOrganizationErasureRecovery(["capture", "--file", "/unopened", "--ignore-errors"], {})).rejects.toBeDefined();
  });
});
