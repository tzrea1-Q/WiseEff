import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { withHostOperationLock } from "./handoff";
import { loadUpgradeJournal, openUpgradeJournal } from "./journal";
import { ApplicationArtifactError } from "./applicationArtifact";
import { ApplicationArtifactCustodyRefusal, produceApplicationArtifactSelection, reopenApplicationArtifactSelection } from "./applicationArtifactCustody";

class ArtifactTerminalRefusal extends Error {
  constructor(readonly reason: "ARGUMENTS-INVALID" | "JOURNAL-UNAVAILABLE" | "OPERATION-FAILED") {
    super(`PCAT-UPG-ARTIFACT-${reason}`);
  }
}
const invalid = (): never => { throw new ArtifactTerminalRefusal("ARGUMENTS-INVALID"); };
const absolute = (value: string | undefined): value is string => !!value && path.isAbsolute(value) && path.resolve(value) === value;

async function main(args: string[]) {
  const [action, ...rest] = args;
  if (action !== "artifact-init" && action !== "artifact-prepare" && action !== "artifact-inspect") invalid();
  const required = action === "artifact-prepare"
    ? ["--journal", "--run-id", "--source-repository", "--source-sha", "--expected-daemon-id", "--release-tag", "--api-base-url"]
    : ["--journal", "--run-id"];
  const allowed = new Set([...required, ...(action === "artifact-prepare" ? ["--build-network-file"] : [])]);
  const values = new Map<string, string>();
  if (rest.length % 2) invalid();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]!, value = rest[index + 1]!;
    if (!allowed.has(key) || values.has(key) || !value || value.startsWith("--") || value.includes("\0")) invalid();
    values.set(key, value);
  }
  if (required.some(key => !values.has(key))) invalid();
  const journalPath = values.get("--journal"), runId = values.get("--run-id")!;
  if (!absolute(journalPath) || !/^[A-Za-z0-9_-]{1,160}$/.test(runId)) invalid();
  if (action === "artifact-prepare") {
    if (!absolute(values.get("--source-repository")) || !/^[a-f0-9]{40}$/.test(values.get("--source-sha")!) ||
        (values.has("--build-network-file") && !absolute(values.get("--build-network-file")))) invalid();
    try {
      const url = new URL(values.get("--api-base-url")!);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) invalid();
    } catch { invalid(); }
  }
  // Prepare/inspect never create a run or use ambient configuration to repair
  // an incomplete invocation. Only explicit init creates an empty journal;
  // lock acquisition itself is a documented local write for all three actions.
  if (action !== "artifact-init" && !loadUpgradeJournal({ journalPath, runId, requireSettled: true }).ok) {
    throw new ArtifactTerminalRefusal("JOURNAL-UNAVAILABLE");
  }
  const directory = path.dirname(journalPath), original = await lstat(directory);
  if (!original.isDirectory() || original.isSymbolicLink() || original.uid !== process.getuid?.() ||
      (original.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) {
    throw new ArtifactTerminalRefusal("JOURNAL-UNAVAILABLE");
  }
  await withHostOperationLock(directory, async lock => {
    const current = await lstat(directory);
    if (current.dev !== original.dev || current.ino !== original.ino) throw new ArtifactTerminalRefusal("JOURNAL-UNAVAILABLE");
    if (action === "artifact-init") {
      await lock.assertHeld();
      const initialized = openUpgradeJournal({ journalPath, runId, requireNew: true });
      if (!initialized.ok) throw new ArtifactTerminalRefusal("JOURNAL-UNAVAILABLE");
      await lock.assertHeld();
      process.stdout.write(JSON.stringify({ ok: true, scope: "empty-artifact-run-only", runId,
        releaseApproved: false }) + "\n");
      return;
    }
    const loaded = loadUpgradeJournal({ journalPath, runId, requireSettled: true });
    if (!loaded.ok) throw new ArtifactTerminalRefusal("JOURNAL-UNAVAILABLE");
    const selection = action === "artifact-prepare"
      ? await produceApplicationArtifactSelection({ journal: loaded.value, lock,
        build: { repository: values.get("--source-repository")!, gitSha: values.get("--source-sha")!,
          expectedDaemonId: values.get("--expected-daemon-id")!, apiBaseUrl: values.get("--api-base-url")!,
          ...(values.has("--build-network-file") ? { buildNetworkFile: values.get("--build-network-file")! } : {}) },
        releaseTag: values.get("--release-tag")! })
      : await reopenApplicationArtifactSelection({ journal: loaded.value, lock });
    const observed = await selection.observe();
    await lock.assertHeld();
    process.stdout.write(JSON.stringify({ ok: true, scope: "application-artifact-only",
      source: { gitSha: observed.source.gitSha, gitTree: observed.source.gitTree },
      loadedImageId: observed.loadedImageId, receiptDigest: observed.receiptDigest,
      pins: { gitSha: observed.pins.gitSha, releaseTag: observed.pins.releaseTag,
        packageManifestDigest: observed.pins.packageManifestDigest, apiImageDigest: observed.pins.apiImageDigest,
        workerImageDigest: observed.pins.workerImageDigest, webImageDigest: observed.pins.webImageDigest },
      releaseApproved: false }) + "\n");
  });
}

try { await main(process.argv.slice(2)); }
catch (error) {
  // Never print arbitrary Git/Docker/SQL errors or private configuration paths.
  const reason = error instanceof ArtifactTerminalRefusal || error instanceof ApplicationArtifactError || error instanceof ApplicationArtifactCustodyRefusal
    ? error.message : "PCAT-UPG-ARTIFACT-OPERATION-FAILED";
  process.stderr.write(reason + "\n");
  process.exitCode = 2;
}
