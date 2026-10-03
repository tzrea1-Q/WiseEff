import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { compareBoundaryInventory } from "./deterministicOutput";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { verifyIssue1015KnowledgeSuccessor } from "./t14FamilySuccessorRelocation";
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
import { issue913StaleRetiredSourceIds } from "./issue913StaleSuccessorRelocation";
import { issue913T14RetiredSourceIds } from "./issue913T14Relocation";
import { issue853CActionRetiredSourceIds, loadIssue853CRemainderRetiredSourceIds } from "./issue853CRelocation";
import { issue904LogRetiredIds } from "./issue904LogRetirement";
import { projectTemplateFixtureSuccessor, templateFixtureSuccessorPath, validateTemplateFixtureSuccessor } from "./templateFixtureSuccessor";

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
  record.files.map((section) => [section.file,
    execFileSync("git", ["show", `e31226b6cc06c2278230b810bb1becd8dbc1f32a:${section.file}`], { cwd: repoRoot })] as const),
);
const postCutoverSourceByFile = new Map(
  postCutoverRecord.files.map((section) => [
    section.file,
    execFileSync("git", ["show", `${postCutoverRecord.trustedBaseSha}:${section.file}`], { cwd: repoRoot }),
  ]),
);
const postCutoverDestinationByFile = new Map(
  postCutoverRecord.files.map((section) => [section.file, execFileSync("git", ["show", `dd7bc33e22b5d2e970d7a37ec25c97e6e45bea1c:${section.file}`], { cwd: repoRoot })] as const),
);
let discovered: BoundaryViolation[];
const issue913RetiredSourceIds = [...issue913StaleRetiredSourceIds, ...issue913T14RetiredSourceIds];
const issue900RetiredIds = new Set((JSON.parse(await readFile(
  `${repoRoot}/scripts/fixtures/parameter-catalog-allowlist/issue-900-dashboard-retirement.json`, "utf8",
)) as { retiredAllowlistEntries: Array<{ id: string }> }).retiredAllowlistEntries.map((entry) => entry.id));
const issue853CRemainderRetiredIds = await loadIssue853CRemainderRetiredSourceIds(repoRoot);
const issue853DRetiredIds = (JSON.parse(await readFile(
  `${repoRoot}/scripts/fixtures/parameter-catalog-allowlist/issue-853-d-902-inventory.json`, "utf8",
)) as { retiredIds: string[] }).retiredIds;

const knowledgeHistoricalView = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowlist.entries);
const knowledgeRetiredIds = new Set(knowledgeHistoricalView.retired.map(({ old }) => old.id));

function expectCurrentRemovedPartition(currentRemoved: readonly BoundaryViolation[]) {
  const removed = currentRemoved.filter(({ id }) => !knowledgeRetiredIds.has(id)); // old 130-entry historical stage only
  expect(currentRemoved.filter(({ id }) => knowledgeRetiredIds.has(id)))
    .toEqual(fixture.violations.filter(({ id }) => knowledgeRetiredIds.has(id)));
  expect(currentRemoved.length).toBe(removed.length + knowledgeHistoricalView.retired.length);
  expect(allowlist.entries.map(({ id }) => id).sort()).toEqual(knowledgeHistoricalView.historicalAllowances
    .filter(({ id }) => !knowledgeRetiredIds.has(id)).map(({ id }) => id).sort());
  const retired = new Set<string>([...issue913RetiredSourceIds, ...issue900RetiredIds,
    ...issue853CActionRetiredSourceIds, ...issue853CRemainderRetiredIds, ...issue853DRetiredIds,
    ...issue904LogRetiredIds]);
  expect(issue900RetiredIds.size).toBe(13);
  expect(issue913StaleRetiredSourceIds).toHaveLength(17);
  expect(issue913T14RetiredSourceIds).toHaveLength(4);
  expect(issue853CRemainderRetiredIds).toHaveLength(42);
  expect(issue853DRetiredIds).toHaveLength(22);
  expect(issue904LogRetiredIds).toHaveLength(2);
  expect(retired.size).toBe(102);
  expect(fixture.violations.filter((entry) => retired.has(entry.id))).toHaveLength(102);
  expect(removed).toHaveLength(28 + 13 + 17 + 4 + 2 + 42 + 22 + issue904LogRetiredIds.length);
  expect(removed.filter((entry) => retired.has(entry.id)).map((entry) => entry.id).sort())
    .toEqual([...retired].sort());
  expect(removed.filter((entry) => !retired.has(entry.id))).toHaveLength(28);
}

/** Consume the full current-tree raw scan from the proof owner, before relocation. */
export function registerRuntimeTopologyRelocationProof(getRaw: () => readonly BoundaryViolation[], trustedBaseSha: string) {
  beforeAll(async () => {
    expect(trustedBaseSha).toBe(fixture.trustedBaseSha);
    discovered = (await projectTemplateFixtureSuccessor(repoRoot, getRaw())).raw;
  }, 60_000);

  describe("exact template fixture successor", () => {
    async function successorInput() {
      const bytes = await readFile(join(repoRoot, templateFixtureSuccessorPath));
      const value = JSON.parse(bytes.toString()) as { files: Array<{ file: string; pairs: Array<{ old: BoundaryViolation; new: BoundaryViolation }> }> };
      const historical = new Map(value.files.map(({ file }) => [file, execFileSync("git", ["show", `dd7bc33e22b5d2e970d7a37ec25c97e6e45bea1c:${file}`], { cwd: repoRoot })]));
      const current = new Map(await Promise.all(value.files.map(async ({ file }) => [file, await readFile(join(repoRoot, file))] as const)));
      return { bytes, value, historical, current, raw: structuredClone([...getRaw()]) };
    }
    it("preserves all 170 exact slices, the original 29 destinations and inherited permissions", async () => {
      const input = await successorInput();
      const result = validateTemplateFixtureSuccessor(input.bytes, input.raw, input.historical, input.current);
      expect(result.currentForOld.size).toBe(170);
      expect(postCutoverRecord.files.flatMap((file) => file.pairs).every((pair) => result.currentForOld.has(pair.new.id))).toBe(true);
      expect(result.raw).toHaveLength(input.raw.length);
      expect(result.native.filter((item) => input.value.files.some(({ file }) => item.file === file))
        .every((item) => allowlist.entries.some((entry) => entry.id === item.id))).toBe(true);
    });
    it.each(["duplicate pair", "omitted pair", "reordered pair", "swapped ID", "slice hash"])("rejects altered %s", async (kind) => {
      const input = await successorInput();
      const pairs = input.value.files[0].pairs;
      if (kind === "duplicate pair") pairs[1] = structuredClone(pairs[0]);
      if (kind === "omitted pair") pairs.pop();
      if (kind === "reordered pair") pairs.reverse();
      if (kind === "swapped ID") [pairs[0].new.id, pairs[1].new.id] = [pairs[1].new.id, pairs[0].new.id];
      if (kind === "slice hash") Object.assign(pairs[0], { sliceSha256: "0".repeat(64) });
      expect(() => validateTemplateFixtureSuccessor(Buffer.from(JSON.stringify(input.value)), input.raw, input.historical, input.current)).toThrow("pinned complete endpoint ledger");
    });
    it.each(["duplicate", "omitted", "same-count replacement", "growth"])("rejects %s current inventory", async (kind) => {
      const input = await successorInput();
      const id = input.value.files[0].pairs[0].new.id;
      const index = input.raw.findIndex((item) => item.id === id);
      if (kind === "duplicate") input.raw.push(structuredClone(input.raw[index]));
      if (kind === "omitted") input.raw.splice(index, 1);
      if (kind === "same-count replacement") input.raw[index].id += "changed";
      if (kind === "growth") input.raw.push({ ...input.raw[index], id: `${id}-new` });
      expect(() => validateTemplateFixtureSuccessor(input.bytes, input.raw, input.historical, input.current)).toThrow();
    });
    it.each(["inside", "outside"])("rejects changed current bytes %s mapped slices", async (kind) => {
      const input = await successorInput();
      const file = input.value.files[0];
      input.current.get(file.file)![kind === "inside" ? file.pairs[0].new.byteStart : 0] ^= 1;
      expect(() => validateTemplateFixtureSuccessor(input.bytes, input.raw, input.historical, input.current)).toThrow("whole-file blob");
    });
  });

  function input() {
    return {
      fixture: structuredClone(fixture),
      allowances: structuredClone(allowlist.entries),
      // The old decision remains tested against its authenticated historical bytes.
      // sourceWorkflowRelocation tests separately enforce the actual current scan.
      discovered: structuredClone(record.files.flatMap((section) => section.pairs.map((pair) => pair.new))),
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

  describe("historical exact reviewed runtime topology occurrence relocation", () => {
    it("binds the reviewed 15+1 destinations and preserves the full inventory", () => {
      const result = validateRuntimeTopologyRelocation(record, input());

      expect(result).toHaveLength(16);
      expect(result.filter((pair) => pair.old.file.endsWith("ingestService.ts"))).toHaveLength(15);
      expect(result.filter((pair) => pair.old.file.endsWith("schemas.ts"))).toHaveLength(1);
      expect(new Set(result.map((pair) => pair.old.id)).size).toBe(16);
      expect(new Set(result.map((pair) => pair.new.id)).size).toBe(16);
      expect(fixture.violations).toHaveLength(3519);
      expect(fixture.violations.length - 28).toBe(3491);
      expect(knowledgeHistoricalView.historicalAllowances).toHaveLength(3491 - 13 - 17 - 4 - 2 - 42 - 22 - issue904LogRetiredIds.length);
      expect(allowlist.entries.length + knowledgeHistoricalView.retired.length).toBe(knowledgeHistoricalView.historicalAllowances.length);
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

    it("does not absorb unrelated debt or restore historical and issue-specific retirements", () => {
      const altered = input();
      const result = validateRuntimeTopologyRelocation(record, altered);
      const unrelated = { ...record.files[0].pairs[0].new, id: `${record.files[0].pairs[0].new.id.slice(0, -16)}${"f".repeat(16)}` };
      const removed = fixture.violations.filter((entry) => !allowlist.entries.some((allowance) => allowance.id === entry.id));

      expectCurrentRemovedPartition(removed);
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
}
