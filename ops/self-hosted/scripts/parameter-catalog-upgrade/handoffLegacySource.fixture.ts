import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createOwnedHandoffDataObserver } from "./handoffDataSource";
import type { HandoffInputs } from "./handoff";
import { observeManagementSnapshotChild, type ManagementSnapshotChild } from "./managementSnapshotChild";

const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
const sourceTree = "6dd92c36c4eb41bcaaba5a7a756befb9239d9120";
const imageId = "sha256:a7c1fd128b60ea545d483b285ab88d349de26a491d1e6a826a413a075cd4737d";
const imageReference = "wiseeff-upg-old-82344044:wiseeff-upg-old-image.xinib2o1";
const services = ["api", "worker", "web", "postgres", "minio", "redis", "mc"] as const;
const storeImages = { postgres: "postgres:16-alpine", redis: "redis:7-alpine", minio: "minio/minio:RELEASE.2024-12-18T13-15-44Z", mc: "minio/mc:RELEASE.2024-11-21T17-21-54Z" };
type Service = typeof services[number];
type Json = Record<string, any>;
class SourceFailure extends Error {}
class SourceCleanupFailure extends AggregateError {}
function safeFailure(error: unknown, stage: string) {
  return error instanceof SourceFailure || error instanceof SourceCleanupFailure ? error : new SourceFailure(`legacy-source-${stage}-failed`);
}
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new SourceFailure(`legacy-source-${code}`); }
function object(value: unknown): Json { requireValue(value && typeof value === "object" && !Array.isArray(value), "response-invalid"); return value; }
// Test preparation only: custody keeps its original Git repository; handoff
// receives a separate clean checkout of the already selected commit.
export async function prepareLegacyCandidateCheckout(input: { repository: string; sha: string; tree: string; privateRoot: string }) {
  requireValue(/^[a-f0-9]{40}$/.test(input.sha) && /^[a-f0-9]{40}$/.test(input.tree), "candidate-identity-invalid");
  const root = await realpath(input.privateRoot).catch(() => { throw new SourceFailure("legacy-source-candidate-root-unavailable"); });
  const directory = await mkdtemp(path.join(root, "candidate-checkout-"));
  const identity = await lstat(directory), checkout = path.join(directory, "repository");
  const close = async () => {
    const current = await lstat(directory);
    requireValue(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino,
      "candidate-cleanup-identity-changed");
    await rm(directory, { recursive: true });
  };
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
      encoding: "utf8", timeout: 30000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    requireValue(result.status === 0, "candidate-checkout-command-failed");
    return result.stdout.trim();
  };
  try {
    git("clone", "--no-local", "--no-checkout", "--template=", "--quiet", "--", await realpath(input.repository), checkout);
    git("-C", checkout, "checkout", "--quiet", "--detach", input.sha);
    requireValue(git("-C", checkout, "rev-parse", "HEAD") === input.sha
      && git("-C", checkout, "rev-parse", "HEAD^{tree}") === input.tree
      && git("-C", checkout, "status", "--porcelain") === "", "candidate-checkout-mismatch");
    return { checkout, close };
  } catch (error) {
    const primary = safeFailure(error, "candidate-checkout");
    try { await close(); } catch { throw new SourceCleanupFailure([primary, new SourceFailure("legacy-source-candidate-cleanup-failed")], "legacy-source-candidate-and-cleanup-failed"); }
    throw primary;
  }
}
const HTTP = `import{readFileSync}from'node:fs';const p=JSON.parse(readFileSync(0,'utf8'));try{const r=await fetch('http://127.0.0.1:'+p.port+p.path,{method:p.method,headers:{'content-type':'application/json',...(p.token?{authorization:'Bearer '+p.token}:{})},...(p.body===undefined?{}:{body:JSON.stringify(p.body)}),signal:AbortSignal.timeout(5000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}process.stdout.write(JSON.stringify({status:r.status,body}));}catch{process.stderr.write('legacy-http-unavailable');process.exitCode=1}`;
const BOOTSTRAP = `import{readFileSync}from'node:fs';import{createPostgresDatabase}from'./server/shared/database/client.ts';import{bootstrapLocalAdmin}from'./server/modules/auth/bootstrapLocalAdmin.ts';const p=JSON.parse(readFileSync(0,'utf8'));const db=createPostgresDatabase(process.env.DATABASE_URL);try{const result=await bootstrapLocalAdmin(db,p);process.stdout.write(JSON.stringify(result));}catch{process.stderr.write('legacy-bootstrap-failed');process.exitCode=1}finally{await db.close()}`;
// Failure-only observation of the original upload's durable rows and the
// installed queue library's pure option validator. No enqueue/retry is issued.
const LOG_UPLOAD_DIAGNOSTIC = `import{readFileSync}from'node:fs';import{Job}from'bullmq';import{createPostgresDatabase}from'./server/shared/database/client.ts';const p=JSON.parse(readFileSync(0,'utf8'));const db=createPostgresDatabase(process.env.DATABASE_URL);try{const result=await db.transaction(async tx=>{await tx.query('set transaction read only');const files=await tx.query('select count(*)::int as count from log_file_objects where organization_id=$1',[p.organizationId]);const logs=await tx.query('select count(*)::int as count from log_records where organization_id=$1',[p.organizationId]);const jobs=await tx.query("select id from jobs where organization_id=$1 and kind='log-analysis'",[p.organizationId]);let nativeJobIdRejected=false;for(const row of jobs.rows){try{Job.prototype.validateOptions.call({opts:{jobId:'log-analysis:'+row.id},name:'analyze-log'},{data:'{}'})}catch(e){if(e instanceof Error&&e.message==='Custom Id cannot contain :')nativeJobIdRejected=true;else throw e}}return{fileCount:files.rows[0].count,logCount:logs.rows[0].count,jobCount:jobs.rows.length,nativeJobIdRejected}});process.stdout.write(JSON.stringify(result));}catch{process.stderr.write('legacy-upload-diagnostic-unavailable');process.exitCode=1}finally{await db.close()}`;
// Explicit synthetic producer for the fixed old application's observed colon-ID
// defect. It consumes exactly the actual HTTP-created row, never creates or
// edits business state, never retries unknown delivery, and never claims that
// the old HTTP producer succeeded. The original production worker consumes it.
const NATIVE_TEST_PRODUCER = `
import {readFileSync} from 'node:fs';
import {Job,Queue} from 'bullmq';
import {createPostgresDatabase} from './server/shared/database/client.ts';
const p=JSON.parse(readFileSync(0,'utf8'));
let db,queue,queueFailed=false;
try {
  db=createPostgresDatabase(process.env.DATABASE_URL);
  const row=await db.transaction(async tx=>{
    await tx.query('set transaction read only');
    const result=await tx.query(
      "select j.id as job_id, lr.id as log_id, lar.id as run_id, j.status from jobs j join log_analysis_runs lar on lar.id=j.target_id join log_records lr on lr.id=lar.log_record_id join log_file_objects f on f.id=lr.file_object_id where j.organization_id=$1 and lr.organization_id=$1 and lar.organization_id=$1 and f.organization_id=$1 and j.kind='log-analysis' and j.target_type='log-analysis-run' and lr.current_run_id=lar.id and lr.submitted_by_user_id=$2 and f.uploaded_by_user_id=$2 and f.file_name=$3 and f.checksum_sha256=$4",
      [p.organizationId,p.userId,p.fileName,p.checksum]);
    if(result.rows.length!==1||result.rows[0].status!=='queued')throw new Error();
    return result.rows[0];
  });
  let rejected=false;
  try {Job.prototype.validateOptions.call({opts:{jobId:'log-analysis:'+row.job_id},name:'analyze-log'},{data:'{}'})}
  catch(e){if(e instanceof Error&&e.message==='Custom Id cannot contain :')rejected=true;else throw e}
  if(!rejected)throw new Error();
  queue=new Queue('log-analysis',{connection:{url:process.env.REDIS_URL},prefix:process.env.LOG_ANALYSIS_QUEUE_PREFIX});
  queue.on('error',()=>{queueFailed=true});
  const fixedId='owned-legacy-'+row.job_id;
  const existing=await queue.getJobs(['wait','active','delayed','completed','failed','paused','waiting-children','prioritized'],0,-1);
  if(existing.length||await queue.getJob('log-analysis:'+row.job_id)||await queue.getJob(fixedId)||queueFailed)throw new Error();
  const payload={organizationId:p.organizationId,logId:row.log_id,runId:row.run_id,jobId:row.job_id};
  const added=await queue.add('analyze-log',payload,{jobId:fixedId,attempts:1,removeOnComplete:false,removeOnFail:false});
  if(queueFailed)throw new Error();
  const actual=await queue.getJob(fixedId);
  if(queueFailed||added.id!==fixedId||!actual||Object.keys(payload).some(key=>actual.data[key]!==payload[key]))throw new Error();
  process.stdout.write(JSON.stringify({logId:row.log_id,jobId:row.job_id,producer:'native-test-only'}));
}catch{process.stderr.write('legacy-native-test-producer-failed');process.exitCode=1}
finally{
  const closed=await Promise.allSettled([Promise.resolve().then(()=>queue?.close()),Promise.resolve().then(()=>db?.close())]);
  if(queueFailed||closed.some(item=>item.status==='rejected')){process.stderr.write('legacy-native-test-producer-close-failed');process.exitCode=1}
}`;
const PAUSE_SOURCE_QUEUE = `import{Queue}from'bullmq';let queue,lost=false;try{queue=new Queue('log-analysis',{connection:{url:process.env.REDIS_URL},prefix:process.env.LOG_ANALYSIS_QUEUE_PREFIX});queue.on('error',()=>{lost=true});await queue.pause();const end=Date.now()+8000;let active=await queue.getActiveCount();while(active>0&&Date.now()<end&&!lost){await new Promise(resolve=>setTimeout(resolve,200));active=await queue.getActiveCount()}if(lost||active!==0||!await queue.isPaused())throw new Error();process.stdout.write(JSON.stringify({paused:true,active:0}));}catch{process.stderr.write('legacy-source-queue-pause-failed');process.exitCode=1}finally{try{await queue?.close();if(lost)throw new Error()}catch{process.stderr.write('legacy-source-queue-close-failed');process.exitCode=1}}`;
/** Test-fixture scheduling seam, also used by the real owned fixture below.
 * This does not issue a handoff or any production admission evidence. */
export function createLegacySourceApplicationStop(options: {
  verify: () => Promise<void>;
  pause: () => Promise<{ paused: boolean; active: number }>;
  own: (service: "worker" | "api" | "web") => Json;
  stop: (service: "worker" | "api" | "web") => void;
  recordStopped: (service: "worker" | "api" | "web") => void;
}) {
  let operation: Promise<void> | undefined;
  return () => operation ??= Promise.resolve().then(async () => {
    try {
      await options.verify();
      const paused = await options.pause();
      requireValue(paused.paused === true && paused.active === 0, "queue-not-drained");
      await options.verify();
      for (const service of ["worker", "api", "web"] as const) {
        const before = options.own(service);
        requireValue(before.State.Running && !before.State.Restarting, "application-before-stop-changed");
        options.stop(service);
        const actual = options.own(service);
        // The fixed old Vite preview exits with 128 + SIGTERM (143), as
        // observed in ad401. This is signal termination, not an application
        // graceful-shutdown acknowledgment. API/worker must still exit zero.
        const webTerminated = service === "web" && actual.State.ExitCode === 143 &&
          (!actual.Config.StopSignal || actual.Config.StopSignal === "SIGTERM") &&
          actual.Config.StopSignal === before.Config.StopSignal && actual.Id === before.Id &&
          actual.State.StartedAt === before.State.StartedAt &&
          Number.isFinite(Date.parse(before.State.StartedAt)) &&
          Date.parse(actual.State.FinishedAt) > Date.parse(before.State.StartedAt) &&
          actual.State.FinishedAt !== before.State.FinishedAt;
        const stoppedConfirmed = actual.State.Status === "exited" && !actual.State.Running && !actual.State.Restarting &&
          !actual.State.OOMKilled && (actual.State.ExitCode === 0 || webTerminated) && !actual.State.Error;
        if (!stoppedConfirmed || webTerminated) console.error(JSON.stringify({ evidence: "legacy-source-stop-outcome", service,
          exited: actual.State.Status === "exited", exitCode: Number.isInteger(actual.State.ExitCode) ? actual.State.ExitCode : null,
          oomKilled: actual.State.OOMKilled === true, stopSignal: !actual.Config.StopSignal ? "default-sigterm" : actual.Config.StopSignal === "SIGTERM" ? "sigterm" : "other" }));
        requireValue(stoppedConfirmed, "application-stop-not-confirmed");
        options.recordStopped(service);
        await options.verify();
      }
    } catch (error) { throw safeFailure(error, "stop"); }
  });
}
// The old HTTP surface has no direct binding/config-revision creation route.
// Use its existing domain owners, inside its fixed image, for this explicitly
// synthetic legacy revision graph. No canonical/registry/checkpoint SQL lives here.
const BINDINGS = `import{readFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{createPostgresDatabase}from'./server/shared/database/client.ts';import{createOrReuseBinding,upsertBindingRevisionValues}from'./server/modules/parameter-topology/bindingService.ts';import{insertConfigRevision}from'./server/modules/parameter-topology/repository.ts';const p=JSON.parse(readFileSync(0,'utf8'));const db=createPostgresDatabase(process.env.DATABASE_URL);try{const binding=await db.transaction(tx=>createOrReuseBinding(tx,{organizationId:p.organizationId,key:{projectId:p.projectId,logicalNodeId:null,parameterSpecId:p.specId,moduleId:p.moduleId}}));for(const [index,value]of[42,43].entries()){await db.transaction(async tx=>{const id=randomUUID();await insertConfigRevision(tx,{id,organizationId:p.organizationId,projectId:p.projectId,configSetId:p.configSetId,revisionNumber:index+1,status:'resolved',createdByUserId:p.userId});await upsertBindingRevisionValues(tx,{bindingId:binding.id,configRevisionId:id,parameterSpecVersionId:p.versionId,tenant:{organizationId:p.organizationId,projectId:p.projectId,configRevisionId:id},values:{typedValue:{kind:'cells',bits:32,groups:[[{kind:'integer',raw:String(value),value:String(value)}]]},rawValue:String(value),schemaState:'valid',policyState:'not_applicable'}})});}process.stdout.write(JSON.stringify({bindingId:binding.id}));}catch{process.stderr.write('legacy-binding-fixture-failed');process.exitCode=1}finally{await db.close()}`;

/** Owned test environment only. Runs the fixed old production entrypoints and
 * real local auth/DB/S3/BullMQ. Models are explicitly deterministic; devices
 * are the old staging simulator. No new application image or controller is
 * created. Root integration tests may reuse source/config/createObserver while
 * retaining responsibility for their real handoff, report and approval gates.
 */
export async function prepareLegacySourceFixture(offered: { expectedDaemonId: string; privateRoot: string }) {
  try { return await prepare(offered); }
  catch (error) { throw safeFailure(error, "preparation"); }
}
async function prepare(offered: { expectedDaemonId: string; privateRoot: string }) {
  const input = structuredClone(offered);
  requireValue(input && typeof input.expectedDaemonId === "string" && /^[a-zA-Z0-9-]+$/.test(input.expectedDaemonId) &&
    typeof input.privateRoot === "string" && path.isAbsolute(input.privateRoot), "input-invalid");
  const privateRoot = await realpath(input.privateRoot);
  const rootStat = await stat(privateRoot);
  requireValue(privateRoot === input.privateRoot && rootStat.isDirectory() && rootStat.uid === process.getuid?.() &&
    (rootStat.mode & 0o777) === 0o700, "private-root-invalid");
  assertOwnedUpgradeTestTarget();
  const docker = createIsolatedUpgradeDocker();
  requireValue(docker.daemonId === input.expectedDaemonId, "daemon-mismatch");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8", timeout: 10000 });
    requireValue(result.status === 0 && !result.error, "git-unavailable"); return result.stdout.trim();
  };
  requireValue(git("rev-parse", `${sourceSha}^{tree}`) === sourceTree, "source-tree-mismatch");
  const oldImage = JSON.parse(docker.command(["image", "inspect", imageId]).toString())[0];
  requireValue(oldImage.Id === imageId && oldImage.Config.Labels?.["org.opencontainers.image.revision"] === sourceSha &&
    oldImage.Config.Labels?.["org.wiseeff.build-tls-policy"] === "verify" &&
    JSON.parse(docker.command(["image", "inspect", imageReference]).toString())[0].Id === imageId, "old-image-mismatch");
  const directory = await mkdtemp(path.join(privateRoot, "source-"));
  const checkout = path.join(directory, "checkout");
  const ownerRunId = randomBytes(12).toString("hex");
  const ownerLabel = "wiseeff.controlled-recovery-run";
  const project = `legacy-${ownerRunId}`;
  const sourceImageReference = `${project}:${sourceSha}`;
  const composeFile = path.join(checkout, "ops/self-hosted/legacy-owned-fixture.json");
  const files = { api: path.join(directory, "api.env"), worker: path.join(directory, "worker.env"),
    management: path.join(directory, "management.env"), stores: path.join(directory, "stores.env") };
  const password = randomBytes(24).toString("hex");
  const account = { username: `owned-${randomBytes(6).toString("hex")}`, password: randomBytes(24).toString("hex"),
    name: "Owned Legacy Operator", organization: "Owned Legacy Organization" };
  const ids = {} as Record<Service, string>;
  const registered = new Map<Service, Json>();
  const imageIds = { api: imageId, worker: imageId, web: imageId } as Record<Service, string>;
  let worktree = false, composeAttempted = false, closed = false, imageAlias = false;
  let closing: Promise<void> | undefined;
  let networkId = "";
  const volumes = new Map<string, string>();
  const volumeIdentities = new Map<string, string>();
  let registeredNetwork: Json | undefined;
  let registrationFailed = false;
  let management: ManagementSnapshotChild | undefined;
  let stopping: Promise<void> | undefined, stopFailed = false;
  const stoppedApplications = new Set<Service>();
  const fileIdentities = new Map<string, string>();
  const fileIdentity = async (file: string) => {
    const before = await lstat(file); const bytes = await readFile(file); const after = await lstat(file);
    requireValue(before.isFile() && before.nlink === 1 && before.uid === process.getuid?.() && (before.mode & 0o777) === 0o600 &&
      before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
    "private-file-changed");
    return `${before.dev}:${before.ino}:${createHash("sha256").update(bytes).digest("hex")}`;
  };
  const compose = (...args: string[]) => docker.command(["compose", "-p", project, "-f", composeFile, ...args]);
  const mountScope = (info: Json, service: Service) => {
    const destination = service === "postgres" ? "/var/lib/postgresql/data" : ["minio", "redis"].includes(service) ? "/data" : undefined;
    const name = `${project}_${service === "postgres" ? "pg" : service === "minio" ? "objects" : "redis"}`;
    return destination ? info.Mounts.length === 1 && info.Mounts[0].Type === "volume" && info.Mounts[0].Name === name &&
      info.Mounts[0].Destination === destination : info.Mounts.length === 0;
  };
  const declaredContainer = (info: Json, service: Service) => info.Config.Labels?.["com.docker.compose.project"] === project &&
    info.Config.Labels?.[ownerLabel] === ownerRunId &&
    info.Config.Labels?.["com.docker.compose.service"] === service && info.Config.Labels?.["com.docker.compose.project.config_files"] === composeFile &&
    info.Config.Image === (["api", "worker", "web"].includes(service) ? sourceImageReference : storeImages[service as keyof typeof storeImages]) &&
    mountScope(info, service);
  const containerIdentity = (info: Json) => JSON.stringify([info.Id, info.Created, info.Image, info.Config.Image, info.Mounts]);
  // Called once, immediately after CREATE (including a partial CREATE failure),
  // never later to adopt a newly labelled resource. A wrong tag can produce a
  // stopped container; retain its exact ID for cleanup without executing it.
  const registerCreated = async () => {
    try {
      for (const service of services) {
        const matches = compose("ps", "-aq", service).toString().trim().split("\n").filter(Boolean);
        requireValue(matches.length <= 1, "duplicate-created-service");
        if (!matches.length) continue;
        const info = JSON.parse(docker.command(["inspect", matches[0]!]).toString())[0];
        requireValue(/^[a-f0-9]{64}$/.test(info.Id) && declaredContainer(info, service) && info.State.Status === "created" && !info.State.Running,
          "created-container-admission-failed");
        ids[service] = info.Id; registered.set(service, info);
      }
      for (const [logical, service] of [["pg", "postgres"], ["objects", "minio"], ["redis", "redis"]] as const) {
        const name = `${project}_${logical}`;
        const names = docker.command(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim().split("\n").filter(Boolean);
        if (!names.includes(name)) continue;
        const volume = JSON.parse(docker.command(["volume", "inspect", name]).toString())[0];
        requireValue(volume.Name === name && volume.Driver === "local" && !Object.keys(volume.Options ?? {}).length &&
          volume.Labels?.["com.docker.compose.project"] === project && volume.Labels?.[ownerLabel] === ownerRunId &&
          volume.Labels?.["com.docker.compose.volume"] === logical, "created-volume-admission-failed");
        volumes.set(name, ids[service] ?? "");
        volumeIdentities.set(name, JSON.stringify([volume.CreatedAt, volume.Mountpoint]));
      }
      const names = docker.command(["network", "ls", "--format", "{{.Name}}", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim().split("\n").filter(Boolean);
      if (names.includes(`${project}_default`)) {
        const net = JSON.parse(docker.command(["network", "inspect", `${project}_default`]).toString())[0];
        requireValue(net.Name === `${project}_default` && net.Driver === "bridge" && net.Internal === true &&
          net.Labels?.["com.docker.compose.project"] === project && net.Labels?.[ownerLabel] === ownerRunId &&
          net.Labels?.["com.docker.compose.network"] === "default", "created-network-admission-failed");
        networkId = net.Id; registeredNetwork = net;
      }
    } catch { registrationFailed = true; throw new SourceFailure("legacy-source-created-resource-admission-failed"); }
    finally {
      await writeFile(path.join(directory, "resources.json"), JSON.stringify({ project, ownerRunId, composeFile,
        containers: [...registered].map(([service, info]) => ({ service, id: info.Id, image: info.Image, created: info.Created, mounts: info.Mounts })),
        volumes: [...volumeIdentities], network: registeredNetwork && { id: networkId, name: registeredNetwork.Name, created: registeredNetwork.Created },
      }), { mode: 0o600 });
    }
  };
  const verifyContainer = (service: Service, info: Json) => {
    requireValue(!closed && !closing && ids[service], "lease-closed-or-unprepared");
    requireValue(info && info.Id === ids[service] && info.Image === imageIds[service] && declaredContainer(info, service) &&
      containerIdentity(info) === containerIdentity(registered.get(service)!) &&
      !info.HostConfig.Privileged && !["host"].includes(info.HostConfig.NetworkMode) && !info.HostConfig.PidMode &&
      !(info.HostConfig.Devices ?? []).length && !(info.HostConfig.DeviceRequests ?? []).length &&
      info.Mounts.every((m: Json) => m.Type === "volume"), "container-owner-mismatch");
    requireValue(!Object.keys(info.HostConfig.PortBindings ?? {}).length, "unexpected-published-port");
    return info;
  };
  const own = (service: Service) => {
    requireValue(!closed && !closing && ids[service], "lease-closed-or-unprepared");
    return verifyContainer(service, JSON.parse(docker.command(["inspect", ids[service]]).toString())[0]);
  };
  const verifyResources = async (started: ReadonlySet<Service>) => {
    requireValue(!closed && !closing && docker.daemonId === input.expectedDaemonId, "lease-closed-or-daemon-changed");
    for (const [file, expected] of fileIdentities) requireValue(await fileIdentity(file) === expected, "private-file-changed");
    const rows = JSON.parse(docker.command(["inspect", ...services.map(service => ids[service])]).toString()) as Json[];
    requireValue(Array.isArray(rows) && rows.length === services.length && new Set(rows.map(row => row?.Id)).size === services.length &&
      rows.every(row => row && services.some(service => ids[service] === row.Id)), "container-batch-mismatch");
    const actual = services.map(service => verifyContainer(service, rows.find(row => row.Id === ids[service])!));
    const stateMatches = actual.every((c, index) => {
      const running = started.has(services[index]!);
      const declared = Object.entries(c.NetworkSettings.Networks);
      const endpoint = declared[0]?.[1] as Json | undefined;
      const stopped = stoppedApplications.has(services[index]!);
      return (running ? c.State.Running : c.State.Status === (stopped ? "exited" : "created") && !c.State.Running) && !c.State.Restarting &&
        declared.length === 1 && declared[0]?.[0] === registeredNetwork?.Name && c.HostConfig.NetworkMode === registeredNetwork?.Name &&
        (running ? endpoint?.NetworkID === networkId : endpoint?.NetworkID === "" || endpoint?.NetworkID === networkId);
    });
    if (!stateMatches) console.error(JSON.stringify({ evidence: "legacy-source-container-admission", observations: actual.map((c, index) => ({
      service: services[index], expectedRunning: started.has(services[index]!), running: c.State.Running === true, created: c.State.Status === "created",
      restarting: c.State.Restarting === true, oneNetwork: Object.keys(c.NetworkSettings.Networks).length === 1,
      networkIdPresent: Boolean((Object.values(c.NetworkSettings.Networks)[0] as Json)?.NetworkID),
      networkIdMatches: (Object.values(c.NetworkSettings.Networks)[0] as Json)?.NetworkID === networkId,
      networkNameMatches: Object.keys(c.NetworkSettings.Networks)[0] === registeredNetwork?.Name,
      networkModeMatches: c.HostConfig.NetworkMode === registeredNetwork?.Name || c.HostConfig.NetworkMode === networkId,
    })) }));
    requireValue(stateMatches, "container-state-changed");
    const net = JSON.parse(docker.command(["network", "inspect", networkId]).toString())[0];
    const manager = management && observeManagementSnapshotChild(management);
    if (manager) requireValue(manager.networkId === networkId && manager.sourceIds.length === 7 &&
      manager.sourceIds.every(id => Object.values(ids).includes(id)), "management-source-mismatch");
    const extra = manager && manager.state === "running" ? [manager.containerId] : [];
    requireValue(net.Id === networkId && net.Internal === true && net.Driver === "bridge" && net.Labels?.["com.docker.compose.project"] === project && net.Labels?.[ownerLabel] === ownerRunId &&
      net.Options?.["com.docker.network.bridge.enable_ip_masquerade"] === "false" &&
      net.Created === registeredNetwork?.Created && Object.keys(net.Containers).length === started.size + extra.length &&
      Object.keys(net.Containers).every(id => extra.includes(id) || [...started].some(service => ids[service] === id)), "network-changed");
    const projectContainers = docker.command(["ps", "-a", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    requireValue(projectContainers.length === 7 && projectContainers.every(id => Object.values(ids).includes(id)), "project-shared");
    const peers = docker.command(["ps", "-a", "--no-trunc", "--filter", `network=${networkId}`, "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    // Created containers have a network declaration but no allocated endpoint.
    // Network inspect above proves actual membership; this also rejects any
    // additional attached or declared consumer returned by Docker's filter.
    requireValue(peers.every(id => Object.values(ids).includes(id) || manager && manager.state !== "removed" && id === manager.containerId), "network-shared");
    const volumeRows = JSON.parse(docker.command(["volume", "inspect", ...volumes.keys()]).toString()) as Json[];
    requireValue(Array.isArray(volumeRows) && volumeRows.length === volumes.size && new Set(volumeRows.map(row => row?.Name)).size === volumes.size &&
      volumeRows.every(row => row && volumes.has(row.Name)), "volume-batch-mismatch");
    for (const [name, serviceId] of volumes) {
      const volume = volumeRows.find(row => row.Name === name)!;
      requireValue(volume.Name === name && volume.Driver === "local" && !Object.keys(volume.Options ?? {}).length &&
        volume.Labels?.["com.docker.compose.project"] === project && volume.Labels?.[ownerLabel] === ownerRunId &&
        JSON.stringify([volume.CreatedAt, volume.Mountpoint]) === volumeIdentities.get(name), "volume-changed");
      const consumers = docker.command(["ps", "-a", "--no-trunc", "--filter", `volume=${name}`, "--format", "{{.ID}}"])
        .toString().trim();
      requireValue(consumers === serviceId, "volume-shared");
    }
  };
  const verify = async () => { try {
    requireValue(!stopFailed, "stop-outcome-unknown");
    await verifyResources(new Set(services.filter(service => !stoppedApplications.has(service))));
  } catch (error) { throw safeFailure(error, "observation"); } };
  const close = () => closing ??= (async () => {
    const failures: Error[] = [];
    const stage = async (name: string, action: () => unknown | Promise<unknown>) => {
      try { await action(); } catch { failures.push(new SourceFailure(`legacy-source-cleanup-${name}-failed`)); }
    };
    if (management) await stage("management-child", () => management!.close());
    if (composeAttempted) {
      await stage("containers", async () => {
        const list = () => docker.command(["ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim().split("\n").filter(Boolean);
        for (const [service, original] of registered) await stage("container", () => {
          const id = original.Id;
          const info = JSON.parse(docker.command(["inspect", id]).toString())[0];
          requireValue(declaredContainer(info, service) && containerIdentity(info) === containerIdentity(original), "cleanup-owner-mismatch");
          docker.command(["rm", "-f", "-v", id]);
        });
        requireValue(list().length === 0, "cleanup-containers-present");
      });
      for (const kind of ["volume", "network"]) await stage(kind, async () => {
        const list = () => docker.command([kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim().split("\n").filter(Boolean);
        const recorded = kind === "volume" ? [...volumeIdentities.keys()] : registeredNetwork ? [networkId] : [];
        for (const name of recorded) await stage(kind, () => {
          const info = JSON.parse(docker.command([kind, "inspect", name]).toString())[0];
          requireValue(info.Labels?.["com.docker.compose.project"] === project && info.Labels?.[ownerLabel] === ownerRunId && (kind === "volume" ?
            info.Name === name && info.Driver === "local" && !Object.keys(info.Options ?? {}).length &&
            JSON.stringify([info.CreatedAt, info.Mountpoint]) === volumeIdentities.get(name) :
            info.Id === networkId && info.Name === registeredNetwork!.Name && info.Created === registeredNetwork!.Created), "cleanup-owner-mismatch");
          docker.command([kind, "rm", kind === "network" ? info.Id : info.Name]);
        });
        requireValue(list().length === 0, "cleanup-resources-present");
      });
    }
    if (registrationFailed) failures.push(new SourceFailure("legacy-source-cleanup-registration-incomplete"));
    // Keep private configuration, exact identities and checkout if any resource
    // could remain. A rejected close is never represented as successful cleanup.
    if (failures.length) throw new SourceCleanupFailure(failures, "legacy-source-cleanup-failed");
    await stage("image-alias", () => {
      if (!imageAlias) return;
      const alias = JSON.parse(docker.command(["image", "inspect", sourceImageReference]).toString())[0];
      requireValue(alias.Id === imageId, "cleanup-image-alias-changed");
      docker.command(["image", "rm", sourceImageReference]);
      requireValue(!docker.command(["image", "ls", "-q", "--filter", `reference=${sourceImageReference}`]).toString().trim(), "cleanup-image-alias-present");
      requireValue(JSON.parse(docker.command(["image", "inspect", imageReference]).toString())[0].Id === imageId, "original-image-changed");
    });
    if (failures.length) throw new SourceCleanupFailure(failures, "legacy-source-cleanup-failed");
    await stage("worktree", async () => {
      if (!worktree) return;
      // Keep the exact Compose material if Git cannot release this checkout.
      const saved = await readFile(composeFile);
      await rm(composeFile);
      try { git("worktree", "remove", checkout); worktree = false; }
      catch (error) { await writeFile(composeFile, saved, { mode: 0o600, flag: "wx" }); throw error; }
    });
    if (failures.length) throw new SourceCleanupFailure(failures, "legacy-source-cleanup-failed");
    await stage("private-files", async () => {
      for (const file of Object.values(files)) await stage("private-file", () => rm(file, { force: true }));
      if (!worktree) await rm(directory, { recursive: true, force: true });
    });
    closed = true;
    if (failures.length) throw new SourceCleanupFailure(failures, "legacy-source-cleanup-failed");
  })();
  const node = (service: "api" | "worker" | "web", script: string, value: unknown, typescript = false) => {
    own(service);
    const result = docker.command(["exec", "-i", ids[service], "node", ...(typescript ? ["--import", "tsx"] : []), "--input-type=module", "-e", script], Buffer.from(JSON.stringify(value)));
    own(service); return JSON.parse(result.toString());
  };
  const wait = async (action: () => Promise<boolean> | boolean, stage: string) => {
    const deadline = Date.now() + 8000;
    for (let n = 0; n < 40 && Date.now() < deadline; n++) { try { if (await action()) return; } catch { /* Fixed bounded startup readiness, never a fabricated response. */ } await setTimeout(200); }
    throw new SourceFailure(`legacy-source-${stage}-not-ready`);
  };
  let stage = "prepare";
  try {
    for (const service of ["postgres", "redis", "minio", "mc"] as const) {
      imageIds[service] = JSON.parse(docker.command(["image", "inspect", storeImages[service]]).toString())[0].Id;
      requireValue(/^sha256:[a-f0-9]{64}$/.test(imageIds[service]), "store-image-unavailable");
    }
    requireValue(!docker.command(["image", "ls", "-q", "--filter", `reference=${sourceImageReference}`]).toString().trim(), "image-alias-exists");
    docker.command(["image", "tag", imageId, sourceImageReference]); imageAlias = true;
    git("worktree", "add", "--detach", checkout, sourceSha); worktree = true;
    const common = { NODE_ENV: "production", AUTH_MODE: "production", AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: "false",
      DATABASE_URL: `postgres://postgres:${password}@postgres:5432/wiseeff`, REDIS_URL: "redis://redis:6379/0",
      OBJECT_STORE_MODE: "s3", OBJECT_STORAGE_ENDPOINT: "http://minio:9000", OBJECT_STORAGE_BUCKET: "wiseeff",
      OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic", OBJECT_STORAGE_SECRET_ACCESS_KEY: password, OBJECT_STORAGE_REGION: "us-east-1",
      XIAOZE_CHECKPOINTER: "postgres", XIAOZE_DETERMINISTIC: "true", XIAOZE_PROACTIVE_ENABLED: "false",
      LOG_ANALYSIS_DETERMINISTIC: "true", KNOWLEDGE_INDEX_WORKER_ENABLED: "false", NOTIFICATION_WORKER_ENABLED: "false",
      LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED: "false", LOG_WEBHOOK_ALLOW_INSECURE_LOCAL: "false",
      DEBUG_DEVICE_GATEWAY_MODE: "simulator", DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
      LOG_ANALYSIS_QUEUE_MODE: "durable", LOG_ANALYSIS_QUEUE_PREFIX: project,
      HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "" };
    const saveEnv = (file: string, value: Record<string, string>) => writeFile(file, Object.entries(value).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
    await saveEnv(files.api, { ...common, HOST: "0.0.0.0", PORT: "8787", LOG_WORKER_ENABLED: "false" });
    await saveEnv(files.worker, { ...common, LOG_WORKER_ENABLED: "true", LOG_WORKER_OBSERVABILITY_HOST: "0.0.0.0", LOG_WORKER_OBSERVABILITY_PORT: "8788" });
    await saveEnv(files.management, { NODE_ENV: "production", DATABASE_URL: common.DATABASE_URL, WISEEFF_UPGRADE_SOURCE_SYSTEM: "wiseeff-v1" });
    await saveEnv(files.stores, { POSTGRES_PASSWORD: password, POSTGRES_USER: "postgres", POSTGRES_DB: "wiseeff", MINIO_ROOT_USER: "synthetic", MINIO_ROOT_PASSWORD: password });
    const labels = { [ownerLabel]: ownerRunId };
    const app = (envFile: string, command: string[]) => ({ image: sourceImageReference, env_file: envFile, command, restart: "no", init: true, labels });
    await writeFile(composeFile, JSON.stringify({ services: {
      api: app(files.api, ["sh", "-lc", "npx tsx server/index.ts"]),
      worker: app(files.worker, ["sh", "-lc", "npm run worker:logs"]),
      web: app(files.api, ["sh", "-lc", "npm run preview -- --host 0.0.0.0 --port 5173 --strictPort"]),
      postgres: { image: "postgres:16-alpine", env_file: files.stores, volumes: ["pg:/var/lib/postgresql/data"],
        labels },
      redis: { image: "redis:7-alpine", command: ["redis-server", "--appendonly", "yes"], volumes: ["redis:/data"], labels },
      minio: { image: "minio/minio:RELEASE.2024-12-18T13-15-44Z", env_file: files.stores, command: ["server", "/data"], volumes: ["objects:/data"], labels },
      mc: { image: "minio/mc:RELEASE.2024-11-21T17-21-54Z", entrypoint: ["sh", "-c", "sleep 900"], labels },
    }, volumes: { pg: { labels }, redis: { labels }, objects: { labels } }, networks: { default: { labels, internal: true, driver_opts: { "com.docker.network.bridge.enable_ip_masquerade": "false" } } } }), { mode: 0o600 });
    for (const file of [...Object.values(files), composeFile]) fileIdentities.set(file, await fileIdentity(file));
    for (const kind of ["volume", "network"]) requireValue(!docker.command([kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim(), "project-already-used");
    requireValue(!docker.command(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]).toString().trim(), "project-already-used");
    composeAttempted = true; stage = "stores";
    try { compose("create", "--no-build", "--pull", "never", ...services); }
    finally { await registerCreated(); }
    const started = new Set<Service>();
    await verifyResources(started);
    const start = async (selection: Service[]) => {
      await verifyResources(started);
      docker.command(["start", ...selection.map(service => ids[service])]);
      selection.forEach(service => started.add(service));
      await verifyResources(started);
    };
    await start(["postgres", "minio", "redis", "mc"]);
    // Internal-only Docker networks do not publish a host port (050/43c actual
    // evidence). Management remains on its original private service transport.
    // The separate, issued management child does not relax the host Socket path.
    await wait(() => { own("postgres"); docker.command(["exec", ids.postgres, "pg_isready", "-U", "postgres", "-d", "wiseeff"]); return true; }, "postgres");
    await wait(() => {
      own("mc"); own("minio");
      docker.command(["exec", "-i", ids.mc, "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "sh", "-c",
        'umask 077; d=$(mktemp -d) || exit 1; trap \'rm -rf "$d"\' HUP INT TERM; result=0; cat > "$d/config.json" && mc --config-dir "$d" mb --ignore-existing source/wiseeff || result=1; rm -rf "$d" || exit 1; exit "$result"'],
      Buffer.from(JSON.stringify({ version: "10", aliases: { source: { url: "http://minio:9000", accessKey: "synthetic", secretKey: password, api: "S3v4", path: "auto" } } })));
      return true;
    }, "object-store");
    // Initialize the empty synthetic source using the unchanged old CLI in its
    // already-verified image. Its real exit (including pool shutdown) precedes
    // the API readiness budget; markers alone never acknowledge completion.
    stage = "source-migration"; await start(["web"]);
    const migrationStarted = Date.now();
    own("web");
    const migrationOutput = docker.command(["exec", ids.web, "npm", "run", "db:migrate"]).toString();
    await verifyResources(started);
    requireValue(/Applied \d+ migration\(s\):/.test(migrationOutput) && migrationOutput.includes("Ensured Xiaoze LangGraph checkpoint tables."), "source-migration-incomplete");
    console.info(JSON.stringify({ evidence: "legacy-source-schema-initialization", elapsedMs: Date.now() - migrationStarted, commandExitedSuccessfully: true }));
    stage = "api-start"; await start(["api"]);
    const http = (service: "api" | "worker", route: string, method = "GET", body?: unknown, token?: string) =>
      object(node(service, HTTP, { port: service === "api" ? 8787 : 8788, path: route, method, body, token }));
    let lastHealth: Json | undefined;
    const readinessStarted = Date.now();
    try {
      await wait(() => { lastHealth = http("api", "/health/ready"); return lastHealth.status === 200; }, "api");
    } catch (error) {
      // Read diagnostics privately; only a closed set of booleans/statuses is
      // emitted. Container logs and health messages can contain private inputs.
      try {
        const api = own("api");
        const logs = docker.command(["logs", "--tail", "200", ids.api]).toString();
        const statuses = new Set(["ready", "not_ready", "failed", "missing", "disabled", "degraded", "unavailable"]);
        console.error(JSON.stringify({ evidence: "legacy-source-api-readiness", elapsedMs: Date.now() - readinessStarted,
          running: api.State?.Running === true, exitCode: Number.isInteger(api.State?.ExitCode) ? api.State.ExitCode : null,
          migrationApplied: /Applied \d+ migration\(s\):/.test(logs), checkpointEnsured: logs.includes("Ensured Xiaoze LangGraph checkpoint tables."),
          apiListening: logs.includes("WiseEff API listening on"),
          httpStatus: Number.isInteger(lastHealth?.status) ? lastHealth!.status : null,
          dependencies: ["database", "objectStore", "workerQueue", "notificationOutbox", "durableQueue", "xiaozeLlm", "logAnalysisLlm", "dtsToolchain"].map(name => {
            const dependency = lastHealth?.body?.dependencies?.[name];
            return { name, ok: typeof dependency?.ok === "boolean" ? dependency.ok : null,
              status: statuses.has(dependency?.status) ? dependency.status : "unobserved" };
          }) }));
      } catch { console.error(JSON.stringify({ evidence: "legacy-source-api-readiness", diagnosticUnavailable: true })); }
      throw error;
    }
    console.info(JSON.stringify({ evidence: "legacy-source-api-ready", elapsedMs: Date.now() - readinessStarted, httpStatus: 200 }));
    stage = "worker-start"; await start(["worker"]);
    await wait(() => http("worker", "/health/live").status === 200, "worker"); await verify();
    stage = "bootstrap"; const admin = object(node("api", BOOTSTRAP, account, true));
    let token = "";
    const request = (route: string, method = "GET", body?: unknown, expected = 200) => {
      const response = http("api", route, method, body, token);
      if (stage === "worker-job" && response.status !== expected) {
        try {
          const result = node("api", LOG_UPLOAD_DIAGNOSTIC, { organizationId: admin.organizationId }, true);
          console.error(JSON.stringify({ evidence: "legacy-source-upload-failure", httpStatus: response.status,
            internalError: response.body?.error?.code === "INTERNAL_ERROR", fileCount: result.fileCount,
            logCount: result.logCount, jobCount: result.jobCount, nativeJobIdRejected: result.nativeJobIdRejected === true }));
        } catch { console.error(JSON.stringify({ evidence: "legacy-source-upload-failure", diagnosticUnavailable: true })); }
      }
      requireValue(response.status === expected, `api-${stage}-status-${Number.isInteger(response.status) ? response.status : "invalid"}`);
      return object(response.body);
    };
    stage = "login"; const login = request("/api/v1/auth/login", "POST", { username: account.username, password: account.password });
    requireValue(typeof login.token === "string" && login.token.length > 10, "login-token-unavailable"); token = login.token;
    stage = "project"; const projectId = `owned-${randomBytes(6).toString("hex")}`;
    request("/api/v1/parameters/admin/projects", "POST", { id: projectId, name: "Owned legacy project", code: "OWNED" }, 201);
    stage = "parameter-definition";
    const business = object(request("/api/v1/parameter-modules", "POST", { name: "Owned business", kind: "business" }, 201).item);
    const driver = object(request("/api/v2/parameter-modules/driver-registry", "POST", { displayName: "Owned driver", businessCategoryId: business.id, compatibles: ["wiseeff,owned-legacy"] }, 201).item);
    const moduleList = request("/api/v1/parameter-modules").items;
    const actualDriver = object(moduleList.find((item: Json) => item.id === driver.id));
    const shape = { valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 }, constraints: { cells: 1 }, documentation: "Owned legacy fixture voltage setting" };
    const spec = object(request("/api/v2/parameter-specs", "POST", { attributionSubjectId: actualDriver.attributionSubjectId, propertyKey: "owned-voltage", ...shape, reason: "owned synthetic source" }, 201).item);
    stage = "parameter-activation";
    const active = object(request(`/api/v2/parameter-specs/${spec.id}/activate`, "POST", { ...shape, reason: "owned synthetic activation", coverageClaim: { kind: "overlay-property", upsertOverlay: { compatible: "wiseeff,owned-legacy", displayName: "Owned schema coverage", createPropertyLink: true } } }).item);
    requireValue(active.lifecycle === "active" && typeof active.currentVersionId === "string", "active-definition-unavailable");
    stage = "binding-revisions";
    const configSet = object(request(`/api/v1/projects/${projectId}/config-sets`, "POST", { name: "owned-values" }, 201).item);
    const binding = object(node("api", BINDINGS, { organizationId: admin.organizationId, userId: admin.userId, projectId,
      moduleId: business.id, specId: active.id, versionId: active.currentVersionId, configSetId: configSet.id }, true));
    stage = "worker-job";
    const logBytes = Buffer.from("2026-09-08T00:00:00Z INFO owned source ready\n");
    const upload = http("api", "/api/v1/log-files", "POST", { fileName: "owned.log", contentType: "text/plain", contentBase64: logBytes.toString("base64"), analysisQuestion: "Summarize this isolated synthetic log." }, token);
    let logId: string;
    let uploadDelivery: "original-http" | "original-http-500-native-test-producer";
    if (upload.status === 201) {
      logId = object(upload.body.log).id;
      requireValue(typeof object(upload.body.job).id === "string", "worker-job-not-created");
      uploadDelivery = "original-http";
    } else {
      requireValue(upload.status === 500 && upload.body?.error?.code === "INTERNAL_ERROR", "original-upload-unexpected-failure");
      const original = node("api", LOG_UPLOAD_DIAGNOSTIC, { organizationId: admin.organizationId }, true);
      requireValue(original.fileCount === 1 && original.logCount === 1 && original.jobCount === 1 && original.nativeJobIdRejected === true, "original-upload-not-exact-colon-refusal");
      await verify();
      const delivered = object(node("api", NATIVE_TEST_PRODUCER, { organizationId: admin.organizationId, userId: admin.userId,
        fileName: "owned.log", checksum: createHash("sha256").update(logBytes).digest("hex") }, true));
      requireValue(delivered.producer === "native-test-only" && typeof delivered.logId === "string" && typeof delivered.jobId === "string", "native-test-delivery-unavailable");
      logId = delivered.logId;
      uploadDelivery = "original-http-500-native-test-producer";
      console.info(JSON.stringify({ evidence: "legacy-source-native-test-delivery", originalHttpStatus: 500, originalJobIdRejected: true, actualPersistedJobCount: 1 }));
      await verify();
    }
    await wait(() => request(`/api/v1/logs/${logId}`).item?.status === "complete", "worker-job");
    const source: HandoffInputs["source"] = { checkout, sha: sourceSha, composeFile, project,
      applications: (["api", "worker", "web"] as const).map(service => ({ service, containerId: ids[service], imageId, imageReference: sourceImageReference })),
      stores: (["postgres", "minio", "redis"] as const).map(service => ({ service, containerId: ids[service],
        volumeName: [...volumes].find(([, id]) => id === ids[service])![0], destination: service === "postgres" ? "/var/lib/postgresql/data" : "/data" })) };
    const observeBusiness = async () => { try {
      requireValue(!stopping, "applications-stopped-or-stopping");
      await verify(); stage = "observation";
      const ready = request("/health/ready"); const definition = object(request(`/api/v2/parameter-specs/${active.id}`).item);
      const bindings = request(`/api/v2/projects/${projectId}/parameter-bindings`).items;
      const current = object(bindings.find((row: Json) => row.id === binding.bindingId));
      const history = request(`/api/v2/projects/${projectId}/bindings/${binding.bindingId}/history`).items;
      const log = object(request(`/api/v1/logs/${logId}`).item);
      requireValue(log.status === "complete", "worker-job-not-complete");
      const projects = request("/api/v1/projects").items; const logs = request("/api/v1/logs").items;
      await verify();
      return { apiStatus: ready.status, workerStatus: "completed-job", uploadDelivery, projectCount: projects.length, logCount: logs.length,
        modelProfile: "deterministic-isolation-only", parameters: { definitionLifecycle: definition.lifecycle,
          currentValue: Number(current.effectiveValue?.groups?.[0]?.[0]?.value),
          history: history.map((row: Json) => ({ fromRawValue: row.fromRawValue, toRawValue: row.toRawValue })) } };
    } catch (error) { throw safeFailure(error, "business-observation"); } };
    await observeBusiness();
    const stopOriginalApplications = createLegacySourceApplicationStop({ verify, own,
      async pause() {
        const paused = object(node("api", PAUSE_SOURCE_QUEUE, {}));
        return { paused: paused.paused, active: paused.active };
      },
      stop(service) { docker.command(["stop", "--time", "10", ids[service]]); },
      recordStopped(service) { stoppedApplications.add(service); },
    });
    const stopApplicationsForHandoff = () => stopping ??= stopOriginalApplications().catch(error => { stopFailed = true; throw error; });
    // Explicit fixture inventory for the later root's existing endpoint owner:
    // the seventh helper is registered here, never discovered/adopted by name.
    return Object.freeze({ ownerRunId, registeredContainerIds: Object.freeze(services.map(service => ids[service])),
      objectClient: Object.freeze({ containerId: ids.mc, imageId: imageIds.mc }),
      sourceEvidence: Object.freeze({ profile: "owned-synthetic-fixed-legacy", originalHttpUploadStatus: upload.status,
        logTaskProducer: uploadDelivery, models: "deterministic-isolation-only" }),
      source: structuredClone(source), privateConfigPaths: Object.freeze({ api: files.api, worker: files.worker, management: files.management }),
      verify, close, observeBusiness, stopApplicationsForHandoff,
      registerManagementChild(handle: ManagementSnapshotChild) {
        requireValue(!management && !stopping && !closing, "management-registration-state");
        const observed = observeManagementSnapshotChild(handle);
        requireValue(observed.state === "created" && observed.networkId === networkId && observed.sourceIds.length === 7 &&
          observed.sourceIds.every(id => Object.values(ids).includes(id)), "management-source-mismatch");
        management = handle;
      },
      async observeUnauthenticatedProjectStatus() { try { requireValue(!stopping, "applications-stopped-or-stopping"); await verify(); return http("api", "/api/v1/projects").status as number; } catch (error) { throw safeFailure(error, "auth-observation"); } },
      createObserver(selection: HandoffInputs) {
        try {
        requireValue(isDeepStrictEqual(selection.source, source) && selection.expectedDaemonId === input.expectedDaemonId, "handoff-source-mismatch");
        return createOwnedHandoffDataObserver({ inputs: selection, management, objectClient: { containerId: ids.mc, imageId: imageIds.mc },
          postgres: { database: "wiseeff", user: "postgres", password }, objects: { bucket: "wiseeff", accessKey: "synthetic", secretKey: password }, redis: { database: 0, auth: { kind: "none" } } });
        } catch (error) { throw safeFailure(error, "observer-selection"); }
      } });
  } catch (cause) {
    const error = safeFailure(cause, stage);
    try { await close(); } catch { throw new SourceCleanupFailure([error, new SourceFailure("legacy-source-cleanup-failed")], "legacy-source-operation-and-cleanup-failed"); }
    throw error;
  }
}
