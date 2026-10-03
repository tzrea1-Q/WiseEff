import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BoundaryViolation } from "./schema";

const head = "c208a12d1e92039206cdacbbd61d53fec4e3181b";
const base = "c8e7ad22ffd0c2d4d559b4769f205dd86eb8ea11";
const path = "docs/exec-plans/active/849-inventory/issue-903-legacy-read-error-observations.json";
const recordDigest = "b2959cea92d6b24cc67738f59674e1160753feae165883fdbf59ae5e82b04279";
// #1011 adds only the public LegacyLookupFn returned-failure consumer check.
// The six-blob #1008 handoff and its 23 endpoints remain pinned to their history.
const returnedFailureSuccessor = {
  head: "adc410d14db9eccd8d3d11709f4cbaf064f20b03",
  path: "server/modules/knowledge/definitionReferences.integration.test.ts",
  oldBlob: "31579658279b0fe6669c99e58f0f67de227c7942",
  newBlob: "181bc8664be6d89cdb84632065fd7ff1bc8ba898",
  oldSha256: "eaaafc21910676d635616f3e53e4da3697e9bca06479ee03fac236278735b6d6",
  newSha256: "26dc651e5f6af368fa2d0050096ed08954db24304b7af2e227ccc2783dc8c860",
  insertionSha256: "4002d4ed69a7b2be2ed59472b5f7d6e709a49240bf671ec5c4b2c7e75400a528",
};
type Endpoint = BoundaryViolation & { sourceSpanText: string; spanSha256: string };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1008 Knowledge successor rejected: ${detail}.`);
}

/** Validate the complete current tree before projecting its 23 endpoints into the unchanged #903 proof. */
export async function projectIssue1008KnowledgeSuccessor(repoRoot: string, raw: readonly BoundaryViolation[]) {
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  const bytes = await readFile(join(repoRoot, path));
  check(sha(bytes) === recordDigest && git(head, path).equals(bytes), "pinned C handoff");
  const record = JSON.parse(bytes.toString()) as {
    baseCommit: string; scannerTrustedBase: string;
    removed: Endpoint[]; added: Endpoint[]; positionalCandidates: Array<{ oldId: string; newId: string }>;
    unmatchedOld: unknown[]; unmatchedNew: unknown[];
    candidateSourceBlobs: Array<{ path: string; candidateBlob: string }>;
  };
  check(record.baseCommit === base && record.scannerTrustedBase === "9b3ba7df7e21f5589684bc92c872da593ad4c246"
    && record.removed.length === 23 && record.added.length === 23 && record.positionalCandidates.length === 23
    && record.unmatchedOld.length === 0 && record.unmatchedNew.length === 0
    && record.candidateSourceBlobs.length === 6, "fixed input and complete 23-pair inventory");
  const currentFiles = new Map<string, Buffer>();
  for (const item of record.candidateSourceBlobs) {
    const current = await readFile(join(repoRoot, item.path));
    const historical = git(head, item.path);
    check(blob(historical) === item.candidateBlob, `historical whole-file blob ${item.path}`);
    if (item.path === returnedFailureSuccessor.path) {
      const successor = returnedFailureSuccessor;
      check(item.candidateBlob === successor.oldBlob && historical.length === 22613
        && sha(historical) === successor.oldSha256, "fixed pre-#1011 whole-file history");
      check(blob(current) === successor.newBlob && sha(current) === successor.newSha256
        && current.equals(git(successor.head, item.path)), `whole-file blob ${item.path}`);
      check(current.length === 24102 && sha(current.subarray(14243, 15732)) === successor.insertionSha256
        && historical.subarray(0, 14243).equals(current.subarray(0, 14243))
        && historical.subarray(14243).equals(current.subarray(15732)), "only exact returned-failure insertion");
    } else if (item.path === "server/testing/parameterCatalog/index.ts") {
      check(item.candidateBlob === "8ed95db394a3b19ff3c15bf3fd400cab4af1c3a4" && historical.length === 1398
        && blob(current) === "16d5c41cbd6d9ef28e11a512f48362f02c98fae6"
        && current.equals(git("7db2e686f086172ec18b82507d76202cf5bb60af", item.path)), `whole-file blob ${item.path}`);
      check(current.length === 1444
        && sha(current.subarray(1299, 1345)) === "2345bd07b48277747fd025ad511c89f15010f9e5949bba1d1cab8299cc4ffe15"
        && historical.subarray(0, 1299).equals(current.subarray(0, 1299))
        && historical.subarray(1299).equals(current.subarray(1345)), "only exact lifecycle fixture export insertion");
    } else {
      check(blob(current) === item.candidateBlob && historical.equals(current), `whole-file blob ${item.path}`);
    }
    currentFiles.set(item.path, current);
  }
  const oldById = new Map(record.removed.map((item) => [item.id, item]));
  const newById = new Map(record.added.map((item) => [item.id, item]));
  const rawById = new Map(raw.map((item) => [item.id, item]));
  check(rawById.size === raw.length, "duplicate observed ID");
  const historicalFiles = new Map<string, Buffer>();
  const oldForCurrent = new Map<string, BoundaryViolation>();
  const currentForOld = new Map<string, BoundaryViolation>();
  const identity = (item: BoundaryViolation) => `${item.id.split(":").slice(0, 3).join(":")}:${sha(Buffer.from([
    item.trustedBaseSha, item.trustedBlobOid, item.byteStart, item.byteEnd, item.token, item.evidence,
    item.file, item.family, item.rule,
  ].join("\0"))).slice(0, 16)}`;
  for (const pair of record.positionalCandidates) {
    const old = oldById.get(pair.oldId), next = newById.get(pair.newId), observed = rawById.get(pair.newId);
    check(old !== undefined && next !== undefined && observed !== undefined, `exact source and destination ${pair.oldId}`);
    check(!oldForCurrent.has(next.id) && !currentForOld.has(old.id), "one-to-one endpoints");
    check(old.id === identity(old) && next.id === identity(next)
      && old.id.split(":").slice(0, 3).join(":") === next.id.split(":").slice(0, 3).join(":")
      && old.file === next.file && old.family === next.family && old.rule === next.rule
      && old.token === next.token && old.evidence === next.evidence, "same scanner context and semantics");
    for (const key of ["id", "file", "family", "rule", "token", "evidence", "line", "column",
      "byteStart", "byteEnd", "trustedBaseSha", "trustedBlobOid"] as const) {
      check(observed[key] === next[key], `current endpoint ${next.id}:${key}`);
    }
    const oldFile = historicalFiles.get(old.file) ?? git(base, old.file);
    historicalFiles.set(old.file, oldFile);
    const nextFile = currentFiles.get(next.file)!;
    const oldSlice = oldFile.subarray(old.byteStart, old.byteEnd);
    const nextSlice = nextFile.subarray(next.byteStart, next.byteEnd);
    check(blob(oldFile) === old.trustedBlobOid && blob(nextFile) === next.trustedBlobOid
      && oldSlice.equals(nextSlice) && oldSlice.toString() === old.sourceSpanText
      && nextSlice.toString() === next.sourceSpanText && sha(oldSlice) === old.spanSha256
      && sha(nextSlice) === next.spanSha256, "exact old/current bytes and source hash");
    const { sourceSpanText: _text, spanSha256: _hash, ...endpoint } = old;
    oldForCurrent.set(next.id, endpoint);
    currentForOld.set(old.id, observed);
  }
  const watched = raw.filter((item) => currentFiles.has(item.file));
  check(watched.length === 23 && watched.every((item) => oldForCurrent.has(item.id)), "no unmatched current observation");
  const projectedRaw = raw.map((item) => oldForCurrent.get(item.id) ?? item);
  check(new Set(projectedRaw.map((item) => item.id)).size === raw.length, "projected ID collision");
  return {
    raw: projectedRaw, historicalFiles, currentForOld,
    project: (items: readonly BoundaryViolation[]) => items.map((item) => oldForCurrent.get(item.id) ?? item),
  };
}
