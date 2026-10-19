import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { bundleFileUtf8Bytes, defaultBundleLimits, intakeLogBundle, type BundleFile } from "../server/modules/logs/bundleIntake";

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
  peakRssMiB: process.resourceUsage().maxRSS / 1024,
  heapUsedMiB: memory.heapUsed / MiB
}, null, 2));
assert(result.ok, "Bundle intake failed; see reason above");
assert.equal(storedBytes, unpackedBytes);
