import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { canonicalBytes, digestOf } from "../../../../server/modules/release-verification/core/digest";

export class ApplicationArtifactError extends Error {
  constructor(readonly code: string) { super(`PCAT-APPLICATION-ARTIFACT-${code}`); }
}

export type ApplicationArtifact = { readonly packageManifestDigest: string; readonly manifestPath: string; readonly image: ApplicationImage };
type ArtifactRecord = { repository: string; manifest: ApplicationPackage; archive: string; directory: string };
type ApplicationPackage = {
  version: "wiseeff-application-package-v1"; gitSha: string; gitTree: string;
  sourceArchiveDigest: string; buildContextDigest: string;
  recipe: { originalDockerfile: string; resolvedDockerfile: string; originalDigest: string; resolvedDigest: string; rule: "first-from-immutable-digest-v1" };
  services: { api: ApplicationImage; worker: ApplicationImage; web: ApplicationImage };
  buildTrust: { tlsPolicy: "verify"; transportFingerprint: string; caDigest: string; baseLoadedImageId: string;
    baseManifestDigest: string; baseConfigDigest: string; baseArchiveDigest: string; composeBuildDigest: string; buildLogDigest: string };
};
const issuedArtifacts = new WeakMap<ApplicationArtifact, ArtifactRecord>();
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const safeEnvironment = () => ({ PATH: process.env.PATH, HOME: os.homedir(), LANG: "C", LC_ALL: "C" });
function git(repository: string, args: string[]) {
  const result = spawnSync("git", ["--no-replace-objects", "-C", repository, ...args], { env: safeEnvironment(), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  requireFact(!result.error && result.status === 0, "SOURCE-UNAVAILABLE"); return result.stdout.toString().trim();
}
async function runOwned(command: string, args: string[], env: NodeJS.ProcessEnv, input?: Buffer, stdout?: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, detached: true, stdio: [input ? "pipe" : "ignore", stdout ?? "ignore", "ignore"] });
    let expired = false, settled = false, escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => { if (child.pid) try { process.kill(-child.pid, signal); } catch {} };
    const interrupt = () => { expired = true; kill("SIGTERM"); escalation ??= setTimeout(() => kill("SIGKILL"), 2000); };
    process.on("SIGTERM", interrupt); process.on("SIGINT", interrupt);
    const timer = setTimeout(interrupt, 20 * 60_000);
    if (input) { child.stdin!.on("error", interrupt); child.stdin!.end(input); }
    // A stopped shell must not leave build/export descendants running. Check
    // group existence after close and finish the exact owned group if needed.
    const finish = (code: number | null, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(escalation); process.off("SIGTERM", interrupt); process.off("SIGINT", interrupt);
      kill("SIGKILL");
      if (expired || failed || code !== 0) reject(new ApplicationArtifactError(expired ? "BUILD-INTERRUPTED" : "BUILD-OR-EXPORT-FAILED")); else resolve();
    };
    child.once("error", () => finish(null, true)); child.once("close", code => finish(code));
  });
}

/** Native Git materialization, not an artifact issuer. The new bare metadata
 * has no local attributes/template. Only tracked tree attributes apply. */
export function captureApplicationSourceArchive(repository: string, commit: string, privateDirectory: string) {
  const isolated = path.join(privateDirectory, "source.git");
  const cloned = spawnSync("git", ["--no-replace-objects", "clone", "--bare", "--shared", "--no-hardlinks", "--template=", "--", repository, isolated],
    { env: safeEnvironment(), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  requireFact(!cloned.error && cloned.status === 0, "SOURCE-ARCHIVE-UNAVAILABLE");
  const result = spawnSync("git", ["--no-replace-objects", "-c", "core.attributesFile=/dev/null", "--git-dir", isolated, "archive", "--format=tar", commit],
    { env: { ...safeEnvironment(), GIT_ATTR_NOSYSTEM: "1" }, timeout: 30_000, maxBuffer: 256 * 1024 * 1024 });
  requireFact(!result.error && result.status === 0, "SOURCE-ARCHIVE-UNAVAILABLE");
  return result.stdout;
}
function archiveEntries(archive: Buffer) {
  const entries = new Map<string, { header: number; offset: number; size: number; end: number }>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { requireFact(archive.subarray(offset).every(byte => byte === 0), "SOURCE-ARCHIVE-INVALID"); break; }
    const text = (start: number, size: number) => header.subarray(start, start + size).toString().replace(/\0.*$/s, "");
    const sizeText = text(124, 12), checksum = text(148, 8);
    requireFact(/^[ 0-7]+$/.test(sizeText) && /^[ 0-7]+$/.test(checksum), "SOURCE-ARCHIVE-INVALID");
    const size = Number.parseInt(sizeText.trim(), 8), end = offset + 512 + Math.ceil(size / 512) * 512;
    requireFact(Number.isSafeInteger(size) && size >= 0 && end <= archive.length
      && header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0) === Number.parseInt(checksum.trim(), 8), "SOURCE-ARCHIVE-INVALID");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    requireFact(!name.startsWith("/") && !name.split("/").some(part => part === ".." || part === ".") && !entries.has(name), "SOURCE-ARCHIVE-INVALID");
    if (header[156] === 103) {
      // Git emits a global PAX comment with its commit identity. Path/link
      // overrides and local PAX headers are not admitted by this fixed stream.
      requireFact(/^[0-9]+ comment=[a-f0-9]{40}\n$/.test(archive.subarray(offset + 512, offset + 512 + size).toString()), "SOURCE-ARCHIVE-UNSUPPORTED");
    } else {
      requireFact([0, 48, 53].includes(header[156]), "SOURCE-ARCHIVE-UNSUPPORTED");
      if (header[156] !== 53) entries.set(name, { header: offset, offset: offset + 512, size, end });
    }
    offset = end;
  }
  return entries;
}

/** Deterministic source transformation only; does not issue build provenance.
 * All source bytes come from the private Git-output buffer, never extracted
 * files. The sole changed instruction resolves the first FROM to a digest. */
export function resolveApplicationBuildContext(source: Buffer, immutableBase: string) {
  requireFact(/^[A-Za-z0-9][A-Za-z0-9._/:\-]*@sha256:[a-f0-9]{64}$/.test(immutableBase), "BASE-REFERENCE-INVALID");
  const entries = archiveEntries(source), dockerfile = entries.get("ops/self-hosted/Dockerfile"), compose = entries.get("ops/self-hosted/compose.yaml");
  requireFact(dockerfile && compose, "TRACKED-RECIPE-MISSING");
  const original = source.subarray(dockerfile.offset, dockerfile.offset + dockerfile.size).toString();
  const first = /^FROM ([A-Za-z0-9][A-Za-z0-9._/:@\-]*)( AS [A-Za-z0-9_-]+)?\n/.exec(original);
  requireFact(first, "DOCKERFILE-BASE-UNSUPPORTED");
  const stages = new Set(first[2] ? [first[2].slice(4)] : []);
  for (const line of original.slice(first[0].length).split("\n")) {
    if (/^\s*FROM\b/i.test(line)) {
      const stage = /^FROM ([A-Za-z0-9_-]+) AS ([A-Za-z0-9_-]+)$/.exec(line);
      requireFact(stage && stages.has(stage[1]) && !stages.has(stage[2]), "DOCKERFILE-BASE-UNSUPPORTED");
      stages.add(stage[2]);
    }
    const copied = /\b--from=([^\s]+)/.exec(line);
    requireFact(!copied || stages.has(copied[1]), "DOCKERFILE-BASE-UNSUPPORTED");
  }
  const resolved = `FROM ${immutableBase}${first[2] ?? ""}\n${original.slice(first[0].length)}`, bytes = Buffer.from(resolved);
  const header = Buffer.from(source.subarray(dockerfile.header, dockerfile.offset));
  header.fill(0, 124, 136); header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
  header.fill(32, 148, 156); header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
  const archive = Buffer.concat([source.subarray(0, dockerfile.header), header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), source.subarray(dockerfile.end)]);
  return { archive, compose: Buffer.from(source.subarray(compose.offset, compose.offset + compose.size)), baseReference: first[1],
    recipe: { originalDockerfile: original, resolvedDockerfile: resolved, originalDigest: sha(Buffer.from(original)), resolvedDigest: sha(bytes), rule: "first-from-immutable-digest-v1" as const } };
}
async function fileDigest(filename: string) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true }); requireFact(before.isFile() && before.nlink === 1n, "MATERIAL-UNSAFE");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let offset = 0;
    for (;;) { const { bytesRead } = await file.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead; }
    const after = await file.stat({ bigint: true }), named = await lstat(filename, { bigint: true });
    requireFact(before.ino === named.ino && before.dev === named.dev && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, "MATERIAL-CHANGED");
    return `sha256:${hash.digest("hex")}`;
  } finally { await file.close(); }
}

/** Actual build/export owner, not a JSON receipt importer. Output is retained
 * on failure for diagnosis. No image push, tag publication or service startup.
 */
export type ApplicationBuildInput = {
  repository: string; gitSha: string; expectedDaemonId: string; outputParent: string;
  apiBaseUrl: string; buildNetworkFile?: string;
};
export async function buildApplicationArtifact(input: ApplicationBuildInput): Promise<ApplicationArtifact> {
  try { return await buildActual(input); }
  catch (error) {
    if (error instanceof ApplicationArtifactError) throw error;
    throw new ApplicationArtifactError("BUILD-OR-PACKAGE-UNAVAILABLE");
  }
}
async function buildActual(input: ApplicationBuildInput): Promise<ApplicationArtifact> {
  const selection = structuredClone(input);
  requireFact(/^[a-f0-9]{40}$/.test(selection.gitSha), "SOURCE-IDENTITY-INVALID");
  const url = new URL(selection.apiBaseUrl);
  requireFact(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, "PUBLIC-BUILD-URL-INVALID");
  const repository = await realpath(selection.repository), parent = await realpath(selection.outputParent);
  const parentStat = await lstat(parent);
  requireFact(parentStat.isDirectory() && parentStat.uid === process.getuid?.() && (parentStat.mode & 0o077) === 0, "OUTPUT-PARENT-UNSAFE");
  requireFact(git(repository, ["rev-parse", `${selection.gitSha}^{commit}`]) === selection.gitSha, "SOURCE-IDENTITY-MISMATCH");
  const gitTree = git(repository, ["rev-parse", `${selection.gitSha}^{tree}`]);
  // Submodules and symlink contexts need a separately proven materialization;
  // no filesystem fallback is permitted for missing tracked source.
  requireFact(!git(repository, ["ls-tree", "-r", selection.gitSha]).split("\n").some(line => /^(120000|160000) /.test(line)), "SOURCE-LINK-UNSUPPORTED");
  const docker = createIsolatedUpgradeDocker();
  requireFact(docker.daemonId === selection.expectedDaemonId, "DAEMON-MISMATCH");
  const directory = await mkdtemp(path.join(parent, "application-"));
  const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const identity = await directoryHandle.stat({ bigint: true });
  const checkDirectory = async () => {
    const current = await lstat(directory, { bigint: true }), held = await directoryHandle.stat({ bigint: true });
    requireFact(current.dev === identity.dev && current.ino === identity.ino && held.nlink > 0n && current.uid === identity.uid && (current.mode & 0o777n) === 0o700n, "OUTPUT-DIRECTORY-CHANGED");
  };
  try {
    const context = path.join(directory, "context"); await mkdir(context, { mode: 0o700 });
    const source = captureApplicationSourceArchive(repository, selection.gitSha, directory), sourceDigest = sha(source), entries = archiveEntries(source);
    const sourceFile = (name: string) => {
      const entry = entries.get(name); requireFact(entry, "TRACKED-RECIPE-MISSING");
      return Buffer.from(source.subarray(entry.offset, entry.offset + entry.size));
    };
    const sourceArchive = path.join(directory, "source.tar");
    const persist = async (name: string, bytes: Buffer) => {
      await checkDirectory(); const file = await open(path.join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    };
    await persist("source.tar", source);
    await mkdir(path.join(context, "ops/self-hosted/build-network"), { recursive: true, mode: 0o700 });
    const emptyCa = sourceFile("ops/self-hosted/build-network/empty-ca.pem");
    const defaultCaFile = await open(path.join(context, "ops/self-hosted/build-network/empty-ca.pem"), "wx", 0o600);
    try { await defaultCaFile.writeFile(emptyCa); } finally { await defaultCaFile.close(); }
    const networkFile = selection.buildNetworkFile ? path.resolve(selection.buildNetworkFile) : path.join(directory, "no-build-network.env");
    if (selection.buildNetworkFile) {
      const stat = await lstat(networkFile);
      requireFact(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "BUILD-NETWORK-UNSAFE");
    }
    const networkDigest = selection.buildNetworkFile ? await fileDigest(networkFile) : null;
    await checkDirectory();
    const imageName = `wiseeff-artifact-${randomBytes(16).toString("hex")}`;
    const prepared = spawnSync("bash", ["-c", 'source "$1"; wiseeff_upgrade_prepare_application_artifact "${@:2}"', "application-artifact",
      path.join(toolRoot, "ops/self-hosted/scripts/upgrade-lib.sh"), context, directory, docker.endpoint, docker.daemonId,
      imageName, selection.gitSha, gitTree, networkFile, selection.apiBaseUrl],
    { env: safeEnvironment(), input: sourceFile("ops/self-hosted/compose.yaml"), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    requireFact(!prepared.error && prepared.status === 0, "BUILD-MODEL-UNAVAILABLE");
    const compose = JSON.parse(prepared.stdout.toString());
    const targets = ["api", "worker", "web"].map(name => compose.services?.[name]);
    requireFact(targets.every(target => target?.image === `${imageName}:candidate` && target.build?.context === context
      && target.build?.dockerfile === "ops/self-hosted/Dockerfile" && digestOf(target.build) === digestOf(targets[0].build)), "COMPOSE-BUILD-MISMATCH");
    const model = targets[0].build;
    requireFact(Object.keys(model).every(key => ["context", "dockerfile", "args", "secrets"].includes(key))
      && model.args?.WISEEFF_BUILD_TLS_POLICY === "verify" && model.args?.WISEEFF_SOURCE_SHA === selection.gitSha
      && model.args?.WISEEFF_SOURCE_TREE === gitTree && Array.isArray(model.secrets) && model.secrets.length === 1
      && model.secrets[0].source === "wiseeff-corporate-ca" && (model.secrets[0].target ?? model.secrets[0].source) === "wiseeff-corporate-ca"
      && Object.keys(model.secrets[0]).every(key => ["source", "target"].includes(key)), "COMPOSE-BUILD-OPTION-UNSUPPORTED");
    await persist("compose.json", prepared.stdout);
    const [transport, ca, extra] = (await readFile(path.join(directory, "build-trust.txt"), "utf8")).trim().split("\n");
    requireFact(/^[a-f0-9]{64}$/.test(transport) && /^[a-f0-9]{64}$/.test(ca) && extra === undefined, "BUILD-TRUST-MISSING");
    const caBytes = await readFile(path.join(directory, "build-ca.pem"));
    requireFact(sha(caBytes) === `sha256:${ca}` && !caBytes.includes(0) && !caBytes.toString().includes("PRIVATE KEY"), "BUILD-TRUST-CHANGED");
    if (!caBytes.equals(emptyCa)) {
      const parsed = spawnSync("openssl", ["crl2pkcs7", "-nocrl", "-out", "/dev/null"], { input: caBytes, env: safeEnvironment(), timeout: 5000 });
      requireFact(!parsed.error && parsed.status === 0 && caBytes.toString().includes("-----BEGIN CERTIFICATE-----"), "BUILD-TRUST-INVALID");
    }
    const baseReference = /^FROM ([^\s]+) AS [^\s]+\n/.exec(sourceFile("ops/self-hosted/Dockerfile").toString())?.[1];
    requireFact(baseReference && /^[A-Za-z0-9][A-Za-z0-9._/:\-]+$/.test(baseReference), "DOCKERFILE-BASE-UNSUPPORTED");
    const baseBefore = JSON.parse(docker.command(["image", "inspect", baseReference]).toString())[0];
    const repositoryName = baseReference.replace(/:[^/:]+$/, "");
    const immutable = (baseBefore?.RepoDigests as string[] | undefined)?.filter(value => value === `${repositoryName}@${baseBefore.Id}`);
    requireFact(digestPattern.test(baseBefore?.Id) && immutable?.length === 1, "IMMUTABLE-BASE-UNAVAILABLE");
    const save = async (id: string, name: string) => {
      await checkDirectory(); requireFact(docker.command(["info", "--format", "{{.ID}}"]).toString().trim() === docker.daemonId, "DAEMON-MISMATCH");
      const output = await open(path.join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await runOwned("docker", ["--host", docker.endpoint, "image", "save", id], safeEnvironment(), undefined, output.fd); await output.sync(); }
      finally { await output.close(); }
      docker.command(["info", "--format", "{{.ID}}"]); await checkDirectory();
    };
    await save(baseBefore.Id, "base.tar");
    const platform = [baseBefore.Os, baseBefore.Architecture, baseBefore.Variant].filter(Boolean).join("/");
    const base = await inspectArchive(path.join(directory, "base.tar"), { loadedImageId: baseBefore.Id, platform, gitSha: "0".repeat(40), gitTree: "0".repeat(40) }, false);
    const resolved = resolveApplicationBuildContext(source, immutable[0]);
    requireFact(resolved.baseReference === baseReference, "BASE-REFERENCE-MISMATCH");
    await persist("build-context.tar", resolved.archive);
    const buildEnvironment: NodeJS.ProcessEnv = { ...safeEnvironment(), WISEEFF_ARTIFACT_BUILD_CA_BYTES: caBytes.toString() };
    const metadataPath = path.join(directory, "build-result.json");
    const args = ["--builder", "default", "--platform", platform, "--load", "--tag", `${imageName}:candidate`, "--metadata-file", metadataPath, "--progress", "plain", "--file", model.dockerfile,
      "--secret", "id=wiseeff-corporate-ca,env=WISEEFF_ARTIFACT_BUILD_CA_BYTES"];
    const allowedArgs = new Set(["VITE_WISEEFF_RUNTIME_MODE", "VITE_WISEEFF_API_BASE_URL", "VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER",
      "VITE_WISEEFF_APP_VERSION", "VITE_WISEEFF_CONTACT_HREF", "WISEEFF_SOURCE_SHA", "WISEEFF_SOURCE_TREE",
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
      "WISEEFF_NPM_REGISTRY", "WISEEFF_BUILD_TLS_POLICY", "WISEEFF_BUILD_TLS_ACK", "WISEEFF_BUILD_TRANSPORT_FINGERPRINT"]);
    for (const [key, value] of Object.entries(model.args)) {
      requireFact(allowedArgs.has(key) && (value === null || typeof value === "string"), "COMPOSE-BUILD-OPTION-UNSUPPORTED");
      if (value !== null) { buildEnvironment[key] = value as string; args.push("--build-arg", key); }
    }
    const builder = JSON.parse(docker.command(["buildx", "inspect", "default", "--format", "{{json .}}"] ).toString());
    requireFact(builder.Driver === "docker", "BUILDER-UNSUPPORTED");
    await runOwned("bash", ["-c", 'source "$1"; wiseeff_upgrade_export_application_artifact "${@:2}"', "application-artifact",
      path.join(toolRoot, "ops/self-hosted/scripts/upgrade-lib.sh"), docker.endpoint, docker.daemonId, directory, ...args, "-"], buildEnvironment, resolved.archive);
    await checkDirectory();
    requireFact(!selection.buildNetworkFile || await fileDigest(networkFile) === networkDigest, "BUILD-NETWORK-CHANGED");
    const metadataDigest = await fileDigest(metadataPath);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    requireFact(await fileDigest(metadataPath) === metadataDigest && digestPattern.test(metadata["containerimage.digest"])
      && digestPattern.test(metadata["containerimage.config.digest"]), "BUILD-RESULT-UNAVAILABLE");
    // BuildKit's own result chooses the immutable object. The mutable output
    // tag is only a later drift check, never the origin of build identity.
    const before = JSON.parse(docker.command(["image", "inspect", metadata["containerimage.digest"]]).toString())[0];
    requireFact(before?.Id === metadata["containerimage.digest"], "BUILD-RESULT-MISMATCH");
    await save(before.Id, "image.tar");
    const current = JSON.parse(docker.command(["image", "inspect", `${imageName}:candidate`]).toString())[0];
    const loadedPlatform = [before?.Os, before?.Architecture, before?.Variant].filter(Boolean).join("/");
    requireFact(before?.Id === current?.Id && loadedPlatform === platform, "LOADED-IMAGE-CHANGED");
    const archive = path.join(directory, "image.tar");
    const image = await inspectApplicationOciArchive(archive, { loadedImageId: before.Id, platform: loadedPlatform, gitSha: selection.gitSha, gitTree });
    requireFact(image.configDigest === metadata["containerimage.config.digest"], "BUILD-RESULT-MISMATCH");
    requireFact(await fileDigest(path.join(directory, "build-ca.pem")) === `sha256:${ca}`, "BUILD-TRUST-CHANGED");
    // Do not publish an offline oracle for proxy credentials. The public build
    // model binds presence only; private resolved Compose remains in this dir.
    const publicBuild = structuredClone(compose.services.api.build);
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
      if (Object.hasOwn(publicBuild.args, key)) publicBuild.args[key] = publicBuild.args[key] ? "configured" : "not-configured";
    }
    publicBuild.context = "tracked-source-archive";
    if (Array.isArray(publicBuild.secrets)) publicBuild.secrets = publicBuild.secrets.map((secret: { source: string; target?: string }) => ({ source: secret.source, target: secret.target ?? secret.source }));
    const manifest: ApplicationPackage = {
      version: "wiseeff-application-package-v1", gitSha: selection.gitSha, gitTree,
      sourceArchiveDigest: sourceDigest, buildContextDigest: sha(resolved.archive), recipe: resolved.recipe,
      services: { api: image, worker: image, web: image },
      buildTrust: { tlsPolicy: "verify", transportFingerprint: `sha256:${transport}`, caDigest: `sha256:${ca}`, baseLoadedImageId: baseBefore.Id,
        baseManifestDigest: base.manifestDigest, baseConfigDigest: base.configDigest, baseArchiveDigest: base.archiveDigest, composeBuildDigest: digestOf(publicBuild), buildLogDigest: await fileDigest(path.join(directory, "build.log")) },
    };
    for (const filename of [archive, sourceArchive, path.join(directory, "build.log"), path.join(directory, "build-ca.pem")]) {
      const material = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await material.sync(); } finally { await material.close(); }
    }
    requireFact(await fileDigest(sourceArchive) === sourceDigest && await fileDigest(path.join(directory, "build-context.tar")) === sha(resolved.archive), "SOURCE-ARCHIVE-CHANGED");
    await checkDirectory();
    const manifestPath = path.join(directory, "application-package.json");
    const output = await open(manifestPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await output.writeFile(canonicalBytes(manifest)); await output.sync(); } finally { await output.close(); }
    await directoryHandle.sync(); await checkDirectory();
    const artifact = Object.freeze({ packageManifestDigest: digestOf(manifest), manifestPath, image });
    issuedArtifacts.set(artifact, { repository, manifest, archive, directory }); return artifact;
  } catch (error) {
    if (error instanceof ApplicationArtifactError) throw error;
    throw new ApplicationArtifactError("BUILD-OR-PACKAGE-UNAVAILABLE");
  } finally { await directoryHandle.close(); }
}

/** A tag is an existing identity selection, never a release approval. The root
 * must obtain that selection from its authorized release owner. No tag is made.
 */
export async function applicationVerificationPins(artifact: ApplicationArtifact, releaseTag?: string) {
  try { return await projectPins(artifact, releaseTag); }
  catch (error) {
    if (error instanceof ApplicationArtifactError) throw error;
    throw new ApplicationArtifactError("PACKAGE-UNAVAILABLE");
  }
}
async function projectPins(artifact: ApplicationArtifact, releaseTag?: string) {
  const record = issuedArtifacts.get(artifact);
  requireFact(record, "UNISSUED-ARTIFACT");
  requireFact(typeof releaseTag === "string" && releaseTag.length > 0 && !releaseTag.startsWith("-") && !releaseTag.includes("..") && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(releaseTag), "RELEASE-IDENTITY-REQUIRED");
  const tagObject = git(record.repository, ["rev-parse", `refs/tags/${releaseTag}`]);
  requireFact(git(record.repository, ["rev-parse", `refs/tags/${releaseTag}^{commit}`]) === record.manifest.gitSha, "RELEASE-SOURCE-MISMATCH");
  const manifest = await readApplicationArtifact(artifact);
  requireFact(git(record.repository, ["rev-parse", `refs/tags/${releaseTag}`]) === tagObject, "RELEASE-IDENTITY-CHANGED");
  return Object.freeze({ gitSha: record.manifest.gitSha, releaseTag, packageManifestDigest: artifact.packageManifestDigest,
    apiImageDigest: manifest.services.api.manifestDigest, workerImageDigest: manifest.services.worker.manifestDigest, webImageDigest: manifest.services.web.manifestDigest });
}

/** Reobserve this process's issued build before downstream consumption. This
 * does not import arbitrary JSON receipts or require/issue release approval. */
export async function readApplicationArtifact(artifact: ApplicationArtifact): Promise<ApplicationPackage> {
  try {
    const record = issuedArtifacts.get(artifact);
    requireFact(record, "UNISSUED-ARTIFACT");
    requireFact(await fileDigest(artifact.manifestPath) === artifact.packageManifestDigest, "PACKAGE-CHANGED");
    const current = await inspectApplicationOciArchive(record.archive, artifact.image);
    requireFact(digestOf(current) === digestOf(artifact.image), "PACKAGE-CHANGED");
    return structuredClone(record.manifest);
  } catch (error) {
    if (error instanceof ApplicationArtifactError) throw error;
    throw new ApplicationArtifactError("PACKAGE-UNAVAILABLE");
  }
}
const requireFact: (value: unknown, code: string) => asserts value = (value, code) => {
  if (!value) throw new ApplicationArtifactError(code);
};
const sha = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
type Descriptor = { mediaType: string; digest: string; size: number; platform?: { os: string; architecture: string; variant?: string } };
export type ApplicationImageExpectation = {
  readonly loadedImageId: string; readonly platform: string; readonly gitSha: string; readonly gitTree: string;
};
export type ApplicationImage = ApplicationImageExpectation & { readonly configDigest: string; readonly manifestDigest: string; readonly archiveDigest: string; readonly layers: readonly string[] };
const imageType = "application/vnd.oci.image.manifest.v1+json";
const indexType = "application/vnd.oci.image.index.v1+json";
const configType = "application/vnd.oci.image.config.v1+json";
const layerTypes = new Set(["application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.oci.image.layer.v1.tar+zstd"]);

/** Inspection only: this does not issue build provenance or release approval.
 * Parse regular ustar entries directly, never extract archive paths to disk.
 * Limits bound malformed inputs; layer bytes are streamed rather than buffered.
 */
export async function inspectApplicationOciArchive(filename: string, input: ApplicationImageExpectation): Promise<ApplicationImage> {
  return inspectArchive(filename, input, true);
}
async function inspectArchive(filename: string, input: ApplicationImageExpectation, requireApplicationLabels: boolean): Promise<ApplicationImage> {
  const expected = structuredClone(input);
  requireFact(digestPattern.test(expected.loadedImageId) && /^[a-f0-9]{40}$/.test(expected.gitSha) && /^[a-f0-9]{40}$/.test(expected.gitTree)
    && /^linux\/(amd64|arm64)(\/v[0-9]+)?$/.test(expected.platform), "EXPECTED-IDENTITY-INVALID");
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new ApplicationArtifactError("ARCHIVE-UNAVAILABLE"); });
  try {
    const before = await file.stat({ bigint: true });
    requireFact(before.isFile() && before.nlink === 1n && before.size <= 64n * 1024n ** 3n, "ARCHIVE-UNSAFE");
    const entries = new Map<string, { offset: number; size: number; digest: string }>();
    const archiveHash = createHash("sha256");
    let offset = 0, ended = false;
    const read = async (size: number) => {
      const bytes = Buffer.alloc(size);
      const result = await file.read(bytes, 0, size, offset);
      requireFact(result.bytesRead === size, "ARCHIVE-TRUNCATED");
      offset += size; archiveHash.update(bytes); return bytes;
    };
    const field = (buffer: Buffer, start: number, length: number) => buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const octal = (value: string) => {
      requireFact(/^[ 0-7]+$/.test(value), "ARCHIVE-HEADER-INVALID");
      const result = Number.parseInt(value.trim(), 8);
      requireFact(Number.isSafeInteger(result) && result >= 0, "ARCHIVE-HEADER-INVALID"); return result;
    };
    while (offset < Number(before.size)) {
      const header = await read(512);
      if (header.every(byte => byte === 0)) { ended = true; continue; }
      requireFact(!ended, "ARCHIVE-TRAILING-DATA");
      const checksum = octal(field(header, 148, 8));
      requireFact(header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0) === checksum, "ARCHIVE-HEADER-INVALID");
      const name = field(header, 0, 100), prefix = field(header, 345, 155);
      const entryName = prefix ? `${prefix}/${name}` : name;
      requireFact(entryName.length > 0 && !entryName.startsWith("/") && !entryName.split("/").some(part => part === ".." || part === ".")
        && !entryName.includes("\\") && !/[\x00-\x1f]/.test(entryName), "ARCHIVE-PATH-INVALID");
      const size = octal(field(header, 124, 12));
      const type = header[156];
      requireFact(type === 0 || type === 48 || (type === 53 && size === 0), "ARCHIVE-ENTRY-UNSUPPORTED");
      requireFact(!entries.has(entryName) && entries.size < 100_000, "ARCHIVE-DUPLICATE-OR-LIMIT");
      const start = offset, hash = createHash("sha256");
      let remaining = size;
      while (remaining > 0) { const bytes = await read(Math.min(remaining, 1024 * 1024)); hash.update(bytes); remaining -= bytes.length; }
      const padding = (512 - size % 512) % 512;
      if (padding) requireFact((await read(padding)).every(byte => byte === 0), "ARCHIVE-PADDING-INVALID");
      if (type !== 53) entries.set(entryName, { offset: start, size, digest: `sha256:${hash.digest("hex")}` });
    }
    requireFact(ended && entries.has("oci-layout") && entries.has("index.json"), "OCI-LAYOUT-REQUIRED");
    const json = async (name: string) => {
      const entry = entries.get(name);
      requireFact(entry && entry.size <= 8 * 1024 * 1024, "OCI-JSON-UNAVAILABLE");
      const bytes = Buffer.alloc(entry.size);
      requireFact((await file.read(bytes, 0, bytes.length, entry.offset)).bytesRead === bytes.length && sha(bytes) === entry.digest, "ARCHIVE-CHANGED");
      const value = JSON.parse(bytes.toString("utf8"));
      requireFact(value && typeof value === "object" && !Array.isArray(value), "OCI-JSON-INVALID"); return value;
    };
    const blob = (value: Descriptor) => {
      requireFact(value && digestPattern.test(value.digest) && Number.isSafeInteger(value.size) && value.size >= 0 && !Object.hasOwn(value, "urls"), "OCI-DESCRIPTOR-INVALID");
      const name = `blobs/sha256/${value.digest.slice(7)}`, entry = entries.get(name);
      requireFact(entry && entry.size === value.size && entry.digest === value.digest, "OCI-BLOB-MISMATCH"); return name;
    };
    requireFact((await json("oci-layout")).imageLayoutVersion === "1.0.0", "OCI-LAYOUT-UNSUPPORTED");
    const candidates: { descriptor: Descriptor; body: any; ancestors: string[] }[] = [];
    const visit = async (index: any, depth: number, ancestors: string[]) => {
      requireFact(depth < 8 && index.schemaVersion === 2 && Array.isArray(index.manifests) && index.manifests.length > 0 && index.manifests.length <= 64, "OCI-INDEX-INVALID");
      for (const descriptor of index.manifests as Descriptor[]) {
        // A platform index may reference other platforms absent from this local
        // save. Its raw bytes are authenticated by its parent; require every
        // referenced blob for the selected platform, not unrelated platforms.
        if (descriptor.platform && [descriptor.platform.os, descriptor.platform.architecture].join("/") !== expected.platform.split("/").slice(0, 2).join("/")) continue;
        const body = await json(blob(descriptor));
        if (descriptor.mediaType === indexType) await visit(body, depth + 1, [...ancestors, descriptor.digest]);
        else {
          requireFact(descriptor.mediaType === imageType && body.mediaType === imageType && body.schemaVersion === 2, "OCI-MANIFEST-UNSUPPORTED");
          const configuration = await json(blob(body.config));
          requireFact(Array.isArray(body.layers), "OCI-LAYERS-INVALID");
          for (const layer of body.layers as Descriptor[]) blob(layer);
          // Attestations and other artifacts are not runnable candidates. Their
          // descriptor bytes are still authenticated; never select them first.
          if (body.artifactType || body.config?.mediaType !== configType) continue;
          const platform = [configuration.os, configuration.architecture, configuration.variant].filter(Boolean).join("/");
          if (platform !== expected.platform) continue;
          if (descriptor.platform) requireFact([descriptor.platform.os, descriptor.platform.architecture].join("/") === [configuration.os, configuration.architecture].join("/")
            && (!configuration.variant || !descriptor.platform.variant || configuration.variant === descriptor.platform.variant), "OCI-PLATFORM-MISMATCH");
          candidates.push({ descriptor, body, ancestors });
        }
      }
    };
    await visit(await json("index.json"), 0, []);
    requireFact(candidates.length === 1, "OCI-RUNNABLE-AMBIGUOUS-OR-MISSING");
    const { descriptor, body, ancestors } = candidates[0];
    // The containerd store may identify the loaded image by its index. Classic
    // stores identify configs. Authenticate the actual ID in this exact graph;
    // never relabel either form as the platform image manifest/config digest.
    requireFact([...ancestors, descriptor.digest, body.config.digest].includes(expected.loadedImageId), "OCI-LOADED-IMAGE-MISMATCH");
    const configuration = await json(blob(body.config));
    requireFact(!requireApplicationLabels || (configuration.config?.Labels?.["org.opencontainers.image.revision"] === expected.gitSha
      && configuration.config?.Labels?.["org.wiseeff.source.tree"] === expected.gitTree
      && configuration.config?.Labels?.["org.wiseeff.build-tls-policy"] === "verify"), "OCI-SOURCE-OR-POLICY-MISMATCH");
    requireFact(Array.isArray(body.layers) && Array.isArray(configuration.rootfs?.diff_ids) && configuration.rootfs.diff_ids.length === body.layers.length, "OCI-LAYERS-INVALID");
    const layers = body.layers.map((layer: Descriptor) => { requireFact(layerTypes.has(layer.mediaType), "OCI-LAYER-UNSUPPORTED"); blob(layer); return layer.digest; });
    const after = await file.stat({ bigint: true }), named = await lstat(filename, { bigint: true });
    for (const stat of [after, named]) requireFact(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs && stat.nlink === 1n, "ARCHIVE-CHANGED");
    return Object.freeze({ ...expected, configDigest: body.config.digest, manifestDigest: descriptor.digest, archiveDigest: `sha256:${archiveHash.digest("hex")}`, layers: Object.freeze(layers) });
  } catch (error) {
    if (error instanceof ApplicationArtifactError) throw error;
    throw new ApplicationArtifactError("ARCHIVE-INVALID");
  } finally { await file.close(); }
}
