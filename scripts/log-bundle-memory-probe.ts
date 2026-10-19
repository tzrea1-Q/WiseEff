import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { bundleFileUtf8Bytes, defaultBundleLimits, intakeLogBundle, MAX_LOG_JSON_UPLOAD_BYTES, type BundleFile } from "../server/modules/logs/bundleIntake";

const MiB = 1024 * 1024;
const fileSizes = [32, 32, 31].map((size) => size * MiB);

function buildArchive() {
  const content = Buffer.alloc(Math.max(...fileSizes));
  content.fill(`INFO device=probe status=healthy message=${"a".repeat(4056)}\n`);
  const members: Buffer[] = [];
  for (const [index, size] of fileSizes.entries()) {
    const data = content.subarray(0, size);
    const header = Buffer.alloc(512);
    header.write(`device-${index}.log`, 0, 100);
    header.write("0000644\0", 100);
    header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    // Concatenated gzip members decode to one tar. Store 1 MiB per file without
    // compression so repetitive logs stay below the intake's 200x ratio ceiling.
    members.push(gzipSync(header), gzipSync(data.subarray(0, MiB), { level: 0 }),
      gzipSync(data.subarray(MiB), { level: 1 }));
  }
  members.push(gzipSync(Buffer.alloc(1024)));
  return Buffer.concat(members);
}

function probeIntake() {
const started = performance.now();
const archive = buildArchive();
const unpackedBytes = fileSizes.reduce((sum, size) => sum + size, 0);
assert(archive.length <= defaultBundleLimits.maxCompressedBytes);
assert(unpackedBytes + fileSizes.length * 512 + 1024 <= defaultBundleLimits.maxUnpackedBytes);
assert(unpackedBytes + fileSizes.length * 512 + 1024 <= archive.length * 200);
const result = intakeLogBundle({ fileName: "memory-probe.tar.gz", bytes: archive });
function storeToThrowawaySink(file: BundleFile) {
  // Use the service's encoding path, then copy one object as an object-store sink would.
  return Buffer.from(bundleFileUtf8Bytes(file)).byteLength;
}
let storedBytes = 0;
if (result.ok) {
  for (const file of result.files) {
    if (file.status === "analyzed") storedBytes += storeToThrowawaySink(file);
    delete file.bytes;
  }
}
const memory = process.memoryUsage();
console.log(JSON.stringify({
  ok: result.ok,
  files: result.ok ? result.files.length : 0,
  ...(result.ok ? {} : { reason: result.reason }),
  unpackedMiB: unpackedBytes / MiB,
  storedMiB: storedBytes / MiB,
  compressedMiB: archive.length / MiB,
  ratio: unpackedBytes / archive.length,
  elapsedMs: performance.now() - started,
  peakRssMiB: process.resourceUsage().maxRSS / 1024,
  heapUsedMiB: memory.heapUsed / MiB
}, null, 2));
assert(result.ok, "Bundle intake failed; see reason above");
assert.equal(storedBytes, unpackedBytes);
}

// Generation and HTTP clients run in separate processes: their buffers never
// contribute to the measured API/worker process's lifetime maximum RSS.
const arg = (name: string, fallback = "") => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const mode = arg("mode", "worker"), phase = arg("phase"), profile = arg("profile", "configured");
const fixtureDir = arg("fixture-dir");
const chunked = arg("chunked") === "true";
const script = fileURLToPath(import.meta.url);
type Manifest = { files: Array<BundleFile & { objectKey: string }>; unpackedBytes: number; archiveBytes?: number };
const line = Buffer.from("INFO device=probe status=healthy".padEnd(1023, " ") + "\n");

function* payload(size: number, index: number) {
  const block = Buffer.alloc(64 * 1024); block.fill(line);
  for (let left = size - 1024; left > 0;) {
    const take = Math.min(block.length, left); yield block.subarray(0, take); left -= take;
  }
  yield Buffer.from(`ERROR STREAM_PROBE_EOF file=${index}`.padEnd(1023, " ") + "\n");
}

function tarHeader(name: string, size: number) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100); header.write("0000644\0", 100);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124); header.fill(32, 148, 156);
  header.write("0", 156); header.write("ustar\0", 257);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

async function generate() {
  const limits = profile === "spec" ? { maxCompressedBytes: 100 * MiB, maxUnpackedBytes: 512 * MiB, maxFiles: 2000, maxFileBytes: 200 * MiB }
    : profile === "smoke" ? { maxCompressedBytes: 2 * MiB, maxUnpackedBytes: 2 * MiB, maxFiles: 8, maxFileBytes: MiB }
    : (await import("../server/config/env")).loadLogBundleLimits(process.env);
  const manifest: Manifest = { files: [], unpackedBytes: 0 };
  if (mode.startsWith("api-")) {
    const size = Math.floor((Math.min(limits.maxCompressedBytes, limits.maxUnpackedBytes, mode === "api-json" ? MAX_LOG_JSON_UPLOAD_BYTES : Infinity) - 2048) / 2048) * 1024;
    await pipeline(Readable.from((function* () {
      for (let index = 0; index < 2; index++) { yield tarHeader(`device-${index}.log`, size); yield* payload(size, index); }
      yield Buffer.alloc(1024);
    })()), createWriteStream(join(fixtureDir, "upload.tar")));
    manifest.archiveBytes = size * 2 + 2048; manifest.unpackedBytes = size * 2;
  } else {
    const count = limits.maxFiles;
    assert(count >= 2 && limits.maxUnpackedBytes >= count * 1024);
    const first = Math.floor(Math.min(limits.maxFileBytes, limits.maxUnpackedBytes / 2) / 1024) * 1024;
    let remaining = limits.maxUnpackedBytes - first;
    await mkdir(join(fixtureDir, "probe-org"), { recursive: true });
    for (let index = 0; index < count; index++) {
      const size = index ? Math.floor(remaining / (count - index) / 1024) * 1024 : first;
      if (index) remaining -= size;
      assert(size <= limits.maxFileBytes && size >= 1024);
      const path = `device-${String(index).padStart(4, "0")}.log`, objectKey = `probe-org/${path}`, hash = createHash("sha256");
      await pipeline(Readable.from((function* () { for (const chunk of payload(size, index)) { hash.update(chunk); yield chunk; } })()), createWriteStream(join(fixtureDir, objectKey)));
      manifest.files.push({ path, objectKey, sizeBytes: size, sha256: hash.digest("hex"), encoding: "utf-8", lossy: false,
        lineCount: size / 1024, status: "analyzed", skipReason: null });
      manifest.unpackedBytes += size;
    }
  }
  await writeFile(join(fixtureDir, "manifest.json"), JSON.stringify(manifest));
}

async function child(args: string[], capture = false) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", script, ...args], { stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"] });
    let output = "";
    proc.stdout?.on("data", (chunk) => { output += String(chunk); });
    proc.on("error", reject);
    proc.on("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`Probe child exited with code ${code}`)));
  });
}

async function sendUpload() {
  const manifest: Manifest = JSON.parse(await readFile(join(fixtureDir, "manifest.json"), "utf8"));
  const json = mode === "api-json", boundary = "wiseeff-memory-probe";
  const prefix = json ? '{"fileName":"cap.tar","contentType":"application/x-tar","contentBase64":"'
    : `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cap.tar"\r\nContent-Type: application/x-tar\r\n\r\n`;
  const suffix = json ? '"}' : `\r\n--${boundary}--\r\n`;
  const size = manifest.archiveBytes!;
  const length = Buffer.byteLength(prefix) + (json ? 4 * Math.ceil(size / 3) : size) + Buffer.byteLength(suffix);
  const req = request({ hostname: "127.0.0.1", port: Number(arg("port")), path: "/api/v1/log-files", method: "POST",
    headers: { "Content-Type": json ? "application/json" : `multipart/form-data; boundary=${boundary}`, ...(!chunked ? { "Content-Length": length } : {}) } });
  const response = new Promise<void>((resolve, reject) => {
    req.on("error", reject);
    req.on("response", (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 201) reject(new Error(`Upload failed (${res.statusCode}): ${body.slice(0, 1000)}`));
        else { const result = JSON.parse(body); assert(result.job && result.log.files.length === 2); resolve(); }
      });
    });
  });
  await pipeline(Readable.from((async function* () {
    yield prefix;
    // Multiples of three preserve base64 across chunk boundaries.
    for await (const chunk of createReadStream(join(fixtureDir, "upload.tar"), { highWaterMark: 48 * 1024 })) yield json ? (chunk as Buffer).toString("base64") : chunk;
    yield suffix;
  })()), req);
  await response;
}

async function measure() {
  assert(process.env.DATABASE_URL, "Set DATABASE_URL to a disposable test PostgreSQL cluster");
  const [{ createEphemeralTestDatabase }, { createPostgresDatabase }, { seedCoreGraph }, { makeTestAuthContext }, { createLocalObjectStore }, service] = await Promise.all([
    import("../server/testing/testDatabase"), import("../server/shared/database/client"), import("../server/testing/fixtures"),
    import("../server/testing/authContext"), import("../server/modules/logs/objectStore"), import("../server/modules/logs/service")
  ]);
  const ephemeral = await createEphemeralTestDatabase("logmemprobe"), db = createPostgresDatabase(ephemeral.url);
  const objectStore = createLocalObjectStore(fixtureDir);
  const auth = makeTestAuthContext({ organizationId: "probe-org", userId: "probe-admin", roles: [{ roleId: "admin", projectId: null }],
    permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
  const manifest: Manifest = JSON.parse(await readFile(join(fixtureDir, "manifest.json"), "utf8"));
  try {
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
    let result: Record<string, unknown>;
    if (mode.startsWith("api-")) {
      const [{ createRouter }, { createHttpServer }, { registerLogRoutes }, { resolveRouteBodyLimit }] = await Promise.all([
        import("../server/shared/http/router"), import("../server/shared/http/server"), import("../server/modules/logs/routes"), import("../server/app")
      ]);
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const server = createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); assert(address && typeof address !== "string");
      const started = performance.now();
      try {
        await child([`--phase=upload-client`, `--mode=${mode}`, `--fixture-dir=${fixtureDir}`, `--port=${address.port}`, `--chunked=${chunked}`], true);
        result = { ok: true, elapsedMs: performance.now() - started, compressedMiB: manifest.archiveBytes! / MiB };
      } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
    } else {
      const [{ createLogSkill, saveLogSkillDraft, publishLogSkill }, { createUserInvocation }, { insertLogFiles }, { processLogAnalysisJobById }] = await Promise.all([
        import("../server/modules/logs/skillsService"), import("../server/modules/auth/trustedInvocation"), import("../server/modules/logs/filesRepository"), import("../server/modules/logs/worker")
      ]);
      const invocation = createUserInvocation(auth), context = { requestId: "memory-probe" };
      const skill = await createLogSkill(db, auth, { name: "Streaming memory probe" }, invocation, context);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1",
        extractors: [{ id: "eof", pattern: "STREAM_PROBE_EOF file=(?P<file>\\d+)", fields: { file: { type: "uint" } } }] } }, null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const uploaded = await service.uploadLogFile(db, objectStore, auth, { fileName: "probe.log", contentType: "text/plain", bytes: Buffer.from("INFO seed\n"), logDomainId: skill.id });
      await db.query("delete from log_files where record_id=$1", [uploaded.log.id]);
      await insertLogFiles(db, auth.organization.id, uploaded.log.id, manifest.files);
      const textKeys = new Set(manifest.files.map((file) => file.objectKey));
      const store = { ...objectStore, async get(key: string) { assert(!textKeys.has(key), "Worker buffered a complete log file"); return objectStore.get(key); } };
      const started = performance.now();
      const worker = await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job!.id });
      const elapsedMs = performance.now() - started;
      const report = await service.getLogRecord(db, auth, uploaded.log.id);
      const indexed = await db.query<{ count: string }>("select count(*) from log_files where record_id=$1 and line_index_key is not null", [uploaded.log.id]);
      const counts = await db.query<{ decoded_event_counts: unknown }>("select decoded_event_counts from log_analysis_runs where id=$1", [uploaded.job!.runId]);
      assert.equal(worker.status, "processed"); assert.equal(report.status, "complete"); assert.equal(Number(indexed.rows[0].count), manifest.files.length);
      result = { ok: true, status: report.status, elapsedMs, files: manifest.files.length,
        indexedFiles: Number(indexed.rows[0].count), largestFileMiB: Math.max(...manifest.files.map((file) => file.sizeBytes)) / MiB,
        decodedCounts: counts.rows[0].decoded_event_counts, signalSummaryTruncated: report.signalSummary?.truncated ?? false };
    }
    console.log(JSON.stringify({ mode, profile, ...(mode.startsWith("api-") ? { chunked } : {}), ...result, unpackedMiB: manifest.unpackedBytes / MiB,
      peakRssMiB: process.resourceUsage().maxRSS / 1024, heapUsedMiB: process.memoryUsage().heapUsed / MiB }, null, 2));
  } finally { await db.close(); await ephemeral.drop(); }
}

if (mode === "intake") probeIntake();
else if (phase === "generate") await generate();
else if (phase === "measure") await measure();
else if (phase === "upload-client") await sendUpload();
else {
  assert(["worker", "api-json", "api-multipart"].includes(mode), "Use --mode=worker|api-json|api-multipart|intake");
  assert(["configured", "spec", "smoke"].includes(profile), "Use --profile=configured|spec|smoke");
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-log-memory-"));
  try {
    const common = [`--mode=${mode}`, `--profile=${profile}`, `--fixture-dir=${directory}`, `--chunked=${chunked}`];
    await child(["--phase=generate", ...common]);
    await child(["--phase=measure", ...common]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
