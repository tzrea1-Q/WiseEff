import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureRecoveryPoint, verifyRecoveryPoint, type QuiescenceProof, type RecoveryTargetIdentity, type RecoveryManifest, type StoreSnapshotPort } from "./recoveryPoint";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const LIMIT = 256 * 1024 * 1024;
export type RecoveryRole = { name: string; login: boolean; members: string[] };
type ObjectBackup = { key: string; contentType: string; metadata: Record<string, string>; bytes: Buffer };
type RedisBackup = { appendonly: true; files: { name: string; bytes: Buffer }[] };
export type RecoveryPackageInput = {
  runId: string; target: RecoveryTargetIdentity; quiescence: QuiescenceProof;
  postgres: Buffer; roles: RecoveryRole[]; objects: ObjectBackup[]; redis: RedisBackup;
};
type FileRef = { file: string; sha256: string; size: number };
type Manifest = {
  format: "wiseeff-recovery-package-v1"; recovery: RecoveryManifest;
  postgres: FileRef; roles: RecoveryRole[];
  objects: (Omit<ObjectBackup, "bytes"> & FileRef)[];
  redis: { appendonly: true; files: ({ name: string } & FileRef)[] };
};
export type VerifiedRecoveryPackage = {
  digest: string; manifest: Manifest; postgres: Buffer; roles: RecoveryRole[]; objects: ObjectBackup[]; redis: RedisBackup;
};
const invalid = () => new Error("recovery-package-invalid");
const validRole = (role: RecoveryRole) => /^[a-z][a-z0-9_]{0,62}$/.test(role.name) && !role.name.startsWith("pg_") && role.name !== "postgres" && typeof role.login === "boolean" && Array.isArray(role.members);
const validateRoles = (roles: RecoveryRole[]) => {
  if (!Array.isArray(roles) || roles.length > 1000 || new Set(roles.map(r => r.name)).size !== roles.length || roles.some(r => !validRole(r) || Object.keys(r).some(k => !["name", "login", "members"].includes(k)) || r.members.some(m => !roles.some(candidate => candidate.name === m)))) throw invalid();
};
const storePorts = (manifest: Pick<Manifest, "postgres" | "objects" | "redis" | "roles">, target: RecoveryTargetIdentity): StoreSnapshotPort[] => [
  ["postgres", target.postgresIdentity, { dump: manifest.postgres, roles: manifest.roles }],
  ["object-store", target.objectStoreIdentity, manifest.objects],
  ["redis", target.redisIdentity, manifest.redis],
].map(([kind, identity, value]) => ({ kind: kind as StoreSnapshotPort["kind"], declaredIdentity: identity as string,
  async snapshot(now) { return { kind: kind as StoreSnapshotPort["kind"], identity: identity as string, checksum: `sha256:${hash(Buffer.from(JSON.stringify(value)))}`, capturedAt: now.toISOString() }; } }));

/** The source adapter exports all bytes and non-secret role capabilities while fenced.
 * No credentials, executable role SQL, config files or application approvals belong here.
 */
export async function captureRecoveryPackage(directory: string, input: RecoveryPackageInput): Promise<string> {
  validateRoles(input.roles);
  let index = 0; let size = 0;
  const payload = async (bytes: Buffer): Promise<FileRef> => {
    size += bytes.length;
    if (size > LIMIT) throw invalid();
    const file = `payload-${index++}.bin`;
    await writeFile(path.join(directory, file), bytes, { flag: "wx", mode: 0o600 });
    return { file, sha256: hash(bytes), size: bytes.length };
  };
  const postgres = await payload(input.postgres);
  const objects = [];
  for (const object of input.objects) objects.push({ key: object.key, contentType: object.contentType, metadata: object.metadata, ...await payload(object.bytes) });
  const files = [];
  for (const file of input.redis.files) files.push({ name: file.name, ...await payload(file.bytes) });
  const content = { postgres, roles: input.roles, objects, redis: { appendonly: true as const, files } };
  const capture = await captureRecoveryPoint({ runId: input.runId, target: input.target, quiescence: input.quiescence,
    maximumAgeMs: 24 * 60 * 60 * 1000, stores: storePorts(content, input.target) });
  if (!capture.ok) throw invalid();
  const manifest: Manifest = { format: "wiseeff-recovery-package-v1", recovery: capture.value.manifest, ...content };
  const bytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(path.join(directory, "manifest.json"), bytes, { flag: "wx", mode: 0o600 });
  const digest = hash(bytes);
  await verifyRecoveryPackage(directory, digest);
  return digest;
}

/** A fixed maximum bounds this in-memory adapter. Larger archives require a reviewed
 * streaming adapter; no partial restore starts merely because intake ran out of space.
 */
export async function verifyRecoveryPackage(directory: string, digest: string): Promise<VerifiedRecoveryPackage> {
  try {
    let total = 0;
    const read = async (name: string, maximum: number) => {
      const fd = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await fd.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || stat.size + total > LIMIT) throw invalid();
        // Allocate only the prechecked bound, including one byte to detect growth.
        const bounded = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < bounded.length) {
          const next = await fd.read(bounded, length, bounded.length - length, length);
          if (!next.bytesRead) break;
          length += next.bytesRead;
        }
        const bytes = bounded.subarray(0, length); total += bytes.length;
        if (bytes.length !== stat.size || total > LIMIT) throw invalid();
        return bytes;
      } finally { await fd.close(); }
    };
    const bytes = await read("manifest.json", 2 * 1024 * 1024);
    if (!/^[a-f0-9]{64}$/.test(digest) || hash(bytes) !== digest) throw invalid();
    const manifest = JSON.parse(bytes.toString()) as Manifest;
    if (manifest.format !== "wiseeff-recovery-package-v1" || manifest.redis.appendonly !== true) throw invalid();
    validateRoles(manifest.roles);
    if (manifest.objects.length > 10000 || manifest.redis.files.length > 1000 || new Set(manifest.objects.map(o => o.key)).size !== manifest.objects.length) throw invalid();
    const seen = new Set<string>();
    const load = async (ref: FileRef) => {
      if (!/^payload-[0-9]+\.bin$/.test(ref.file) || seen.has(ref.file) || !Number.isSafeInteger(ref.size) || ref.size < 0) throw invalid();
      seen.add(ref.file);
      const data = await read(ref.file, ref.size);
      if (data.length !== ref.size || hash(data) !== ref.sha256) throw invalid();
      return data;
    };
    const postgres = await load(manifest.postgres);
    const objects = [];
    for (const object of manifest.objects) {
      if (typeof object.key !== "string" || !object.key || typeof object.contentType !== "string" || !object.metadata || Object.values(object.metadata).some(v => typeof v !== "string")) throw invalid();
      objects.push({ key: object.key, contentType: object.contentType, metadata: object.metadata, bytes: await load(object) });
    }
    const files: RedisBackup["files"] = [];
    for (const file of manifest.redis.files) {
      if (!/^appendonly\.aof(?:\.manifest|\.[0-9]+\.(?:base\.rdb|base\.aof|incr\.aof))$/.test(file.name)) throw invalid();
      files.push({ name: file.name, bytes: await load(file) });
    }
    if (new Set(files.map(f => f.name)).size !== files.length) throw invalid();
    const aof = files.find(f => f.name === "appendonly.aof.manifest");
    if (!aof) throw invalid();
    const references = aof.bytes.toString().trim().split("\n").map(line => {
      const match = /^file (\S+) seq [0-9]+ type [bi]$/.exec(line);
      if (!match) throw invalid();
      return match[1];
    });
    if (!references.length || references.length !== files.length - 1 || references.some(name => !files.some(f => f.name === name))) throw invalid();
    const verification = await verifyRecoveryPoint({ manifest: manifest.recovery, stores: storePorts(manifest, manifest.recovery.target) });
    if (!verification.ok) throw invalid();
    if (Date.parse(manifest.recovery.capturedAt) > Date.now()) throw invalid();
    const regenerated = await captureRecoveryPoint({ runId: manifest.recovery.runId, target: manifest.recovery.target,
      quiescence: manifest.recovery.quiescence, maximumAgeMs: manifest.recovery.maximumAgeMs,
      now: () => new Date(manifest.recovery.capturedAt), stores: storePorts(manifest, manifest.recovery.target) });
    if (!regenerated.ok || regenerated.value.manifest.recoveryPointDigest !== manifest.recovery.recoveryPointDigest) throw invalid();
    return { digest, manifest, postgres, roles: manifest.roles, objects, redis: { appendonly: true, files } };
  } catch { throw invalid(); }
}

export type RecoveryRestoreBinding = { runId: string; packageDigest: string; source: RecoveryTargetIdentity; target: RecoveryTargetIdentity };
export type RecoveryPackageTarget = {
  target: RecoveryTargetIdentity; journalPath: string;
  /** Provided by the controller's approval adapter. It must validate the exact binding,
   * principal and purpose; this storage module cannot mint an approval. */
  authorize(binding: RecoveryRestoreBinding): Promise<void>;
  assertEmptyAndIsolated(binding: RecoveryRestoreBinding): Promise<void>;
  /** The implementation receives ONLY verified package material and external secret
   * facilities in its closure, never a source connection or fixture oracle. */
  restore(backup: VerifiedRecoveryPackage): Promise<void>;
};
export async function restoreRecoveryPackage(directory: string, digest: string, target: RecoveryPackageTarget) {
  const backup = await verifyRecoveryPackage(directory, digest);
  const binding = { runId: backup.manifest.recovery.runId, packageDigest: digest, source: backup.manifest.recovery.target, target: target.target };
  for (const key of ["deploymentId", "postgresIdentity", "objectStoreIdentity", "redisIdentity"] as const) {
    if (!target.target[key] || target.target[key] === binding.source[key]) throw new Error("recovery-target-not-independent");
  }
  await target.authorize(binding);
  await target.assertEmptyAndIsolated(binding);
  const journal = await open(target.journalPath, "wx", 0o600).catch(() => { throw new Error("recovery-restore-journal-exists-or-unavailable"); });
  try {
    await journal.writeFile(JSON.stringify({ binding, status: "started-unknown-until-completed" })); await journal.sync();
    const parent = await open(path.dirname(target.journalPath), "r");
    try { await parent.sync(); } finally { await parent.close(); }
    // No re-read of replaceable files: these are the previously authenticated bytes.
    await target.assertEmptyAndIsolated(binding);
    await target.restore(backup);
    await journal.truncate(0);
    await journal.write(Buffer.from(JSON.stringify({ binding, status: "restore-executed-not-business-verified" })), 0, undefined, 0);
    await journal.sync();
    return { status: "restore-executed-not-business-verified" as const, binding };
  } catch { throw new Error("recovery-restore-outcome-unknown-target-must-remain-isolated"); }
  finally { await journal.close(); }
}
