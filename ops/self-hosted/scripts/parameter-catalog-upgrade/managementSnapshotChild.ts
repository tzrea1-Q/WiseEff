import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, fstatSync, lstatSync, readSync } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { z } from "zod";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { superviseComponentProcess } from "../../../../scripts/run-upgrade-component-tests";
import type { FrozenSourceSnapshot } from "../../../../server/modules/catalog-cutover/sourceSnapshot";
import { reopenApplicationArtifactSelection } from "./applicationArtifactCustody";
import { assertHostOperationLockForJournal, openHandoffRuntimeConfigurationLease, verifyStoppedHandoff,
  type HandoffInputs, type HandoffObserver, type HandoffPlan, type HostOperationLock } from "./handoff";
import { canonicalJson, loadUpgradeJournal, sha256Prefixed, type UpgradeJournal } from "./journal";

class SnapshotChildError extends Error {
  constructor(code: string) { super(`PCAT-MANAGEMENT-SNAPSHOT-${code}`); }
}
const need: (value: unknown, code: string) => asserts value = (value, code) => { if (!value) throw new SnapshotChildError(code); };
const safe = (error: unknown) => error instanceof SnapshotChildError ||
  error instanceof AggregateError && error.errors.every(item => item instanceof SnapshotChildError)
  ? error : new SnapshotChildError("UNAVAILABLE");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const environment = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
const git = (checkout: string, args: string[]) => {
  const result = spawnSync("git", ["--no-replace-objects", "-C", checkout, ...args], { env: environment(), timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  need(result.status === 0 && !result.error, "SOURCE-UNAVAILABLE");
  return result.stdout;
};
const id = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const migrationSchema = z.object({ name: z.string().regex(/^[A-Za-z0-9_-]+\.sql$/), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const snapshotSchema = z.object({
  version: z.literal("pcat-frozen-public-source-v1"),
  target: z.object({ systemIdentifier: z.string().regex(/^[0-9]+$/), databaseOid: z.string().regex(/^[1-9][0-9]*$/) }).strict(),
  sourceMigrations: z.array(migrationSchema).min(1), migrationSuffix: z.array(migrationSchema),
  candidateInventoryDigest: digestSchema, digest: digestSchema,
  relations: z.array(z.object({ name: z.string().min(1), kind: z.enum(["r", "p"]),
    columns: z.array(z.object({ name: z.string().min(1), position: z.number().int().safe().positive(), type: z.string().min(1) }).strict()),
    rowCount: z.number().int().safe().nonnegative(), rowsDigest: digestSchema }).strict()),
}).strict();

// Fixed controller bootstrap, not code claimed to reside in the candidate
// artifact. Its exact command is inspected before START. The snapshot owner
// and candidate migration files are imported from the actual immutable image.
// Stdin contains data only, never a caller script, SQL command or callback.
const bootstrap = String.raw`
import {readFileSync} from 'node:fs';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {Socket} from 'node:net';
import {TLSSocket} from 'node:tls';
let pool,lost=false,result,closing=false;const clients=new Set(),checkedOut=new Set();let failed=false,stage='module-load',failedAt;
try {
 const {default:pg}=await import('pg');const {captureFrozenSourceSnapshot}=await import('./server/modules/catalog-cutover/sourceSnapshot.ts');stage='input';
 const bytes=readFileSync(0);if(bytes.length>16777216)throw new Error();const p=JSON.parse(bytes.toString('utf8'));
 if(Object.keys(p).sort().join(',')!=='database,files,host,password,port,target,user'||p.port!==5432||!Array.isArray(p.files)||!p.files.length)throw new Error();
 stage='source-files';await mkdir('/private/source',{mode:0o700});const names=new Set();
 for(const f of p.files){if(Object.keys(f).sort().join(',')!=='bytes,name'||!/^[A-Za-z0-9_-]+\.sql$/.test(f.name)||names.has(f.name))throw new Error();names.add(f.name);await writeFile('/private/source/'+f.name,Buffer.from(f.bytes,'base64'),{mode:0o600,flag:'wx'});}
 stage='connection';pool=new pg.Pool({host:p.host,port:p.port,user:p.user,password:p.password,database:p.database,max:1,connectionTimeoutMillis:1500,query_timeout:1500,options:'-c default_transaction_read_only=on -c search_path=pg_catalog'});
 pool.on('error',()=>{lost=true});pool.on('acquire',c=>checkedOut.add(c));pool.on('release',(_,c)=>checkedOut.delete(c));pool.on('connect',c=>{clients.add(c);c.on('error',()=>{lost=true});c.on('end',()=>{if(!closing)lost=true});});
 const client=await new Promise((resolve,reject)=>pool.connect((error,c)=>{if(c){clients.add(c);c.on('error',()=>{lost=true});}if(error)reject(new Error());else resolve(c)}));
 stage='target';try{const stream=client.connection.stream;if(!(stream instanceof Socket)||stream instanceof TLSSocket||stream.destroyed||stream.remoteAddress!==p.host||stream.remotePort!==5432)throw new Error();
 const row=(await client.query("select s.system_identifier::text system_id,d.oid::text database_oid,d.datname database,session_user=current_user same_role from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database()" )).rows[0];
 if(!row||row.system_id!==p.target.systemIdentifier||row.database_oid!==p.target.databaseOid||row.database!==p.database||!row.same_role||lost)throw new Error();
 }finally{client.release();}
 stage='source-snapshot';result=await captureFrozenSourceSnapshot({pool,sourceMigrationsDirectory:'/private/source',candidateMigrationsDirectory:'/app/server/migrations'});
 if(lost||result.target.systemIdentifier!==p.target.systemIdentifier||result.target.databaseOid!==p.target.databaseOid)throw new Error();
}catch{failed=true;failedAt=stage}
finally{closing=true;const endings=await Promise.allSettled([...clients].map(c=>c.end()));if(endings.some(r=>r.status==='rejected')){failed=true;failedAt??='native-close'}for(const c of checkedOut){try{c.release(true)}catch{failed=true;failedAt??='native-close'}}try{await pool?.end()}catch{failed=true;failedAt??='native-close'}try{await rm('/private/source',{recursive:true,force:true})}catch{failed=true;failedAt??='source-file-close'}}
if(failed||lost||!result){process.stderr.write('management-snapshot-child-failed:'+(failedAt??stage));process.exitCode=1}else process.stdout.write(JSON.stringify(result));
`;
const command = ["--import", "tsx", "--input-type=module", "-e", bootstrap];
type Json = Record<string, any>;
function childEnvironment(imageEnvironment: unknown): string[] {
  need(Array.isArray(imageEnvironment) && imageEnvironment.every(value => typeof value === "string" && value.includes("=")) &&
    new Set(imageEnvironment.map(value => value.slice(0, value.indexOf("=")))).size === imageEnvironment.length &&
    !imageEnvironment.some(value => value.startsWith("TMPDIR=")), "IMAGE-ENVIRONMENT");
  return [...imageEnvironment, "TMPDIR=/private"].sort();
}
function assertContainerShape(c: Json, intent: Json, imageEnvironment: unknown) {
  need(id(c.Id) && c.Name === `/${intent.name}` && c.Image === intent.imageId &&
    canonicalJson(c.Config.Cmd) === canonicalJson(command) && canonicalJson(c.Config.Entrypoint) === canonicalJson(["node"]) &&
    c.Config.WorkingDir === "/app" && c.Config.Labels?.["wiseeff.controlled-recovery-run"] === intent.ownerRunId &&
    Array.isArray(c.Config.Env) && canonicalJson([...c.Config.Env].sort()) === canonicalJson(childEnvironment(imageEnvironment)) &&
    c.Config.Labels?.["wiseeff.management-snapshot-intent"] === sha256Prefixed(canonicalJson(intent)) &&
    c.HostConfig.NetworkMode === intent.networkId && c.HostConfig.ReadonlyRootfs === true && !c.HostConfig.Privileged &&
    !c.HostConfig.PidMode && !(c.HostConfig.Devices ?? []).length && !(c.HostConfig.DeviceRequests ?? []).length &&
    canonicalJson(c.HostConfig.CapDrop) === canonicalJson(["ALL"]) && !(c.HostConfig.CapAdd ?? []).length &&
    canonicalJson(c.HostConfig.SecurityOpt) === canonicalJson(["no-new-privileges"]) &&
    !Object.keys(c.HostConfig.PortBindings ?? {}).length && c.HostConfig.RestartPolicy?.Name === "no" &&
    c.Mounts.length === 0 && canonicalJson(c.HostConfig.Tmpfs) ===
      canonicalJson({ "/private": "rw,noexec,nosuid,size=33554432,mode=0700" }), "CONTAINER-CHANGED");
}
type Registration = { containerId: string; imageId: string; networkId: string; sourceIds: readonly string[]; state: "created" | "running" | "exited" | "removed" };
declare const issued: unique symbol;
export type ManagementSnapshotChild = { readonly [issued]: true; close(): Promise<void> };
type CaptureInput = { handoff: HandoffPlan; expectedHandoffDigest: string; observer: HandoffObserver };
type DiagnosticStage = "created" | "capture-checks" | "child-execution" | "child-settled" |
  "output-validation" | "resource-close" | "resources-closed" | "capture-returned" | "refused";
const childRefusalStages = ["module-load", "input", "source-files", "connection", "target", "source-snapshot", "native-close", "source-file-close"] as const;
type Diagnostic = { diagnosticOnly: true; stages: readonly { stage: DiagnosticStage; elapsedMs: number }[];
  execution?: { exitCode: number | null; refusalStage?: typeof childRefusalStages[number] } };
const children = new WeakMap<ManagementSnapshotChild, { observe(): Registration; capture(input: CaptureInput): Promise<FrozenSourceSnapshot>; diagnostic(): Diagnostic }>();

/** Process-local timing only, including after refusal. This does not observe
 * current resource identity or authorize capture, cleanup, handoff or replay. */
export function readManagementSnapshotChildDiagnostic(handle: ManagementSnapshotChild): Diagnostic {
  const child = children.get(handle); need(child, "NOT-ISSUED"); return child.diagnostic();
}

/** Only this actual owner can add its one predeclared management member. */
export function observeManagementSnapshotChild(handle: ManagementSnapshotChild): Registration {
  const child = children.get(handle); need(child, "NOT-ISSUED"); return child.observe();
}
export async function captureManagementSourceSnapshot(handle: ManagementSnapshotChild, input: CaptureInput) {
  const child = children.get(handle); need(child, "NOT-ISSUED"); return child.capture(input);
}

/** Explicit cleanup of an unknown CREATE, never START/resume/capture. The old
 * unscoped name is retained for the first failed attempt; later attempts use
 * their already-issued source owner ID. No name/prefix discovery is admitted.
 */
export async function reconcileUnstartedManagementSnapshotChild(input: {
  journal: UpgradeJournal; lock: HostOperationLock; expectedDaemonId: string; ownerRunId?: string;
}): Promise<{ outcome: "removed-unknown-origin" }> {
  const journal = input.journal, lock = input.lock, daemonId = input.expectedDaemonId, owner = input.ownerRunId;
  const original = canonicalJson(journal.record), directory = path.dirname(journal.journalPath);
  const prefix = owner === undefined ? "management-snapshot" : `management-snapshot-${owner}`;
  need(owner === undefined || /^[a-f0-9]{24}$/.test(owner), "RECONCILE-SELECTION");
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  let primary: Error | undefined;
  try {
    await assertHostOperationLockForJournal(lock, journal.journalPath);
    const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(dir);
    const directoryIdentity = fstatSync(dir.fd);
    need(directoryIdentity.isDirectory() && directoryIdentity.uid === process.getuid?.() && (directoryIdentity.mode & 0o777) === 0o700 && await realpath(directory) === directory, "PRIVATE-DIRECTORY");
    const filename = path.join(directory, `${prefix}-intent.json`);
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(file);
    const identity = fstatSync(file.fd);
    need(identity.isFile() && identity.nlink === 1 && identity.uid === process.getuid?.() && (identity.mode & 0o777) === 0o600 && identity.size <= 65536, "RECONCILE-INTENT");
    const bytes = Buffer.alloc(identity.size);
    need(readSync(file.fd, bytes, 0, bytes.length, 0) === bytes.length, "RECONCILE-INTENT");
    const intent = JSON.parse(bytes.toString()) as Json;
    need(intent.runId === journal.record.runId && /^[a-f0-9]{24}$/.test(intent.ownerRunId) &&
      (owner === undefined || intent.ownerRunId === owner) &&
      new RegExp(`^wiseeff-management-snapshot-${intent.ownerRunId}-[a-f0-9]{12}$`).test(intent.name) &&
      id(intent.networkId) && Array.isArray(intent.sourceIds) && intent.sourceIds.length === 7 &&
      new Set(intent.sourceIds).size === 7 && intent.sourceIds.every(id) &&
      intent.commandDigest === sha256Prefixed(canonicalJson(command)) && (intent.daemonId === undefined || intent.daemonId === daemonId), "RECONCILE-INTENT");
    const artifact = await reopenApplicationArtifactSelection({ journal, lock }), selected = await artifact.observe();
    need(selected.loadedImageId === intent.imageId && selected.receiptDigest === intent.artifactReceiptDigest, "RECONCILE-ARTIFACT");
    const docker = createIsolatedUpgradeDocker(); need(docker.daemonId === daemonId, "DAEMON-MISMATCH");
    const imageEnvironment = JSON.parse(docker.command(["image", "inspect", intent.imageId]).toString())[0].Config.Env;
    childEnvironment(imageEnvironment);
    const lookup = () => docker.command(["ps", "-a", "--no-trunc", "--filter", `name=^/${intent.name}$`, "--format", "{{.ID}}"])
      .toString().trim();
    const containerId = lookup(); need(id(containerId), "RECONCILE-IDENTITY");
    const verify = () => {
      const namedDirectory = lstatSync(directory), namedFile = lstatSync(filename), held = fstatSync(file.fd);
      need(namedDirectory.dev === directoryIdentity.dev && namedDirectory.ino === directoryIdentity.ino && !namedDirectory.isSymbolicLink() &&
        (namedDirectory.mode & 0o777) === 0o700 && namedFile.dev === identity.dev && namedFile.ino === identity.ino &&
        held.dev === identity.dev && held.ino === identity.ino && held.nlink === 1 && held.size === identity.size &&
        (held.mode & 0o777) === 0o600 && held.mtimeMs === identity.mtimeMs && held.ctimeMs === identity.ctimeMs, "RECONCILE-INTENT-CHANGED");
      const current = Buffer.alloc(bytes.length); need(readSync(file.fd, current, 0, current.length, 0) === current.length && current.equals(bytes), "RECONCILE-INTENT-CHANGED");
      const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId: journal.record.runId, requireSettled: true });
      need(loaded.ok && canonicalJson(loaded.value.record) === original && lookup() === containerId, "RECONCILE-BOUNDARY-CHANGED");
      const c = JSON.parse(docker.command(["inspect", containerId]).toString())[0];
      need(c.Id === containerId, "RECONCILE-IDENTITY"); assertContainerShape(c, intent, imageEnvironment);
      need(c.State.Status === "created" && !c.State.Running && !c.State.Restarting && !c.State.OOMKilled && !c.State.Error &&
        c.State.StartedAt === "0001-01-01T00:00:00Z" && Object.keys(c.NetworkSettings.Networks).length === 1 &&
        Object.values(c.NetworkSettings.Networks).every((n: any) => !n.NetworkID), "RECONCILE-NOT-UNSTARTED");
    };
    verify();
    const receipt = await open(path.join(directory, `${prefix}-cleanup-observation.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(receipt);
    await receipt.writeFile(canonicalJson({ containerId, daemonId, intentDigest: sha256Prefixed(bytes.toString()), createOutcome: "unknown-origin" }));
    await receipt.sync(); await dir.sync();
    await assertHostOperationLockForJournal(lock, journal.journalPath); verify();
    docker.command(["rm", containerId]); need(lookup() === "", "RECONCILE-REMOVE-UNKNOWN");
    const result = await open(path.join(directory, `${prefix}-cleanup-result.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(result);
    await result.writeFile(canonicalJson({ containerId, outcome: "removed-unknown-origin" })); await result.sync(); await dir.sync();
    await assertHostOperationLockForJournal(lock, journal.journalPath);
    return { outcome: "removed-unknown-origin" };
  } catch (error) { primary = safe(error); throw primary; }
  finally {
    const ended = await Promise.allSettled(handles.map(handle => handle.close()));
    if (ended.some(result => result.status === "rejected")) throw new AggregateError(
      [...(primary ? [primary] : []), new SnapshotChildError("RECONCILE-CLOSE-UNKNOWN")], "PCAT-MANAGEMENT-SNAPSHOT-RECONCILE-CLEANUP-UNKNOWN");
  }
}

/** Read-only, internal-network child. No runtime admission or migration effects.
 * The host retains journal/config/lock custody; no host path is mounted inside.
 */
type PreparationInput = {
  journal: UpgradeJournal; lock: HostOperationLock; source: HandoffInputs["source"];
  registeredSourceContainerIds: readonly string[];
};
export async function prepareManagementSnapshotChild(offered: PreparationInput): Promise<ManagementSnapshotChild> {
  try { return await prepare(offered); } catch (error) { throw safe(error); }
}
async function prepare(offered: PreparationInput): Promise<ManagementSnapshotChild> {
  const began = performance.now();
  const stages: Array<{ stage: DiagnosticStage; elapsedMs: number }> = [];
  let executionDiagnostic: Diagnostic["execution"];
  const mark = (stage: DiagnosticStage) => { stages.push({ stage, elapsedMs: Math.round(performance.now() - began) }); };
  const journal = offered.journal, lock = offered.lock, source = structuredClone(offered.source);
  const sourceIds = [...offered.registeredSourceContainerIds], runId = journal.record.runId;
  need(sourceIds.length === 7 && new Set(sourceIds).size === 7 && sourceIds.every(id) &&
    /^[a-f0-9]{40}$/.test(source.sha) && [...source.applications, ...source.stores].every(s => sourceIds.includes(s.containerId)), "SOURCE-REGISTRATION");
  await assertHostOperationLockForJournal(lock, journal.journalPath);
  const original = canonicalJson(journal.record);
  const artifact = await reopenApplicationArtifactSelection({ journal, lock });
  const selected = await artifact.observe();
  const docker = createIsolatedUpgradeDocker();
  const imageConfiguration = JSON.parse(docker.command(["image", "inspect", selected.loadedImageId]).toString())[0]?.Config;
  need(imageConfiguration && !imageConfiguration.OnBuild?.length, "IMAGE-CONFIGURATION");
  childEnvironment(imageConfiguration.Env);
  const controller = { sha: git(root, ["rev-parse", "HEAD"]).toString().trim(), tree: git(root, ["rev-parse", "HEAD^{tree}"]).toString().trim() };
  need(git(root, ["status", "--porcelain", "--untracked-files=no"]).length === 0, "CONTROLLER-DIRTY");
  const implementation = "ops/self-hosted/scripts/parameter-catalog-upgrade/managementSnapshotChild.ts";
  need(git(root, ["show", `${controller.sha}:${implementation}`]).equals(await readFile(path.join(root, implementation))), "CONTROLLER-CODE-CHANGED");
  need(await realpath(source.checkout) === source.checkout && git(source.checkout, ["rev-parse", "HEAD"]).toString().trim() === source.sha, "SOURCE-CHECKOUT");
  const files = git(source.checkout, ["ls-tree", "-rz", "--full-tree", source.sha, "--", "server/migrations/"]).toString().split("\0").filter(Boolean).map(line => {
    const match = /^100644 blob [a-f0-9]{40}\tserver\/migrations\/([A-Za-z0-9_-]+\.sql)$/.exec(line);
    need(match, "SOURCE-MIGRATION-FILE");
    return { name: match[1]!, bytes: git(source.checkout, ["show", `${source.sha}:server/migrations/${match[1]}`]).toString("base64") };
  });
  need(files.length > 0, "SOURCE-MIGRATIONS-EMPTY");
  const observed = JSON.parse(docker.command(["inspect", ...sourceIds]).toString()) as Json[];
  const ownerRunId = observed[0]?.Config.Labels?.["wiseeff.controlled-recovery-run"];
  need(typeof ownerRunId === "string" && /^[a-f0-9]{24}$/.test(ownerRunId) && observed.length === 7 &&
    new Set(observed.map(c => c.Id)).size === 7 &&
    observed.every(c => sourceIds.includes(c.Id) && c.Config.Labels?.["wiseeff.controlled-recovery-run"] === ownerRunId), "SOURCE-IDENTITY");
  const pgId = source.stores.find(s => s.service === "postgres")?.containerId;
  const pgInfo = observed.find(c => c.Id === pgId);
  need(pgInfo && Object.keys(pgInfo.NetworkSettings.Networks).length === 1, "SOURCE-NETWORK");
  const pgNetwork = Object.values(pgInfo.NetworkSettings.Networks)[0] as Json;
  const networkId = pgNetwork.NetworkID;
  need(id(networkId) && isIP(pgNetwork.IPAddress) === 4, "SOURCE-NETWORK");
  const name = `wiseeff-management-snapshot-${ownerRunId}-${randomBytes(6).toString("hex")}`;
  const intent = { runId, ownerRunId, daemonId: docker.daemonId, name, sourceIds, networkId, imageId: selected.loadedImageId, artifactReceiptDigest: selected.receiptDigest,
    controller, commandDigest: sha256Prefixed(canonicalJson(command)), sourceSha: source.sha, sourceFilesDigest: sha256Prefixed(canonicalJson(files)) };
  const directory = path.dirname(journal.journalPath);
  const directoryFd = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const directoryIdentity = await (async () => { try {
    const identity = await directoryFd.stat();
    need(identity.isDirectory() && identity.uid === process.getuid?.() && (identity.mode & 0o777) === 0o700 &&
      await realpath(directory) === directory, "PRIVATE-DIRECTORY");
    return identity;
  } catch (error) { await directoryFd.close(); throw error; } })();
  let directoryClosed = false;
  const checkDirectory = async () => {
    need(!directoryClosed, "DIRECTORY-CLOSED");
    const named = await lstat(directory), held = await directoryFd.stat();
    need(named.isDirectory() && !named.isSymbolicLink() && named.dev === directoryIdentity.dev && named.ino === directoryIdentity.ino &&
      held.dev === named.dev && held.ino === named.ino && named.uid === process.getuid?.() && (named.mode & 0o777) === 0o700 &&
      await realpath(directory) === directory, "DIRECTORY-CHANGED");
  };
  const record = async (suffix: string, value: unknown) => {
    await checkDirectory();
    // The source resource owner is the already-issued attempt identity. Reusing
    // that same attempt refuses EXCL; a later explicitly selected source keeps
    // every earlier failed attempt rather than overwriting its evidence.
    const fd = await open(path.join(directory, `management-snapshot-${ownerRunId}-${suffix}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await fd.writeFile(canonicalJson(value)); await fd.sync(); } finally { await fd.close(); }
    await directoryFd.sync(); await checkDirectory();
  };
  let containerId = "", started = false, ended = false, closed = false, failed = false;
  let childProcess: ChildProcess | undefined, closing: Promise<void> | undefined;
  let closeRequested = false, cleanup: Promise<void> | undefined, cancelExecution: (() => void) | undefined;
  let execution: Promise<FrozenSourceSnapshot> | undefined;
  const network = () => {
    const actual = JSON.parse(docker.command(["network", "inspect", networkId]).toString())[0];
    need(actual.Id === networkId && actual.Driver === "bridge" && actual.Internal === true &&
      actual.Options?.["com.docker.network.bridge.enable_ip_masquerade"] === "false" &&
      actual.Labels?.["wiseeff.controlled-recovery-run"] === ownerRunId &&
      Object.keys(actual.Containers ?? {}).every(c => sourceIds.includes(c) || c === containerId), "NETWORK-CHANGED");
    const declared = docker.command(["ps", "-a", "--no-trunc", "--filter", `network=${networkId}`, "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    need(declared.every(c => sourceIds.includes(c) || c === containerId), "NETWORK-CONSUMER");
  };
  const inspect = () => {
    need(id(containerId), "CONTAINER-UNAVAILABLE");
    const c = JSON.parse(docker.command(["inspect", containerId]).toString())[0];
    need(c.Id === containerId, "CONTAINER-CHANGED");
    assertContainerShape(c, intent, imageConfiguration.Env);
    const nets = Object.values(c.NetworkSettings.Networks) as Json[];
    need(nets.length === 1 && (nets[0]!.NetworkID === networkId || !started && !c.State.Running && !nets[0]!.NetworkID), "CONTAINER-NETWORK");
    return c;
  };
  const current = async () => {
    need(!closeRequested, "CLOSING");
    await checkDirectory();
    const loaded = loadUpgradeJournal({ journalPath: journal.journalPath, runId, requireSettled: true });
    need(loaded.ok && canonicalJson(loaded.value.record) === original, "JOURNAL-CHANGED");
    need(canonicalJson(await artifact.observe()) === canonicalJson(selected), "ARTIFACT-CHANGED");
    await assertHostOperationLockForJournal(lock, journal.journalPath);
    need(!closeRequested, "CLOSING");
    network();
  };
  const closeResources = () => cleanup ??= (async () => {
    mark("resource-close");
    const failures: unknown[] = [];
    if (containerId) {
      try {
        const c = inspect();
        if (c.State.Running) { docker.command(["stop", "--time", "2", containerId]); need(!inspect().State.Running, "STOP-UNKNOWN"); }
        docker.command(["rm", containerId]);
        need(docker.command(["ps", "-a", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])
          .toString().trim() === "", "CLEANUP-UNKNOWN");
      } catch { failures.push(new SnapshotChildError("CLEANUP-UNKNOWN")); }
    }
    try { await directoryFd.close(); directoryClosed = true; } catch { failures.push(new SnapshotChildError("DIRECTORY-CLOSE-UNKNOWN")); }
    if (failures.length) throw new AggregateError(failures, "PCAT-MANAGEMENT-SNAPSHOT-CLEANUP-UNKNOWN");
    closed = true;
    mark("resources-closed");
  })();
  const close = () => {
    closeRequested = true;
    cancelExecution?.();
    return closing ??= (async () => {
      if (execution) await execution.catch(() => undefined);
      await closeResources();
    })();
  };
  try {
    await current();
    need(docker.command(["ps", "-a", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])
      .toString().trim() === "", "NAME-IN-USE");
    await record("intent", intent);
    await current();
    // Last asynchronous check before the concrete create effect.
    await assertHostOperationLockForJournal(lock, journal.journalPath); network();
    try { containerId = docker.command(["create", "--name", name, "--interactive", "--network", networkId, "--read-only",
      "--tmpfs", "/private:rw,noexec,nosuid,size=33554432,mode=0700", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--env", "TMPDIR=/private",
      "--restart", "no", "--workdir", "/app", "--label", `wiseeff.controlled-recovery-run=${ownerRunId}`,
      "--label", `wiseeff.management-snapshot-intent=${sha256Prefixed(canonicalJson(intent))}`,
      "--entrypoint", "node", selected.loadedImageId, ...command]).toString().trim(); }
    catch (error) {
      // Exact predeclared name only; never enumerate or adopt a foreign member.
      const possible = docker.command(["ps", "-a", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])
        .toString().trim();
      if (id(possible)) { containerId = possible; inspect(); await record("container", { containerId, createOutcome: "unknown" }); }
      throw error;
    }
    need(id(containerId), "CREATE-ACK-INVALID");
    await record("container", { containerId, createOutcome: "acknowledged" });
    const created = inspect(); need(created.State.Status === "created" && !created.State.Running, "NOT-CREATED");
    mark("created");
    const handle = Object.freeze({ close }) as ManagementSnapshotChild;
    const observe = (): Registration => {
      need(!failed, "CHILD-UNAVAILABLE"); network();
      if (closed) {
        need(docker.command(["ps", "-a", "--no-trunc", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])
          .toString().trim() === "", "REMOVED-CHILD-PRESENT");
        return { containerId, imageId: selected.loadedImageId, networkId, sourceIds: [...sourceIds], state: "removed" };
      }
      const c = inspect();
      need(!c.State.Restarting && !c.State.OOMKilled && !c.State.Error &&
        (!started ? c.State.Status === "created" : c.State.Running || c.State.Status === "exited" && c.State.ExitCode === 0), "CHILD-STATE");
      return { containerId, imageId: selected.loadedImageId, networkId, sourceIds: [...sourceIds],
        state: c.State.Running ? "running" : c.State.Status === "created" ? "created" : "exited" };
    };
    const capture = (input: CaptureInput) => execution ??= (async () => {
      const handoff = structuredClone(input.handoff), digest = input.expectedHandoffDigest, observer = input.observer;
      let config: Awaited<ReturnType<typeof openHandoffRuntimeConfigurationLease>> | undefined;
      let checking: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined;
      let stop: (() => void) | undefined;
      let primary: Error | undefined;
      try {
        mark("capture-checks");
        need(handoff.inputs.runId === runId && handoff.inputs.journalPath === journal.journalPath &&
          canonicalJson(handoff.inputs.source) === canonicalJson(source) && handoff.inputs.candidate.imageId === selected.loadedImageId,
        "HANDOFF-MISMATCH");
        config = await openHandoffRuntimeConfigurationLease(handoff, digest, lock);
        need(!closeRequested, "CLOSING");
        const env = await config.read();
        need(!closeRequested, "CLOSING");
        const url = new URL(env.management.DATABASE_URL!);
        need(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash && (url.port || "5432") === "5432" &&
          url.username && url.password && /^\/[A-Za-z0-9_-]+$/.test(url.pathname) && !/[\r\n\0]/.test(decodeURIComponent(url.password)), "PRIVATE-CONFIG");
        need(pgNetwork.Aliases?.includes(url.hostname) || pgInfo.Config.Hostname === url.hostname, "CONFIGURATION-ENDPOINT");
        const check = async () => {
          await current();
          need(canonicalJson(await config!.read()) === canonicalJson(env), "CONFIG-CHANGED");
          need(canonicalJson(await verifyStoppedHandoff(handoff, digest, observer, lock)) === canonicalJson(handoff.observation), "SOURCE-CHANGED");
          const actualPg = JSON.parse(docker.command(["inspect", pgId!]).toString())[0];
          need(actualPg.Id === pgId && actualPg.Image === pgInfo.Image && actualPg.State.Running &&
            canonicalJson(actualPg.Mounts) === canonicalJson(pgInfo.Mounts) &&
            Object.values(actualPg.NetworkSettings.Networks).some((n: any) => n.NetworkID === networkId && n.IPAddress === pgNetwork.IPAddress), "PG-CHANGED");
          observe(); await assertHostOperationLockForJournal(lock, journal.journalPath);
        };
        await check();
        const query = "select pg_catalog.json_build_object('systemIdentifier',s.system_identifier::text,'databaseOid',d.oid::text) from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database()";
        const target = JSON.parse(docker.command(["exec", "-i", pgId!, "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "sh", "-c",
          'IFS= read -r PGPASSWORD || exit 1; export PGPASSWORD; exec psql -X -w -h 127.0.0.1 -U "$1" -d "$2" -At -c "$3"',
          "management-target", decodeURIComponent(url.username), url.pathname.slice(1), query], Buffer.from(decodeURIComponent(url.password) + "\n")).toString());
        need(/^[0-9]+$/.test(target.systemIdentifier) && /^[1-9][0-9]*$/.test(target.databaseOid), "TARGET-UNAVAILABLE");
        const payload = Buffer.from(JSON.stringify({ host: pgNetwork.IPAddress, port: 5432, user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password), database: url.pathname.slice(1), target, files }));
        need(payload.length <= 16 * 1024 * 1024 && !/[\r\n\0]/.test(decodeURIComponent(url.password)), "INPUT-UNSUPPORTED");
        await check();
        await assertHostOperationLockForJournal(lock, journal.journalPath); need(!closeRequested, "CLOSING"); inspect(); network();
        mark("child-execution");
        childProcess = spawn("docker", ["--host", docker.endpoint, "start", "--attach", "--interactive", containerId],
          { env: { PATH: environment().PATH, HOME: environment().HOME }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
        started = true;
        const supervisor = superviseComponentProcess(childProcess, { deadlineMs: 30000, graceMs: 2000, outputBytes: 8 * 1024 * 1024 });
        stop = supervisor.stop; cancelExecution = supervisor.stop;
        childProcess.stdin!.on("error", () => { failed = true; supervisor.stop(); });
        childProcess.stdin!.end(payload);
        const scheduleCheck = () => {
          if (ended || failed || checking) return;
          checking = check().catch(() => { failed = true; supervisor.stop(); }).finally(() => { checking = undefined; });
        };
        timer = setInterval(scheduleCheck, 250);
        const outcome = await supervisor.wait; mark("child-settled");
        executionDiagnostic = { exitCode: Number.isSafeInteger(outcome.exitCode) ? outcome.exitCode : null };
        const refusalStage = childRefusalStages.find(stage => outcome.output === `management-snapshot-child-failed:${stage}`);
        if (refusalStage) executionDiagnostic.refusalStage = refusalStage;
        ended = true; clearInterval(timer); await checking;
        need(!failed && outcome.exitCode === 0, "EXECUTION-UNKNOWN");
        const final = inspect(); need(final.State.Status === "exited" && final.State.ExitCode === 0 && !final.State.OOMKilled && !final.State.Error, "EXIT-UNKNOWN");
        mark("output-validation");
        const parsed = snapshotSchema.safeParse(JSON.parse(outcome.output));
        need(parsed.success, "OUTPUT-INVALID");
        const result = parsed.data;
        const { digest: resultDigest, ...body } = result;
        need(resultDigest === sha256Prefixed(canonicalJson(body)) && canonicalJson(result.target) === canonicalJson(target), "OUTPUT-INVALID");
        await check();
        await config.close(); config = undefined;
        await closeResources();
        await assertHostOperationLockForJournal(lock, journal.journalPath); need(!closeRequested, "CLOSING"); observe(); network();
        mark("capture-returned");
        return structuredClone(result);
      } catch (error) { mark("refused"); failed = true; stop?.(); primary = safe(error); throw primary; }
      finally {
        if (timer) clearInterval(timer);
        await checking?.catch(() => undefined);
        const cleanup = await Promise.allSettled([
          Promise.resolve().then(() => config?.close()),
          Promise.resolve().then(() => { if (failed && containerId) {
            const actual = inspect(); if (actual.State.Running) docker.command(["stop", "--time", "2", containerId]);
            need(!inspect().State.Running, "STOP-UNKNOWN");
          } }),
        ]);
        if (cleanup.some(result => result.status === "rejected")) throw new AggregateError(
          [...(primary ? [primary] : []), new SnapshotChildError("EXECUTION-CLEANUP-UNKNOWN")], "PCAT-MANAGEMENT-SNAPSHOT-CLEANUP-UNKNOWN");
      }
    })();
    children.set(handle, { observe, capture, diagnostic: () => ({ diagnosticOnly: true, stages: structuredClone(stages),
      ...(executionDiagnostic ? { execution: structuredClone(executionDiagnostic) } : {}) }) }); return handle;
  } catch (error) {
    try { await close(); }
    catch { throw new AggregateError([safe(error), new SnapshotChildError("PREPARE-CLEANUP-UNKNOWN")], "PCAT-MANAGEMENT-SNAPSHOT-PREPARE-AND-CLEANUP-UNKNOWN"); }
    throw safe(error);
  }
}
