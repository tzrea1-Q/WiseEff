import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { captureRecoveryPoint, verifyRecoveryPoint, type QuiescenceProof, type RecoveryTargetIdentity, type RecoveryManifest, type StoreSnapshotPort } from "./recoveryPoint";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const LIMIT = 256 * 1024 * 1024;
/** Read-only PG16 vanilla/bootstrap-postgres profile. pg_dump without --create
 * does not carry these capabilities. Compare ACL entries as ordered multisets;
 * pg_init_privs records non-default initial grants, while acldefault supplies
 * PostgreSQL's own default for objects without an initial-privilege row.
 * Other databases are never opened: shared catalog entries only detect package
 * roles' explicit privileges/ownership that this single-database dump would omit.
 * Database-wide settings have setrole=0, so they cannot be found by joining
 * pg_roles. Reject settings affecting this database; do not guess or reset them.
 * A query error or unavailable baseline is a refusal, never an empty inventory.
 * Database creation attributes are not in a dump without --create. Both current
 * package adapters support ONLY the explicitly observed PG16-alpine defaults:
 * UTF8 / en_US.utf8 / libc / no ICU or collation-version metadata. Different
 * locale, encoding, provider, connection or template settings are unsupported;
 * this query never normalizes them. Supporting variable properties will require
 * an authenticated package contract and exact target comparison.
 */
const nonDumpInventorySql = (bootstrapPredicate: string, packageRolePredicate: string) => `
with bootstrap as (
  select oid from pg_catalog.pg_roles where ${bootstrapPredicate}
), package_roles as (
  select oid from pg_catalog.pg_roles where ${packageRolePredicate}
), target_database as (
  select * from pg_catalog.pg_database where datname=pg_catalog.current_database()
), builtin_functions as (
  select routine.* from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
  where namespace.nspname='pg_catalog'
), acl_inputs(kind,actual,expected) as (
  select 'databaseAcl', coalesce(database.datacl,pg_catalog.acldefault('d',database.datdba)),
    pg_catalog.acldefault('d',database.datdba) from target_database database
  union all
  select 'tablespaceAcl',coalesce(space.spcacl,pg_catalog.acldefault('t',space.spcowner)),
    pg_catalog.acldefault('t',space.spcowner) from pg_catalog.pg_tablespace space
  union all
  select 'parameterAcl',coalesce(parameter.paracl,pg_catalog.acldefault('p',bootstrap.oid)),
    coalesce(initial.initprivs,pg_catalog.acldefault('p',bootstrap.oid))
    from pg_catalog.pg_parameter_acl parameter cross join bootstrap
    left join pg_catalog.pg_init_privs initial on initial.objoid=parameter.oid
      and initial.classoid='pg_catalog.pg_parameter_acl'::regclass and initial.objsubid=0 and initial.privtype='i'
  union all
  select 'builtinFunctionAcl',coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner)),
    coalesce(initial.initprivs,pg_catalog.acldefault('f',routine.proowner))
    from builtin_functions routine left join pg_catalog.pg_init_privs initial on initial.objoid=routine.oid
      and initial.classoid='pg_catalog.pg_proc'::regclass and initial.objsubid=0 and initial.privtype='i'
), changed_acls as (
  select kind from acl_inputs where
    coalesce((select jsonb_agg(jsonb_build_array(grantor,grantee,privilege_type,is_grantable)
      order by grantor,grantee,privilege_type,is_grantable) from pg_catalog.aclexplode(actual)),'[]'::jsonb)
    is distinct from
    coalesce((select jsonb_agg(jsonb_build_array(grantor,grantee,privilege_type,is_grantable)
      order by grantor,grantee,privilege_type,is_grantable) from pg_catalog.aclexplode(expected)),'[]'::jsonb)
)
select json_build_object(
  'databaseOwner',(select count(*) from target_database where datdba is distinct from (select oid from bootstrap))
    + (select count(*) from pg_catalog.pg_database where datname<>pg_catalog.current_database() and datdba in (select oid from package_roles)),
  'databaseAcl',(select count(*) from changed_acls where kind='databaseAcl')
    + (select count(*) from pg_catalog.pg_database database cross join lateral pg_catalog.aclexplode(database.datacl) acl
       where database.datname<>pg_catalog.current_database() and (acl.grantee in (select oid from package_roles) or acl.grantor in (select oid from package_roles))),
  'databaseSettings',(select count(*) from pg_catalog.pg_db_role_setting
    where setrole=0 and (setdatabase=0 or setdatabase in (select oid from target_database))),
  'databaseProperties',(select count(*) from target_database where encoding<>6
    or datcollate<>'en_US.utf8' or datctype<>'en_US.utf8' or datlocprovider<>'c'
    or daticulocale is not null or daticurules is not null or datcollversion is not null
    or datconnlimit<>-1 or not datallowconn or datistemplate),
  'tablespaceOwner',(select count(*) from pg_catalog.pg_tablespace where spcname not in ('pg_default','pg_global') or spcowner is distinct from (select oid from bootstrap)),
  'tablespaceAcl',(select count(*) from changed_acls where kind='tablespaceAcl'),
  'parameterAcl',(select count(*) from changed_acls where kind='parameterAcl'),
  'builtinFunctionOwner',(select count(*) from builtin_functions where proowner is distinct from (select oid from bootstrap)),
  'builtinFunctionAcl',(select count(*) from changed_acls where kind='builtinFunctionAcl'),
  'baselineUnavailable',case when (select count(*) from bootstrap)<>1 or (select count(*) from target_database)<>1
    or pg_catalog.current_setting('server_version_num')::integer not between 160000 and 169999
    or not exists(select 1 from builtin_functions where oid='pg_catalog.pg_control_system()'::regprocedure)
    or not exists(select 1 from pg_catalog.pg_init_privs where classoid='pg_catalog.pg_proc'::regclass and privtype='i')
    or exists(select 1 from builtin_functions where oid>=16384) then 1 else 0 end
)`;
// v2 remains postgres-only; the explicit database-attribute refusal applies to
// both profiles because neither format promises to recreate those attributes.
export const RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL = nonDumpInventorySql("rolname='postgres'", "rolname !~ '^pg_' and rolname<>'postgres'");
/** $1/$2 come from an independently verified bootstrap OID/name, not SQL text. */
export const RECOVERY_V3_NON_DUMP_CAPABILITY_INVENTORY_SQL = nonDumpInventorySql("oid=$1::oid and rolname=$2::text", "rolname !~ '^pg_' and oid<>$1::oid");
export const hasUnsupportedNonDumpCapabilities = (value: unknown): boolean => {
  const keys = ["databaseOwner", "databaseAcl", "databaseSettings", "databaseProperties", "tablespaceOwner", "tablespaceAcl", "parameterAcl", "builtinFunctionOwner", "builtinFunctionAcl", "baselineUnavailable"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return true;
  return Object.values(value).some(count => typeof count !== "number" || !Number.isSafeInteger(count) || count !== 0);
};
export type RecoveryRoleMembership = { name: string; inherit: boolean; set: boolean };
// ADMIN OPTION and privileged role attributes are deliberately not representable.
// Every inheritance flag is explicit: v1 packages must be re-exported, not guessed.
export type RecoveryRole = { name: string; login: boolean; inherit: boolean; members: RecoveryRoleMembership[] };
/** Identity of the existing initdb administrator, never instructions to create
 * one. Its password/hash and attributes are not transferable package material. */
export type RecoveryBootstrapIdentity = { roleName: string; roleOid: "10"; postgresMajor: 16 };
type ObjectBackup = { key: string; contentType: string; metadata: Record<string, string>; bytes: Buffer };
type RedisBackup = { appendonly: true; files: { name: string; bytes: Buffer }[] };
export type RecoveryPackageInput = {
  runId: string; target: RecoveryTargetIdentity; quiescence: QuiescenceProof;
  postgres: Buffer; roles: RecoveryRole[]; objects: ObjectBackup[]; redis: RedisBackup;
  bootstrap?: RecoveryBootstrapIdentity;
};
type FileRef = { file: string; sha256: string; size: number };
type Manifest = {
  format: "wiseeff-recovery-package-v2" | "wiseeff-recovery-package-v3"; recovery: RecoveryManifest;
  bootstrap?: RecoveryBootstrapIdentity;
  postgres: FileRef; roles: RecoveryRole[];
  objects: (Omit<ObjectBackup, "bytes"> & FileRef)[];
  redis: { appendonly: true; files: ({ name: string } & FileRef)[] };
};
export type VerifiedRecoveryPackage = {
  digest: string; manifest: Manifest; postgres: Buffer; roles: RecoveryRole[]; objects: ObjectBackup[]; redis: RedisBackup;
  bootstrap?: RecoveryBootstrapIdentity;
};
const invalid = () => new Error("recovery-package-invalid");
export type RecoveryPackageDirectoryIdentity = Readonly<{ dev: number; ino: number }>;
const sameFileIdentity = (left: RecoveryPackageDirectoryIdentity, right: RecoveryPackageDirectoryIdentity) => left.dev === right.dev && left.ino === right.ino;

/** A pathname can be replaced while the source is exported or between payloads.
 * Keep the original directory open, then identify each actual output descriptor
 * and its named inode before writing through that descriptor. A race during open
 * can create an empty file in a replacement directory, but it receives no backup
 * bytes. Never delete that file or any other foreign resource on refusal.
 */
async function openPackageWriter(directory: string, expected?: RecoveryPackageDirectoryIdentity) {
  const pinned = expected ? { ...expected } : undefined;
  const root = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const original = await root.stat();
    if (pinned && !sameFileIdentity(original, pinned)) throw invalid();
    const check = async () => {
      const [held, named] = await Promise.all([root.stat(), lstat(directory)]);
      if (!held.isDirectory() || !named.isDirectory() || named.isSymbolicLink()
        || (held.mode & 0o777) !== 0o700 || (named.mode & 0o777) !== 0o700
        || !sameFileIdentity(original, held) || !sameFileIdentity(original, named)) throw invalid();
    };
    await check();
    return { check, close: () => root.close(), async sync() {
      await check();
      await root.sync();
      await check();
    }, async write(name: string, bytes: Buffer) {
      await check();
      const filename = path.join(directory, name);
      const output = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await check();
        const [held, named] = await Promise.all([output.stat(), lstat(filename)]);
        await check();
        if (!held.isFile() || !named.isFile() || held.nlink !== 1 || named.nlink !== 1
          || held.size !== 0 || (held.mode & 0o777) !== 0o600 || !sameFileIdentity(held, named)) throw invalid();
        await output.writeFile(bytes);
        await output.sync();
        await check();
        const final = await output.stat();
        if (final.size !== bytes.length || final.nlink !== 1 || !sameFileIdentity(final, await lstat(filename))) throw invalid();
      } finally { await output.close(); }
    } };
  } catch (error) { await root.close(); throw error; }
}
const roleName = (name: unknown): name is string => typeof name === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(name) && !name.startsWith("pg_") && name !== "postgres";
const validateBootstrap = (value: RecoveryBootstrapIdentity) => {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "postgresMajor,roleName,roleOid"
    || !(value.roleName === "postgres" || roleName(value.roleName)) || value.roleOid !== "10" || value.postgresMajor !== 16) throw invalid();
};
const validateBootstrapRoles = (bootstrap: RecoveryBootstrapIdentity, roles: RecoveryRole[]) => {
  validateBootstrap(bootstrap);
  if (roles.some(role => role.name === bootstrap.roleName || role.members.some(member => member.name === bootstrap.roleName))) throw invalid();
};
const validateRoles = (roles: RecoveryRole[]) => {
  if (!Array.isArray(roles) || roles.length > 1000 || roles.some(role => !role || !roleName(role.name) || typeof role.login !== "boolean" || typeof role.inherit !== "boolean" || !Array.isArray(role.members) || Object.keys(role).some(key => !["name", "login", "inherit", "members"].includes(key)))) throw invalid();
  const names = new Set(roles.map(role => role.name));
  const byName = new Map(roles.map(role => [role.name, role]));
  if (names.size !== roles.length || roles.reduce((count, role) => count + role.members.length, 0) > 10000) throw invalid();
  for (const role of roles) {
    if (role.members.some(member => !member || !roleName(member.name) || !names.has(member.name) || member.name === role.name || typeof member.inherit !== "boolean" || typeof member.set !== "boolean" || Object.keys(member).some(key => !["name", "inherit", "set"].includes(key))) || new Set(role.members.map(member => member.name)).size !== role.members.length) throw invalid();
  }
  // PostgreSQL rejects circular membership. Detect it before any target role is created.
  const active = new Set<string>(); const visited = new Set<string>();
  const visit = (role: RecoveryRole) => {
    if (active.has(role.name)) throw invalid();
    if (visited.has(role.name)) return;
    active.add(role.name);
    for (const member of role.members) visit(byName.get(member.name)!);
    active.delete(role.name); visited.add(role.name);
  };
  for (const role of roles) visit(role);
};
export const recoveryPackageStorePorts = (manifest: Pick<Manifest, "postgres" | "objects" | "redis" | "roles" | "bootstrap">, target: RecoveryTargetIdentity): StoreSnapshotPort[] => [
  ["postgres", target.postgresIdentity, { dump: manifest.postgres, roles: manifest.roles, ...(manifest.bootstrap ? { bootstrap: manifest.bootstrap } : {}) }],
  ["object-store", target.objectStoreIdentity, manifest.objects],
  ["redis", target.redisIdentity, manifest.redis],
].map(([kind, identity, value]) => ({ kind: kind as StoreSnapshotPort["kind"], declaredIdentity: identity as string,
  async snapshot(now) { return { kind: kind as StoreSnapshotPort["kind"], identity: identity as string, checksum: `sha256:${hash(Buffer.from(JSON.stringify(value)))}`, capturedAt: now.toISOString() }; } }));

/** The source adapter exports all bytes and non-secret role capabilities while fenced.
 * No credentials, executable role SQL, config files or application approvals belong here.
 */
export async function captureRecoveryPackage(directory: string, input: RecoveryPackageInput, expectedDirectoryIdentity?: RecoveryPackageDirectoryIdentity): Promise<string> {
  validateRoles(input.roles);
  if (input.bootstrap !== undefined) validateBootstrapRoles(input.bootstrap, input.roles);
  const writer = await openPackageWriter(directory, expectedDirectoryIdentity).catch(() => { throw invalid(); });
  try {
    let index = 0; let size = 0;
    const payload = async (bytes: Buffer): Promise<FileRef> => {
      size += bytes.length;
      if (size > LIMIT) throw invalid();
      const file = `payload-${index++}.bin`;
      await writer.write(file, bytes);
      return { file, sha256: hash(bytes), size: bytes.length };
    };
    const postgres = await payload(input.postgres);
    const objects = [];
    for (const object of input.objects) objects.push({ key: object.key, contentType: object.contentType, metadata: object.metadata, ...await payload(object.bytes) });
    const files = [];
    for (const file of input.redis.files) files.push({ name: file.name, ...await payload(file.bytes) });
    const content = { postgres, roles: input.roles, objects, redis: { appendonly: true as const, files }, ...(input.bootstrap ? { bootstrap: { ...input.bootstrap } } : {}) };
    const capture = await captureRecoveryPoint({ runId: input.runId, target: input.target, quiescence: input.quiescence,
      maximumAgeMs: 24 * 60 * 60 * 1000, stores: recoveryPackageStorePorts(content, input.target) });
    if (!capture.ok) throw invalid();
    const manifest: Manifest = { format: input.bootstrap ? "wiseeff-recovery-package-v3" : "wiseeff-recovery-package-v2", recovery: capture.value.manifest, ...content };
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writer.write("manifest.json", bytes);
    const digest = hash(bytes);
    // All payloads and the manifest have synced their actual file descriptors;
    // persist directory entries before verification can return capture success.
    await writer.sync();
    await verifyRecoveryPackage(directory, digest);
    await writer.check();
    return digest;
  } catch { throw invalid(); }
  finally { await writer.close().catch(() => { throw invalid(); }); }
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
    if (!["wiseeff-recovery-package-v2", "wiseeff-recovery-package-v3"].includes(manifest.format) || manifest.redis.appendonly !== true) throw invalid();
    validateRoles(manifest.roles);
    if (manifest.format === "wiseeff-recovery-package-v3") validateBootstrapRoles(manifest.bootstrap!, manifest.roles);
    else if (manifest.bootstrap !== undefined) throw invalid();
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
    const verification = await verifyRecoveryPoint({ manifest: manifest.recovery, stores: recoveryPackageStorePorts(manifest, manifest.recovery.target) });
    if (!verification.ok) throw invalid();
    if (Date.parse(manifest.recovery.capturedAt) > Date.now()) throw invalid();
    const regenerated = await captureRecoveryPoint({ runId: manifest.recovery.runId, target: manifest.recovery.target,
      quiescence: manifest.recovery.quiescence, maximumAgeMs: manifest.recovery.maximumAgeMs,
      now: () => new Date(manifest.recovery.capturedAt), stores: recoveryPackageStorePorts(manifest, manifest.recovery.target) });
    if (!regenerated.ok || regenerated.value.manifest.recoveryPointDigest !== manifest.recovery.recoveryPointDigest) throw invalid();
    return { digest, manifest, postgres, roles: manifest.roles, objects, redis: { appendonly: true, files }, ...(manifest.bootstrap ? { bootstrap: manifest.bootstrap } : {}) };
  } catch { throw invalid(); }
}
