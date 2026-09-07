import { mkdtempSync, realpathSync, rmSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { canonicalBytes, digestOf } from "../../../../server/modules/release-verification/core/digest";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withHostOperationLock, type HostOperationLock } from "./handoff";
import { openUpgradeJournal, commitJournalTransition, journalBytes } from "./journal";
import { produceApplicationArtifactSelection, reopenApplicationArtifactSelection } from "./applicationArtifactCustody";

const mocks = vi.hoisted(() => ({ build: vi.fn(), pins: vi.fn(), inspect: vi.fn(), cleanController: false, failSyncInode: 0,
  afterGit: undefined as undefined | (() => void) }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, fsyncSync: (fd: number) => {
    if (mocks.failSyncInode && actual.fstatSync(fd).ino === mocks.failSyncInode) throw new Error("private metadata sync failure");
    return actual.fsyncSync(fd);
  } };
});
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs"), crypto = await import("node:crypto"), paths = await import("node:path");
  return { ...actual, spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
    // Only the module-under-development status is an auxiliary test seam.
    // All source/tag Git calls and host-lock children still execute natively.
    if (mocks.cleanController && args[0] === "git" && Array.isArray(args[1]) && args[1].includes("status"))
      return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const ref = Array.isArray(args[1]) ? args[1].at(-1) : undefined;
    if (mocks.cleanController && args[0] === "git" && typeof ref === "string" && /^[a-f0-9]{40}:ops\//.test(ref)) {
      const root = args[1]![2] as string, bytes = fs.readFileSync(paths.join(root, ref.slice(41)));
      return { status: 0, stdout: Buffer.from(crypto.createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex")), stderr: Buffer.alloc(0) };
    }
    const result = actual.spawnSync(...args); if (args[0] === "git") mocks.afterGit?.(); return result;
  } };
});
vi.mock("./applicationArtifact", async importOriginal => ({ ...(await importOriginal<typeof import("./applicationArtifact")>()),
  buildApplicationArtifact: mocks.build, applicationVerificationPins: mocks.pins, openApplicationArtifactInspection: mocks.inspect }));
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); mocks.build.mockReset(); mocks.pins.mockReset(); mocks.inspect.mockReset(); mocks.cleanController = false;
  mocks.failSyncInode = 0;
  mocks.afterGit = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "artifact-custody-"))); roots.push(root);
  const result = openUpgradeJournal({ journalPath: path.join(root, "journal.json"), runId: "host" });
  if (!result.ok) throw new Error("fixture-journal");
  return { root, journal: result.value };
}
const build = { repository: "/absent", gitSha: "a".repeat(40), expectedDaemonId: "daemon", apiBaseUrl: "http://127.0.0.1:8787" };

it("does not import arbitrary package JSON without an original host receipt", async () => {
  const f = fixture(); const before = journalBytes(f.journal.journalPath);
  writeFileSync(path.join(f.root, "application-package.json"), "{}", { mode: 0o600 });
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: f.journal, lock })))
    .rejects.toThrow("PCAT-APPLICATION-CUSTODY-UNAVAILABLE");
  expect(journalBytes(f.journal.journalPath)).toEqual(before); expect(mocks.build).not.toHaveBeenCalled();
});
it("rejects an unissued host lock before any source or build work", async () => {
  const f = fixture();
  await expect(produceApplicationArtifactSelection({ journal: f.journal, lock: {} as HostOperationLock, build, releaseTag: "candidate" }))
    .rejects.toThrow("PCAT-APPLICATION-CUSTODY-BOUNDARY");
  expect(mocks.build).not.toHaveBeenCalled();
});
it.each(["pending", "unknown", "committed"])("never rebuilds an existing %s selection", async outcome => {
  const f = fixture();
  expect(commitJournalTransition(f.journal, { action: `application-artifact-${outcome}`, inputDigest: "sha256:" + "a".repeat(64),
    toState: "idle", nextAction: "plan", outcome: outcome === "committed" ? "committed" : "crashed" }).ok).toBe(true);
  const before = journalBytes(f.journal.journalPath);
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ journal: f.journal, lock, build, releaseTag: "candidate" })))
    .rejects.toThrow("PCAT-APPLICATION-CUSTODY-EXISTING-SELECTION");
  expect(journalBytes(f.journal.journalPath)).toEqual(before); expect(mocks.build).not.toHaveBeenCalled();
});
it("rejects an unsettled journal instead of treating partial persistence as approval", async () => {
  const f = fixture(); mkdirSync(`${f.journal.journalPath}.write-lock`, { mode: 0o700 });
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: f.journal, lock })))
    .rejects.toThrow("PCAT-APPLICATION-CUSTODY-BOUNDARY");
  expect(mocks.build).not.toHaveBeenCalled();
});
it("rejects a stale caller record even when the shared run ID is correct", async () => {
  const f = fixture(); const stale = { ...f.journal, record: structuredClone(f.journal.record) };
  expect(commitJournalTransition(f.journal, { action: "other", inputDigest: "other", toState: "idle", nextAction: "plan" }).ok).toBe(true);
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: stale, lock })))
    .rejects.toThrow("PCAT-APPLICATION-CUSTODY-BOUNDARY");
  expect(JSON.parse(readFileSync(f.journal.journalPath, "utf8")).entries).toHaveLength(1);
});

// These are host persistence tests. The build/OCI owner is explicitly a test
// double; actual issuance + separate-process acceptance uses the official CLI.
function issuedOwnerFixture() {
  const f = fixture(), repository = path.join(f.root, "repository"); mkdirSync(repository, { mode: 0o700 });
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repository, ...args], { env: { PATH: process.env.PATH, HOME: f.root } });
    expect(result.status).toBe(0); return result.stdout.toString().trim();
  };
  git("init", "--template="); writeFileSync(path.join(repository, "source.ts"), "source"); git("add", ".");
  git("-c", "user.name=synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", "source");
  git("tag", "candidate"); const gitSha = git("rev-parse", "HEAD"), gitTree = git("rev-parse", "HEAD^{tree}");
  const artifactDirectory = path.join(f.root, "application-fixture"), digest = `sha256:${"b".repeat(64)}`;
  const image = { loadedImageId: digest, manifestDigest: digest, configDigest: digest, archiveDigest: digest,
    gitSha, gitTree, platform: "linux/arm64", layers: [] };
  const manifest = { gitSha, gitTree, services: { api: image, worker: image, web: image } };
  const pins = { gitSha, releaseTag: "candidate", packageManifestDigest: digest, apiImageDigest: digest, workerImageDigest: digest, webImageDigest: digest };
  const close = vi.fn(async () => {}), verify = vi.fn(async () => {});
  const inspection = { manifest, image, directoryIdentity: { fixture: true }, materials: [{ name: "build-result.json", fixture: true }], close, verify, verifyIdentity: vi.fn() };
  mocks.cleanController = true;
  mocks.build.mockImplementation(async () => {
    mkdirSync(artifactDirectory, { mode: 0o700 });
    writeFileSync(path.join(artifactDirectory, "build-result.json"), "synthetic build metadata", { mode: 0o600 });
    return { packageManifestDigest: digest, manifestPath: path.join(artifactDirectory, "application-package.json"), image };
  });
  mocks.pins.mockResolvedValue(pins); mocks.inspect.mockImplementation(async () => inspection);
  const input = { journal: f.journal, build: { ...build, repository, gitSha }, releaseTag: "candidate" };
  return { ...f, input, git, close, verify, inspection };
}
it("persists a request before the actual owner call and reopens without another build", async () => {
  const f = issuedOwnerFixture();
  const implementation = mocks.build.getMockImplementation()!;
  mocks.build.mockImplementation(async (...args) => {
    expect(f.journal.record.entries.at(-1)?.action).toBe("application-artifact-pending");
    const request = JSON.parse(readFileSync(path.join(f.root, "application-artifact-custody/request.json"), "utf8"));
    expect(request.source.gitSha).toBe(f.input.build.gitSha); expect(request.originalJournal.cutoverRunId).toBeNull();
    expect(statSync(path.join(f.root, "application-artifact-custody/request.json")).mode & 0o777).toBe(0o600);
    return implementation(...args);
  });
  await withHostOperationLock(f.root, async lock => {
    const selection = await produceApplicationArtifactSelection({ ...f.input, lock });
    expect((await selection.observe()).source.gitSha).toBe(f.input.build.gitSha);
    expect(f.close).toHaveBeenCalledTimes(3);
  });
  await withHostOperationLock(f.root, async lock => {
    const reopened = await reopenApplicationArtifactSelection({ journal: f.journal, lock });
    expect((await reopened.observe()).pins.releaseTag).toBe("candidate");
  });
  expect(mocks.build).toHaveBeenCalledTimes(1);
  expect(f.journal.record.entries.map(entry => entry.action)).toEqual(["application-artifact-pending", "application-artifact-committed"]);
});
it("retains unknown after a build failure and never calls the owner again", async () => {
  const f = issuedOwnerFixture(); mocks.build.mockRejectedValue(new Error("private diagnostic"));
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("PCAT-APPLICATION-CUSTODY-UNAVAILABLE");
  expect(f.journal.record.entries.map(entry => entry.action)).toEqual(["application-artifact-pending", "application-artifact-unknown"]);
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: f.journal, lock }))).rejects.toThrow("UNAVAILABLE");
  expect(mocks.build).toHaveBeenCalledTimes(1);
});
it.each(["receipt-bytes", "receipt-replacement", "copied-root", "tag", "material", "request-bytes"])("rejects original custody drift: %s", async fault => {
  const f = issuedOwnerFixture();
  await withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }));
  if (fault === "receipt-bytes" || fault === "request-bytes") {
    const filename = path.join(f.root, "application-artifact-custody", fault === "receipt-bytes" ? "receipt.json" : "request.json");
    writeFileSync(filename, readFileSync(filename, "utf8") + "\n");
  }
  if (fault === "copied-root") {
    const directory = path.join(f.root, "application-artifact-custody"); renameSync(directory, `${directory}-original`); mkdirSync(directory, { mode: 0o700 });
    for (const name of ["request.json", "receipt.json"]) writeFileSync(path.join(directory, name), readFileSync(path.join(`${directory}-original`, name)), { mode: 0o600 });
  }
  if (fault === "receipt-replacement") {
    const receipt = path.join(f.root, "application-artifact-custody/receipt.json"); renameSync(receipt, `${receipt}.original`);
    writeFileSync(receipt, readFileSync(`${receipt}.original`), { mode: 0o600 });
  }
  if (fault === "tag") f.git("tag", "-d", "candidate");
  if (fault === "material") f.inspection.materials[0].fixture = false;
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: f.journal, lock }))).rejects.toThrow("PCAT-APPLICATION-CUSTODY-");
  expect(mocks.build).toHaveBeenCalledTimes(1);
});
it("refuses a durable receipt whose journal commit acknowledgment is missing", async () => {
  const f = issuedOwnerFixture();
  await withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }));
  // Restore the genuinely written pending record captured from its serialized
  // request preimage + the unchanged original pending entry, using the codec.
  const request = JSON.parse(readFileSync(path.join(f.root, "application-artifact-custody/request.json"), "utf8"));
  writeFileSync(f.journal.journalPath, canonicalBytes(request.originalJournal));
  const result = openUpgradeJournal({ journalPath: f.journal.journalPath, runId: "host" }); if (!result.ok) throw new Error("fixture-reopen");
  expect(commitJournalTransition(result.value, { action: "application-artifact-pending", inputDigest: digestOf(request), toState: "idle", nextAction: "plan", outcome: "crashed" }).ok).toBe(true);
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: result.value, lock }))).rejects.toThrow("UNAVAILABLE");
  expect(mocks.build).toHaveBeenCalledTimes(1);
});
it("keeps the first caller selection even if the input is mutated during the owner await", async () => {
  const f = issuedOwnerFixture(), implementation = mocks.build.getMockImplementation()!;
  mocks.build.mockImplementation(async (...args) => { f.input.releaseTag = "different"; f.input.build.gitSha = "f".repeat(40); return implementation(...args); });
  await withHostOperationLock(f.root, async lock => {
    const selected = await produceApplicationArtifactSelection({ ...f.input, lock });
    expect((await selected.observe()).pins.releaseTag).toBe("candidate");
  });
});
it("does not adopt a late shared journal mutation after artifact readback", async () => {
  const f = issuedOwnerFixture();
  mocks.pins.mockImplementation(async () => {
    expect(commitJournalTransition(f.journal, { action: "late-event", inputDigest: "late", toState: "idle", nextAction: "plan" }).ok).toBe(true);
    return { gitSha: f.input.build.gitSha, releaseTag: "candidate" };
  });
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("BOUNDARY");
  expect(f.journal.record.entries.some(entry => entry.action === "application-artifact-committed")).toBe(false);
  expect(f.close).toHaveBeenCalledOnce();
});
it("refuses same-byte request ABA during issuance without acknowledging the package", async () => {
  const f = issuedOwnerFixture(), implementation = mocks.build.getMockImplementation()!;
  mocks.build.mockImplementation(async (...args) => {
    const filename = path.join(f.root, "application-artifact-custody/request.json"), bytes = readFileSync(filename);
    writeFileSync(filename, bytes); return implementation(...args);
  });
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("MATERIAL-CHANGED");
  expect(f.journal.record.entries.map(entry => entry.action)).toEqual(["application-artifact-pending"]);
});
it("reports static close failure after commit without rewriting committed provenance as unknown", async () => {
  const f = issuedOwnerFixture(); f.close.mockRejectedValue(new Error("private close diagnostic"));
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("PCAT-APPLICATION-CUSTODY-CLOSE-FAILED");
  expect(f.journal.record.entries.at(-1)?.action).toBe("application-artifact-committed");
});
it("does not treat a copied same-run journal under the same parent as the original selection", async () => {
  const f = issuedOwnerFixture();
  await withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }));
  const copied = path.join(f.root, "copied.json"); writeFileSync(copied, journalBytes(f.journal.journalPath), { mode: 0o600 });
  const result = openUpgradeJournal({ journalPath: copied, runId: "host" }); if (!result.ok) throw new Error("fixture-journal");
  await expect(withHostOperationLock(f.root, lock => reopenApplicationArtifactSelection({ journal: result.value, lock }))).rejects.toThrow("RECEIPT-MISMATCH");
});
it("rejects a symbolic release tag before invoking the build owner", async () => {
  const f = issuedOwnerFixture(); const branch = f.git("symbolic-ref", "HEAD");
  f.git("symbolic-ref", "refs/tags/candidate", branch);
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("TAG-UNSUPPORTED");
  expect(mocks.build).not.toHaveBeenCalled();
});
it("does not acknowledge custody when a required material fsync fails", async () => {
  const f = issuedOwnerFixture(), implementation = mocks.build.getMockImplementation()!;
  mocks.build.mockImplementation(async (...args) => {
    const result = await implementation(...args);
    mocks.failSyncInode = statSync(path.join(f.root, "application-fixture/build-result.json")).ino;
    return result;
  });
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("PCAT-APPLICATION-CUSTODY-UNAVAILABLE");
  expect(f.journal.record.entries.map(entry => entry.action)).toEqual(["application-artifact-pending", "application-artifact-unknown"]);
  expect(f.close).toHaveBeenCalledOnce();
});
it("reopens a direct packed tag without depending on a new loose reference", async () => {
  const f = issuedOwnerFixture(); f.git("pack-refs", "--all", "--prune");
  await withHostOperationLock(f.root, async lock => {
    const selected = await produceApplicationArtifactSelection({ ...f.input, lock });
    expect((await selected.observe()).pins.releaseTag).toBe("candidate");
  });
});
it("refuses a world-readable build-network file before any build or pending record", async () => {
  const f = issuedOwnerFixture(), filename = path.join(f.root, "network.env"); writeFileSync(filename, "proxy config", { mode: 0o644 });
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, build: { ...f.input.build, buildNetworkFile: filename }, lock })))
    .rejects.toThrow("MATERIAL-UNSAFE");
  expect(mocks.build).not.toHaveBeenCalled(); expect(f.journal.record.entries).toHaveLength(0);
});
it("does not write the request when its actual holder dies during the final native Git check", async () => {
  const f = issuedOwnerFixture(); let killed = false;
  mocks.afterGit = () => {
    if (!existsSync(path.join(f.root, "application-artifact-custody"))) return;
    const primary = path.join(f.root, ".operation.lock.owner");
    const owner = readFileSync(existsSync(primary) ? primary : path.join(f.root, ".operation.lock.d/owner"), "utf8");
    const pid = Number(/^pid=(\d+)$/m.exec(owner)?.[1]);
    if (!pid || !owner.includes("operation=catalog-handoff\n")) throw new Error("fixture-holder");
    mocks.afterGit = undefined; process.kill(pid, "SIGKILL"); killed = true;
  };
  await expect(withHostOperationLock(f.root, lock => produceApplicationArtifactSelection({ ...f.input, lock }))).rejects.toThrow("BOUNDARY");
  expect(killed).toBe(true); expect(existsSync(path.join(f.root, "application-artifact-custody/request.json"))).toBe(false);
  expect(mocks.build).not.toHaveBeenCalled(); expect(f.journal.record.entries).toHaveLength(0);
});
