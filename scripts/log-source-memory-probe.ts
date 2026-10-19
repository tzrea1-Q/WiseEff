import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { request } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { defaultSourceSnapshotLimits, getSourceSnapshotLimits, indexSourceArchive, sourceChunks } from "../server/modules/logs/sourceArchive";
import { createHttpServer, type MultipartBody } from "../server/shared/http/server";
import { createRouter } from "../server/shared/http/router";

const MiB = 1024 * 1024;
async function probeUpload() {
  const limits = getSourceSnapshotLimits();
  const uploadBytes = 100 * MiB;
  assert.equal(limits.maxCompressedBytes, uploadBytes, "Upload probe requires the stock 100 MiB source cap");
  const boundary = "wiseeff-source-memory-probe";
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="versionLabel"\r\n\r\nv1-probe\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.zip"\r\nContent-Type: application/zip\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.alloc(2 * MiB, 97);
  async function* multipart() {
    yield prefix;
    for (let index = 0; index < 50; index++) yield payload;
    yield suffix;
  }
  const router = createRouter();
  router.post("/api/v1/log-skills/:skillId/source-snapshots", async ({ body }) => {
    const multipartBody = body as MultipartBody;
    assert.equal(multipartBody.kind, "multipart");
    assert.equal(multipartBody.fields.versionLabel, "v1-probe");
    assert.equal(multipartBody.files.length, 1);
    const file = multipartBody.files[0];
    assert.equal(file.bytes.length, uploadBytes);
    assert.equal(file.bytes[0], 97); assert.equal(file.bytes.at(-1), 97);
    return { status: 201, body: { bytes: file.bytes.length, fileName: file.fileName } };
  });
  const server = createHttpServer(router, { maxBodyBytes: () => limits.maxCompressedBytes + 64 * 1024 });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await new Promise<{ status: number; body: { bytes: number; fileName: string } }>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port: address.port, path: "/api/v1/log-skills/probe/source-snapshots", method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": prefix.length + uploadBytes + suffix.length }
      }, (incoming) => {
        void (async () => {
          const parts: Buffer[] = [];
          for await (const block of incoming) parts.push(block as Buffer);
          resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(Buffer.concat(parts).toString()) });
        })().catch(reject);
      });
      outgoing.once("error", reject);
      void pipeline(Readable.from(multipart()), outgoing).catch(reject);
    });
    assert.equal(response.status, 201); assert.equal(response.body.bytes, uploadBytes);
    console.log(JSON.stringify({ mode: "upload", uploadMiB: uploadBytes / MiB, bodyBytes: prefix.length + uploadBytes + suffix.length,
      transportLimitBytes: limits.maxCompressedBytes + 64 * 1024, status: response.status,
      peakRssMiB: process.resourceUsage().maxRSS / 1024, heapUsedMiB: process.memoryUsage().heapUsed / MiB }, null, 2));
    assert(process.resourceUsage().maxRSS / 1024 < 512, "Source upload parser exceeded the stock 512 MiB API budget");
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function probeWorker() {
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-source-probe-"));
  const archivePath = join(directory, "memory-probe.tar.gz");
  const fileSize = 2 * MiB, fileCount = 512;
  const payload = Buffer.alloc(fileSize);
  payload.fill(`int source_memory_probe(void) { return 42; } // ${"x".repeat(75)}\n`);
  async function* tar() {
    for (let index = 0; index < fileCount; index++) {
      const header = Buffer.alloc(512);
      header.write(`src/file-${index}.c`, 0, 100);
      header.write("0000644\0", 100);
      header.write(`${fileSize.toString(8).padStart(11, "0")}\0`, 124);
      header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257);
      header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
      yield header; yield payload;
    }
    yield Buffer.alloc(1024);
  }
  try {
    await pipeline(Readable.from(tar()), createGzip({ level: 1 }), createWriteStream(archivePath));
    let storedBytes = 0, chunks = 0;
    const result = await indexSourceArchive({ archivePath, fileName: "memory-probe.tar.gz", limits: defaultSourceSnapshotLimits,
      async onFile(file) {
        // Exercise the exact chunk/UTF-8 serialization path without retaining previous files.
        for (const chunk of sourceChunks(file.text)) { storedBytes += Buffer.from(chunk.content, "utf8").byteLength; chunks++; }
      }
    });
    console.log(JSON.stringify({ mode: "worker", ...result, unpackedMiB: fileSize * fileCount / MiB,
      compressedMiB: (await stat(archivePath)).size / MiB, storedMiB: storedBytes / MiB, chunks,
      peakRssMiB: process.resourceUsage().maxRSS / 1024, heapUsedMiB: process.memoryUsage().heapUsed / MiB }, null, 2));
    assert.equal(result.fileCount, fileCount);
    assert.equal(storedBytes, fileSize * fileCount);
    assert(process.resourceUsage().maxRSS / 1024 < 384, "Source indexing exceeded the stock 384 MiB worker budget");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv.includes("--upload")) await probeUpload();
else await probeWorker();
