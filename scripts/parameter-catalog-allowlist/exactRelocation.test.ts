import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedExactRelocation, exactRelocationRecordPath, validateExactRelocation } from "./exactRelocation";
import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { compareBoundaryInventory } from "./deterministicOutput";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const record: {
  schemaVersion: number; file: string; trustedBaseSha: string; fixtureSha256: string;
  sourceBlobOid: string; destinationBlobOid: string;
  pairs: Array<{ old: BoundaryViolation; new: BoundaryViolation; sliceSha256: string }>;
} = JSON.parse(await readFile(`${repoRoot}/${exactRelocationRecordPath}`, "utf8"));
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowlist = await loadAllowlistIndex(repoRoot);
const source = execFileSync("git", ["show", `${record.trustedBaseSha}:${record.file}`], { cwd: repoRoot });
const destination = await readFile(`${repoRoot}/${record.file}`);
let discovered: BoundaryViolation[];
beforeAll(async () => {
  const all = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
  const targets = new Set(record.pairs.map((pair) => pair.new.id));
  discovered = all.filter((violation) => targets.has(violation.id));
}, 60_000);

function input() {
  return {
    fixture: structuredClone(fixture), allowances: structuredClone(allowlist.entries),
    source: Buffer.from(source), destination: Buffer.from(destination), discovered: structuredClone(discovered),
  };
}

describe("exact reviewed Catalog occurrence relocation", () => {
  it("binds all 23 exact destinations to existing IDs without changing historical records", () => {
    const result = validateExactRelocation(record, input());
    expect(result).toHaveLength(23);
    expect(result[0]).toEqual(record.pairs[0]);
    expect(fixture.violations).toHaveLength(3519);
    expect(allowlist.entries).toHaveLength(3509);
  });

  it.each([
    ["file", (value: typeof record) => { value.file = "server/modules/parameter-specs/other.ts"; }],
    ["base", (value: typeof record) => { value.trustedBaseSha = "0".repeat(40); }],
    ["source blob", (value: typeof record) => { value.sourceBlobOid = "0".repeat(40); }],
    ["destination blob", (value: typeof record) => { value.destinationBlobOid = "0".repeat(40); }],
    ["fixture digest", (value: typeof record) => { value.fixtureSha256 = "0".repeat(64); }],
    ["omitted pair", (value: typeof record) => { value.pairs.pop(); }],
    ["duplicate pair", (value: typeof record) => { value.pairs[1] = structuredClone(value.pairs[0]); }],
    ["reused destination", (value: typeof record) => { value.pairs[1].new = structuredClone(value.pairs[0].new); }],
    ["slice digest", (value: typeof record) => { value.pairs[0].sliceSha256 = "0".repeat(64); }],
    ["old identity", (value: typeof record) => { value.pairs[0].old.id = value.pairs[1].old.id; }],
    ["new identity", (value: typeof record) => { value.pairs[0].new.id = value.pairs[1].new.id; }],
    ["rule", (value: typeof record) => { value.pairs[0].new.rule = "legacy-catalog-sql-write"; }],
    ["token", (value: typeof record) => { value.pairs[0].new.token += " changed"; }],
    ["evidence", (value: typeof record) => { value.pairs[0].new.evidence += " changed"; }],
    ["reason", (value: typeof record) => { value.pairs[0].new.reason += " changed"; }],
    ["cross-file occurrence", (value: typeof record) => { value.pairs[0].new.file += ".other"; }],
    ["position", (value: typeof record) => { value.pairs[0].new.byteStart += 1; }],
    ["extra self-approval", (value: typeof record) => { Object.assign(value, { approved: true }); }],
  ])("rejects altered %s", (_name, mutate) => {
    const altered = structuredClone(record);
    mutate(altered);
    expect(() => validateExactRelocation(altered, input())).toThrow();
  });

  it.each(["source", "destination"] as const)("rejects any future or dirty %s bytes outside mapped slices", (key) => {
    const altered = input();
    altered[key][0] ^= 1;
    expect(() => validateExactRelocation(record, altered)).toThrow("whole-file blob");
  });

  it("rejects swapped destinations even for identical repeated SQL slices", () => {
    const altered = structuredClone(record);
    const first = altered.pairs.findIndex((pair, index) => altered.pairs.some((other, j) =>
      j > index && other.sliceSha256 === pair.sliceSha256 && other.old.byteStart !== pair.old.byteStart));
    expect(first).toBeGreaterThanOrEqual(0);
    const second = altered.pairs.findIndex((pair, index) => index > first &&
      pair.sliceSha256 === altered.pairs[first].sliceSha256 && pair.old.byteStart !== altered.pairs[first].old.byteStart);
    [altered.pairs[first].new, altered.pairs[second].new] = [altered.pairs[second].new, altered.pairs[first].new];
    expect(() => validateExactRelocation(altered, input())).toThrow();
  });

  it.each(["missing discovery", "duplicate discovery", "already bound", "missing allowance", "changed allowance", "missing original", "wrong fixture base"])("rejects %s", (kind) => {
    const altered = input();
    const id = record.pairs[0].old.id;
    if (kind === "missing discovery") altered.discovered.shift();
    if (kind === "duplicate discovery") altered.discovered.push(altered.discovered[0]);
    if (kind === "already bound") altered.discovered.push(record.pairs[0].old);
    if (kind === "missing allowance") altered.allowances = altered.allowances.filter((entry) => entry.id !== id);
    if (kind === "changed allowance") altered.allowances.find((entry) => entry.id === id)!.reason += " changed";
    if (kind === "missing original") altered.fixture.violations = altered.fixture.violations.filter((entry) => entry.id !== id);
    if (kind === "wrong fixture base") altered.fixture.trustedBaseSha = "0".repeat(40);
    expect(() => validateExactRelocation(record, altered)).toThrow();
  });

  it("does not absorb unmapped new debt or restore historical and retired CLI allowances", () => {
    const ids = new Set(allowlist.entries.map((entry) => entry.id));
    const removed = fixture.violations.filter((entry) => !ids.has(entry.id));
    const retiredCliIds = [
      "S12-OPS:legacy-catalog-module-import:0de940e8c1cf0301:a43f4f7a42918672",
      "S12-OPS:legacy-catalog-module-import:d9e13bef075b88d5:332be66199b7f0bb",
      "S12-OPS:legacy-effective-governance-contract:0a94e52764fc5f68:866526a44b8818f5",
      "S12-OPS:legacy-effective-governance-contract:70c00c1b4d907eed:435e4c1c7a8cc55e",
    ];
    expect(removed).toHaveLength(10);
    expect(removed.filter((entry) => retiredCliIds.includes(entry.id)).map((entry) => entry.id).sort())
      .toEqual([...retiredCliIds].sort());
    expect(removed.filter((entry) => !retiredCliIds.includes(entry.id))).toHaveLength(6);
    const unrelated = { ...record.pairs[0].new, id: `${record.pairs[0].new.id.slice(0, -16)}${"f".repeat(16)}` };
    const pairs = validateExactRelocation(record, { ...input(), discovered: [...discovered, unrelated] });
    const mapped = pairs.map((pair) => pair.old);
    expect(compareBoundaryInventory([...mapped, unrelated], allowlist.entries, fixture.violations).unallowlisted).toContainEqual(unrelated);
    for (const deleted of removed) {
      expect(compareBoundaryInventory([deleted], allowlist.entries, fixture.violations).unallowlisted).toContainEqual(deleted);
    }
  });

  it.each(["missing", "changed", "partial"])("rejects a %s record at the filesystem entry", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "catalog-relocation-"));
    try {
      if (kind !== "missing") {
        const path = join(root, exactRelocationRecordPath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, kind === "partial" ? "{" : `${JSON.stringify(record)}\n`);
      }
      await expect(applyReviewedExactRelocation(root, fixture, allowlist.entries, discovered)).rejects.toThrow(
        kind === "missing" ? "ENOENT" : "reviewed record integrity",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
