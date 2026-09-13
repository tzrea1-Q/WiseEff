import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { compareBoundaryInventory } from "./deterministicOutput";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  applyReviewedRuntimeTopologyRelocation,
  applyReviewedPostCutoverRelocation,
  postCutoverRelocationRecordPath,
  runtimeTopologyRelocationRecordPath,
  type RuntimeTopologyRelocationRecord,
  validatePostCutoverRelocation,
  validateRuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const record: RuntimeTopologyRelocationRecord = JSON.parse(
  await readFile(`${repoRoot}/${runtimeTopologyRelocationRecordPath}`, "utf8"),
);
const postCutoverRecord: RuntimeTopologyRelocationRecord = JSON.parse(
  await readFile(`${repoRoot}/${postCutoverRelocationRecordPath}`, "utf8"),
);
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowlist = await loadAllowlistIndex(repoRoot);
const sourceByFile = new Map(
  record.files.map((section) => [
    section.file,
    execFileSync("git", ["show", `${record.trustedBaseSha}:${section.file}`], { cwd: repoRoot }),
  ]),
);
const destinationByFile = new Map(
  await Promise.all(record.files.map(async (section) => [section.file, await readFile(`${repoRoot}/${section.file}`)] as const)),
);
const postCutoverSourceByFile = new Map(
  postCutoverRecord.files.map((section) => [
    section.file,
    execFileSync("git", ["show", `${postCutoverRecord.trustedBaseSha}:${section.file}`], { cwd: repoRoot }),
  ]),
);
const postCutoverDestinationByFile = new Map(
  await Promise.all(postCutoverRecord.files.map(async (section) => [section.file, await readFile(`${repoRoot}/${section.file}`)] as const)),
);
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
}, 60_000);

function input() {
  return {
    fixture: structuredClone(fixture),
    allowances: structuredClone(allowlist.entries),
    discovered: structuredClone(discovered),
    sourceByFile: new Map([...sourceByFile].map(([file, bytes]) => [file, Buffer.from(bytes)])),
    destinationByFile: new Map([...destinationByFile].map(([file, bytes]) => [file, Buffer.from(bytes)])),
  };
}

function postCutoverInput() {
  const ids = new Set(postCutoverRecord.files.flatMap((section) => section.pairs.map((pair) => pair.new.id)));
  return {
    fixture: structuredClone(fixture),
    allowances: structuredClone(allowlist.entries),
    discovered: structuredClone(discovered.filter((entry) => ids.has(entry.id))),
    sourceByFile: new Map([...postCutoverSourceByFile].map(([file, bytes]) => [file, Buffer.from(bytes)])),
    destinationByFile: new Map([...postCutoverDestinationByFile].map(([file, bytes]) => [file, Buffer.from(bytes)])),
  };
}

describe("exact reviewed runtime topology occurrence relocation", () => {
  it("binds the reviewed 15+1 destinations and preserves the full inventory", () => {
    const result = validateRuntimeTopologyRelocation(record, input());

    expect(result).toHaveLength(16);
    expect(result.filter((pair) => pair.old.file.endsWith("ingestService.ts"))).toHaveLength(15);
    expect(result.filter((pair) => pair.old.file.endsWith("schemas.ts"))).toHaveLength(1);
    expect(new Set(result.map((pair) => pair.old.id)).size).toBe(16);
    expect(new Set(result.map((pair) => pair.new.id)).size).toBe(16);
    expect(fixture.violations).toHaveLength(3519);
    expect(allowlist.entries).toHaveLength(3513);
  });

  it.each([
    ["file", (value: RuntimeTopologyRelocationRecord) => { value.files[0].file += ".other"; }],
    ["base", (value: RuntimeTopologyRelocationRecord) => { value.trustedBaseSha = "0".repeat(40) as never; }],
    ["fixture digest", (value: RuntimeTopologyRelocationRecord) => { value.fixtureSha256 = "0".repeat(64) as never; }],
    ["source blob", (value: RuntimeTopologyRelocationRecord) => { value.files[0].sourceBlobOid = "0".repeat(40); }],
    ["destination blob", (value: RuntimeTopologyRelocationRecord) => { value.files[0].destinationBlobOid = "0".repeat(40); }],
    ["omitted pair", (value: RuntimeTopologyRelocationRecord) => { value.files[0].pairs.pop(); }],
    ["duplicate pair", (value: RuntimeTopologyRelocationRecord) => { value.files[0].pairs[1] = structuredClone(value.files[0].pairs[0]); }],
    ["swapped identical destination", (value: RuntimeTopologyRelocationRecord) => {
      [value.files[0].pairs[0].new, value.files[0].pairs[1].new] = [value.files[0].pairs[1].new, value.files[0].pairs[0].new];
    }],
    ["cross-file occurrence", (value: RuntimeTopologyRelocationRecord) => { value.files[0].pairs[0].new.file = value.files[1].file; }],
    ["extra self-approval", (value: RuntimeTopologyRelocationRecord) => { Object.assign(value, { approved: true }); }],
  ])("rejects altered %s", (_name, mutate) => {
    const altered = structuredClone(record);
    mutate(altered);
    expect(() => validateRuntimeTopologyRelocation(altered, input())).toThrow();
  });

  it("rejects any future or dirty source bytes outside mapped slices", () => {
    const altered = input();
    altered.sourceByFile.get(record.files[0].file)![0] ^= 1;
    expect(() => validateRuntimeTopologyRelocation(record, altered)).toThrow("source whole-file blob");
  });

  it("rejects any future or dirty destination bytes outside mapped slices", () => {
    const altered = input();
    altered.destinationByFile.get(record.files[0].file)![0] ^= 1;
    expect(() => validateRuntimeTopologyRelocation(record, altered)).toThrow("destination whole-file blob");
  });

  it.each(["missing discovery", "duplicate discovery", "already bound", "missing allowance", "changed allowance", "missing original", "wrong fixture base"])(
    "rejects %s",
    (kind) => {
      const altered = input();
      const pair = record.files[0].pairs[0];
      if (kind === "missing discovery") altered.discovered = altered.discovered.filter((entry) => entry.id !== pair.new.id);
      if (kind === "duplicate discovery") altered.discovered.push(structuredClone(pair.new));
      if (kind === "already bound") altered.discovered.push(structuredClone(pair.old));
      if (kind === "missing allowance") altered.allowances = altered.allowances.filter((entry) => entry.id !== pair.old.id);
      if (kind === "changed allowance") altered.allowances.find((entry) => entry.id === pair.old.id)!.reason += " changed";
      if (kind === "missing original") altered.fixture.violations = altered.fixture.violations.filter((entry) => entry.id !== pair.old.id);
      if (kind === "wrong fixture base") altered.fixture.trustedBaseSha = "0".repeat(40);
      expect(() => validateRuntimeTopologyRelocation(record, altered)).toThrow();
    },
  );

  it("rejects source or destination IDs already used by the original 23-pair record", () => {
    const pair = record.files[0].pairs[0];
    expect(() => validateRuntimeTopologyRelocation(record, {
      ...input(),
      existingRelocations: [{ id: pair.old.id, observed: pair.new }],
    })).toThrow("cross-record");
  });

  it("does not absorb unrelated debt or restore the six removed allowances", () => {
    const altered = input();
    const result = validateRuntimeTopologyRelocation(record, altered);
    const unrelated = { ...record.files[0].pairs[0].new, id: `${record.files[0].pairs[0].new.id.slice(0, -16)}${"f".repeat(16)}` };
    const removed = fixture.violations.filter((entry) => !allowlist.entries.some((allowance) => allowance.id === entry.id));

    expect(removed).toHaveLength(6);
    expect(compareBoundaryInventory([...result.map((pair) => pair.old), unrelated], allowlist.entries, fixture.violations).unallowlisted).toContainEqual(unrelated);
    for (const entry of removed) {
      expect(compareBoundaryInventory([entry], allowlist.entries, fixture.violations).unallowlisted).toContainEqual(entry);
    }
  });

  it.each(["missing", "changed", "partial"])("rejects a %s record at the filesystem entry", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "runtime-topology-relocation-"));
    try {
      if (kind !== "missing") {
        const path = join(root, runtimeTopologyRelocationRecordPath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, kind === "partial" ? "{" : `${JSON.stringify(record)}\n`);
      }
      await expect(applyReviewedRuntimeTopologyRelocation(root, fixture, allowlist.entries, discovered)).rejects.toThrow(
        kind === "missing" ? "ENOENT" : "reviewed record integrity",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("exact reviewed post-cutover test occurrence relocation", () => {
  it("binds all 29 fixed destinations before granting aliases", () => {
    const result = validatePostCutoverRelocation(postCutoverRecord, postCutoverInput());
    expect(result).toHaveLength(29);
    expect(new Set(result.map((pair) => pair.old.id)).size).toBe(29);
    expect(new Set(result.map((pair) => pair.new.id)).size).toBe(29);
  });

  it.each(["duplicate", "swapped", "partial", "tampered"])("rejects %s raw identity mapping", (kind) => {
    const altered = structuredClone(postCutoverRecord);
    if (kind === "duplicate") altered.files[0].pairs[1] = structuredClone(altered.files[0].pairs[0]);
    if (kind === "swapped") [altered.files[0].pairs[0].new, altered.files[0].pairs[1].new] = [altered.files[0].pairs[1].new, altered.files[0].pairs[0].new];
    if (kind === "partial") altered.files[0].pairs.pop();
    if (kind === "tampered") altered.files[0].pairs[0].new.token += " changed";
    expect(() => validatePostCutoverRelocation(altered, postCutoverInput())).toThrow();
  });

  it("rejects cross-record IDs and allowance growth", () => {
    const pair = postCutoverRecord.files[0].pairs[0];
    expect(() => validatePostCutoverRelocation(postCutoverRecord, {
      ...postCutoverInput(), existingRelocations: [{ id: pair.old.id, observed: pair.new }],
    })).toThrow("cross-record");
    const altered = postCutoverInput();
    altered.allowances = [...altered.allowances, {
      id: postCutoverRecord.files[0].pairs[0].new.id,
      rule: postCutoverRecord.files[0].pairs[0].new.rule,
      file: postCutoverRecord.files[0].pairs[0].new.file,
      reason: postCutoverRecord.files[0].pairs[0].new.reason,
    }];
    expect(() => validatePostCutoverRelocation(postCutoverRecord, altered)).toThrow("allowance growth");
  });

  it.each(["source", "destination"] as const)("rejects %s whole-file drift", (kind) => {
    const altered = postCutoverInput();
    altered[`${kind}ByFile` as "sourceByFile" | "destinationByFile"].get(postCutoverRecord.files[0].file)![0] ^= 1;
    expect(() => validatePostCutoverRelocation(postCutoverRecord, altered)).toThrow("whole-file blob");
  });

  it.each(["missing", "changed", "partial"])("rejects a %s post-cutover record at the filesystem entry", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "post-cutover-relocation-"));
    try {
      if (kind !== "missing") {
        const path = join(root, postCutoverRelocationRecordPath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, kind === "partial" ? "{" : `${JSON.stringify(postCutoverRecord)}\n`);
      }
      await expect(applyReviewedPostCutoverRelocation(root, fixture, allowlist.entries, discovered)).rejects.toThrow(
        kind === "missing" ? "ENOENT" : "reviewed record integrity",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
