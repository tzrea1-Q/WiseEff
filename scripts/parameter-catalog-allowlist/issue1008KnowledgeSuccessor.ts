import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BoundaryViolation } from "./schema";

const head = "c208a12d1e92039206cdacbbd61d53fec4e3181b";
const base = "c8e7ad22ffd0c2d4d559b4769f205dd86eb8ea11";
const path = "docs/exec-plans/active/849-inventory/issue-903-legacy-read-error-observations.json";
const recordDigest = "b2959cea92d6b24cc67738f59674e1160753feae165883fdbf59ae5e82b04279";
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
    check(blob(current) === item.candidateBlob && git(head, item.path).equals(current), `whole-file blob ${item.path}`);
    currentFiles.set(item.path, current);
  }
  const oldById = new Map(record.removed.map((item) => [item.id, item]));
  const newById = new Map(record.added.map((item) => [item.id, item]));
  const rawById = new Map(raw.map((item) => [item.id, item]));
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
  const watched = raw.filter((item) => historicalFiles.has(item.file));
  check(watched.length === 23 && watched.every((item) => oldForCurrent.has(item.id)), "no unmatched current observation");
  return {
    raw: raw.map((item) => oldForCurrent.get(item.id) ?? item), historicalFiles, currentForOld,
    project: (items: readonly BoundaryViolation[]) => items.map((item) => oldForCurrent.get(item.id) ?? item),
  };
}
