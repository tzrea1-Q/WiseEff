import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import type { RuntimeTopologyRelocation } from "./runtimeTopologyRelocation";
import { t14FamilySuccessorRelocationConfig } from "./t14FamilySuccessorRelocation";
import { t14RewrittenSliceSuccessorRelocationConfig } from "./t14RewrittenSliceSuccessorRelocation";

const cRecordPath = "docs/exec-plans/active/849-inventory/issue-903-native-catalog-observations.json";
const cRecordSha256 = "c5b3ddc9c5f7905b0b582bab4d9a5debdc099500524efb31ecd14367c8b60c55";
const aRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-903-a-knowledge-successor.json";
const aRecordSha256 = "8cd80e8e6fac00cc6bbff0323388d826f6f07dda5b0b76ee5da57db207d3f594";
const cBase = "c48e6e1d4c0414d7aef42f4f33a6fa3822d8a8a3";
const aBase = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
const cHead = "d6f1c28ab04875c847f4d1655dd2c34341de2765";
const aHead = "1e55c6ef11ba667a6fd6104f1bb0794ab0ca76a1";
const inheritedUnallowed = "S12-KNW:legacy-parameter-spec-identifier:7d722a7dd611c22b:35f177f136ca66bb";
const samePositionSource = "S12-KNW:legacy-parameter-spec-identifier:8a7ee14a16ecfa7b:82395fc3bdb3885f";

type Endpoint = {
  id: string; line: number; column: number; byteStart: number; byteEnd: number; trustedBlobOid: string;
};
type CPair = {
  disposition: string; rule: string; path: string; token: string; scannerEvidence: string;
  sourceSpanText: string; spanSha256: string; old: Endpoint; new: Endpoint;
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const blobOid = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function requireProof(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #903 Knowledge successor rejected: ${detail}.`);
}

function rebind(pair: CPair, endpoint: Endpoint, base: string) {
  const anchor = endpoint.id.split(":").slice(0, 3).join(":");
  const occurrence = sha256(Buffer.from([
    base, endpoint.trustedBlobOid, endpoint.byteStart, endpoint.byteEnd,
    pair.token, pair.scannerEvidence, pair.path, "S12-KNW", pair.rule,
  ].join("\0"))).slice(0, 16);
  return `${anchor}:${occurrence}`;
}

async function pinnedJson(repoRoot: string, path: string, digest: string) {
  const bytes = await readFile(resolve(repoRoot, path));
  requireProof(sha256(bytes) === digest, `pinned record ${path}`);
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

/** Historical T14 records are fully checked by the preceding T14 gate. This only binds their old A IDs. */
async function historicalBridge(repoRoot: string) {
  const bridge = new Map<string, string>();
  for (const config of [t14FamilySuccessorRelocationConfig, t14RewrittenSliceSuccessorRelocationConfig]) {
    const record = await pinnedJson(repoRoot, config.recordPath, config.recordSha256) as {
      files: Array<{ file: string; pairs: Array<{ old: BoundaryViolation; new: BoundaryViolation }> }>;
    };
    for (const section of record.files.filter(({ file }) => file === "server/modules/knowledge/parameterReferences.ts")) {
      for (const pair of section.pairs) {
        requireProof(!bridge.has(pair.new.id), `duplicate historical bridge ${pair.new.id}`);
        bridge.set(pair.new.id, pair.old.id);
      }
    }
  }
  requireProof(bridge.size === 15, "15 previously reviewed Knowledge relocations");
  return bridge;
}

/** Exact byte and ID successor proof; this does not authorize a newly observed Catalog use. */
export async function applyReviewedIssue903KnowledgeSuccessor(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  raw: readonly BoundaryViolation[],
) {
  if (fixture.trustedBaseSha !== aBase) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }
  const c = await pinnedJson(repoRoot, cRecordPath, cRecordSha256) as {
    schemaVersion: number; baseCommit: string; pairs: CPair[];
  };
  const a = await pinnedJson(repoRoot, aRecordPath, aRecordSha256) as {
    schemaVersion: number; aHead: string; cHead: string;
    pairs: Array<{ cOldId: string; aSourceId: string }>;
  };
  requireProof(c.schemaVersion === 1 && c.baseCommit === cBase && a.schemaVersion === 1
    && a.aHead === aHead && a.cHead === cHead && c.pairs.length === 34 && a.pairs.length === 34,
  "exact input and 34-pair inventory");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  requireProof(sha256(git(cHead, cRecordPath)) === cRecordSha256, "C head handoff identity");
  const bridge = await historicalBridge(repoRoot);
  const sources = new Map(fixture.violations.map((entry) => [entry.id, entry]));
  const allowed = new Set(allowances.map((entry) => entry.id));
  const current = new Map(raw.map((entry) => [entry.id, entry]));
  const sourceIds = new Set<string>();
  const observedIds = new Set<string>();
  const watchedFiles = new Set(c.pairs.map((pair) => pair.path));
  const sourceBytes = new Map<string, Buffer>();
  const aSourceBytes = new Map<string, Buffer>();
  const destinationBytes = new Map<string, Buffer>();
  const cHeadBytes = new Map<string, Buffer>();
  const replacements = new Map<string, BoundaryViolation>();
  const relocations: RuntimeTopologyRelocation[] = [];
  let direct = 0;
  let historical = 0;
  let samePosition = 0;
  let alreadyBound = 0;
  for (const [index, pair] of c.pairs.entries()) {
    const link = a.pairs[index];
    requireProof(link?.cOldId === pair.old.id && pair.disposition === "position-migration", `pair order ${index}`);
    requireProof(pair.old.id === rebind(pair, pair.old, cBase)
      && pair.new.id === rebind(pair, pair.new, cBase), `C IDs ${index}`);
    const aOldId = rebind(pair, pair.old, aBase);
    const aNewId = rebind(pair, pair.new, aBase);
    const observed = current.get(aNewId);
    let source = sources.get(link.aSourceId);
    // This one #897-era unresolved use was introduced after the frozen #913 fixture.
    // The unchanged A source tree and exact C old endpoint keep its old ID visible.
    if (!source && link.aSourceId === inheritedUnallowed && observed) {
      requireProof(link.aSourceId === aOldId, `unallowed A source endpoint ${index}`);
      source = {
        ...observed,
        id: aOldId,
        line: pair.old.line, column: pair.old.column,
        byteStart: pair.old.byteStart, byteEnd: pair.old.byteEnd,
        trustedBlobOid: pair.old.trustedBlobOid,
      };
    }
    requireProof(source !== undefined && observed !== undefined,
      `A source and destination ${index}: ${link.aSourceId} / ${aNewId}`);
    requireProof(!sourceIds.has(source.id) && !observedIds.has(observed.id), `one-to-one mapping ${index}`);
    sourceIds.add(source.id);
    observedIds.add(observed.id);
    requireProof(source.file === pair.path && observed.file === pair.path
      && source.rule === pair.rule && observed.rule === pair.rule
      && observed.token === pair.token && observed.evidence === pair.scannerEvidence
      && observed.line === pair.new.line && observed.column === pair.new.column
      && observed.byteStart === pair.new.byteStart && observed.byteEnd === pair.new.byteEnd
      && observed.trustedBlobOid === pair.new.trustedBlobOid,
    `exact current observation ${index}`);
    if (source.id === aOldId) direct++;
    else if (bridge.get(aOldId) === source.id) historical++;
    else {
      requireProof(source.id === samePositionSource && source.id.split(":").slice(0, 3).join(":")
        === aOldId.split(":").slice(0, 3).join(":")
        && source.byteStart === pair.old.byteStart && source.byteEnd === pair.old.byteEnd
        && source.line === pair.old.line && source.column === pair.old.column,
      `baseline position bridge ${index}`);
      const initialBytes = git(aBase, pair.path);
      const oldBytes = sourceBytes.get(pair.path) ?? git(cBase, pair.path);
      requireProof(initialBytes.subarray(source.byteStart, source.byteEnd)
        .equals(oldBytes.subarray(pair.old.byteStart, pair.old.byteEnd)), `baseline slice bridge ${index}`);
      samePosition++;
    }
    const oldFile = sourceBytes.get(pair.path) ?? git(cBase, pair.path);
    sourceBytes.set(pair.path, oldFile);
    const oldAFile = aSourceBytes.get(pair.path) ?? git(aHead, pair.path);
    aSourceBytes.set(pair.path, oldAFile);
    const newFile = destinationBytes.get(pair.path) ?? await readFile(resolve(repoRoot, pair.path));
    destinationBytes.set(pair.path, newFile);
    const cFile = cHeadBytes.get(pair.path) ?? git(cHead, pair.path);
    cHeadBytes.set(pair.path, cFile);
    requireProof(blobOid(oldAFile) === pair.old.trustedBlobOid
      && blobOid(oldFile) === pair.old.trustedBlobOid
      && blobOid(cFile) === pair.new.trustedBlobOid
      && blobOid(newFile) === pair.new.trustedBlobOid, `whole-file blobs ${pair.path}`);
    const oldSlice = oldFile.subarray(pair.old.byteStart, pair.old.byteEnd);
    const newSlice = newFile.subarray(pair.new.byteStart, pair.new.byteEnd);
    requireProof(oldSlice.equals(newSlice) && newSlice.toString("utf8") === pair.sourceSpanText
      && sha256(newSlice) === pair.spanSha256, `exact source slice ${index}`);
    requireProof(allowed.has(source.id) === (source.id !== inheritedUnallowed)
      && !allowed.has(observed.id), `allowance status ${index}`);
    if (discovered.some((entry) => entry.id === observed.id)) {
      replacements.set(observed.id, source);
      relocations.push({ id: source.id, observed });
    } else {
      requireProof(discovered.some((entry) => entry.id === source.id
        && entry.file === observed.file && entry.byteStart === observed.byteStart
        && entry.byteEnd === observed.byteEnd && entry.token === observed.token
        && entry.evidence === observed.evidence), `prebound current position ${index}`);
      alreadyBound++;
    }
  }
  requireProof(watchedFiles.size === 7 && direct === 18 && historical === 15
    && samePosition === 1 && alreadyBound === 1,
    "A historical partition");
  const watched = raw.filter((entry) => watchedFiles.has(entry.file));
  requireProof(watched.length === 34 && watched.every((entry) => observedIds.has(entry.id)),
    "no unmatched Knowledge observation");
  return {
    violations: discovered.map((entry) => replacements.get(entry.id) ?? entry),
    relocations,
  };
}
