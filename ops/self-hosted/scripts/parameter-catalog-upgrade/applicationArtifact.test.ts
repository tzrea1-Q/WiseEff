import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { inspectApplicationOciArchive } from "./applicationArtifact";

it("refuses a Docker-only archive instead of relabeling its config ID as a manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "application-oci-"));
  try {
    const archive = path.join(directory, "image.tar");
    await writeFile(archive, Buffer.alloc(1024), { mode: 0o600 });
    await expect(inspectApplicationOciArchive(archive, {
      loadedImageId: `sha256:${"a".repeat(64)}`, platform: "linux/arm64",
      gitSha: "b".repeat(40), gitTree: "c".repeat(40),
    })).rejects.toMatchObject({ code: "OCI-LAYOUT-REQUIRED" });
  } finally { await rm(directory, { recursive: true }); }
});

// Independent, minimal ustar fixture: no image builder or production parser is
// used to manufacture expected inspection output.
const hash = (value: Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function tar(entries: [string, Buffer][]) {
  const parts: Buffer[] = [];
  for (const [name, value] of entries) {
    const header = Buffer.alloc(512);
    header.write(name); header.write("0000600\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(`${value.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136);
    header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(header, value, Buffer.alloc((512 - value.length % 512) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
function imageFixture() {
  const entries: [string, Buffer][] = [];
  const blob = (mediaType: string, value: unknown) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const digest = hash(bytes); entries.push([`blobs/sha256/${digest.slice(7)}`, bytes]);
    return { mediaType, digest, size: bytes.length };
  };
  const layer = blob("application/vnd.oci.image.layer.v1.tar", Buffer.from("synthetic layer bytes"));
  const config = blob("application/vnd.oci.image.config.v1+json", { os: "linux", architecture: "arm64",
    config: { Labels: { "org.opencontainers.image.revision": "b".repeat(40), "org.wiseeff.source.tree": "c".repeat(40), "org.wiseeff.build-tls-policy": "verify" } },
    rootfs: { type: "layers", diff_ids: [layer.digest] } });
  const manifest = blob("application/vnd.oci.image.manifest.v1+json", { schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json", config, layers: [layer] });
  const index = blob("application/vnd.oci.image.index.v1+json", { schemaVersion: 2, manifests: [{ ...manifest, platform: { os: "linux", architecture: "arm64" } }] });
  entries.push(["oci-layout", Buffer.from('{"imageLayoutVersion":"1.0.0"}')], ["index.json", Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [index] }))]);
  return { entries, config, manifest, index, expected: { loadedImageId: index.digest, platform: "linux/arm64", gitSha: "b".repeat(40), gitTree: "c".repeat(40) } };
}
async function withArchive(entries: [string, Buffer][], action: (archive: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "application-oci-"));
  try { const archive = path.join(directory, "image.tar"); await writeFile(archive, tar(entries), { mode: 0o600 }); await action(archive); }
  finally { await rm(directory, { recursive: true }); }
}
it("keeps actual index, image manifest and config identities distinct", async () => {
  const f = imageFixture();
  await withArchive(f.entries, async archive => {
    const result = await inspectApplicationOciArchive(archive, f.expected);
    expect(result.loadedImageId).toBe(f.index.digest);
    expect(result.manifestDigest).toBe(f.manifest.digest);
    expect(result.configDigest).toBe(f.config.digest);
    expect(new Set([result.loadedImageId, result.manifestDigest, result.configDigest]).size).toBe(3);
  });
});
it.each(["layer", "config", "manifest"] as const)("refuses changed %s bytes despite matching archive paths", async kind => {
  const f = imageFixture(), ordinal = { layer: 0, config: 1, manifest: 2 }[kind];
  f.entries[ordinal][1] = Buffer.from("tampered");
  await withArchive(f.entries, async archive => {
    await expect(inspectApplicationOciArchive(archive, f.expected)).rejects.toMatchObject({ code: "OCI-BLOB-MISMATCH" });
  });
});
it("refuses a different loaded identity before it can become a package pin", async () => {
  const f = imageFixture();
  await withArchive(f.entries, async archive => {
    await expect(inspectApplicationOciArchive(archive, { ...f.expected, loadedImageId: `sha256:${"d".repeat(64)}` }))
      .rejects.toMatchObject({ code: "OCI-LOADED-IMAGE-MISMATCH" });
  });
});
it.each(["../index.json", "blobs/../index.json", "/index.json"])("refuses unsafe archive member %s without extraction", async name => {
  const f = imageFixture(); f.entries.push([name, Buffer.from("foreign")]);
  await withArchive(f.entries, async archive => { await expect(inspectApplicationOciArchive(archive, f.expected)).rejects.toMatchObject({ code: "ARCHIVE-PATH-INVALID" }); });
});
it("refuses repeated index members rather than selecting tar's first or last value", async () => {
  const f = imageFixture(); f.entries.push(["index.json", Buffer.from("{}")]);
  await withArchive(f.entries, async archive => { await expect(inspectApplicationOciArchive(archive, f.expected)).rejects.toMatchObject({ code: "ARCHIVE-DUPLICATE-OR-LIMIT" }); });
});
