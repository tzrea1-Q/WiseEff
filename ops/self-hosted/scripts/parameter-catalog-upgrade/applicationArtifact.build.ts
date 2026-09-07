/** Explicit real-build acceptance of the maintainer terminal entry. No running
 * services, Docker default changes, shared Git tags or release approval. The
 * final mutation intentionally makes this synthetic run ineligible for reuse. */
import assert from "node:assert/strict";
import { readFile, open, mkdtemp, realpath, lstat, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { openApplicationArtifactInspection, ApplicationArtifactError } from "./applicationArtifact";

const [repository, gitSha, expectedDaemonId, outputParent, apiBaseUrl, buildNetworkFile] = process.argv.slice(2);
const entry = fileURLToPath(new URL("../upgrade.sh", import.meta.url));
let commandSequence = 0;
type TerminalResult = { status: number | null; stdout: string; stderr: string; pid: number };

async function terminal(args: string[]): Promise<TerminalResult> {
  // Each call is a new process. Own only this command's process group; the
  // production entry retains ownership of its build and journal lifecycle.
  const result = await new Promise<TerminalResult>((resolve, reject) => {
    const child = spawn("bash", [entry, ...args], { cwd: outputParent, detached: true,
      env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failed = false, escalation: NodeJS.Timeout | undefined;
    const signal = (value: NodeJS.Signals) => {
      if (child.pid) { try { process.kill(-child.pid, value); } catch { /* already gone */ } }
    };
    const interrupt = () => {
      failed = true;
      signal("SIGTERM");
      escalation ??= setTimeout(() => signal("SIGKILL"), 2_000);
    };
    const collect = (current: string, chunk: Buffer) => {
      if (Buffer.byteLength(current) + chunk.length > 1024 * 1024) { interrupt(); return current; }
      return current + chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
    child.once("error", () => { failed = true; });
    process.on("SIGTERM", interrupt); process.on("SIGINT", interrupt);
    const deadline = setTimeout(interrupt, 20 * 60_000);
    child.once("close", status => {
      clearTimeout(deadline);
      if (escalation) clearTimeout(escalation);
      if (failed) signal("SIGKILL");
      process.off("SIGTERM", interrupt); process.off("SIGINT", interrupt);
      if (failed || !child.pid) reject(new Error("application-artifact-terminal-process-failed"));
      else resolve({ status, stdout, stderr, pid: child.pid });
    });
  });
  // Full subprocess output is retained only in the owned private evidence root.
  const evidence = await open(path.join(outputParent, `terminal-${++commandSequence}-${args[0]}.json`), "wx", 0o600);
  try { await evidence.writeFile(JSON.stringify(result)); await evidence.sync(); } finally { await evidence.close(); }
  return result;
}

try {
  assert.ok(repository && gitSha && expectedDaemonId && outputParent && apiBaseUrl && process.argv.length <= 8,
    "application-artifact-build-test-arguments-required");
  const parent = await lstat(outputParent);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === process.getuid?.() &&
    (parent.mode & 0o777) === 0o700 && await realpath(outputParent) === outputParent, "private-evidence-root-required");
  // Only this private copy receives synthetic references. No shared repository
  // refs or remote are changed, and a tag remains identity, never approval.
  const synthetic = await mkdtemp(path.join(outputParent, "synthetic-git-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", ["--no-replace-objects", ...args], { timeout: 30_000,
      maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    assert.equal(result.status, 0, "synthetic-git-operation-failed");
  };
  git(["clone", "--shared", "--no-checkout", "--no-hardlinks", "--", repository, synthetic]);
  git(["-C", synthetic, "tag", "synthetic-artifact-acceptance", gitSha]);
  git(["-C", synthetic, "tag", "synthetic-artifact-wrong-source", `${gitSha}^`]);
  const root = await mkdtemp(path.join(outputParent, "terminal-run-"));
  const journal = path.join(root, "journal.json"), runId = "synthetic-terminal-acceptance";
  const selection = ["--journal", journal, "--run-id", runId];
  const prepare = ["--source-repository", synthetic, "--source-sha", gitSha,
    "--expected-daemon-id", expectedDaemonId, "--api-base-url", apiBaseUrl,
    ...(buildNetworkFile ? ["--build-network-file", buildNetworkFile] : [])];
  const initialized = await terminal(["artifact-init", ...selection]);
  assert.equal(initialized.status, 0, "terminal-init-failed");
  assert.equal(JSON.parse(initialized.stdout).scope, "empty-artifact-run-only");
  const prepared = await terminal(["artifact-prepare", ...selection, ...prepare, "--release-tag", "synthetic-artifact-acceptance"]);
  assert.equal(prepared.status, 0, "terminal-prepare-failed");
  const observed = JSON.parse(prepared.stdout);
  assert.equal(observed.scope, "application-artifact-only");
  assert.equal(observed.source.gitSha, gitSha);
  assert.equal(observed.pins.gitSha, gitSha);
  assert.equal(observed.pins.releaseTag, "synthetic-artifact-acceptance");
  assert.equal(observed.pins.apiImageDigest, observed.pins.workerImageDigest);
  assert.equal(observed.pins.apiImageDigest, observed.pins.webImageDigest);
  assert.equal(observed.releaseApproved, false);
  const inspected = await terminal(["artifact-inspect", ...selection]);
  assert.equal(inspected.status, 0, "terminal-inspect-failed");
  assert.notEqual(inspected.pid, prepared.pid, "independent-process-required");
  assert.deepEqual(JSON.parse(inspected.stdout), observed);

  const wrongRoot = await mkdtemp(path.join(outputParent, "terminal-wrong-source-"));
  const wrongJournal = path.join(wrongRoot, "journal.json");
  const wrongSelection = ["--journal", wrongJournal, "--run-id", "synthetic-wrong-source"];
  assert.equal((await terminal(["artifact-init", ...wrongSelection])).status, 0, "negative-run-init-failed");
  const missing = await terminal(["artifact-prepare", ...wrongSelection, ...prepare]);
  assert.equal(missing.status, 2);
  assert.equal(missing.stderr.trim(), "PCAT-UPG-ARTIFACT-ARGUMENTS-INVALID");
  const wrong = await terminal(["artifact-prepare", ...wrongSelection, ...prepare, "--release-tag", "synthetic-artifact-wrong-source"]);
  assert.equal(wrong.status, 2);
  assert.equal(wrong.stderr.trim(), "PCAT-APPLICATION-CUSTODY-SOURCE-CHANGED");
  assert.equal(JSON.parse(await readFile(wrongJournal, "utf8")).entries.length, 0);
  assert.equal((await readdir(wrongRoot)).some(name => name.startsWith("application-")), false);

  // The actual original receipt locates test material; it is not imported as
  // authority. Only the terminal above issued/reopened the retained selection.
  const receipt = JSON.parse(await readFile(path.join(root, "application-artifact-custody", "receipt.json"), "utf8"));
  assert.match(receipt.artifactName, /^application-[A-Za-z0-9]+$/);
  assert.equal(receipt.packageManifestDigest, observed.pins.packageManifestDigest);
  const directory = path.join(root, receipt.artifactName);
  const manifestPath = path.join(directory, "application-package.json");
  const original = await readFile(manifestPath);
  const replace = async (bytes: Buffer) => {
    const file = await open(manifestPath, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  };
  try {
    await replace(Buffer.concat([original, Buffer.from("\n")]));
    const changed = await terminal(["artifact-inspect", ...selection]);
    assert.equal(changed.status, 2);
    assert.equal(changed.stderr.trim(), "PCAT-APPLICATION-CUSTODY-UNAVAILABLE");
  } finally { await replace(original); }
  const raw = await openApplicationArtifactInspection(directory, receipt.packageManifestDigest);
  try {
    await raw.verify();
    assert.equal(raw.manifest.gitSha, gitSha);
    assert.equal(raw.manifest.buildTrust.tlsPolicy, "verify");
    assert.equal(raw.manifest.services.api.manifestDigest, observed.pins.apiImageDigest);
  } finally { await raw.close(); }
  // Restoring bytes does not restore the original FD identity/ctime pinned in
  // the receipt. This test run is deliberately no longer a usable candidate.
  const restored = await terminal(["artifact-inspect", ...selection]);
  assert.equal(restored.status, 2);
  assert.equal(restored.stderr.trim(), "PCAT-APPLICATION-CUSTODY-MATERIAL-CHANGED");
  console.info(JSON.stringify({ scope: "application-terminal-acceptance-only", gitSha,
    packageManifestDigest: observed.pins.packageManifestDigest, loadedImageId: observed.loadedImageId,
    manifestDigest: observed.pins.apiImageDigest, receiptDigest: observed.receiptDigest,
    independentReopenVerified: true, wrongSourceRejected: true, originalMaterialMutationRejected: true,
    restoredBytesDoNotReissue: true, negativeTestRunEligible: false, releaseApproved: false }));
} catch (error) {
  console.error(error instanceof ApplicationArtifactError ? error.message : "application-artifact-terminal-test-failed");
  process.exitCode = 1;
}
