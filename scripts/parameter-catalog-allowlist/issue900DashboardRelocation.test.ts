import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { boundaryViolationFixturePath, loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  issue900DashboardRelocationRecordPath,
  verifyHistoricalIssue900DashboardRelocation,
} from "./issue900DashboardRelocation";
import { issue913StaleRetiredSourceIds } from "./issue913StaleSuccessorRelocation";

const retirementRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-900-dashboard-retirement.json";
const retirementRecordSha256 = "069cd75d9cf3f29364149c96c63a13b2862db2b0de79896987f3de623062fe01";
const baseShardRevision = "47a67562df2920d804ea6ca0f27b84e024ff2ac4";
const trustedFixtureRevision = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
const destinationRevision = "411d9f4c828ecffa0c074b1aa93314eae88abfca";
const shardPath = "scripts/parameter-catalog-allowlist/shards/s12-prj.json";

const retiredIds = [
  "S12-PRJ:legacy-catalog-raw-read:615b4d45f7059ed1:11d2249984064946",
  "S12-PRJ:legacy-catalog-raw-read:615b4d45f7059ed1:24f362f0f6789ba5",
  "S12-PRJ:legacy-catalog-raw-read:615b4d45f7059ed1:4191961ca82a308b",
  "S12-PRJ:unresolved-boundary-expression:14051fd83ba05053:1672137d914581a2",
  "S12-PRJ:unresolved-boundary-expression:14051fd83ba05053:60fd11904b6411f3",
  "S12-PRJ:unresolved-boundary-expression:14051fd83ba05053:76d7ca2a986549f6",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:5cdab7ab69a983fc",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:6a83c33633ffb34a",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:7c970e0e46f009e5",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:91fd71c28e340b15",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:9a95911be58d9752",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:9d7d1c15d5cd9b9b",
  "S12-PRJ:unresolved-boundary-expression:3a9bcfb508ae1391:ea846d21dd7ac3d3",
].sort();

type RetirementRecord = {
  schemaVersion: 1;
  issue: 900;
  baseShardRevision: string;
  baseShardBlobOid: string;
  fixtureTrustedBaseSha: string;
  fixtureSha256: string;
  destinationRevision: string;
  destinationTree: string;
  ownerFile: string;
  ownerDestinationBlobOid: string;
  retiredAllowlistEntries: Array<{ id: string; rule: string; file: string; reason: string }>;
  files: Array<{
    file: string;
    sourceBlobOid: string;
    destinationBlobOid: string;
    occurrences: Array<{ id: string; sourceSliceSha256: string }>;
  }>;
};

function gitBuffer(repoRoot: string, revisionAndPath: string) {
  return execFileSync("git", ["show", revisionAndPath], { cwd: repoRoot, encoding: null });
}

function sha256(contents: Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

function blobOid(contents: Buffer) {
  return createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
}

describe("Issue #900 dashboard Catalog boundary proof", () => {
  it("authenticates the complete 18-pair historical successor map", async () => {
    const repoRoot = process.cwd();
    const [fixture, allowlist] = await Promise.all([
      loadBoundaryViolationFixture(repoRoot),
      loadAllowlistIndex(repoRoot),
    ]);
    const proof = await verifyHistoricalIssue900DashboardRelocation(repoRoot, fixture, allowlist.entries);

    expect(issue900DashboardRelocationRecordPath).toBe(
      "scripts/fixtures/parameter-catalog-allowlist/issue-900-dashboard-relocation.json",
    );
    expect(proof.pairs).toHaveLength(18);
    expect(new Set(proof.pairs.map((pair) => pair.old.id)).size).toBe(18);
    expect(new Set(proof.pairs.map((pair) => pair.new.id)).size).toBe(18);
    for (const pair of proof.pairs.filter((candidate) => candidate.old.file !== "server/modules/parameters/dashboard/repository.ts")) {
      const source = gitBuffer(repoRoot, `${trustedFixtureRevision}:${pair.old.file}`);
      const destination = gitBuffer(repoRoot, `${destinationRevision}:${pair.new.file}`);
      expect(
        source.subarray(pair.old.byteStart, pair.old.byteEnd).equals(
          destination.subarray(pair.new.byteStart, pair.new.byteEnd),
        ),
      ).toBe(true);
    }
    expect(proof.pairs.filter((pair) => pair.old.file === "server/modules/parameters/lifecycleRanking.integration.test.ts")).toHaveLength(14);
    expect(proof.pairs.filter((pair) => pair.old.file === "server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts")).toHaveLength(1);
    expect(proof.pairs.filter((pair) => pair.old.file === "server/modules/parameters/dashboard/repository.ts")).toHaveLength(3);
  });

  it("proves only 13 exact old dashboard allowances were retired behind the typed Binding read owner", async () => {
    const repoRoot = process.cwd();
    const manifestBytes = await readFile(join(repoRoot, retirementRecordPath));
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as RetirementRecord;
    const [fixture, baseShardBytes, currentShardBytes] = await Promise.all([
      loadBoundaryViolationFixture(repoRoot),
      Promise.resolve(gitBuffer(repoRoot, `${baseShardRevision}:${shardPath}`)),
      readFile(join(repoRoot, shardPath)),
    ]);
    const baseShard = JSON.parse(baseShardBytes.toString("utf8")) as { entries: RetirementRecord["retiredAllowlistEntries"] };
    const currentShard = JSON.parse(currentShardBytes.toString("utf8")) as { entries: RetirementRecord["retiredAllowlistEntries"] };

    expect(sha256(manifestBytes)).toBe(retirementRecordSha256);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      issue: 900,
      baseShardRevision,
      fixtureTrustedBaseSha: trustedFixtureRevision,
      destinationRevision,
      ownerFile: "server/modules/parameter-bindings/dashboardRead.ts",
    });
    expect(execFileSync("git", ["rev-parse", `${destinationRevision}^{tree}`], { cwd: repoRoot, encoding: "utf8" }).trim())
      .toBe(manifest.destinationTree);
    expect(blobOid(baseShardBytes)).toBe(manifest.baseShardBlobOid);

    const retiredEntries = manifest.retiredAllowlistEntries;
    expect(retiredEntries.map((entry) => entry.id)).toEqual(retiredIds);
    expect(retiredEntries).toHaveLength(13);
    expect(baseShard.entries.filter((entry) => retiredIds.includes(entry.id))).toEqual(retiredEntries);
    const issue913ModuleIds = new Set<string>(issue913StaleRetiredSourceIds.filter((id) => id.startsWith("S12-PRJ:")));
    expect(issue913ModuleIds.size).toBe(2);
    expect([...issue913ModuleIds].filter((id) => retiredIds.includes(id))).toEqual([]);
    expect(baseShard.entries.filter((entry) => issue913ModuleIds.has(entry.id))).toHaveLength(2);
    expect(currentShard.entries).toEqual(baseShard.entries.filter((entry) =>
      !retiredIds.includes(entry.id) && !issue913ModuleIds.has(entry.id)));

    const fixtureById = new Map(fixture.violations.map((entry) => [entry.id, entry]));
    const retiredById = new Map(retiredEntries.map((entry) => [entry.id, entry]));
    const scanned = await scanParameterCatalogBoundaries(repoRoot, trustedFixtureRevision);
    expect(scanned.filter((entry) => retiredById.has(entry.id))).toEqual([]);

    for (const file of manifest.files) {
      const source = gitBuffer(repoRoot, `${trustedFixtureRevision}:${file.file}`);
      const destination = gitBuffer(repoRoot, `${destinationRevision}:${file.file}`);
      expect(blobOid(source)).toBe(file.sourceBlobOid);
      expect(blobOid(destination)).toBe(file.destinationBlobOid);
      expect(await readFile(join(repoRoot, file.file))).toEqual(destination);
      for (const occurrence of file.occurrences) {
        const sourceOccurrence = fixtureById.get(occurrence.id);
        expect(sourceOccurrence).toBeDefined();
        expect(retiredById.get(occurrence.id)).toMatchObject({
          id: sourceOccurrence?.id,
          rule: sourceOccurrence?.rule,
          file: sourceOccurrence?.file,
          reason: sourceOccurrence?.reason,
        });
        expect(sourceOccurrence?.trustedBlobOid).toBe(file.sourceBlobOid);
        const oldSlice = source.subarray(sourceOccurrence!.byteStart, sourceOccurrence!.byteEnd);
        expect(sha256(oldSlice)).toBe(occurrence.sourceSliceSha256);
        expect(destination.includes(oldSlice)).toBe(false);
      }
    }

    expect(manifest.files.flatMap((file) => file.occurrences.map((entry) => entry.id)).sort()).toEqual(retiredIds);

    const owner = await readFile(join(repoRoot, manifest.ownerFile));
    const ownerSource = owner.toString("utf8");
    expect(blobOid(owner)).toBe(manifest.ownerDestinationBlobOid);
    expect(ownerSource).toMatch(/export async function readBindingDashboardKpis/u);
    expect(ownerSource).toMatch(/export async function readBindingDashboardTrend/u);
    expect(ownerSource).toMatch(/export async function aggregateBindingDashboardHotspots/u);
    expect(ownerSource).toContain("parameter_catalog.current_project_parameter_bindings");
    expect(ownerSource).toContain("parameter_catalog.binding_history_events");
    expect(ownerSource).toContain("source_pin.organization_id = b.organization_id");
    expect(ownerSource).toContain("and ${alias}.organization_id = $1");
    expect(ownerSource).toContain("and ($3::text[] is null or ${alias}.project_id = any($3::text[]))");
    expect(ownerSource).not.toMatch(/\b(?:insert\s+into|update\s+parameter_catalog\.|delete\s+from\s+parameter_catalog\.)/iu);

    for (const consumerFile of [
      "server/modules/parameters/dashboard/repository.ts",
      "server/modules/parameters/dashboard/hotspotRepository.ts",
    ]) {
      const consumer = await readFile(join(repoRoot, consumerFile), "utf8");
      expect(consumer).toContain('from "../../parameter-bindings/dashboardRead"');
      expect(consumer).not.toMatch(/parameter_catalog\./u);
    }

    expect(sha256(await readFile(join(repoRoot, boundaryViolationFixturePath)))).toBe(manifest.fixtureSha256);
  });
});
