import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  scanParameterCatalogBoundaries,
} from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  runReviewedRelocationRecord,
  type RuntimeTopologyRelocationRecord,
} from "./runtimeTopologyRelocation";
import {
  applyReviewedIssue913T14Relocation,
  issue913T14ExpectedActiveRelocationCount,
  issue913T14RetiredSourceIds,
  issue913T14ServiceSuccessorRelocationConfig,
  issue913T14ServiceSuccessorRelocationRecordPath,
  issue913T14SuccessorPairCount,
  validateIssue913T14HistoricalPartition,
} from "./issue913T14Relocation";
import {
  applyReviewedIssue913StaleSuccessorRelocation,
  issue913StaleRetiredSourceIds,
  issue913StaleSuccessorPairCount,
  issue913StaleSuccessorRelocationConfig,
  issue913StaleSuccessorRelocationRecordPath,
  validateIssue913StaleHistoricalPartition,
} from "./issue913StaleSuccessorRelocation";
import type { BoundaryViolation } from "./schema";
import { registerIssue903904JointProof } from "./issue903904JointProof.proof";
import { registerT14RewrittenSliceSuccessorRelocationProof } from "./t14RewrittenSliceSuccessorRelocation.proof";
import { registerExactRelocationProof } from "./exactRelocation.proof";
import { registerIssue853CRelocationProof } from "./issue853CRelocation.proof";
import { registerIssue900DashboardRelocationProof } from "./issue900DashboardRelocation.proof";
import { registerRuntimeTopologyRelocationProof } from "./runtimeTopologyRelocation.proof";
import { registerSourceWorkflowRelocationProof } from "./sourceWorkflowRelocation.proof";
import { applyReviewedT14FamilySuccessorRelocation, verifyIssue1015KnowledgeSuccessor } from "./t14FamilySuccessorRelocation";
import { registerT14FamilySuccessorRelocationProof } from "./t14FamilySuccessorRelocation.proof";
import { applyReviewedIssue1016ModuleReadHeadersSuccessor, issue1016ModuleRoutesFile,
  issue1016ModuleReadHeadersSuccessorConfig, historicalIssue1016ModuleReport } from "./issue1016ModuleReadHeadersSuccessor";
import { compareBoundaryInventory } from "./deterministicOutput";
import { issue1017RetirementRecordPath, verifyIssue1017RawRetirement,
  type Issue1017RetirementRecord } from "./issue1017ApprovedPrepareRetirement.proof";
import { historicalIssue1018JsonDeletedStateRaw, issue1018ReadSuccessorRecordPath,
  type Issue1018ReadSuccessorRecord } from "./issue1018JsonDeletedStateReadSuccessor.proof";

import { historicalIssue1019DtsReloadCurrentTipRaw, issue1019ReadSuccessorRecordPath,
  type Issue1019ReadSuccessorRecord } from "./issue1019DtsReloadCurrentTipReadSuccessor.proof";

const repoRoot = process.cwd();
const repositoryFile = "server/modules/parameter-modules/repository.ts";
const serviceTestFile = "server/modules/parameter-modules/service.test.ts";
const changedFiles = new Set([repositoryFile, serviceTestFile]);
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const historicalRecords = await Promise.all([
  "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/t14-rewritten-slice-successor-relocation.json",
].map(async (path) => JSON.parse(await readFile(join(repoRoot, path), "utf8")) as RuntimeTopologyRelocationRecord));
const historicalChangedSourceIds = historicalRecords.flatMap((record) =>
  record.files.flatMap((section) =>
    changedFiles.has(section.file) ? section.pairs.map((pair) => pair.old.id) : [],
  ),
);
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
}, 60_000);

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

registerT14RewrittenSliceSuccessorRelocationProof(() => discovered);
registerIssue903904JointProof(() => discovered);
registerExactRelocationProof(() => discovered);
registerIssue853CRelocationProof(() => discovered, fixture.trustedBaseSha);
registerIssue900DashboardRelocationProof(() => discovered, fixture.trustedBaseSha);
registerRuntimeTopologyRelocationProof(() => discovered, fixture.trustedBaseSha);
registerSourceWorkflowRelocationProof(() => discovered, fixture.trustedBaseSha);
registerT14FamilySuccessorRelocationProof(() => discovered, fixture.trustedBaseSha);

async function copyServiceProofFixture() {
  const root = await mkdtemp(join(tmpdir(), "issue913-t14-service-"));
  temporaryRoots.push(root);
  for (const file of [issue913T14ServiceSuccessorRelocationRecordPath, serviceTestFile]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(join(repoRoot, file)));
  }
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  return root;
}

async function copyStaleSuccessorProofFixture() {
  const root = await mkdtemp(join(tmpdir(), "issue913-stale-successor-"));
  temporaryRoots.push(root);
  for (const file of [
    issue913StaleSuccessorRelocationRecordPath,
    ...issue913StaleSuccessorRelocationConfig.files.map(({ file: path }) => path),
  ]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(join(repoRoot, file)));
  }
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  return root;
}

describe("Issue #913 T1.4 successor relocation", () => {
  it("#1019 proves two retired tags and one still-unlicensed organization count with the existing complete scan", async () => {
    const before = structuredClone(discovered);
    const { record, historical } = await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered);
    expect(record.retired).toHaveLength(2);
    expect(record.pairs).toHaveLength(1);
    expect(new Set([...record.retired, ...record.pairs.flatMap(({ old, current }) => [old, current])]
      .map(({ id }) => id)).size).toBe(4);
    expect(record.currentInventory.summary.unallowlisted).toBe(150);
    expect(record.baseInventory.summary.unallowlisted).toBe(152);
    expect(discovered.filter(({ file }) => file === record.source.file)).toEqual(
      record.pairs.map(({ current }) => current).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const { old, current } of record.pairs) {
      expect(discovered).toContainEqual(current);
      expect(allowances.some(({ id }) => id === current.id)).toBe(false);
      expect(historical).toContainEqual(old);
    }
    expect(historical).toHaveLength(discovered.length + 2);
    expect(discovered).toEqual(before);
    expect((await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances, historical)).record.currentInventory.summary.unallowlisted).toBe(152);
  });

  it("#1019 rejects source revival, false SQL retirement, allowance growth and complete raw identity or metadata tampering", async () => {
    const { record } = await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered);
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances) =>
      historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, permissions, raw);
    for (const old of [...record.retired, ...record.pairs.map((pair) => pair.old)]) {
      await expect(apply([...discovered, old])).rejects.toThrow(/complete current raw/);
      await expect(apply(discovered, [...allowances, { id: old.id, file: old.file, rule: old.rule, reason: old.reason }]))
        .rejects.toThrow(/complete allowances/);
    }
    for (const { current } of record.pairs) {
      await expect(apply(discovered.filter(({ id }) => id !== current.id))).rejects.toThrow(/complete current raw/);
      await expect(apply(discovered, [...allowances, { id: current.id, file: current.file, rule: current.rule, reason: current.reason }]))
        .rejects.toThrow(/complete allowances/);
      for (const property of ["id", "trustedBlobOid", "byteStart", "byteEnd", "line", "column", "evidence", "reason"] as const) {
        const changed = discovered.map((entry) => entry.id === current.id
          ? { ...entry, [property]: typeof entry[property] === "number" ? Number(entry[property]) + 1 : `${entry[property]}-changed` }
          : entry);
        await expect(apply(changed)).rejects.toThrow(/complete current raw/);
      }
    }
    for (const changed of [discovered.slice(1), [...discovered, discovered[0]!], [...discovered].reverse(),
      discovered.map((entry, index) => index === 0 ? { ...entry, id: `${entry.id}-new` } : entry),
      discovered.map((entry, index) => index === 1 ? discovered[0]! : entry)]) {
      await expect(apply(changed)).rejects.toThrow(/complete current raw/);
    }
    for (const permissions of [allowances.slice(1), [...allowances, allowances[0]!],
      allowances.map((entry, index) => index === 0 ? { ...entry, reason: `${entry.reason}-changed` } : entry),
      [...allowances.slice(1), { ...allowances[0]!, id: `${allowances[0]!.id}-changed` }]]) {
      await expect(apply(discovered, permissions)).rejects.toThrow(/complete allowances/);
    }
  });

  it("#1019 rejects endpoint/record/reader changes, revival and weakening of every original case or protected boundary", async () => {
    const recordBytes = await readFile(join(repoRoot, issue1019ReadSuccessorRecordPath));
    const record = JSON.parse(recordBytes.toString()) as Issue1019ReadSuccessorRecord;
    const root = await mkdtemp(join(tmpdir(), "issue1019-json-source-proof-"));
    temporaryRoots.push(root);
    for (const file of [issue1019ReadSuccessorRecordPath, record.source.file, ...record.readers.map(({ file }) => file)]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), await readFile(join(repoRoot, file)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const apply = () => historicalIssue1019DtsReloadCurrentTipRaw(root, allowances, discovered);
    for (const mutate of [
      (value: typeof record) => { value.retired.pop(); },
      (value: typeof record) => { value.pairs.pop(); },
      (value: typeof record) => { value.retired[1] = structuredClone(value.retired[0]!); },
      (value: typeof record) => { value.pairs.push(structuredClone(value.pairs[0]!)); },
      (value: typeof record) => { value.pairs[0]!.current.reason += "-changed"; },
      (value: typeof record) => { value.retired.reverse(); },
      (value: typeof record) => { value.spans[0]!.contextUtf8 += "-changed"; },
      (value: typeof record) => { value.spans[0]!.sliceSha256 = "0".repeat(64); },
      (value: typeof record) => { value.source.currentBlob = "0".repeat(40); },
      (value: typeof record) => { value.changes[1]!.currentEnd += 1; },
      (value: typeof record) => { value.rawCurrent.idsSha256 = "0".repeat(64); },
      (value: typeof record) => { value.readers[0]!.sha256 = "0".repeat(64); },
      ...Array.from({ length: 4 }, (_, index) => (value: typeof record) => {
        const endpoints = [...value.retired, ...value.pairs.flatMap(({ old, current }) => [old, current])];
        endpoints[index]!.byteStart += 1; endpoints[index]!.id += "-changed";
      }),
    ]) {
      const changed = structuredClone(record); mutate(changed);
      await writeFile(join(root, issue1019ReadSuccessorRecordPath), `${JSON.stringify(changed, null, 2)}\n`);
      await expect(apply()).rejects.toThrow(/record integrity/);
    }
    await writeFile(join(root, issue1019ReadSuccessorRecordPath), recordBytes);
    const source = await readFile(join(repoRoot, record.source.file));
    const text = source.toString();
    const old = execFileSync("git", ["show", `${record.baseHead}:${record.source.file}`], { cwd: repoRoot });
    for (const changed of [old, Buffer.concat([source, Buffer.from("\n// outside reviewed read\n")]),
      ...record.retired.map((entry) => Buffer.concat([source, old.subarray(entry.byteStart, entry.byteEnd)]))]) {
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file DTS fixture/);
    }
    const starts = [...text.matchAll(/\n[ \t]*it\(/gu)].map((match) => match.index);
    expect(starts).toHaveLength(5);
    for (const [index, start] of starts.entries()) {
      await writeFile(join(root, record.source.file), text.slice(0, start)
        + text.slice(starts[index + 1] ?? text.lastIndexOf("\n});")));
      await expect(apply()).rejects.toThrow(/whole-file DTS fixture/);
    }
    for (const [from, to] of [["current.status !== \"current\"", "current.status === \"current\""],
      ["readOwnedCurrentBinding(db,", "readOwnedCurrentBinding(otherDb,"],
      ["organizationId: fixture.organizationId, projectId: fixture.projectId, bindingId: fixture.bindingId", "organizationId: fixture.organizationId, bindingId: fixture.bindingId"],
      ["current.binding.currentValueId", "fixture.bindingId"],
      ["import { readOwnedCurrentBinding }", "import { readOwnedBaseBindingState }"],
      ["where organization_id=$1", "where id=$1"],
      ["bindings: \"0\", drafts: \"0\"", "bindings: \"1\", drafts: \"0\""],
      ["decision: \"approve\"", "decision: \"reject\""],
      ["auth: { mode: \"production\" }", "auth: { mode: \"mock\" }"],
      ["createControlledReloadBridge(db,", "createControlledReloadBridge(otherDb,"],
      ["120_000", "180_000"],
      ["lease?.release()", "void lease"], ["bridge?.close()", "void bridge"],
      ["await database?.drop()", "await Promise.resolve()"], ["await db?.close()", "await Promise.resolve()"],
      ["await rm(storageRoot, { recursive: true, force: true })", "await Promise.resolve()"]]) {
      const changed = text.replace(from, to);
      expect(changed).not.toBe(text);
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file DTS fixture/);
    }
    await writeFile(join(root, record.source.file), source);
    for (const { file } of record.readers) {
      const original = await readFile(join(repoRoot, file));
      await writeFile(join(root, file), Buffer.concat([original, Buffer.from("\n// altered owner reader\n")]));
      await expect(apply()).rejects.toThrow(/public owner reader/);
      await writeFile(join(root, file), original);
    }
    await expect(apply()).resolves.toMatchObject({ historical: expect.any(Array) });
  });


  it("#1018 proves three retired reads and four still-unlicensed SQL successors with the existing complete scan", async () => {
    const a8HistoricalRaw = (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical;
    const before = structuredClone(a8HistoricalRaw);
    const { record, historical } = await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances, a8HistoricalRaw);
    expect(record.retired).toHaveLength(3);
    expect(record.pairs).toHaveLength(4);
    expect(new Set([...record.retired, ...record.pairs.flatMap(({ old, current }) => [old, current])]
      .map(({ id }) => id)).size).toBe(11);
    expect(record.currentInventory.summary.unallowlisted).toBe(152);
    expect(record.baseInventory.summary.unallowlisted).toBe(155);
    expect(a8HistoricalRaw.filter(({ file }) => file === record.source.file)).toEqual(
      record.pairs.map(({ current }) => current).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const { old, current } of record.pairs) {
      expect(a8HistoricalRaw).toContainEqual(current);
      expect(allowances.some(({ id }) => id === current.id)).toBe(false);
      expect(historical).toContainEqual(old);
    }
    expect(historical).toHaveLength(a8HistoricalRaw.length + 3);
    expect(a8HistoricalRaw).toEqual(before);
    expect(await verifyIssue1017RawRetirement(repoRoot, allowances, historical)).toMatchObject({
      retired: expect.any(Array), currentInventory: { summary: { unallowlisted: 155 } },
    });
  });

  it("#1018 rejects source revival, false SQL retirement, allowance growth and complete raw identity or metadata tampering", async () => {
    const a8HistoricalRaw = (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical;
    const { record } = await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances, a8HistoricalRaw);
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances) =>
      historicalIssue1018JsonDeletedStateRaw(repoRoot, permissions, raw);
    for (const old of [...record.retired, ...record.pairs.map((pair) => pair.old)]) {
      await expect(apply([...a8HistoricalRaw, old])).rejects.toThrow(/complete current raw/);
      await expect(apply(a8HistoricalRaw, [...allowances, { id: old.id, file: old.file, rule: old.rule, reason: old.reason }]))
        .rejects.toThrow(/complete allowances/);
    }
    for (const { current } of record.pairs) {
      await expect(apply(a8HistoricalRaw.filter(({ id }) => id !== current.id))).rejects.toThrow(/complete current raw/);
      await expect(apply(a8HistoricalRaw, [...allowances, { id: current.id, file: current.file, rule: current.rule, reason: current.reason }]))
        .rejects.toThrow(/complete allowances/);
      for (const property of ["id", "trustedBlobOid", "byteStart", "byteEnd", "line", "column", "evidence", "reason"] as const) {
        const changed = a8HistoricalRaw.map((entry) => entry.id === current.id
          ? { ...entry, [property]: typeof entry[property] === "number" ? Number(entry[property]) + 1 : `${entry[property]}-changed` }
          : entry);
        await expect(apply(changed)).rejects.toThrow(/complete current raw/);
      }
    }
    for (const changed of [a8HistoricalRaw.slice(1), [...a8HistoricalRaw, a8HistoricalRaw[0]!], [...a8HistoricalRaw].reverse(),
      a8HistoricalRaw.map((entry, index) => index === 0 ? { ...entry, id: `${entry.id}-new` } : entry),
      a8HistoricalRaw.map((entry, index) => index === 1 ? a8HistoricalRaw[0]! : entry)]) {
      await expect(apply(changed)).rejects.toThrow(/complete current raw/);
    }
    for (const permissions of [allowances.slice(1), [...allowances, allowances[0]!],
      allowances.map((entry, index) => index === 0 ? { ...entry, reason: `${entry.reason}-changed` } : entry),
      [...allowances.slice(1), { ...allowances[0]!, id: `${allowances[0]!.id}-changed` }]]) {
      await expect(apply(a8HistoricalRaw, permissions)).rejects.toThrow(/complete allowances/);
    }
  });

  it("#1018 rejects endpoint/record/reader changes, revival and weakening of every original case or protected boundary", async () => {
    const a8HistoricalRaw = (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical;
    const recordBytes = await readFile(join(repoRoot, issue1018ReadSuccessorRecordPath));
    const record = JSON.parse(recordBytes.toString()) as Issue1018ReadSuccessorRecord;
    const root = await mkdtemp(join(tmpdir(), "issue1018-json-source-proof-"));
    temporaryRoots.push(root);
    for (const file of [issue1018ReadSuccessorRecordPath, record.source.file, ...record.readers.map(({ file }) => file)]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), await readFile(join(repoRoot, file)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const apply = () => historicalIssue1018JsonDeletedStateRaw(root, allowances, a8HistoricalRaw);
    for (const mutate of [
      (value: typeof record) => { value.retired.pop(); },
      (value: typeof record) => { value.pairs.pop(); },
      (value: typeof record) => { value.retired[1] = structuredClone(value.retired[0]!); },
      (value: typeof record) => { value.pairs[1] = structuredClone(value.pairs[0]!); },
      (value: typeof record) => { value.pairs.reverse(); },
      (value: typeof record) => { value.retired.reverse(); },
      (value: typeof record) => { value.spans[0]!.contextUtf8 += "-changed"; },
      (value: typeof record) => { value.spans[0]!.sliceSha256 = "0".repeat(64); },
      (value: typeof record) => { value.source.currentBlob = "0".repeat(40); },
      (value: typeof record) => { value.changedRead.currentEnd += 1; },
      (value: typeof record) => { value.rawCurrent.idsSha256 = "0".repeat(64); },
      (value: typeof record) => { value.readers[0]!.sha256 = "0".repeat(64); },
      ...Array.from({ length: 11 }, (_, index) => (value: typeof record) => {
        const endpoints = [...value.retired, ...value.pairs.flatMap(({ old, current }) => [old, current])];
        endpoints[index]!.byteStart += 1; endpoints[index]!.id += "-changed";
      }),
    ]) {
      const changed = structuredClone(record); mutate(changed);
      await writeFile(join(root, issue1018ReadSuccessorRecordPath), `${JSON.stringify(changed, null, 2)}\n`);
      await expect(apply()).rejects.toThrow(/record integrity/);
    }
    await writeFile(join(root, issue1018ReadSuccessorRecordPath), recordBytes);
    const source = await readFile(join(repoRoot, record.source.file));
    const text = source.toString();
    const old = execFileSync("git", ["show", `${record.baseHead}:${record.source.file}`], { cwd: repoRoot });
    for (const changed of [old, Buffer.concat([source, Buffer.from("\n// outside reviewed read\n")]),
      ...record.retired.map((entry) => Buffer.concat([source, old.subarray(entry.byteStart, entry.byteEnd)]))]) {
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file JSON fixture/);
    }
    const starts = [...text.matchAll(/\n[ \t]*it\(/gu)].map((match) => match.index);
    expect(starts).toHaveLength(18);
    for (const [index, start] of starts.entries()) {
      await writeFile(join(root, record.source.file), text.slice(0, start)
        + text.slice(starts[index + 1] ?? text.lastIndexOf("\n});")));
      await expect(apply()).rejects.toThrow(/whole-file JSON fixture/);
    }
    for (const [from, to] of [["deletedValue.binding_id !== target.id", "deletedValue.binding_id === target.id"],
      ["if (!deletedBinding)", "if (false)"], ["if (!deletedPin)", "if (false)"],
      ["decision: \"approve\"", "decision: \"reject\""], ["createUserInvocation(auth)", "createUserInvocation(reviewer)"],
      ["\"parameter:review\"", "\"parameter:edit-critical\""],
      ["kind: \"json-delete-v1\"", "kind: \"json-delete-v0\""],
      ["/export?projectValueId=${deletedValueId}", "/export?projectValueId=${target.id}"],
      ["code: \"23503\"", "code: \"42501\""], ["deleted_pins: \"1\",deleted_history: \"1\"", "deleted_pins: \"0\",deleted_history: \"0\""],
      ["await database?.drop()", "await Promise.resolve()"], ["await db?.close()", "await Promise.resolve()"],
      ["await rm(storageDirectory, { recursive: true, force: true })", "await Promise.resolve()"]]) {
      const changed = text.replace(from, to);
      expect(changed).not.toBe(text);
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file JSON fixture/);
    }
    await writeFile(join(root, record.source.file), source);
    for (const { file } of record.readers) {
      const original = await readFile(join(repoRoot, file));
      await writeFile(join(root, file), Buffer.concat([original, Buffer.from("\n// altered owner reader\n")]));
      await expect(apply()).rejects.toThrow(/public owner reader/);
      await writeFile(join(root, file), original);
    }
    await expect(apply()).resolves.toMatchObject({ historical: expect.any(Array) });
  });

  it("#1017 retires only eight unlicensed fixture sources using the complete same-tree scan", async () => {
    const prepareHistoricalRaw = (await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances,
      (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical)).historical;
    const record = await verifyIssue1017RawRetirement(repoRoot, allowances, prepareHistoricalRaw);
    expect(record.retired).toHaveLength(8);
    expect(new Set(record.retired.map(({ old }) => old.id)).size).toBe(8);
    expect(record.retired.filter(({ old }) => old.rule === "forbidden-catalog-internal-import")).toHaveLength(5);
    expect(record.retired.filter(({ old }) => old.rule === "legacy-catalog-sql-write")).toHaveLength(3);
    expect(prepareHistoricalRaw.filter(({ file }) => file === record.source.file)).toHaveLength(0);
    expect(record.baseInventory.summary.unallowlisted).toBe(163);
    expect(record.currentInventory.summary.unallowlisted).toBe(155);
  });

  it("#1017 rejects revived sources or permissions, missing, duplicate, reordered, substituted and forged raw metadata", async () => {
    const prepareHistoricalRaw = (await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances,
      (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical)).historical;
    const record = await verifyIssue1017RawRetirement(repoRoot, allowances, prepareHistoricalRaw);
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances) =>
      verifyIssue1017RawRetirement(repoRoot, permissions, raw);
    for (const { old } of record.retired) {
      await expect(apply([...prepareHistoricalRaw, old])).rejects.toThrow(/complete current raw/);
      await expect(apply(prepareHistoricalRaw, [...allowances, { id: old.id, file: old.file, rule: old.rule, reason: old.reason }]))
        .rejects.toThrow(/complete allowances/);
    }
    for (const changed of [prepareHistoricalRaw.slice(1), [...prepareHistoricalRaw, prepareHistoricalRaw[0]!], [...prepareHistoricalRaw].reverse(),
      prepareHistoricalRaw.map((entry, index) => index === 0 ? { ...entry, id: `${entry.id}-changed` } : entry),
      prepareHistoricalRaw.map((entry, index) => index === 1 ? prepareHistoricalRaw[0]! : entry),
      prepareHistoricalRaw.map((entry, index) => index === 0 ? { ...entry, trustedBlobOid: "0".repeat(40) } : entry),
      prepareHistoricalRaw.map((entry, index) => index === 0 ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
      prepareHistoricalRaw.map((entry, index) => index === 0 ? { ...entry, reason: `${entry.reason}-changed` } : entry)]) {
      await expect(apply(changed)).rejects.toThrow(/complete current raw/);
    }
    for (const permissions of [allowances.slice(1), [...allowances, allowances[0]!],
      allowances.map((entry, index) => index === 0 ? { ...entry, reason: `${entry.reason}-changed` } : entry),
      [...allowances.slice(1), { ...allowances[0]!, id: `${allowances[0]!.id}-changed` }]]) {
      await expect(apply(prepareHistoricalRaw, permissions)).rejects.toThrow(/complete allowances/);
    }
  });

  it("#1017 rejects record, source, helper, product-case, approval, provenance, JSON and cleanup tampering", async () => {
    const prepareHistoricalRaw = (await historicalIssue1018JsonDeletedStateRaw(repoRoot, allowances,
      (await historicalIssue1019DtsReloadCurrentTipRaw(repoRoot, allowances, discovered)).historical)).historical;
    const recordBytes = await readFile(join(repoRoot, issue1017RetirementRecordPath));
    const record = JSON.parse(recordBytes.toString()) as Issue1017RetirementRecord;
    const root = await mkdtemp(join(tmpdir(), "issue1017-prepare-proof-"));
    temporaryRoots.push(root);
    for (const file of [issue1017RetirementRecordPath, record.source.file, record.helper.file]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), await readFile(join(repoRoot, file)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const apply = () => verifyIssue1017RawRetirement(root, allowances, prepareHistoricalRaw);
    for (const mutate of [
      (value: typeof record) => { value.retired.pop(); },
      (value: typeof record) => { value.retired[1] = structuredClone(value.retired[0]!); },
      (value: typeof record) => { value.retired.reverse(); },
      (value: typeof record) => { value.retired[0]!.old.id += "-changed"; },
      (value: typeof record) => { value.retired[0]!.old.trustedBlobOid = "0".repeat(40); },
      (value: typeof record) => { value.retired[0]!.old.byteEnd += 1; },
      (value: typeof record) => { value.retired[0]!.contextByteStart += 1; },
      (value: typeof record) => { value.retired[0]!.contextUtf8 += "-changed"; },
      (value: typeof record) => { value.retired[0]!.sliceSha256 = "0".repeat(64); },
      (value: typeof record) => { value.currentInventory.unallowlistedIdsSha256 = "0".repeat(64); },
    ]) {
      const changed = structuredClone(record); mutate(changed);
      await writeFile(join(root, issue1017RetirementRecordPath), `${JSON.stringify(changed, null, 2)}\n`);
      await expect(apply()).rejects.toThrow(/record integrity/);
    }
    await writeFile(join(root, issue1017RetirementRecordPath), recordBytes);
    const source = await readFile(join(repoRoot, record.source.file));
    const text = source.toString();
    const old = execFileSync("git", ["show", `${record.baseHead}:${record.source.file}`], { cwd: repoRoot });
    for (const changed of [old, Buffer.concat([source, Buffer.from("\n// outside-slice change\n")]),
      ...record.retired.map(({ sourceSliceUtf8 }) => Buffer.concat([source, Buffer.from(`\n${sourceSliceUtf8}\n`)]))]) {
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file approved fixture/);
    }
    const starts = [...text.matchAll(/\n  it\(/gu)].map((match) => match.index);
    expect(starts).toHaveLength(5);
    for (const [index, start] of starts.entries()) {
      await writeFile(join(root, record.source.file), text.slice(0, start)
        + text.slice(starts[index + 1] ?? text.lastIndexOf("\n});")));
      await expect(apply()).rejects.toThrow(/whole-file approved fixture/);
    }
    for (const [from, to] of [["approval: { required: true, approvalId }", "approval: { required: false, approvalId }"],
      ["initiator_type: \"agent\"", "initiator_type: \"user\""],
      ["\"parameter:review\"", "\"parameter:edit-critical\""],
      ["const JSON_SOURCE =", "const JSON_SOURCE_CHANGED ="],
      ["csub_acme_power", "csub_wrong_subject"],
      ["await database?.drop()", "await Promise.resolve()"],
      ["await db?.close()", "await Promise.resolve()"],
      ["await rm(storageDirectory, { recursive: true, force: true })", "await Promise.resolve()"]]) {
      const changed = text.replace(from, to);
      expect(changed).not.toBe(text);
      await writeFile(join(root, record.source.file), changed);
      await expect(apply()).rejects.toThrow(/whole-file approved fixture/);
    }
    await writeFile(join(root, record.source.file), source);
    const helper = await readFile(join(repoRoot, record.helper.file));
    await writeFile(join(root, record.helper.file), Buffer.concat([helper, Buffer.from("\n// altered owner\n")]));
    await expect(apply()).rejects.toThrow(/public fixture owner/);
    await writeFile(join(root, record.helper.file), helper);
    expect((await apply()).retired).toHaveLength(8);
  });

  it("#1016 preserves all thirteen live Module identities as a separate current partition", async () => {
    const result = await applyReviewedIssue1016ModuleReadHeadersSuccessor(repoRoot, fixture, allowances, discovered);
    expect(result.relocations).toHaveLength(13);
    expect(result.violations).toHaveLength(discovered.length);
    const historical = fixture.violations.filter(({ file }) => file === issue1016ModuleRoutesFile);
    expect(historical).toHaveLength(13);
    expect(new Set(result.relocations.map(({ id }) => id))).toEqual(new Set(historical.map(({ id }) => id)));
    expect(result.violations.filter(({ file }) => file === issue1016ModuleRoutesFile).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...historical].sort((a, b) => a.id.localeCompare(b.id)));
    expect(result.relocations.every(({ observed }) => discovered.some((item) => item.id === observed.id))).toBe(true);
    expect(result.relocations.every(({ id, observed }) => allowances.some((entry) => entry.id === id)
      && !allowances.some((entry) => entry.id === observed.id))).toBe(true);
  });

  it("#1016 rejects missing, duplicate, substituted, reordered or new current sources and altered permissions", async () => {
    const watched = discovered.filter(({ file }) => file === issue1016ModuleRoutesFile);
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances, history = fixture) =>
      applyReviewedIssue1016ModuleReadHeadersSuccessor(repoRoot, history, permissions, raw);
    for (const changed of [discovered.filter(({ id }) => id !== watched[0]!.id),
      [...discovered, watched[0]!], [...discovered].reverse(),
      discovered.map((entry) => entry.id === watched[0]!.id ? { ...entry, id: `${entry.id}-replaced` } : entry),
      discovered.map((entry) => entry.id === watched[0]!.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
      discovered.map((entry) => entry.id === watched[0]!.id ? { ...entry, evidence: `${entry.evidence}-changed` } : entry),
      [...discovered, { ...watched[0]!, id: `${watched[0]!.id}-new` }]]) {
      await expect(apply(changed)).rejects.toThrow(/relocation rejected|Module successor rejected/);
    }
    const source = fixture.violations.find(({ file }) => file === issue1016ModuleRoutesFile)!;
    for (const permissions of [allowances.filter(({ id }) => id !== source.id),
      allowances.map((entry) => entry.id === source.id ? { ...entry, reason: `${entry.reason}-changed` } : entry),
      [...allowances, { id: watched[0]!.id, file: watched[0]!.file, rule: watched[0]!.rule, reason: watched[0]!.reason }]]) {
      await expect(apply(discovered, permissions)).rejects.toThrow(/existing allowance|allowance growth/);
    }
    await expect(apply(discovered, allowances, { ...fixture, violations: fixture.violations.map((entry) =>
      entry.id === source.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry) }))
      .rejects.toThrow(/original occurrence/);
    const result = await apply(discovered);
    await expect(applyReviewedIssue1016ModuleReadHeadersSuccessor(repoRoot, fixture, allowances,
      discovered, result.relocations)).rejects.toThrow(/cross-record/);
  });

  it("#1016 rejects record, literal, context, writer, body, auth, scope and outside-slice tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "issue1016-module-proof-"));
    temporaryRoots.push(root);
    const recordPath = issue1016ModuleReadHeadersSuccessorConfig.recordPath;
    for (const path of [recordPath, issue1016ModuleRoutesFile]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), await readFile(join(repoRoot, path)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const apply = () => applyReviewedIssue1016ModuleReadHeadersSuccessor(root, fixture, allowances, discovered);
    const recordBytes = await readFile(join(repoRoot, recordPath));
    const record = JSON.parse(recordBytes.toString()) as RuntimeTopologyRelocationRecord;
    for (const mutate of [
      (value: typeof record) => { value.files[0]!.pairs.pop(); },
      (value: typeof record) => { value.files[0]!.pairs[1] = structuredClone(value.files[0]!.pairs[0]!); },
      (value: typeof record) => { value.files[0]!.pairs.reverse(); },
      (value: typeof record) => { [value.files[0]!.pairs[0]!.new, value.files[0]!.pairs[1]!.new]
        = [value.files[0]!.pairs[1]!.new, value.files[0]!.pairs[0]!.new]; },
      (value: typeof record) => { value.files[0]!.pairs[0]!.new.id += "-changed"; },
      (value: typeof record) => { value.files[0]!.pairs[0]!.new.evidence += "-changed"; },
      (value: typeof record) => { value.files[0]!.pairs[0]!.sliceSha256 = "0".repeat(64); },
    ]) {
      const changed = structuredClone(record); mutate(changed);
      await writeFile(join(root, recordPath), `${JSON.stringify(changed, null, 2)}\n`);
      await expect(apply()).rejects.toThrow(/reviewed record integrity/);
    }
    await writeFile(join(root, recordPath), recordBytes);
    const source = await readFile(join(repoRoot, issue1016ModuleRoutesFile));
    for (const offset of [0, record.files[0]!.pairs[0]!.new.byteStart,
      record.files[0]!.pairs[0]!.new.byteStart - 5]) {
      const changed = Buffer.from(source); changed[offset] ^= 1;
      await writeFile(join(root, issue1016ModuleRoutesFile), changed);
      await expect(apply()).rejects.toThrow(/destination whole-file blob/);
    }
    for (const [from, to] of [["return { status: 200, headers: legacyReadHeaders, body: result }",
      "return { status: 410, headers: legacyReadHeaders, body: result }"],
      ["return { status: 201, body: result }", "return { status: 410, body: result }"],
      ["return { status: 200, body: result }", "return { status: 410, body: result }"],
      ["headers: legacyReadHeaders, body: result", "headers: legacyReadHeaders, body: {}"],
      ["await options.getCurrentAuthContext(request)", "await options.getCurrentAuthContext({ ...request, headers: {} })"],
      ["getParameterModuleRegistry(db, auth)", "getParameterModuleRegistry(db, { ...auth, organization: null })"]]) {
      const changed = Buffer.from(source.toString().replace(from, to));
      expect(changed.equals(source)).toBe(false);
      await writeFile(join(root, issue1016ModuleRoutesFile), changed);
      await expect(apply()).rejects.toThrow(/destination whole-file blob/);
    }
    await writeFile(join(root, issue1016ModuleRoutesFile), source);
    expect((await apply()).relocations).toHaveLength(13);
  });

  it("#1016 copies only the exact current alias partition into a historical view and rejects forged reports", async () => {
    const current = await applyReviewedIssue913T14Relocation(repoRoot, fixture, allowances, discovered);
    // A narrow unit-report fixture, not a claimed current native inventory or scan.
    const ids = new Set(allowances.map(({ id }) => id));
    const report = { ...compareBoundaryInventory(fixture.violations.filter(({ id }) => ids.has(id)),
      allowances, fixture.violations), relocations: current.relocations };
    const before = structuredClone(report);
    const project = (value = report, permissions = allowances) =>
      historicalIssue1016ModuleReport(repoRoot, fixture, permissions, value);
    const history = await project();
    expect(report).toEqual(before);
    const module = report.relocations.filter(({ observed }) => observed.file === issue1016ModuleRoutesFile);
    expect(module).toHaveLength(13);
    expect(history).toEqual({ ...report, relocations: report.relocations.filter((entry) => !module.includes(entry)) });
    expect(history.relocations.length).toBe(report.relocations.length - module.length);
    const first = module[0]!;
    for (const relocations of [report.relocations.filter((entry) => entry !== first),
      [...report.relocations, first], [...report.relocations].reverse(),
      report.relocations.map((entry) => entry === first ? { ...entry, id: `${entry.id}-changed` } : entry),
      report.relocations.map((entry) => entry === first ? { ...entry, observed: { ...entry.observed,
        evidence: `${entry.observed.evidence}-changed` } } : entry),
      report.relocations.map((entry) => entry === first ? { ...entry, observed: fixture.violations.find(({ id }) => id === entry.id)! } : entry)]) {
      await expect(project({ ...report, relocations })).rejects.toThrow(/relocation rejected|Module successor rejected/);
    }
    for (const violations of [report.violations.filter(({ id }) => id !== first.id),
      [...report.violations, report.violations[0]!],
      report.violations.map((entry) => entry.id === first.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
      [...report.violations, { ...report.violations[0]!, id: `${report.violations[0]!.id}-new` }]]) {
      await expect(project({ ...report, violations })).rejects.toThrow(/relocation rejected|Module successor rejected/);
    }
    await expect(project({ ...report, summary: { ...report.summary, allowlistGrowth: 1 } }))
      .rejects.toThrow(/exact current report/);
    const old = fixture.violations.find(({ id }) => !ids.has(id))!;
    await expect(project(report, [...allowances, { id: old.id, file: old.file, rule: old.rule, reason: old.reason }]))
      .rejects.toThrow(/exact current report/);
    await expect(project(report, [...allowances.slice(1), { id: old.id, file: old.file, rule: old.rule, reason: old.reason }]))
      .rejects.toThrow(/existing allowance|exact current report/);
  });

  it("#1015 retires only nine licensed test sources and preserves every current endpoint", async () => {
    const proof = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
    expect(proof.oldPairs).toHaveLength(13);
    expect(proof.currentPairs).toHaveLength(4);
    expect(proof.retired).toHaveLength(9);
    expect(new Set([...proof.currentPairs, ...proof.retired].map(({ old }) => old.id)))
      .toEqual(new Set(proof.oldPairs.map(({ old }) => old.id)));
    const file = "e2e/acceptance/knowledge.acceptance.spec.ts";
    const current = discovered.filter((entry) => entry.file === file);
    expect(current).toHaveLength(6);
    const activeFiles = [file];
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances) =>
      applyReviewedT14FamilySuccessorRelocation(repoRoot, fixture, permissions, raw, [], activeFiles);
    expect((await apply(discovered)).relocations).toHaveLength(4);
    for (const retired of proof.retired) {
      const original = proof.historicalAllowances.find(({ id }) => id === retired.old.id)!;
      await expect(apply(discovered, [...allowances, original])).rejects.toThrow(/retired allowance revived/);
      await expect(apply([...discovered, retired.new])).rejects.toThrow(/complete six current/);
    }
    for (const changed of [
      discovered.filter(({ id }) => id !== current[0]!.id), [...discovered, current[0]!],
      [...discovered].reverse(),
      discovered.map((entry) => entry.id === current[0]!.id ? { ...entry, id: `${entry.id}-replaced` } : entry),
      discovered.map((entry) => entry.id === current[0]!.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
      [...discovered, { ...current[0]!, id: `${current[0]!.id}-new` }],
    ]) await expect(apply(changed)).rejects.toThrow(/relocation rejected|Knowledge successor rejected/);
    for (const endpoint of current.filter((entry) => entry.line < 21)) {
      await expect(apply(discovered, [...allowances, {
        id: endpoint.id, file: endpoint.file, rule: endpoint.rule, reason: endpoint.reason,
      }])).rejects.toThrow(/unallowed GET/);
    }

    const root = await mkdtemp(join(tmpdir(), "issue1015-knowledge-proof-"));
    temporaryRoots.push(root);
    const paths = [file, "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json",
      "scripts/fixtures/parameter-catalog-allowlist/issue-1015-knowledge-current-relocation.json",
      "scripts/parameter-catalog-allowlist/shards/s12-knw.json",
      "e2e/acceptance/knowledge-canonical-definition.acceptance.spec.ts", "e2e/acceptance/requirements.ts",
      "e2e/acceptance/operationMatrix.ts", "server/testing/parameterCatalog/registryProjection.ts",
      "server/testing/parameterCatalog/knowledgeDefinitionLifecycle.test.ts"];
    for (const path of paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), await readFile(join(repoRoot, path)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const source = await readFile(join(repoRoot, file));
    const old = execFileSync("git", ["show", `5d90785fea95ee436e4e2faccc2be0e0328d3c54:${file}`], { cwd: repoRoot });
    for (const changed of [Buffer.concat([source, old.subarray(7833, 9621)]),
      Buffer.concat([source, old.subarray(53764, 62932)]), Buffer.concat([source, Buffer.from("\n// outside slice\n")]),
      Buffer.from(source.toString().replace("where organization_id = $1 order by id limit 1", "where organization_id <> $1 order by id limit 1"))]) {
      expect(changed.equals(source)).toBe(false);
      await writeFile(join(root, file), changed);
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/whole-file source/);
    }
    await writeFile(join(root, file), source);
    const shardPath = paths[3]!;
    const shard = JSON.parse((await readFile(join(repoRoot, shardPath))).toString());
    for (const entries of [shard.entries.slice(1), [...shard.entries].reverse(),
      [...shard.entries, proof.historicalAllowances.find(({ id }) => id === proof.retired[0]!.old.id)],
      shard.entries.map((entry: { id: string }, index: number) => index === 0 ? { ...entry, id: `${entry.id}-changed` } : entry)]) {
      await writeFile(join(root, shardPath), JSON.stringify({ ...shard, entries }));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/exact shard revocations/);
    }
    await writeFile(join(root, shardPath), await readFile(join(repoRoot, shardPath)));
    for (const path of paths.slice(1, 3)) {
      const original = await readFile(join(repoRoot, path));
      await writeFile(join(root, path), Buffer.concat([original, Buffer.from("\n")]));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/frozen thirteen|pinned current four/);
      await writeFile(join(root, path), original);
    }
    for (const path of paths.slice(4)) {
      const original = await readFile(join(repoRoot, path));
      await writeFile(join(root, path), Buffer.concat([original, Buffer.from("\n// altered scope or lifecycle\n")]));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/fixed canonical required replacement/);
      await writeFile(join(root, path), original);
    }
  });
  it("leaves unrelated synthetic fixtures unchanged", async () => {
    const unrelatedFixture = {
      ...fixture,
      violations: fixture.violations.filter((entry) =>
        !changedFiles.has(entry.file)
        && !issue913StaleSuccessorRelocationConfig.files.some(({ file }) => file === entry.file),
      ),
    };
    const result = await applyReviewedIssue913T14Relocation(
      repoRoot,
      unrelatedFixture,
      [],
      [],
    );
    expect(result).toEqual({ violations: [], relocations: [] });
    await expect(
      applyReviewedIssue913StaleSuccessorRelocation(repoRoot, unrelatedFixture, [], []),
    ).resolves.toEqual({ violations: [], relocations: [] });
  });

  it("activates only the exact 45 successor pairs after proving all old history", async () => {
    const serviceRecord = JSON.parse(
      await readFile(join(repoRoot, issue913T14ServiceSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    for (const pair of serviceRecord.files[0]!.pairs) {
      const candidates = discovered.filter((entry) =>
        entry.file === pair.new.file &&
        entry.line === pair.new.line &&
        entry.token === pair.new.token,
      );
      expect(candidates).toEqual([pair.new]);
    }

    const result = await applyReviewedIssue913T14Relocation(
      repoRoot,
      fixture,
      allowances,
      discovered,
    );
    const changedRelocations = result.relocations.filter((entry) => changedFiles.has(entry.observed.file));

    expect(issue913T14SuccessorPairCount).toBe(45);
    expect(issue913T14ExpectedActiveRelocationCount).toBe(252);
    const knowledge = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
    const historicalPartition = result.relocations.filter(({ observed }) => observed.file !== issue1016ModuleRoutesFile);
    expect(historicalPartition.length + knowledge.retired.length).toBe(252);
    expect(new Set(historicalPartition.map((entry) => entry.id)).size + knowledge.retired.length).toBe(252);
    expect(new Set(historicalPartition.map((entry) => entry.observed.id)).size + knowledge.retired.length).toBe(252);
    const moduleHeaders = await applyReviewedIssue1016ModuleReadHeadersSuccessor(repoRoot, fixture, allowances, discovered);
    expect(result.relocations.filter(({ observed }) => observed.file === issue1016ModuleRoutesFile))
      .toEqual(moduleHeaders.relocations);
    expect(moduleHeaders.relocations).toHaveLength(13);
    expect(result.relocations.length).toBe(historicalPartition.length + moduleHeaders.relocations.length);
    expect(changedRelocations).toHaveLength(45);
    expect(changedRelocations.filter((entry) => entry.observed.file === repositoryFile)).toHaveLength(20);
    expect(changedRelocations.filter((entry) => entry.observed.file === serviceTestFile)).toHaveLength(25);
    expect(issue913T14RetiredSourceIds.every((id) => !result.relocations.some((entry) => entry.id === id))).toBe(true);
    expect(changedRelocations.every((entry) => discovered.some((observation) => observation.id === entry.observed.id))).toBe(true);
  });

  it("rejects a missing retirement, a duplicate source, or an extra residual source", async () => {
    const retired = new Set<string>(issue913T14RetiredSourceIds);
    const activeIds = historicalChangedSourceIds.filter((id) => !retired.has(id));
    validateIssue913T14HistoricalPartition(historicalChangedSourceIds, activeIds);

    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds.filter((id) => id !== issue913T14RetiredSourceIds[0]),
        activeIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913T14HistoricalPartition(historicalChangedSourceIds, [...activeIds, activeIds[0]!]),
    ).toThrow("successor source inventory");
    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds,
        [...activeIds.slice(1), issue913T14RetiredSourceIds[0]!],
      ),
    ).toThrow("successor source partition");
    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds,
        [...activeIds.slice(1), "S12-MOD:unmapped-residual"],
      ),
    ).toThrow("successor source partition");
    const retiredBaseline = fixture.violations.find((entry) => entry.id === issue913T14RetiredSourceIds[0]);
    expect(retiredBaseline).toBeDefined();
    await expect(
      applyReviewedIssue913T14Relocation(
        repoRoot,
        fixture,
        [...allowances, {
          id: retiredBaseline!.id,
          rule: retiredBaseline!.rule,
          file: retiredBaseline!.file,
          reason: retiredBaseline!.reason,
        }],
        discovered,
      ),
    ).rejects.toThrow("retired sources remain allowlisted");
  });

  it("rejects swapping identical-text service endpoints under the fixed record digest", async () => {
    const root = await copyServiceProofFixture();
    const recordPath = join(root, issue913T14ServiceSuccessorRelocationRecordPath);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RuntimeTopologyRelocationRecord;
    const pairs = record.files[0]!.pairs;
    const first = pairs.findIndex((pair) => pair.old.line === 74 && pair.old.token === "read:parameter_modules");
    const second = pairs.findIndex((pair) => pair.old.line === 382 && pair.old.token === "read:parameter_modules");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(pairs[first]!.new.evidence).toBe(pairs[second]!.new.evidence);
    expect(pairs[first]!.new.token).toBe(pairs[second]!.new.token);
    [pairs[first]!.new, pairs[second]!.new] = [pairs[second]!.new, pairs[first]!.new];
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913T14ServiceSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("reviewed record integrity");
  });

  it("rejects whole-file blob drift before applying a service successor", async () => {
    const root = await copyServiceProofFixture();
    const servicePath = join(root, serviceTestFile);
    const service = await readFile(servicePath);
    service[0] = service[0]! ^ 1;
    await writeFile(servicePath, service);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913T14ServiceSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("destination whole-file blob");
  });

  it("partitions the exact 63 stale successors and named 17 retirements", async () => {
    const record = JSON.parse(
      await readFile(join(repoRoot, issue913StaleSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    const successorSourceIds = record.files.flatMap((section) => section.pairs.map((pair) => pair.old.id));
    const historicalSourceIds = [...successorSourceIds, ...issue913StaleRetiredSourceIds];

    expect(issue913StaleSuccessorPairCount).toBe(63);
    expect(new Set(successorSourceIds).size).toBe(63);
    expect(issue913StaleRetiredSourceIds.every((id) => !allowances.some((entry) => entry.id === id))).toBe(true);
    // The fixed record and partition prove #913 history; the owner-path test owns current inventory.
    validateIssue913StaleHistoricalPartition(historicalSourceIds, successorSourceIds);
  });

  it("rejects an incomplete historical partition and same-text endpoint reorder", async () => {
    const fixedRecord = JSON.parse(
      await readFile(join(repoRoot, issue913StaleSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    const successorSourceIds = fixedRecord.files.flatMap((section) => section.pairs.map((pair) => pair.old.id));
    const historicalSourceIds = [...successorSourceIds, ...issue913StaleRetiredSourceIds];
    validateIssue913StaleHistoricalPartition(historicalSourceIds, successorSourceIds);

    expect(() =>
      validateIssue913StaleHistoricalPartition(
        historicalSourceIds.filter((id) => id !== issue913StaleRetiredSourceIds[0]),
        successorSourceIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913StaleHistoricalPartition(
        [...historicalSourceIds, "S12-MOD:legacy-parameter-spec-identifier:unreviewed:residual"],
        successorSourceIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913StaleHistoricalPartition(
        historicalSourceIds,
        [...successorSourceIds.slice(1), issue913StaleRetiredSourceIds[0]!],
      ),
    ).toThrow("successor source partition");

    const root = await copyStaleSuccessorProofFixture();
    const recordPath = join(root, issue913StaleSuccessorRelocationRecordPath);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RuntimeTopologyRelocationRecord;
    const service = record.files.find((section) => section.file === "server/modules/parameter-modules/service.ts")!;
    const duplicateAnchor = "S12-MOD:legacy-parameter-spec-identifier:420ee39a001dbcaa";
    const duplicates = service.pairs.filter((pair) => pair.old.id.startsWith(`${duplicateAnchor}:`));
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((pair) => pair.old.line)).toEqual([201, 388]);
    [duplicates[0]!.new, duplicates[1]!.new] = [duplicates[1]!.new, duplicates[0]!.new];
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    await writeFile(recordPath, bytes);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        {
          ...issue913StaleSuccessorRelocationConfig,
          recordSha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ),
    ).rejects.toThrow("unchanged stable anchor byte order");
  });

  it("rejects a changed whole-file destination blob", async () => {
    const root = await copyStaleSuccessorProofFixture();
    const serviceFile = "server/modules/parameter-modules/service.ts";
    const servicePath = join(root, serviceFile);
    const service = await readFile(servicePath);
    service[0] = service[0]! ^ 1;
    await writeFile(servicePath, service);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913StaleSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("destination whole-file blob");
  });
});
