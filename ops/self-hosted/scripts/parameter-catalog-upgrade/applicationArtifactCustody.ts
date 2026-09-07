import { constants, fstatSync, lstatSync, realpathSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalBytes, digestOf } from "../../../../server/modules/release-verification/core/digest";
import { buildApplicationArtifact, applicationVerificationPins, openApplicationArtifactInspection,
  type ApplicationBuildInput, type ApplicationPackage } from "./applicationArtifact";
import { assertHostOperationLockForJournal, type HostOperationLock } from "./handoff";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, type UpgradeJournal, type JournalRecord } from "./journal";

/** Static public reasons only; private paths, command output and payloads are
 * never attached. Custody is provenance, not release or startup approval. */
export class ApplicationArtifactCustodyRefusal extends Error {
  readonly code: string;
  constructor(reason: string) { const code = `PCAT-APPLICATION-CUSTODY-${reason}`; super(code); this.code = code; }
}
type Boundary = { journal: UpgradeJournal; lock: HostOperationLock };
type HeldBoundary = Boundary & { journalPath: string };
const captureBoundary = (input: Boundary): HeldBoundary => ({ journal: input.journal, lock: input.lock, journalPath: input.journal.journalPath });
export type ApplicationArtifactSelectionInput = Boundary & {
  build: Omit<ApplicationBuildInput, "outputParent">; releaseTag: string;
};
type Identity = { device: string; inode: string; owner: string; mode: string };
type FileIdentity = Identity & { size: string; changed: string; modified: string };
type Pins = Awaited<ReturnType<typeof applicationVerificationPins>>;
type Request = {
  version: "application-artifact-request-v1"; hostRunId: string; journalPath: string; originalJournal: JournalRecord;
  hostIdentity: Identity; custodyIdentity: Identity;
  source: { repository: string; gitSha: string; gitTree: string; repositoryIdentity: Identity; releaseTag: string; tagObject: string };
  controller: { gitSha: string; gitTree: string };
  build: Omit<ApplicationBuildInput, "outputParent">;
  network: { identity: FileIdentity; digest: string } | null;
};
type Receipt = {
  version: "application-artifact-receipt-v1"; hostRunId: string; requestDigest: string;
  requestIdentity: FileIdentity;
  artifactName: string; packageManifestDigest: string; pins: Pins;
  directoryIdentity: Awaited<ReturnType<typeof openApplicationArtifactInspection>>["directoryIdentity"];
  materials: Awaited<ReturnType<typeof openApplicationArtifactInspection>>["materials"];
};
export type ApplicationArtifactSelection = { observe(): Promise<{
  pins: Pins; manifest: ApplicationPackage; loadedImageId: string;
  source: { gitSha: string; gitTree: string }; receiptDigest: string;
}> };
const prefix = "application-artifact-";
const custodyName = "application-artifact-custody";
const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const requireFact: (condition: unknown, reason: string) => asserts condition = (condition, reason) => {
  if (!condition) throw new ApplicationArtifactCustodyRefusal(reason);
};
const safeError = (error: unknown) => error instanceof ApplicationArtifactCustodyRefusal ? error : new ApplicationArtifactCustodyRefusal("UNAVAILABLE");
const hash = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const materialRecordDigest = (material: { digest: string; identity: FileIdentity }) => digestOf({ digest: material.digest, identity: material.identity });
const identity = (stat: Awaited<ReturnType<typeof bigintStat>>): Identity => ({ device: String(stat.dev), inode: String(stat.ino), owner: String(stat.uid), mode: String(stat.mode & 0o777n) });
const fileIdentity = (stat: Awaited<ReturnType<typeof bigintStat>>): FileIdentity => ({ ...identity(stat), size: String(stat.size), changed: String(stat.ctimeNs), modified: String(stat.mtimeNs) });
const bigintStat = (file: FileHandle) => file.stat({ bigint: true });
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function git(repository: string, args: string[]) {
  const result = spawnSync("git", ["--no-replace-objects", "-C", repository, ...args], {
    env: { PATH: process.env.PATH, HOME: os.homedir(), LANG: "C", LC_ALL: "C" }, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  requireFact(!result.error && result.status === 0, "SOURCE-UNAVAILABLE"); return result.stdout.toString().trim();
}
async function directoryLease(filename: string, privateOnly = true) {
  requireFact(path.isAbsolute(filename) && await realpath(filename) === filename, "MATERIAL-UNSAFE");
  const fd = await open(filename, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await bigintStat(fd), pinned = identity(stat);
    requireFact(stat.isDirectory() && stat.uid === BigInt(process.getuid!()) && (stat.mode & (privateOnly ? 0o077n : 0o022n)) === 0n, "MATERIAL-UNSAFE");
    const verifyIdentity = () => {
      const held = fstatSync(fd.fd, { bigint: true }), named = lstatSync(filename, { bigint: true });
      requireFact(named.isDirectory() && !named.isSymbolicLink() && held.nlink > 0n && equal(identity(held), pinned)
        && equal(identity(named), pinned) && realpathSync(filename) === filename, "MATERIAL-CHANGED");
    };
    return { fd, identity: pinned, verifyIdentity, async verify() { verifyIdentity(); }, close: () => fd.close() };
  } catch (error) { await fd.close().catch(() => {}); throw error; }
}
async function fileLease(filename: string, privateOnly = true) {
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await bigintStat(fd), pinned = fileIdentity(stat);
    requireFact(stat.isFile() && stat.nlink === 1n && stat.uid === BigInt(process.getuid!())
      && (stat.mode & (privateOnly ? 0o077n : 0o022n)) === 0n && stat.size <= 16n * 1024n * 1024n, "MATERIAL-UNSAFE");
    const bytes = Buffer.alloc(Number(stat.size));
    requireFact((await fd.read(bytes, 0, bytes.length, 0)).bytesRead === bytes.length, "MATERIAL-UNAVAILABLE");
    const digest = hash(bytes);
    const verifyIdentity = () => {
      const held = fstatSync(fd.fd, { bigint: true }), named = lstatSync(filename, { bigint: true });
      requireFact(held.nlink === 1n && named.nlink === 1n && named.isFile() && !named.isSymbolicLink()
        && equal(fileIdentity(held), pinned) && equal(fileIdentity(named), pinned), "MATERIAL-CHANGED");
    };
    const verify = async () => {
      verifyIdentity(); const current = Buffer.alloc(bytes.length);
      requireFact((await fd.read(current, 0, current.length, 0)).bytesRead === current.length && hash(current) === digest, "MATERIAL-CHANGED");
      verifyIdentity();
    };
    await verify(); return { bytes, digest, identity: pinned, verify, verifyIdentity, close: () => fd.close() };
  } catch (error) { await fd.close().catch(() => {}); throw error; }
}
function writeExclusive(filename: string, value: unknown, directory: FileHandle) {
  const bytes = canonicalBytes(value);
  const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  fsyncSync(directory.fd);
}
async function tagLease(repository: string, releaseTag: string) {
  const loose = git(repository, ["rev-parse", "--path-format=absolute", "--git-path", `refs/tags/${releaseTag}`]);
  let packed = false;
  try { await lstat(loose); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; packed = true; }
  const filename = packed ? git(repository, ["rev-parse", "--path-format=absolute", "--git-path", "packed-refs"]) : loose;
  const file = await fileLease(filename, false);
  try {
    if (!packed) requireFact(/^[a-f0-9]{40}\n?$/.test(file.bytes.toString()), "TAG-UNSUPPORTED");
    else {
      const entries = file.bytes.toString().split("\n").filter(line => line.split(" ")[1] === `refs/tags/${releaseTag}`);
      requireFact(entries.length === 1 && /^[a-f0-9]{40} /.test(entries[0]), "TAG-UNSUPPORTED");
    }
  } catch (error) { await file.close().catch(() => {}); throw error; }
  const verifyIdentity = () => {
    file.verifyIdentity();
    if (packed) {
      let absent = false;
      try { lstatSync(loose); } catch (error) { absent = (error as NodeJS.ErrnoException).code === "ENOENT"; }
      requireFact(absent, "SOURCE-CHANGED");
    }
  };
  return { async verify() { await file.verify(); verifyIdentity(); }, verifyIdentity, close: file.close };
}
/** The custody owner makes every required material durable before committing
 * its receipt. The reusable raw validator itself remains strictly read-only. */
function syncInspectedMaterials(directory: string, inspected: Awaited<ReturnType<typeof openApplicationArtifactInspection>>) {
  inspected.verifyIdentity();
  for (const material of inspected.materials) {
    const fd = openSync(path.join(directory, material.name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  inspected.verifyIdentity();
}
async function assertBoundary(input: HeldBoundary, expected: JournalRecord) {
  try {
    requireFact(input.journal.journalPath === input.journalPath, "BOUNDARY");
    await assertHostOperationLockForJournal(input.lock, input.journal.journalPath);
    const current = loadUpgradeJournal({ journalPath: input.journal.journalPath, runId: expected.runId, requireSettled: true });
    requireFact(current.ok && equal(current.value.record, expected) && equal(input.journal.record, expected), "BOUNDARY");
  } catch { throw new ApplicationArtifactCustodyRefusal("BOUNDARY"); }
}
function append(input: HeldBoundary, expected: JournalRecord, action: string, inputDigest: string, outcome: "crashed" | "committed") {
  requireFact(input.journal.journalPath === input.journalPath && equal(input.journal.record, expected), "BOUNDARY");
  const result = commitJournalTransition(input.journal, { action: `${prefix}${action}`, inputDigest, outcome,
    toState: expected.state, nextAction: expected.nextAction });
  requireFact(result.ok && !result.value.replayed, "PERSISTENCE-UNKNOWN");
  return structuredClone(input.journal.record);
}
function verifySource(request: Pick<Request, "source">) {
  const source = request.source;
  requireFact(git(source.repository, ["rev-parse", `${source.gitSha}^{commit}`]) === source.gitSha
    && git(source.repository, ["rev-parse", `${source.gitSha}^{tree}`]) === source.gitTree
    && git(source.repository, ["rev-parse", `refs/tags/${source.releaseTag}`]) === source.tagObject
    && git(source.repository, ["rev-parse", `refs/tags/${source.releaseTag}^{commit}`]) === source.gitSha, "SOURCE-CHANGED");
}
async function finish<T>(work: (own: <U extends { close(): Promise<void> }>(lease: U) => U) => Promise<T>, onFailure?: () => Promise<void>): Promise<T> {
  const leases: { close(): Promise<void> }[] = []; let primary: unknown, value!: T;
  try { value = await work(lease => { leases.push(lease); return lease; }); } catch (error) {
    primary = safeError(error);
    // Unknown recording still uses the original held directory/material FDs.
    // If that boundary is gone, retain pending; never reopen a replacement root.
    try { await onFailure?.(); } catch { /* Original pending is retained. */ }
  }
  const closed = await Promise.allSettled(leases.reverse().map(lease => Promise.resolve().then(() => lease.close())));
  if (primary) throw primary;
  requireFact(closed.every(result => result.status === "fulfilled"), "CLOSE-FAILED"); return value;
}

/** Only this actual build invocation can retain an issued artifact. An existing
 * pending/unknown/committed selection never authorizes another build. */
export async function produceApplicationArtifactSelection(supplied: ApplicationArtifactSelectionInput): Promise<ApplicationArtifactSelection> {
  const selection = structuredClone({ build: supplied.build, releaseTag: supplied.releaseTag }), input = captureBoundary(supplied);
  let expected = structuredClone(input.journal.record), markUnknown: (() => Promise<void>) | undefined;
  try {
    await finish(async own => {
      await assertBoundary(input, expected);
      requireFact(!expected.entries.some(entry => entry.action.startsWith(prefix)), "EXISTING-SELECTION");
      const root = path.dirname(input.journal.journalPath), host = own(await directoryLease(root));
      requireFact(/^[a-f0-9]{40}$/.test(selection.build.gitSha)
        && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(selection.releaseTag) && !selection.releaseTag.includes(".."), "SOURCE-INVALID");
      const url = new URL(selection.build.apiBaseUrl);
      requireFact(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, "SOURCE-INVALID");
      const repository = await realpath(selection.build.repository);
      const repositoryDirectory = own(await directoryLease(repository, false));
      const source = { repository, gitSha: selection.build.gitSha, gitTree: git(repository, ["rev-parse", `${selection.build.gitSha}^{tree}`]),
        repositoryIdentity: repositoryDirectory.identity, releaseTag: selection.releaseTag, tagObject: git(repository, ["rev-parse", `refs/tags/${selection.releaseTag}`]) };
      verifySource({ source });
      const tag = own(await tagLease(repository, source.releaseTag));
      const controller = { gitSha: git(controllerRoot, ["rev-parse", "HEAD"]), gitTree: git(controllerRoot, ["rev-parse", "HEAD^{tree}"]) };
      requireFact(git(controllerRoot, ["status", "--porcelain", "--untracked-files=no"]) === "", "CONTROLLER-CHANGED");
      const code: Awaited<ReturnType<typeof fileLease>>[] = [];
      for (const relative of ["ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifactCustody.ts",
        "ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifact.ts", "ops/self-hosted/scripts/upgrade-lib.sh"]) {
        const material = own(await fileLease(path.join(controllerRoot, relative), false));
        const blob = createHash("sha1").update(Buffer.from(`blob ${material.bytes.length}\0`)).update(material.bytes).digest("hex");
        requireFact(git(controllerRoot, ["rev-parse", `${controller.gitSha}:${relative}`]) === blob, "CONTROLLER-CHANGED");
        code.push(material);
      }
      if (selection.build.buildNetworkFile) requireFact(await realpath(selection.build.buildNetworkFile) === selection.build.buildNetworkFile, "MATERIAL-UNSAFE");
      const network = selection.build.buildNetworkFile ? own(await fileLease(selection.build.buildNetworkFile)) : undefined;
      await host.verify(); await assertBoundary(input, expected); host.verifyIdentity();
      const directory = path.join(root, custodyName);
      mkdirSync(directory, { mode: 0o700 }); fsyncSync(host.fd.fd);
      const custody = own(await directoryLease(directory));
      const request: Request = { version: "application-artifact-request-v1", hostRunId: expected.runId, journalPath: input.journalPath, originalJournal: expected,
        hostIdentity: host.identity, custodyIdentity: custody.identity, source, controller,
        build: { ...selection.build, repository }, network: network ? { identity: network.identity, digest: network.digest } : null };
      verifySource(request);
      await tag.verify(); await host.verify(); await custody.verify(); await assertBoundary(input, expected);
      tag.verifyIdentity(); host.verifyIdentity(); custody.verifyIdentity();
      writeExclusive(path.join(directory, "request.json"), request, custody.fd);
      const requestFile = own(await fileLease(path.join(directory, "request.json")));
      requireFact(requestFile.digest === digestOf(request), "MATERIAL-CHANGED");
      const verify = async () => {
        await host.verify(); await custody.verify(); await requestFile.verify(); await network?.verify(); await tag.verify(); verifySource(request);
        for (const material of code) await material.verify();
        await repositoryDirectory.verify();
        requireFact(git(controllerRoot, ["rev-parse", "HEAD"]) === controller.gitSha
          && git(controllerRoot, ["status", "--porcelain", "--untracked-files=no"]) === "", "CONTROLLER-CHANGED");
        await assertBoundary(input, expected);
        host.verifyIdentity(); custody.verifyIdentity(); requestFile.verifyIdentity(); repositoryDirectory.verifyIdentity(); network?.verifyIdentity(); tag.verifyIdentity();
        for (const material of code) material.verifyIdentity();
      };
      await verify(); expected = append(input, expected, "pending", materialRecordDigest(requestFile), "crashed");
      markUnknown = async () => { await verify(); expected = append(input, expected, "unknown", materialRecordDigest(requestFile), "crashed"); };
      const artifact = await buildApplicationArtifact({ ...request.build, outputParent: root });
      await verify();
      const pins = await applicationVerificationPins(artifact, source.releaseTag);
      const artifactDirectory = path.dirname(artifact.manifestPath);
      requireFact(path.dirname(artifactDirectory) === root && /^application-[a-zA-Z0-9]+$/.test(path.basename(artifactDirectory)), "MATERIAL-UNSAFE");
      const inspected = own(await openApplicationArtifactInspection(artifactDirectory, artifact.packageManifestDigest));
      requireFact(inspected.manifest.gitSha === source.gitSha && inspected.manifest.gitTree === source.gitTree, "SOURCE-CHANGED");
      const receipt: Receipt = { version: "application-artifact-receipt-v1", hostRunId: expected.runId, requestDigest: requestFile.digest,
        requestIdentity: requestFile.identity,
        artifactName: path.basename(artifactDirectory), packageManifestDigest: artifact.packageManifestDigest, pins: structuredClone(pins),
        directoryIdentity: structuredClone(inspected.directoryIdentity), materials: structuredClone(inspected.materials) };
      await inspected.verify(); await verify();
      syncInspectedMaterials(artifactDirectory, inspected);
      await verify(); inspected.verifyIdentity();
      writeExclusive(path.join(directory, "receipt.json"), receipt, custody.fd);
      const receiptFile = own(await fileLease(path.join(directory, "receipt.json")));
      requireFact(receiptFile.digest === digestOf(receipt), "MATERIAL-CHANGED");
      await inspected.verify(); await receiptFile.verify(); await verify();
      inspected.verifyIdentity(); receiptFile.verifyIdentity();
      expected = append(input, expected, "committed", materialRecordDigest(receiptFile), "committed"); markUnknown = undefined;
    }, async () => { await markUnknown?.(); });
  } catch (error) {
    throw safeError(error);
  }
  return reopenApplicationArtifactSelection(input);
}

/** Reads only the original protected receipt and exact committed journal.
 * Every observe owns/releases its FDs; this handle holds no process resources. */
export async function reopenApplicationArtifactSelection(supplied: Boundary): Promise<ApplicationArtifactSelection> {
  const input = captureBoundary(supplied);
  const observe = () => finish(async own => {
    const expected = structuredClone(input.journal.record);
    await assertBoundary(input, expected);
    const events = expected.entries.filter(entry => entry.action.startsWith(prefix));
    requireFact(events.length === 2 && events[0].action === `${prefix}pending` && events[0].outcome === "crashed"
      && events[1].action === `${prefix}committed` && events[1].outcome === "committed" && events[1].seq === events[0].seq + 1, "UNAVAILABLE");
    const root = path.dirname(input.journal.journalPath), host = own(await directoryLease(root));
    const custody = own(await directoryLease(path.join(root, custodyName)));
    const requestFile = own(await fileLease(path.join(root, custodyName, "request.json")));
    const receiptFile = own(await fileLease(path.join(root, custodyName, "receipt.json")));
    const request = JSON.parse(requestFile.bytes.toString()) as Request, receipt = JSON.parse(receiptFile.bytes.toString()) as Receipt;
    requireFact(materialRecordDigest(requestFile) === events[0].inputDigest && materialRecordDigest(receiptFile) === events[1].inputDigest
      && digestOf(request) === requestFile.digest && digestOf(receipt) === receiptFile.digest
      && request.version === "application-artifact-request-v1" && receipt.version === "application-artifact-receipt-v1"
      && request.hostRunId === expected.runId && request.journalPath === input.journalPath
      && receipt.hostRunId === expected.runId && receipt.requestDigest === requestFile.digest
      && equal(receipt.requestIdentity, requestFile.identity)
      && equal(request.hostIdentity, host.identity) && equal(request.custodyIdentity, custody.identity)
      && request.originalJournal.entries.length === events[0].seq - 1
      && equal(expected.entries.slice(0, events[0].seq - 1), request.originalJournal.entries)
      && /^[a-zA-Z0-9]+$/.test(receipt.artifactName.slice("application-".length)) && receipt.artifactName.startsWith("application-"), "RECEIPT-MISMATCH");
    const inspected = own(await openApplicationArtifactInspection(path.join(root, receipt.artifactName), receipt.packageManifestDigest));
    const repositoryDirectory = own(await directoryLease(request.source.repository, false));
    const tag = own(await tagLease(request.source.repository, request.source.releaseTag));
    const network = request.build.buildNetworkFile ? own(await fileLease(await realpath(request.build.buildNetworkFile))) : undefined;
    requireFact(equal(repositoryDirectory.identity, request.source.repositoryIdentity)
      && equal(request.network, network ? { identity: network.identity, digest: network.digest } : null), "MATERIAL-CHANGED");
    requireFact(equal(inspected.directoryIdentity, receipt.directoryIdentity) && equal(inspected.materials, receipt.materials)
      && inspected.manifest.gitSha === request.source.gitSha && inspected.manifest.gitTree === request.source.gitTree, "MATERIAL-CHANGED");
    const pins = { gitSha: request.source.gitSha, releaseTag: request.source.releaseTag, packageManifestDigest: receipt.packageManifestDigest,
      apiImageDigest: inspected.manifest.services.api.manifestDigest, workerImageDigest: inspected.manifest.services.worker.manifestDigest,
      webImageDigest: inspected.manifest.services.web.manifestDigest };
    requireFact(equal(pins, receipt.pins), "RECEIPT-MISMATCH");
    verifySource(request);
    requireFact(await realpath(request.source.repository) === request.source.repository
      && equal(identity(await lstat(request.source.repository, { bigint: true })), request.source.repositoryIdentity), "SOURCE-CHANGED");
    await inspected.verify(); await requestFile.verify(); await receiptFile.verify(); await custody.verify(); await host.verify();
    await network?.verify(); await repositoryDirectory.verify(); await tag.verify();
    await assertBoundary(input, expected);
    inspected.verifyIdentity(); requestFile.verifyIdentity(); receiptFile.verifyIdentity(); custody.verifyIdentity(); host.verifyIdentity();
    repositoryDirectory.verifyIdentity(); network?.verifyIdentity(); tag.verifyIdentity();
    return { pins: structuredClone(pins), manifest: structuredClone(inspected.manifest), loadedImageId: inspected.image.loadedImageId,
      source: { gitSha: request.source.gitSha, gitTree: request.source.gitTree }, receiptDigest: receiptFile.digest };
  });
  await observe(); return Object.freeze({ observe });
}
