import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import { gate0SecretValuesFromEnv, sanitizeGate0ArtifactTree, sanitizeGate0DiagnosticText, scanGate0ArtifactTree } from "./gate0-artifact-sanitizer";
import { buildGate0OwnedChildProcessEnv } from "./gate0-child-process-env";
import { writeZipArchive } from "./finalize-gate0-upload";
import { validCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";

// Isolated terminal acceptance only. The application and upgrade controller are
// unmodified production entry points; this driver owns the synthetic deployment.
const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
const repository = process.cwd();
const [candidateSha, expectedDaemon, ...extra] = process.argv.slice(2);
assert.match(candidateSha ?? "", /^[a-f0-9]{40}$/);
assert.ok(expectedDaemon && extra.length === 0, "candidate SHA and expected Docker daemon ID required");
assert.notEqual(process.getuid?.(), 0, "run as an ordinary deployment user");
const directory = mkdtempSync(path.join(tmpdir(), "wiseeff-minimal-terminal-"));
chmodSync(directory, 0o700);
let step = "preflight";
let commandNumber = 0;
const secrets = gate0SecretValuesFromEnv();
const launchEnv = buildGate0OwnedChildProcessEnv({});
let lastCommandFailure = "";
function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? repository,
    env: options.env ?? launchEnv, input: options.input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    lastCommandFailure = sanitizeGate0DiagnosticText(result.stdout + result.stderr, secrets).value.slice(-6000);
    writeFileSync(path.join(directory, `private-failure-${++commandNumber}.log`), result.stdout + result.stderr, { mode: 0o600 });
    throw new Error(`minimal-terminal-${step}-command-failed:${result.status ?? "signal"}`);
  }
  return result.stdout.trim();
}
const docker = (...args: string[]) => run("docker", args);
assert.equal(docker("info", "--format", "{{.ID}}"), expectedDaemon);
assert.equal(docker("info", "--format", "{{.OSType}}/{{.Architecture}}"), "linux/x86_64",
  "the existing self-hosted base-image contract requires native amd64");
assert.equal(run("git", ["status", "--porcelain"]), "", "seal the candidate before terminal acceptance");
assert.equal(run("git", ["rev-parse", "HEAD"]), candidateSha);
const project = `minimal-${randomBytes(8).toString("hex")}`;
const browserDirectory = path.join(directory, "browser-evidence");
let browserOpened = false;
function browser(...args: string[]) {
  const output = run("playwright-cli", [`-s=${project}`, ...args], { cwd: directory });
  assert.ok(!/^### Error/m.test(output), sanitizeGate0DiagnosticText(output, secrets).value);
  return output;
}
function browserCode(code: string) {
  const file = path.join(directory, "private-browser-code.js");
  writeFileSync(file, code, { mode: 0o600 });
  return browser("run-code", "--filename", file);
}
function captureBrowserText(name: string) {
  for (const command of [["snapshot"], ["console", "error"], ["requests"]]) {
    const output = browser(...command);
    const attachments = [...output.matchAll(/\]\((\.playwright-cli\/[a-zA-Z0-9_.-]+\.(?:yml|log|txt))\)/g)]
      .map(match => readFileSync(path.join(directory, match[1]), "utf8"));
    writeFileSync(path.join(browserDirectory, `${name}-${command[0]}.txt`),
      sanitizeGate0DiagnosticText([output, ...attachments].join("\n"), secrets).value);
  }
}
function captureBrowser(name: string, code: string) {
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    browser("resize", String(width), String(height));
    try {
      browserCode(code);
    } finally {
      captureBrowserText(`${name}-${width}`);
      browser("screenshot", `--filename=${path.join(browserDirectory, `${name}-${width}.png`)}`);
    }
  }
}
function browserJson(output: string) {
  return JSON.parse(output.match(/^### Result\n([^\n]+)\n/m)?.[1] ?? "null");
}
const publishedDts = `/dts-v1/;
/ {
	charger {
		compatible = "acme,power";
		iin_max = <1000>;
	};
};
`;
function readPublishedValues(id: string) {
  return inApi(`
    import{readFileSync}from'node:fs';import{createPostgresDatabase}from'./server/shared/database/client.ts';
    const {projectId}=JSON.parse(readFileSync(0,'utf8'));
    const db=createPostgresDatabase(process.env.DATABASE_URL);
    try{
      const values=await db.query("select d.property_key as key, v.value from parameter_catalog.project_parameter_bindings b join parameter_catalog.parameter_definitions d on d.id=b.definition_id join parameter_catalog.project_parameter_values v on v.id=b.current_value_id where b.project_id=$1 and v.source_ref <> 'canonical-binding-identity'",[projectId]);
      const specs=await db.query("select count(*)::text as c from parameter_specs ps left join dts_property_specs dps on dps.parameter_spec_id=ps.id where coalesce(ps.property_key,dps.property_key)='iin_max'");
      const registrations=await db.query("select count(*)::text as c from parameter_catalog.organization_subject_registrations where status='active' and subject_id='csub_acme_power'");
      console.log(JSON.stringify({values:values.rows,specCount:Number(specs.rows[0]?.c??0),registrations:Number(registrations.rows[0]?.c??0)}));
    }finally{await db.close()}
  `, { projectId: id });
}
async function waitForPublishedValue(id: string, expected: number) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const observed = readPublishedValues(id);
    const row = observed.values.find((item: { key: string; value: unknown }) => item.key === "iin_max");
    if (row && Number(row.value) === expected && observed.specCount === 0) return observed;
    await setTimeout(1000);
  }
  throw new Error(`${step}: published iin_max ${expected} was not observed without a new spec`);
}
assert.equal(docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`), "");
const checkout = path.join(directory, "deployment");
run("git", ["clone", "--no-local", "--quiet", repository, checkout]);
run("git", ["checkout", "--detach", sourceSha], { cwd: checkout });
const composeDir = path.join(checkout, "ops/self-hosted");
const password = randomBytes(24).toString("hex");
const account = { username: `minimal-${randomBytes(6).toString("hex")}`, password, name: "Synthetic upgrade admin", organization: "Minimal upgrade rehearsal" };
const member = { username: `${project}-member`, password: randomBytes(24).toString("hex") };
secrets.push(password, account.username, member.username, member.password);
const envFile = path.join(directory, "runtime.env");
const ca = path.join(directory, "corporate-ca.pem");
writeFileSync(ca, "", { mode: 0o600 });
const env = { ...launchEnv, COMPOSE_PROJECT_NAME: project, WISEEFF_ENV_FILE: envFile,
  COMPOSE_FILE: `${composeDir}/compose.yaml:${directory}/compose.override.yaml` };
writeFileSync(envFile, [
  "NODE_ENV=production", "HOST=0.0.0.0", "PORT=8787", "AUTH_MODE=production", "AUTH_PROVIDER=local",
  `POSTGRES_PASSWORD=${password}`, `DATABASE_URL=postgres://wiseeff:${password}@postgres:5432/wiseeff`,
  "MINIO_ROOT_USER=wiseeff", `MINIO_ROOT_PASSWORD=${password}`, "OBJECT_STORE_MODE=s3",
  "OBJECT_STORAGE_ENDPOINT=http://minio:9000", "OBJECT_STORAGE_BUCKET=wiseeff", "OBJECT_STORAGE_REGION=us-east-1",
  "OBJECT_STORAGE_ACCESS_KEY_ID=wiseeff", `OBJECT_STORAGE_SECRET_ACCESS_KEY=${password}`, "OBJECT_STORAGE_TLS_POLICY=required",
  "LOG_ANALYSIS_QUEUE_MODE=durable", "REDIS_URL=redis://redis:6379", `LOG_ANALYSIS_QUEUE_PREFIX=${project}`,
  "LOG_WORKER_ENABLED=false", "LOG_ANALYSIS_DETERMINISTIC=true", "XIAOZE_CHECKPOINTER=postgres", "XIAOZE_DETERMINISTIC=true", "XIAOZE_PROACTIVE_ENABLED=false",
  "DEBUG_DEVICE_GATEWAY_MODE=multi", "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true",
  "LOG_WORKER_OBSERVABILITY_HOST=0.0.0.0", "WISEEFF_SITE_HOST=localhost", "WISEEFF_TLS_EMAIL=synthetic@example.invalid",
  "WISEEFF_PUBLIC_URL=http://127.0.0.1:18080", "WISEEFF_API_BASE_URL=http://127.0.0.1:18080", "VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:18080",
  `WISEEFF_APP_IMAGE=${project}`, `WISEEFF_APP_TAG=${sourceSha}`, `WISEEFF_BUILD_CA_CERT_FILE=${ca}`,
  "WISEEFF_BUILD_TLS_POLICY=verify"
].join("\n") + "\n", { mode: 0o600 });
// Only test transport changes: retain stock services, volumes, commands and
// health checks, bind the proxy to loopback and suppress external certificate IO.
writeFileSync(path.join(directory, "Caddyfile"), ":80 {\n handle /api/* {\n  reverse_proxy api:8787\n }\n handle /health/* {\n  reverse_proxy api:8787\n }\n handle {\n  reverse_proxy web:5173\n }\n}\n", { mode: 0o600 });
writeFileSync(path.join(directory, "compose.override.yaml"), `services:
  proxy:
    ports: !override ["127.0.0.1:18080:80"]
    volumes:
      - ${directory}/Caddyfile:/etc/caddy/Caddyfile:ro
secrets:
  wiseeff-corporate-ca:
    file: ${ca}
`, { mode: 0o600 });
const compose = (...args: string[]) => run("bash", ["scripts/compose", "--env-file", envFile, ...args], { cwd: composeDir, env });
function owned(service: string) {
  const id = compose("ps", "-aq", service);
  assert.match(id, /^[a-f0-9]{64}$/);
  const inspected = JSON.parse(docker("inspect", id))[0];
  assert.equal(inspected.Config.Labels["com.docker.compose.project"], project);
  return id;
}
function inApi(script: string, input: unknown = {}) {
  return JSON.parse(run("docker", ["exec", "-i", owned("api"), "node", "--import", "tsx", "--input-type=module", "-e", script],
    { input: JSON.stringify(input) }));
}
type ConstraintObservation = { name: string; definition: string; validated: boolean };
type TableObservation = { name: string; columns: string[]; rows: string[]; constraints: ConstraintObservation[] };
const observeRows = (projections: TableObservation[] = []): TableObservation[] => inApi(`
  import{readFileSync}from'node:fs';
  import{createPostgresDatabase}from'./server/shared/database/client.ts';
  const {projections}=JSON.parse(readFileSync(0,'utf8'));
  const db=createPostgresDatabase(process.env.DATABASE_URL);
  try{console.log(JSON.stringify(await db.transaction(async tx=>{
    await tx.query('set transaction isolation level repeatable read, read only');
    const tables=await tx.query("select c.table_name,array_agg(c.column_name::text order by c.ordinal_position) as columns from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and t.table_type='BASE TABLE' group by c.table_name order by c.table_name");
    const result=[];
    for(const table of tables.rows){const quoted='"'+table.table_name.replaceAll('"','""')+'"';const source=projections.find(p=>p.name===table.table_name);const added=source?table.columns.filter(column=>!source.columns.includes(column)):[];
      const rows=await tx.query('select (to_jsonb(t) - $1::text[])::text as row from public.'+quoted+' t',[added]);
      const constraints=await tx.query("select c.conname as name,pg_get_constraintdef(c.oid) as definition,c.convalidated as validated from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname=$1 and c.contype in ('p','f','u','c') order by c.conname",[table.table_name]);
      result.push({name:table.table_name,columns:table.columns,rows:rows.rows.map(r=>r.row),constraints:constraints.rows});}
    return result;
  })))}finally{await db.close()}
`, { projections: projections.map(({ name, columns }) => ({ name, columns })) });
const observeObjects = () => inApi(`
  import{createPostgresDatabase}from'./server/shared/database/client.ts';
  import{createHttpObjectStorageTransport}from'./server/modules/logs/s3ObjectStore.ts';
  const db=createPostgresDatabase(process.env.DATABASE_URL);
  const store=createHttpObjectStorageTransport({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY});
  try{const rows=await db.query('select storage_key from log_file_objects order by storage_key');const result=[];
    for(const row of rows.rows){const input={bucket:process.env.OBJECT_STORAGE_BUCKET,key:row.storage_key};result.push({key:row.storage_key,bytes:(await store.get(input)).toString('base64'),head:await store.head(input)});}
    console.log(JSON.stringify(result));
  }finally{await db.close()}
`);
const observeQueue = () => inApi(`
  import{Queue}from'bullmq';const q=new Queue('log-analysis',{connection:{url:process.env.REDIS_URL},prefix:process.env.LOG_ANALYSIS_QUEUE_PREFIX});
  try{const jobs=await q.getJobs(['wait','active','delayed','completed','failed','paused','waiting-children','prioritized'],0,-1);
    const result=[];for(const j of jobs)result.push({id:j.id,data:j.data,state:await j.getState(),attemptsMade:j.attemptsMade,failedReason:j.failedReason,progress:j.progress});
    result.sort((a,b)=>a.id.localeCompare(b.id));console.log(JSON.stringify(result));
  }finally{await q.close()}
`);
async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = inApi(`import{readFileSync}from'node:fs';import{createPostgresDatabase}from'./server/shared/database/client.ts';import{getJobSnapshot}from'./server/modules/jobs/repository.ts';const db=createPostgresDatabase(process.env.DATABASE_URL);try{console.log(JSON.stringify(await getJobSnapshot(db,JSON.parse(readFileSync(0,'utf8')).jobId)))}finally{await db.close()}`, { jobId });
    if (job?.status === "complete" && observeQueue().some((delivery: { data: { jobId?: string }; state: string }) =>
      delivery.data.jobId === jobId && delivery.state === "completed")) return;
    await setTimeout(1000);
  }
  throw new Error(`${step}: actual worker did not complete its job`);
}
function assertPreserved(before: TableObservation[], after: TableObservation[]) {
  const additions: Record<string, { rows: number; columns: string[]; constraints: ConstraintObservation[] }> = {};
  for (const source of before) {
    const target = after.find(table => table.name === source.name);
    assert.ok(target, `preservation: missing table ${source.name}`);
    assert.ok(source.columns.every(column => target.columns.includes(column)), `preservation: missing column in ${source.name}`);
    for (const constraint of source.constraints) {
      assert.deepEqual(target.constraints.find(current => current.name === constraint.name), constraint,
        `preservation: original constraint changed or lost in ${source.name}.${constraint.name}`);
    }
    // Keep PostgreSQL canonical JSON as text: parsing bigint/numeric values in
    // JavaScript could make different original values compare equal.
    const remaining = new Map<string, number>();
    for (const row of target.rows) remaining.set(row, (remaining.get(row) ?? 0) + 1);
    for (const row of source.rows) {
      const count = remaining.get(row) ?? 0;
      assert.ok(count > 0, `preservation: original fields changed or row lost in ${source.name}`);
      remaining.set(row, count - 1);
    }
    const added = [...remaining.values()].reduce((sum, count) => sum + count, 0);
    assert.ok(added === 0 || source.name === "schema_migrations", `preservation: unexplained added rows in ${source.name}`);
    const columns = target.columns.filter(column => !source.columns.includes(column));
    const constraints = target.constraints.filter(current => !source.constraints.some(original => original.name === current.name));
    if (added || columns.length || constraints.length) additions[source.name] = { rows: added, columns, constraints };
  }
  return { tables: before.length, originalRows: before.reduce((sum, table) => sum + table.rows.length, 0),
    originalConstraints: before.reduce((sum, table) => sum + table.constraints.length, 0),
    everyOriginalFieldPreserved: true, everyOriginalConstraintPreserved: true, additions };
}
const httpScript = `import{readFileSync}from'node:fs';const p=JSON.parse(readFileSync(0,'utf8'));const r=await fetch('http://127.0.0.1:8787'+p.route,{method:p.method,headers:{'content-type':'application/json',...(p.token?{authorization:'Bearer '+p.token}:{})},...(p.body===undefined?{}:{body:JSON.stringify(p.body)})});console.log(JSON.stringify({status:r.status,body:await r.json()}));`;
let token = "";
const http = (route: string, method = "GET", body?: unknown, status = 200) => {
  const result = inApi(httpScript, { route, method, body, token });
  assert.equal(result.status, status, `${step}: ${method} ${route}`);
  if (route === "/api/v1/auth/login" && typeof result.body.token === "string") secrets.push(result.body.token);
  return result.body;
};
let lastHealth: unknown;
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:18080/health/ready", { signal: AbortSignal.timeout(2000) });
      const health = { status: response.status, body: await response.json() };
      lastHealth = health;
      if (health.status === 200 && health.body && typeof health.body === "object" &&
        "ok" in health.body && health.body.ok === true) return;
    } catch { /* startup remains unaccepted */ }
    await setTimeout(2000);
  }
  throw new Error("minimal-terminal-api-not-ready");
}
const evidence: Record<string, unknown> = { sourceSha, candidateSha, project, daemon: expectedDaemon, complete: false };
const record = () => writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
let created = false;
let activeUpgradeRunId = `${project}-upgrade`;
let interruptionChild: ReturnType<typeof spawn> | undefined;
try {
  step = "old-config-validation";
  symlinkSync(path.join(repository, "node_modules"), path.join(checkout, "node_modules"), "dir");
  const sourceConfig = await import(pathToFileURL(path.join(checkout, "server/config/env.ts")).href);
  sourceConfig.loadServerEnv(parse(readFileSync(envFile, "utf8")));
  run("docker", ["run", "--rm", "--network", "none", "--label", `wiseeff.upgrade.minimal=${project}`,
    "-v", `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`, "caddy:2-alpine", "caddy", "adapt",
    "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]);
  step = "old-image-build";
  docker("load", "-i", path.join(composeDir, "images/node-22.21.1-alpine-amd64.tar"));
  run("docker", ["build", "--secret", `id=wiseeff-corporate-ca,src=${ca}`, "--build-arg", "VITE_WISEEFF_RUNTIME_MODE=api",
    "--build-arg", "VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:18080", "--label", `org.opencontainers.image.revision=${sourceSha}`,
    "-t", `${project}:${sourceSha}`, "-f", "ops/self-hosted/Dockerfile", "."], { cwd: checkout });
  evidence.sourceImageId = JSON.parse(docker("image", "inspect", `${project}:${sourceSha}`))[0].Id;
  step = "old-start"; created = true;
  compose("up", "-d", "--no-build", "postgres", "redis", "minio", "minio-init", "api", "worker", "web", "proxy");
  await ready();
  step = "old-synthetic-business";
  const admin = inApi(`import{readFileSync}from'node:fs';import{createPostgresDatabase}from'./server/shared/database/client.ts';import{bootstrapLocalAdmin}from'./server/modules/auth/bootstrapLocalAdmin.ts';const db=createPostgresDatabase(process.env.DATABASE_URL);try{console.log(JSON.stringify(await bootstrapLocalAdmin(db,JSON.parse(readFileSync(0,'utf8')))))}finally{await db.close()}`, account);
  token = http("/api/v1/auth/login", "POST", { username: account.username, password }).token;
  const projectId = `${project}-business`;
  http("/api/v1/parameters/admin/projects", "POST", { id: projectId, name: "Preserved project", code: "MIN" }, 201);
  http("/api/v1/users", "POST", { ...member, name: "Preserved project user", roles: [{ projectId, roleId: "software-user" }] }, 201);
  const node = http("/api/v1/debugging/admin/nodes", "POST", { name: "Preserved node", module: "minimal",
    bindings: [{ protocol: "hdc", nodePath: "/minimal/node", accessMode: "RW", enabled: true }] }, 201).item;
  const business = http("/api/v1/parameter-modules", "POST", { name: "Legacy business", kind: "business" }, 201).item;
  const driver = http("/api/v2/parameter-modules/driver-registry", "POST", { displayName: "Legacy driver", businessCategoryId: business.id, compatibles: ["wiseeff,minimal"] }, 201).item;
  const actualDriver = http("/api/v1/parameter-modules").items.find((item: { id: string }) => item.id === driver.id);
  http("/api/v2/parameter-specs", "POST", { attributionSubjectId: actualDriver.attributionSubjectId, propertyKey: "legacy-voltage",
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 }, constraints: { cells: 1 }, documentation: "Retained old parameter", reason: "synthetic source" }, 201);
  const logBytes = Buffer.from("2026-09-09T00:00:00Z INFO isolated original source\n");
  const upload = inApi(httpScript, { route: "/api/v1/log-files", method: "POST", token,
    body: { fileName: "original.log", contentType: "text/plain", contentBase64: logBytes.toString("base64") } });
  let jobId: string;
  if (upload.status === 201) jobId = upload.body.job.id;
  else {
    assert.equal(upload.status, 500);
    assert.equal(upload.body.error.code, "INTERNAL_ERROR");
    // Reuse the fixed old fixture's explicit native producer for its observed
    // colon-ID defect. It consumes only the exact HTTP-created job, and does
    // not relabel the failed HTTP upload as a success or change the old image.
    jobId = inApi(`
      import{readFileSync}from'node:fs';import{Job,Queue}from'bullmq';
      import{createPostgresDatabase}from'./server/shared/database/client.ts';
      const p=JSON.parse(readFileSync(0,'utf8')),db=createPostgresDatabase(process.env.DATABASE_URL);
      const q=new Queue('log-analysis',{connection:{url:process.env.REDIS_URL},prefix:process.env.LOG_ANALYSIS_QUEUE_PREFIX});
      try {
        const r=await db.query("select j.id,lr.id as log_id,lar.id as run_id,j.status from jobs j join log_analysis_runs lar on lar.id=j.target_id join log_records lr on lr.id=lar.log_record_id join log_file_objects f on f.id=lr.file_object_id where j.organization_id=$1 and lr.organization_id=$1 and lar.organization_id=$1 and f.organization_id=$1 and j.kind='log-analysis' and j.target_type='log-analysis-run' and lr.current_run_id=lar.id and lr.submitted_by_user_id=$2 and f.uploaded_by_user_id=$2 and f.file_name='original.log' and f.checksum_sha256=$3",[p.organizationId,p.userId,p.checksum]);
        if(r.rows.length!==1||r.rows[0].status!=='queued')throw Error('legacy-job-scope');
        const row=r.rows[0];let rejected=false;
        try{Job.prototype.validateOptions.call({opts:{jobId:'log-analysis:'+row.id},name:'analyze-log'},{data:'{}'})}
        catch(e){if(e.message==='Custom Id cannot contain :')rejected=true;else throw e}
        if(!rejected||(await q.getJobs(['wait','active','delayed','completed','failed','paused'],0,-1)).length)throw Error('legacy-delivery-ambiguous');
        await q.add('analyze-log',{organizationId:p.organizationId,logId:row.log_id,runId:row.run_id,jobId:row.id},{jobId:'owned-legacy-'+row.id,attempts:1,removeOnComplete:false,removeOnFail:false});
        console.log(JSON.stringify(row.id));
      }finally{await q.close();await db.close()}
    `, { organizationId: admin.organizationId, userId: admin.userId, checksum: createHash("sha256").update(logBytes).digest("hex") });
  }
  await waitForJob(jobId);
  evidence.sourceBusiness = { projectId, nodeId: node.id, legacyParameterCreated: true,
    originalHttpUploadStatus: upload.status, originalJobCompleted: true,
    delivery: upload.status === 201 ? "original-http" : "original-http-500-native-test-producer" };
  writeFileSync(path.join(directory, "private-source-rows.json"), JSON.stringify(observeRows()), { mode: 0o600 });
  writeFileSync(path.join(directory, "private-source-objects.json"), JSON.stringify(observeObjects()), { mode: 0o600 });
  writeFileSync(path.join(directory, "private-source-queue.json"), JSON.stringify(observeQueue()), { mode: 0o600 });
  record();
  step = "candidate-checkout";
  run("git", ["checkout", "--detach", candidateSha], { cwd: checkout });
  const upgradeArgs = (...args: string[]) => ["scripts/upgrade.sh", ...args, "--env-file", envFile,
    "--state-dir", path.join(directory, "runs"), "--backup-root", path.join(directory, "backups")];
  const upgrade = (...args: string[]) => run("bash", upgradeArgs(...args), { cwd: composeDir, env });
  step = "wrong-target-before-side-effects";
  const originalContainers = ["api", "worker", "web", "proxy"].map(owned);
  const wrongTarget = spawnSync("bash", upgradeArgs("plan", "--ref", sourceSha, "--parameter-data-mode", "new-empty"),
    { cwd: composeDir, env, encoding: "utf8" });
  assert.equal(wrongTarget.status, 10);
  assert.ok(wrongTarget.stderr.includes("target does not implement the new-empty parameter route"));
  assert.deepEqual(["api", "worker", "web", "proxy"].map(owned), originalContainers);
  await ready();
  evidence.wrongTargetRejectedBeforeDowntime = true;
  step = "terminal-plan";
  evidence.plan = JSON.parse(upgrade("plan", "--ref", candidateSha, "--parameter-data-mode", "new-empty", "--json"));
  record();
  step = "terminal-apply";
  const upgradeRunId = `${project}-upgrade`;
  upgrade("apply", "--run-id", upgradeRunId, "--ref", candidateSha, "--parameter-data-mode", "new-empty", "--non-interactive", "--yes");
  step = "candidate-business";
  await ready();
  const originalRows: TableObservation[] = JSON.parse(readFileSync(path.join(directory, "private-source-rows.json"), "utf8"));
  evidence.preservation = assertPreserved(originalRows, observeRows(originalRows));
  assert.ok(JSON.stringify(observeObjects()) === readFileSync(path.join(directory, "private-source-objects.json"), "utf8"), "preservation: original object bytes or metadata changed");
  evidence.originalObjectsPreserved = true;
  token = http("/api/v1/auth/login", "POST", { username: account.username, password }).token;
  assert.ok(http("/api/v1/debugging/admin/nodes").items.some((item: { id: string }) => item.id === node.id));
  const adminToken = token;
  token = http("/api/v1/auth/login", "POST", member).token;
  assert.ok(http("/api/v1/me").roles.some((role: { projectId: string; roleId: string }) =>
    role.projectId === projectId && role.roleId === "software-user"), "original project role must survive");
  http("/api/v1/debugging/admin/nodes", "GET", undefined, 403);
  token = adminToken;
  evidence.originalMemberLoginAndPermissionIsolation = true;
  assert.deepEqual(http("/api/v2/catalog"), { item: null, publicationState: "unpublished" });
  assert.ok(JSON.stringify(observeQueue()) === readFileSync(path.join(directory, "private-source-queue.json"), "utf8"), "preservation: actual original queue task changed");
  const newUpload = http("/api/v1/log-files", "POST", { fileName: "candidate.log", contentType: "text/plain",
    contentBase64: Buffer.from("INFO actual candidate worker task\n").toString("base64") }, 201);
  await waitForJob(newUpload.job.id);
  evidence.candidateHttpUploadAndWorkerCompleted = true;
  evidence.terminalUpgradeAndOriginalLogin = true;
  evidence.candidateImageId = JSON.parse(docker("inspect", owned("api")))[0].Image;
  step = "candidate-browser-empty-and-original-node";
  mkdirSync(browserDirectory, { mode: 0o700 });
  browserOpened = true;
  browser("open", "http://127.0.0.1:18080", "--browser=chrome");
  const browserLogin = browserCode(`async page => {
    await page.getByLabel('用户名', {exact:true}).fill(${JSON.stringify(account.username)});
    await page.getByLabel('密码', {exact:true}).fill(${JSON.stringify(password)});
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST'),
      page.locator('form').getByRole('button', {name:'登录', exact:true}).click()
    ]);
    const session = await response.json();
    return {sessionToken: session.token};
  }`);
  const browserSession = JSON.parse(browserLogin.match(/^### Result\n([^\n]+)\n/m)?.[1] ?? "null");
  assert.ok(typeof browserSession?.sessionToken === "string" && browserSession.sessionToken.length > 0,
    "browser login must return its actual session for evidence redaction");
  secrets.push(browserSession.sessionToken);
  browserCode(`async page => { await page.getByRole('main', {name:'雷泽首页', exact:true}).waitFor(); }`);
  captureBrowser("unpublished", `async page => {
    await page.goto('http://127.0.0.1:18080/parameter-admin/specs');
    await page.getByText('尚无首个 Catalog 发布。旧参数不会自动迁入；请先发布真实参数定义。', {exact:true}).waitFor();
    if (await page.getByRole('region', {name:'目录列表', exact:true}).count()) throw new Error('unpublished page rendered a publication workspace');
  }`);
  captureBrowser("original-node", `async page => {
    const waitValue = async (box, expected, message) => {
      await box.waitFor();
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await box.inputValue() === expected) return;
        await page.waitForTimeout(100);
      }
      throw new Error(message);
    };
    await page.goto('http://127.0.0.1:18080/debugging-admin/nodes');
    await page.getByRole('cell', {name:'Preserved node', exact:true}).click();
    const editor = page.getByRole('dialog', {name:'编辑节点', exact:true});
    await editor.waitFor();
    await waitValue(editor.getByRole('textbox', {name:'名称', exact:true}), 'Preserved node', 'original node name changed');
    await editor.getByRole('button', {name:'取消', exact:true}).click();
    await page.getByRole('button', {name:'路径绑定', exact:true}).click();
    const bindings = page.getByRole('dialog', {name:'Preserved node', exact:true});
    await bindings.waitFor();
    await waitValue(bindings.getByRole('textbox', {name:'HDC 节点路径', exact:true}), '/minimal/node', 'original node path changed');
  }`);
  evidence.browser = { viewports: [[1440, 900], [768, 1024], [390, 844]],
    observed: ["original-user-login", "unpublished-page", "original-node-details"],
    visualAndConsoleReview: "pending", parameterEditSaveImport: "not-executed" };
  step = "first-real-catalog-publication";
  const fixture = validCatalogReleaseBundle();
  const first = { schemaVersion: fixture.schemaVersion, targetReleaseId: fixture.releases[0].manifest.release.id, releases: [fixture.releases[0]] };
  const compiled = await compileCatalogRelease(first);
  assert.ok(compiled.ok, "synthetic repository bundle must compile");
  run("docker", ["exec", "-i", owned("api"), "sh", "-c", "cat > /tmp/minimal-reviewed-bundle.json"], { input: JSON.stringify(first) });
  run("docker", ["exec", owned("api"), "node", "--import", "tsx", "scripts/install-catalog-release.ts",
    "/tmp/minimal-reviewed-bundle.json", "--confirm-digest", compiled.value.aggregateDigest]);
  assert.equal(http("/api/v2/catalog").item.catalogReleaseId, first.targetReleaseId);
  step = "published-normal-restart";
  compose("restart", "api", "worker");
  await ready();
  assert.equal(JSON.parse(docker("inspect", owned("api")))[0].Image, evidence.candidateImageId);
  assert.equal(http("/api/v2/catalog").item.catalogReleaseId, first.targetReleaseId);
  evidence.firstPublicationAndNormalRestart = { releaseId: first.targetReleaseId, digest: compiled.value.aggregateDigest,
    input: "repository compiler fixture via actual management CLI; not page editing" };
  captureBrowser("published-after-restart", `async page => {
    await page.goto('http://127.0.0.1:18080/parameter-admin/specs');
    await page.getByLabel('目录发布', {exact:true}).getByText(${JSON.stringify(first.targetReleaseId)}, {exact:true}).waitFor();
  }`);
  step = "page-register-published-subject";
  const driverGroups = inApi(`
    import{createPostgresDatabase}from'./server/shared/database/client.ts';
    const db=createPostgresDatabase(process.env.DATABASE_URL);
    try{const r=await db.query("select count(*)::int as c from parameter_modules where kind='driver-group'");console.log(JSON.stringify(Number(r.rows[0]?.c??0)>0))}finally{await db.close()}
  `);
  if (!driverGroups) {
    http("/api/v2/parameter-modules/driver-registry", "POST", {
      displayName: "Published driver", businessCategoryId: business.id, compatibles: ["acme,power"]
    }, 201);
  }
  const registered = browserJson(browserCode(`async page => {
    const dismiss = page.getByRole('button', {name:'不再提示'});
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click({force:true});
    await page.goto('http://127.0.0.1:18080/parameter-admin/specs');
    await page.getByRole('region', {name:'参数定义目录'}).waitFor();
    const subject = page.getByRole('list', {name:'主体列表'}).getByRole('button', {name:/acme,power/});
    await subject.waitFor();
    await subject.click();
    const register = page.getByRole('button', {name:'登记主体', exact:true});
    await register.waitFor();
    await register.click();
    const dialog = page.getByRole('dialog', {name:'登记主体', exact:true});
    await dialog.waitFor();
    await dialog.getByRole('radio', {name:'使用默认根放置'}).click();
    await dialog.getByRole('textbox', {name:'原因'}).fill('minimal-upgrade-page-register');
    await dialog.getByRole('button', {name:'继续确认', exact:true}).click();
    const confirm = page.getByRole('dialog', {name:'确认登记主体', exact:true});
    await confirm.waitFor();
    await confirm.getByRole('checkbox').check();
    await confirm.getByRole('button', {name:'确认登记', exact:true}).click();
    await dialog.waitFor({state:'detached'});
    await page.getByRole('button', {name:'调整放置', exact:true}).waitFor();
    return {registered:true};
  }`));
  assert.equal(registered?.registered, true);
  assert.ok(readPublishedValues(projectId).registrations >= 1, "page registration must persist an active subject");
  captureBrowser("registered-subject", `async page => {
    await page.goto('http://127.0.0.1:18080/parameter-admin/specs');
    await page.getByRole('list', {name:'主体列表'}).getByRole('button', {name:/acme,power.*已登记/}).waitFor();
  }`);
  step = "initialize-preserved-project";
  const initialization = http(`/api/v1/parameters/projects/${projectId}/initialization`);
  if (initialization.status !== "initialized" && initialization.status !== "maintenance") {
    const pending = (http("/api/v1/parameters/admin/initialization-reviews").items as Array<{ id: string; projectId: string }>)
      .find((item) => item.projectId === projectId);
    let reviewId = pending?.id;
    if (!reviewId) {
      http(`/api/v1/parameters/projects/${projectId}/initialization/draft`, "PUT", {
        projectName: "Preserved project",
        projectCode: "MIN",
        ownerUserId: admin.userId,
        sourceProjectIds: [],
        primarySourceProjectId: null,
        supplementSourceProjectIds: [],
        selectedModuleIds: [],
        selectedRisks: [],
        selectedSourceBindingIds: [],
        bindingSnapshots: [],
        emptyLibrary: true,
        notes: "minimal-upgrade-empty-library"
      });
      reviewId = http(`/api/v1/parameters/projects/${projectId}/initialization/submit`, "POST", {}, 201).item.id;
    }
    http(`/api/v1/parameters/admin/initialization-reviews/${reviewId}/approve`, "POST", {});
  }
  assert.ok(["initialized", "maintenance"].includes(
    http(`/api/v1/parameters/projects/${projectId}/initialization`).status
  ), "project must be initialized before workbench save");
  step = "dts-ingest-published-value";
  const listedSets = http(`/api/v1/projects/${projectId}/config-sets`).items as Array<{ id: string; name: string }>;
  const configSet = listedSets.find((item) => item.name === "default")
    ?? http(`/api/v1/projects/${projectId}/config-sets`, "POST", {
      name: "default", description: "minimal published project value"
    }, 201).item;
  const uploaded = http(`/api/v1/projects/${projectId}/parameter-files`, "POST", {
    fileName: "charger.dts", contentBase64: Buffer.from(publishedDts).toString("base64")
  }, 201);
  http(`/api/v1/projects/${projectId}/config-sets/${configSet.id}/files`, "POST", {
    fileId: uploaded.item.id, role: "base", sortOrder: 0
  }, 201);
  http(`/api/v1/projects/${projectId}/parameter-files`, "POST", {
    fileName: "charger.dts", contentBase64: Buffer.from(publishedDts).toString("base64")
  }, 201);
  await waitForPublishedValue(projectId, 1000);
  step = "page-read-published-value";
  captureBrowser("published-value-1000", `async page => {
    await page.goto('http://127.0.0.1:18080/parameters');
    const project = page.getByRole('combobox', {name:'项目'});
    if (await project.count()) {
      const current = await project.innerText();
      if (!current.includes('Preserved project')) {
        await project.click();
        await page.getByRole('option', {name:/Preserved project/}).click();
      }
    }
    await page.getByRole('region', {name:'DTS 参数工作台'}).waitFor();
    await page.getByText('iin_max', {exact:true}).waitFor();
    await page.getByText('<1000>', {exact:true}).waitFor();
  }`);
  step = "page-edit-save-published-value";
  browser("resize", "1440", "900");
  const saved = browserJson(browserCode(`async page => {
    await page.goto('http://127.0.0.1:18080/parameters');
    await page.getByRole('region', {name:'DTS 参数工作台'}).waitFor();
    await page.getByRole('button', {name:/编辑 iin_max/}).click();
    const dialog = page.getByRole('dialog', {name:'修改草稿', exact:true});
    await dialog.waitFor();
    await dialog.getByRole('textbox', {name:'目标值'}).fill('<2000>');
    await dialog.getByRole('textbox', {name:'修改原因'}).fill('raise published input current');
    await dialog.getByRole('button', {name:'校验并加入本轮', exact:true}).click();
    await dialog.waitFor({state:'detached'});
    if (await page.getByRole('region', {name:'本轮已修改'}).count()) throw new Error('canonical save opened the review draft tray');
    await page.getByText('<2000>', {exact:true}).waitFor();
    return {saved:true};
  }`));
  assert.equal(saved?.saved, true);
  await waitForPublishedValue(projectId, 2000);
  captureBrowser("published-value-2000", `async page => {
    await page.goto('http://127.0.0.1:18080/parameters');
    await page.getByRole('region', {name:'DTS 参数工作台'}).waitFor();
    await page.getByText('<2000>', {exact:true}).waitFor();
    if (await page.getByRole('region', {name:'本轮已修改'}).count()) throw new Error('saved value still has a draft tray');
  }`);
  step = "page-import-published-value";
  browser("resize", "1440", "900");
  const importJson = JSON.stringify([{
    name: "iin_max", module: "Driver", currentValue: "3000", configFormat: "DTS", risk: "Low"
  }]);
  const imported = browserJson(browserCode(`async page => {
    await page.goto('http://127.0.0.1:18080/parameter-admin/specs');
    await page.getByRole('button', {name:'打开批量参数导入'}).click();
    const dialog = page.getByRole('dialog', {name:'批量参数导入'});
    await dialog.waitFor();
    await dialog.locator('select').selectOption(${JSON.stringify(projectId)});
    await dialog.getByRole('button', {name:'粘贴 JSON / CSV / DTS 内容'}).click();
    const paste = page.getByRole('dialog', {name:'粘贴导入内容'});
    await paste.waitFor();
    await paste.getByLabel('导入内容').fill(${JSON.stringify(importJson)});
    await paste.getByRole('button', {name:'确认', exact:true}).click();
    await dialog.getByRole('button', {name:'下一步', exact:true}).click();
    await dialog.getByRole('region', {name:'解析与校验'}).waitFor();
    await dialog.getByRole('button', {name:'下一步', exact:true}).click();
    await dialog.getByRole('region', {name:'逐行核对'}).waitFor();
    if (await dialog.getByRole('button', {name:'预填并创建'}).count()) throw new Error('import treated the published value as a new definition');
    await dialog.getByRole('button', {name:'通过', exact:true}).click();
    await dialog.getByRole('button', {name:'下一步', exact:true}).click();
    const preview = dialog.getByRole('region', {name:'批次预览'});
    await preview.waitFor();
    await preview.getByText('正在生成导入预览…').waitFor({state:'hidden'}).catch(() => undefined);
    let text = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      text = await preview.innerText();
      if (/更新\\s*1/.test(text) && /新增\\s*0/.test(text)) break;
      await page.waitForTimeout(250);
    }
    if (!/更新\\s*1/.test(text) || !/新增\\s*0/.test(text)) throw new Error('import preview must update the existing value: '+text);
    await dialog.getByRole('button', {name:'下一步', exact:true}).click();
    await dialog.getByRole('button', {name:'确认应用', exact:true}).click();
    await dialog.waitFor({state:'detached'});
    return {imported:true};
  }`));
  assert.equal(imported?.imported, true);
  await waitForPublishedValue(projectId, 3000);
  captureBrowser("published-value-3000", `async page => {
    await page.goto('http://127.0.0.1:18080/parameters');
    await page.getByRole('region', {name:'DTS 参数工作台'}).waitFor();
    await page.getByText('<3000>', {exact:true}).waitFor();
  }`);
  step = "published-value-restart-reread";
  compose("restart", "api", "worker");
  await ready();
  await waitForPublishedValue(projectId, 3000);
  captureBrowser("published-value-after-restart", `async page => {
    await page.goto('http://127.0.0.1:18080/parameters');
    await page.getByRole('region', {name:'DTS 参数工作台'}).waitFor();
    await page.getByText('<3000>', {exact:true}).waitFor();
  }`);
  evidence.pageProjectValues = { registeredSubject: "csub_acme_power", ingested: 1000, saved: 2000, imported: 3000, restartReread: 3000 };
  evidence.browser = { viewports: [[1440, 900], [768, 1024], [390, 844]],
    observed: ["original-user-login", "unpublished-page", "original-node-details", "published-after-restart",
      "registered-subject", "published-value-1000", "published-value-2000", "published-value-3000", "published-value-after-restart"],
    visualAndConsoleReview: "pending", parameterEditSaveImport: "executed" };
  step = "same-sha-no-op";
  upgrade("apply", "--ref", candidateSha, "--non-interactive", "--yes");
  assert.equal(http("/api/v2/catalog").item.catalogReleaseId, first.targetReleaseId);
  evidence.sameShaDidNotResetCatalog = true;
  step = "terminal-whole-state-restore";
  upgrade("rollback", "--run-id", upgradeRunId, "--restore-data", "--confirm", `restore-${upgradeRunId}`, "--non-interactive", "--yes");
  await ready();
  const restoreOracle: TableObservation[] = JSON.parse(readFileSync(path.join(directory, "private-source-rows.json"), "utf8"));
  evidence.restoredRows = assertPreserved(restoreOracle, observeRows(restoreOracle));
  assert.ok(JSON.stringify(observeObjects()) === readFileSync(path.join(directory, "private-source-objects.json"), "utf8"), "restore: original object bytes or metadata changed");
  evidence.originalObjectsRestored = true;
  assert.ok(JSON.stringify(observeQueue()) === readFileSync(path.join(directory, "private-source-queue.json"), "utf8"), "restore: actual original queue payload or state changed");
  evidence.originalQueueRestored = true;
  step = "interrupted-management-migration";
  run("git", ["checkout", "--detach", candidateSha], { cwd: checkout });
  const interruptionRunId = `${project}-interrupted`;
  activeUpgradeRunId = interruptionRunId;
  const previousPostgres = owned("postgres");
  const interruptionLog = openSync(path.join(directory, "private-interruption.log"), "w", 0o600);
  interruptionChild = spawn("bash", upgradeArgs("apply", "--run-id", interruptionRunId, "--ref", candidateSha,
    "--parameter-data-mode", "new-empty", "--non-interactive", "--yes"), { cwd: composeDir, env,
    stdio: ["ignore", interruptionLog, interruptionLog] });
  closeSync(interruptionLog);
  const interruptionExit = new Promise<number | null>((resolve, reject) => {
    interruptionChild!.once("error", reject);
    interruptionChild!.once("exit", resolve);
  });
  let postgres = "";
  // The controller recreates the data plane. Acquire the test lock on the new
  // PostgreSQL process, before its health gate admits the migration container.
  for (let attempt = 0; attempt < 180 && interruptionChild.exitCode === null; attempt++) {
    const current = compose("ps", "-aq", "postgres");
    if (/^[a-f0-9]{64}$/.test(current) && current !== previousPostgres &&
      spawnSync("docker", ["exec", current, "psql", "-U", "wiseeff", "-d", "wiseeff", "-Atc", "select 1"],
        { env: launchEnv, stdio: "ignore" }).status === 0) { postgres = current; break; }
    await setTimeout(1000);
  }
  assert.ok(postgres, `interruption: replacement PostgreSQL was not observed; controller exit=${interruptionChild.exitCode}`);
  const applicationName = `minimal-interruption-${project}`;
  const blocker = spawn("docker", ["exec", "-e", `PGAPPNAME=${applicationName}`, postgres, "psql", "-U", "wiseeff",
    "-d", "wiseeff", "-v", "ON_ERROR_STOP=1", "-c",
    "begin; lock table public.parameter_drafts in share mode; select pg_sleep(600); rollback;"], { env: launchEnv, stdio: "ignore" });
  const blockerExit = new Promise<void>(resolve => blocker.once("exit", () => resolve()));
  const sql = (query: string) => docker("exec", postgres, "psql", "-U", "wiseeff", "-d", "wiseeff", "-Atc", query);
  let killed = false;
  try {
    for (let attempt = 0; attempt < 120 && interruptionChild.exitCode === null; attempt++) {
      const waiting = sql("select count(*) from pg_locks where relation='public.parameter_drafts'::regclass and not granted");
      if (Number(waiting) > 0) {
        const ids = docker("ps", "-q", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`)
          .split(/\s+/).filter(Boolean);
        const migrations = ids.map(id => JSON.parse(docker("inspect", id))[0]).filter(container =>
          container.Config.Labels["com.docker.compose.oneoff"] === "True" &&
          JSON.stringify(container.Config.Cmd) === JSON.stringify(["npm", "run", "db:migrate"]));
        assert.equal(migrations.length, 1, "interruption: require the actual owned migration process");
        assert.equal(migrations[0].Image, JSON.parse(docker("image", "inspect", `${project}:${candidateSha}`))[0].Id);
        evidence.interruptedCandidateImageId = migrations[0].Image;
        assert.equal(migrations[0].Config.Labels["com.docker.compose.project.working_dir"], composeDir);
        docker("kill", "--signal", "KILL", migrations[0].Id);
        killed = true;
        break;
      }
      await setTimeout(1000);
    }
    assert.ok(killed, "interruption: no blocked migration was killed; do not count a missed injection");
    assert.equal(await interruptionExit, 70);
  } finally {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${applicationName}' and datname=current_database()`);
    await blockerExit;
  }
  const interruptionState = (key: string) => readFileSync(path.join(directory, "runs", interruptionRunId, key), "utf8").trim();
  assert.equal(interruptionState("outcome"), "recovery-required");
  assert.equal(interruptionState("migration_started"), "true");
  for (const service of ["proxy", "worker"]) assert.equal(JSON.parse(docker("inspect", owned(service)))[0].State.Running, false);
  const queueState = compose("run", "--rm", "--no-deps", "-T", "api", "node", "--input-type=module", "-e",
    "import{Queue}from'bullmq';const q=new Queue('log-analysis',{connection:{url:process.env.REDIS_URL},prefix:process.env.LOG_ANALYSIS_QUEUE_PREFIX});try{console.log(JSON.stringify({paused:await q.isPaused()}))}finally{await q.close()}");
  assert.equal(JSON.parse(queueState).paused, true);
  const resume = spawnSync("bash", upgradeArgs("resume", "--run-id", interruptionRunId, "--non-interactive", "--yes"),
    { cwd: composeDir, env, encoding: "utf8" });
  assert.equal(resume.status, 70, "a migration failure requires explicit recovery, not automatic traffic resume");
  evidence.interruptedMigration = { actualMigrationKilled: killed, outcome: interruptionState("outcome"),
    proxyStopped: true, workerStopped: true, queuePaused: true, ordinaryResumeExit: resume.status };
  step = "interrupted-migration-explicit-restore";
  upgrade("rollback", "--run-id", interruptionRunId, "--restore-data", "--confirm", `restore-${interruptionRunId}`, "--non-interactive", "--yes");
  await ready();
  evidence.interruptionRestore = assertPreserved(restoreOracle, observeRows(restoreOracle));
  assert.equal(JSON.stringify(observeObjects()), readFileSync(path.join(directory, "private-source-objects.json"), "utf8"));
  assert.equal(JSON.stringify(observeQueue()), readFileSync(path.join(directory, "private-source-queue.json"), "utf8"));
  evidence.nextStage = "independent-review-and-required-ci";
} catch (error) {
  evidence.failedStage = step;
  evidence.failure = sanitizeGate0DiagnosticText(error instanceof Error ? error.message : "minimal-terminal-failed", secrets).value;
  evidence.lastHealth = sanitizeGate0DiagnosticText(JSON.stringify(lastHealth ?? null), secrets).value;
  evidence.commandFailure = lastCommandFailure;
  if (browserOpened) {
    try { captureBrowserText("failed-stage"); }
    catch { evidence.browserDiagnostics = "unavailable"; }
  }
  if (interruptionChild) {
    evidence.interruptionDiagnostics = sanitizeGate0DiagnosticText(
      readFileSync(path.join(directory, "private-interruption.log"), "utf8"), secrets).value.slice(-6000);
  }
  const journal: Record<string, string> = {};
  for (const key of ["phase", "outcome", "failure_code", "migration_started", "parameter_initialization",
    "recovery_proxy_stopped", "recovery_queue_paused", "next_action"]) {
    try { journal[key] = readFileSync(path.join(directory, "runs", activeUpgradeRunId, key), "utf8").trim(); }
    catch { /* A failure before run creation has no controller journal. */ }
  }
  evidence.controllerJournal = journal;
  evidence.requestedControllerRunId = activeUpgradeRunId;
  if (created) {
    try {
      const state = JSON.parse(docker("inspect", owned("api")))[0].State;
      evidence.apiProcess = { status: state.Status, exitCode: state.ExitCode, oomKilled: state.OOMKilled };
    } catch { evidence.apiProcess = "unavailable"; }
    try { evidence.apiDiagnostics = sanitizeGate0DiagnosticText(compose("logs", "--no-color", "--tail", "40", "api"), secrets).value.slice(-6000); }
    catch { evidence.apiDiagnostics = "unavailable"; }
    try { evidence.proxyDiagnostics = sanitizeGate0DiagnosticText(compose("logs", "--no-color", "--tail", "20", "proxy"), secrets).value.slice(-3000); }
    catch { evidence.proxyDiagnostics = "unavailable"; }
  }
  process.exitCode = 1;
} finally {
  if (browserOpened) {
    try { browser("close"); } catch { evidence.browserCleanup = "incomplete"; process.exitCode = 1; }
  }
  if (interruptionChild && interruptionChild.exitCode === null) interruptionChild.kill("SIGTERM");
  if (created) {
    try {
      const ids = docker("ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${project}`).split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const labels = JSON.parse(docker("inspect", id))[0].Config.Labels;
        assert.equal(labels["com.docker.compose.project"], project);
        assert.equal(labels["com.docker.compose.project.working_dir"], composeDir);
      }
      compose("down", "--volumes", "--remove-orphans");
      evidence.cleanup = "complete";
    } catch { evidence.cleanup = "incomplete"; process.exitCode = 1; }
  }
  record();
  // Publish only after the CLI and deployment cleanup attempts have finished.
  // A killed owner cannot publish a partial raw tree through the CI fallback.
  const staging = mkdtempSync(path.join(directory, "private-upload-staging-"));
  copyFileSync(path.join(directory, "evidence.json"), path.join(staging, "evidence.json"));
  if (existsSync(browserDirectory)) {
    for (const name of readdirSync(browserDirectory)) {
      const source = path.join(browserDirectory, name);
      assert.ok(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), "browser evidence must be regular files");
      copyFileSync(source, path.join(staging, name));
    }
  }
  await sanitizeGate0ArtifactTree(staging, undefined, secrets);
  assert.equal((await scanGate0ArtifactTree(staging, undefined, secrets)).violations.length, 0, "unsafe evidence staging");
  const archiveDirectory = mkdtempSync(path.join(directory, "private-upload-archive-"));
  const archive = path.join(archiveDirectory, "evidence.zip");
  await writeZipArchive(staging, archive);
  assert.equal((await scanGate0ArtifactTree(archiveDirectory, undefined, secrets)).violations.length, 0, "unsafe evidence archive");
  chmodSync(archive, 0o444);
  const archiveFd = openSync(archive, "r");
  try { fsyncSync(archiveFd); } finally { closeSync(archiveFd); }
  renameSync(archive, path.join(directory, "evidence.zip"));
  console.log(JSON.stringify({ evidence: path.join(directory, "evidence.json"), failedStage: evidence.failedStage ?? null, complete: false }));
}
