import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BoundaryViolation } from "./schema";

export const templateFixtureSuccessorPath = "scripts/fixtures/parameter-catalog-allowlist/template-fixture-successor.json";
const digest = "c425d4f92f50c41bdfff3f9434e2418947f60b3cd5fe095dc44f598617eeef03";
const base = "dd7bc33e22b5d2e970d7a37ec25c97e6e45bea1c";
type Pair = { old: BoundaryViolation; new: BoundaryViolation; effectiveOld: BoundaryViolation; sliceSha256: string; sliceText: string };
type Record = { baseHead: string; trustedBase: string; files: Array<{
  file: string; oldBlob: string; newBlob: string; before: string; after: string; replacements: number; pairs: Pair[];
}> };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Template fixture successor rejected: ${detail}.`);
}

/** This fixed decision changes three fixture options, with no scanner/source SQL changes. */
export function validateTemplateFixtureSuccessor(
  recordBytes: Buffer, raw: readonly BoundaryViolation[], historicalFiles: ReadonlyMap<string, Buffer>,
  currentFiles: ReadonlyMap<string, Buffer>,
) {
  check(sha(recordBytes) === digest, "pinned complete endpoint ledger");
  const record = JSON.parse(recordBytes.toString()) as Record;
  check(record.baseHead === base && record.trustedBase === "9b3ba7df7e21f5589684bc92c872da593ad4c246"
    && record.files.length === 2 && record.files[0].pairs.length === 93 && record.files[1].pairs.length === 77,
  "fixed input and full 170 endpoints");
  const rawById = new Map(raw.map((item) => [item.id, item]));
  check(rawById.size === raw.length, "duplicate observed ID");
  const oldForCurrent = new Map<string, BoundaryViolation>();
  const effectiveForCurrent = new Map<string, BoundaryViolation>();
  const currentForOld = new Map<string, BoundaryViolation>();
  for (const section of record.files) {
    const old = historicalFiles.get(section.file), current = currentFiles.get(section.file);
    check(old !== undefined && current !== undefined && blob(old) === section.oldBlob && blob(current) === section.newBlob,
      `whole-file blob ${section.file}`);
    check(old.toString().split(section.before).length - 1 === section.replacements
      && Buffer.from(old.toString().split(section.before).join(section.after)).equals(current), "only explicit template opt-in bytes");
    let previousStart = -1;
    for (const pair of section.pairs) {
      const observed = rawById.get(pair.new.id);
      check(observed !== undefined && isDeepStrictEqual(observed, pair.new), `exact current endpoint ${pair.new.id}`);
      check(!oldForCurrent.has(pair.new.id) && !currentForOld.has(pair.old.id)
        && pair.old.byteStart >= previousStart, "one-to-one ordered endpoints");
      previousStart = pair.old.byteStart;
      for (const key of ["file", "family", "rule", "token", "evidence", "reason", "trustedBaseSha"] as const) {
        check(pair.old[key] === pair.new[key], `same source semantics ${key}`);
      }
      check(pair.old.file === section.file && pair.old.trustedBlobOid === section.oldBlob
        && pair.new.trustedBlobOid === section.newBlob
        && pair.old.id.split(":").slice(0, 3).join(":") === pair.new.id.split(":").slice(0, 3).join(":"), "same scanner context");
      const slice = old.subarray(pair.old.byteStart, pair.old.byteEnd);
      check(slice.equals(current.subarray(pair.new.byteStart, pair.new.byteEnd))
        && sha(slice) === pair.sliceSha256 && slice.toString() === pair.sliceText, "exact source slice and hash");
      oldForCurrent.set(pair.new.id, pair.old);
      effectiveForCurrent.set(pair.new.id, pair.effectiveOld);
      currentForOld.set(pair.old.id, observed);
    }
    const watched = raw.filter((item) => item.file === section.file);
    check(watched.length === section.pairs.length && watched.every((item) => oldForCurrent.has(item.id)), "complete current file inventory");
  }
  return {
    raw: raw.map((item) => oldForCurrent.get(item.id) ?? item),
    native: raw.map((item) => effectiveForCurrent.get(item.id) ?? item),
    currentForOld, historicalFiles,
  };
}

export async function projectTemplateFixtureSuccessor(repoRoot: string, raw: readonly BoundaryViolation[]) {
  const bytes = await readFile(join(repoRoot, templateFixtureSuccessorPath));
  check(sha(bytes) === digest, "pinned complete endpoint ledger");
  const record = JSON.parse(bytes.toString()) as Record;
  const historicalFiles = new Map<string, Buffer>();
  const currentFiles = new Map<string, Buffer>();
  for (const { file } of record.files) {
    historicalFiles.set(file, execFileSync("git", ["show", `${base}:${file}`], { cwd: repoRoot }));
    currentFiles.set(file, await readFile(join(repoRoot, file)));
  }
  return validateTemplateFixtureSuccessor(bytes, raw, historicalFiles, currentFiles);
}
