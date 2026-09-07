import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { inspectApplicationOciArchive, buildApplicationArtifact, applicationVerificationPins, resolveApplicationBuildContext, captureApplicationSourceArchive, type ApplicationArtifact } from "./applicationArtifact";

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
it("ignores untracked repository export attributes while preserving tracked archive attributes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "application-git-attributes-"));
  const run = (args: string[]) => {
    const result = spawnSync("git", ["-C", directory, ...args], { env: { PATH: process.env.PATH, HOME: directory } });
    expect(result.status).toBe(0); return result.stdout.toString().trim();
  };
  try {
    run(["init", "--template="]);
    await writeFile(path.join(directory, "kept.ts"), "tracked source");
    await writeFile(path.join(directory, "tracked-excluded.txt"), "intentional archive exclusion");
    await writeFile(path.join(directory, ".gitattributes"), "tracked-excluded.txt export-ignore\n");
    run(["add", "."]); run(["-c", "user.name=synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", "source"]);
    const commit = run(["rev-parse", "HEAD"]);
    await mkdir(path.join(directory, ".git/info"), { recursive: true });
    await writeFile(path.join(directory, ".git/info/attributes"), "kept.ts export-ignore\n");
    const output = path.join(directory, "private"); await mkdir(output, { mode: 0o700 });
    const archive = captureApplicationSourceArchive(directory, commit, output);
    const listing = spawnSync("tar", ["-tf", "-"], { input: archive });
    expect(listing.status).toBe(0);
    expect(listing.stdout.toString().split("\n")).toContain("kept.ts");
    expect(listing.stdout.toString().split("\n")).not.toContain("tracked-excluded.txt");
  } finally { await rm(directory, { recursive: true }); }
});
it("uses the physical selected Git object despite local replacement refs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "application-git-replace-"));
  const run = (args: string[]) => {
    const result = spawnSync("git", ["-C", directory, ...args], { env: { PATH: process.env.PATH, HOME: directory } });
    expect(result.status).toBe(0); return result.stdout.toString().trim();
  };
  try {
    run(["init", "--template="]);
    await writeFile(path.join(directory, "kept.ts"), "physical selected source"); run(["add", "."]);
    const commit = () => { run(["-c", "user.name=synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-am", "source"]); return run(["rev-parse", "HEAD"]); };
    const original = commit();
    await writeFile(path.join(directory, "kept.ts"), "replacement source"); const replacement = commit();
    run(["replace", original, replacement]);
    const output = path.join(directory, "private"); await mkdir(output, { mode: 0o700 });
    const archive = captureApplicationSourceArchive(directory, original, output);
    const actual = spawnSync("tar", ["-xOf", "-", "kept.ts"], { input: archive });
    expect(actual.status).toBe(0); expect(actual.stdout.toString()).toBe("physical selected source");
  } finally { await rm(directory, { recursive: true }); }
});
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
it("pins the only external FROM and preserves all other recipe and tracked source bytes in the actual tar stream", () => {
  const original = "FROM node:22.21.1-alpine AS build-transport\nRUN echo existing\nFROM build-transport AS application\nCOPY . .\n";
  const source = tar([["ops/self-hosted/Dockerfile", Buffer.from(original)], ["ops/self-hosted/compose.yaml", Buffer.from("services: original\n")], ["server/probe.ts", Buffer.from("tracked-original")]]);
  const immutable = `node@sha256:${"a".repeat(64)}`;
  const fixed = resolveApplicationBuildContext(source, immutable);
  // Change the caller's original source buffer after capture, just as an
  // extracted directory could change. The consumer receives independent bytes.
  source.fill(120);
  const actual = spawnSync("tar", ["-xOf", "-", "server/probe.ts"], { input: fixed.archive });
  expect(actual.status).toBe(0); expect(actual.stdout.toString()).toBe("tracked-original");
  const recipe = spawnSync("tar", ["-xOf", "-", "ops/self-hosted/Dockerfile"], { input: fixed.archive });
  expect(recipe.status).toBe(0);
  expect(recipe.stdout.toString()).toBe(original.replace("node:22.21.1-alpine", immutable));
  expect(fixed.recipe.originalDigest).toBe(hash(Buffer.from(original)));
  expect(fixed.recipe.resolvedDigest).toBe(hash(recipe.stdout));
  expect(fixed.compose.toString()).toBe("services: original\n");
});
it("cannot translate a mutable tag or a caller-supplied Dockerfile into an immutable build context", () => {
  const source = tar([["ops/self-hosted/Dockerfile", Buffer.from("FROM node:22 AS base\n")], ["ops/self-hosted/compose.yaml", Buffer.from("services: {}\n")]]);
  expect(() => resolveApplicationBuildContext(source, "node:candidate")).toThrow("BASE-REFERENCE-INVALID");
  expect(() => resolveApplicationBuildContext(tar([["Dockerfile", Buffer.from("FROM foreign\n")]]), `node@sha256:${"a".repeat(64)}`)).toThrow("TRACKED-RECIPE-MISSING");
});
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
it("refuses symlink archive inputs rather than following a foreign package", async () => {
  const f = imageFixture();
  await withArchive(f.entries, async archive => {
    await symlink(archive, `${archive}.link`);
    await expect(inspectApplicationOciArchive(`${archive}.link`, f.expected)).rejects.toMatchObject({ code: "ARCHIVE-UNAVAILABLE" });
  });
});
it("does not issue Verification pins from an inspection-shaped caller object", async () => {
  await expect(applicationVerificationPins({} as ApplicationArtifact, "existing-tag")).rejects.toMatchObject({ code: "UNISSUED-ARTIFACT" });
});
it("statically rejects malformed private input without returning a raw URL error", async () => {
  let caught: unknown;
  try { await buildApplicationArtifact({ repository: "/unopened", gitSha: "b".repeat(40), expectedDaemonId: "unopened", outputParent: "/unopened", apiBaseUrl: "private-secret-invalid-url" }); }
  catch (error) { caught = error; }
  expect(caught).toMatchObject({ code: "BUILD-OR-PACKAGE-UNAVAILABLE" });
  expect(String(caught).includes("private-secret-invalid-url")).toBe(false);
});
it.each(["insecure", "registry"] as const)("the real build owner refuses %s before any Docker call", async mode => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "application-trust-"));
  try {
    const context = path.join(directory, "context"), output = path.join(directory, "output"), bin = path.join(directory, "bin");
    await mkdir(path.join(context, "ops/self-hosted/build-network"), { recursive: true }); await mkdir(output); await mkdir(bin);
    await writeFile(path.join(context, "ops/self-hosted/build-network/empty-ca.pem"), "");
    const network = path.join(directory, "network.env");
    await writeFile(network, mode === "insecure" ? "WISEEFF_BUILD_TLS_POLICY=insecure\n" : "WISEEFF_NPM_REGISTRY=http://registry.invalid\n", { mode: 0o600 });
    // This can only detect an unintended effect. It cannot return build output
    // or make a positive build pass. Real trust preparation is unmodified.
    await writeFile(path.join(bin, "docker"), '#!/bin/sh\nprintf "DOCKER-CALLED\\n" >&2\nexit 99\n', { mode: 0o700 });
    const result = spawnSync("bash", ["-c", 'source "$1"; wiseeff_upgrade_prepare_application_artifact "${@:2}"', "test",
      path.resolve("ops/self-hosted/scripts/upgrade-lib.sh"), context, output, "unix:///unused", "unused", "unused", "b".repeat(40), "c".repeat(40), network, "http://127.0.0.1"],
    { env: { PATH: `${bin}:${process.env.PATH}`, HOME: os.homedir() }, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(10);
    expect(result.stderr.includes(mode === "insecure" ? "BUILD-TRUST-INSECURE" : "BUILD-TRUST-REGISTRY")).toBe(true);
    expect(result.stderr.includes("DOCKER-CALLED")).toBe(false);
  } finally { await rm(directory, { recursive: true }); }
});
