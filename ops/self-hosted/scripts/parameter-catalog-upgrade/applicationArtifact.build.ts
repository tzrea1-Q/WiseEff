/** Explicit real-build acceptance command. No environment opt-in, fake build,
 * Docker default change, running services or production release creation. */
import assert from "node:assert/strict";
import { readFile, writeFile, open, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildApplicationArtifact, applicationVerificationPins, readApplicationArtifact, ApplicationArtifactError } from "./applicationArtifact";

const [repository, gitSha, expectedDaemonId, outputParent, apiBaseUrl, buildNetworkFile] = process.argv.slice(2);
if (!repository || !gitSha || !expectedDaemonId || !outputParent || !apiBaseUrl || process.argv.length > 8) {
  throw new Error("application-artifact-build-test-arguments-required");
}
try {
  // Only this private copy receives synthetic tag references. No shared repo
  // refs or remote are changed, and a tag remains identity, never approval.
  const synthetic = await mkdtemp(path.join(outputParent, "synthetic-git-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    assert.equal(result.status, 0, "synthetic-git-operation-failed"); return result.stdout.toString().trim();
  };
  git(["clone", "--shared", "--no-checkout", "--no-hardlinks", "--", repository, synthetic]);
  git(["-C", synthetic, "tag", "synthetic-artifact-acceptance", gitSha]);
  git(["-C", synthetic, "tag", "synthetic-artifact-wrong-source", `${gitSha}^`]);
  const artifact = await buildApplicationArtifact({ repository: synthetic, gitSha, expectedDaemonId, outputParent, apiBaseUrl, buildNetworkFile });
  const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8"));
  assert.equal(manifest.gitSha, gitSha);
  assert.equal(manifest.services.api.manifestDigest, artifact.image.manifestDigest);
  assert.equal(manifest.services.worker.configDigest, artifact.image.configDigest);
  assert.equal(manifest.services.web.archiveDigest, artifact.image.archiveDigest);
  assert.equal(manifest.buildTrust.tlsPolicy, "verify");
  await assert.rejects(applicationVerificationPins(artifact), error => error instanceof ApplicationArtifactError && error.code === "RELEASE-IDENTITY-REQUIRED");
  const pins = await applicationVerificationPins(artifact, "synthetic-artifact-acceptance");
  assert.equal(pins.gitSha, gitSha); assert.equal(pins.apiImageDigest, artifact.image.manifestDigest);
  assert.equal(pins.packageManifestDigest, artifact.packageManifestDigest);
  await assert.rejects(applicationVerificationPins(artifact, "synthetic-artifact-wrong-source"), error => error instanceof ApplicationArtifactError && error.code === "RELEASE-SOURCE-MISMATCH");
  // Real issued package mutation, not a caller-created passing receipt. Restore
  // the exact bytes in finally and verify them again before retaining evidence.
  const original = await readFile(artifact.manifestPath);
  try {
    await writeFile(artifact.manifestPath, Buffer.concat([original, Buffer.from("\n")]));
    await assert.rejects(readApplicationArtifact(artifact), error => error instanceof ApplicationArtifactError && error.code === "PACKAGE-CHANGED");
  } finally {
    const file = await open(artifact.manifestPath, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
    try { await file.writeFile(original); await file.sync(); } finally { await file.close(); }
  }
  assert.deepEqual(await readApplicationArtifact(artifact), manifest);
  console.info(JSON.stringify({ scope: "application-build-artifact-only", gitSha,
    packageManifestDigest: artifact.packageManifestDigest, loadedImageId: artifact.image.loadedImageId,
    manifestDigest: artifact.image.manifestDigest, configDigest: artifact.image.configDigest,
    platform: artifact.image.platform, releaseApproved: false }));
} catch (error) {
  console.error(error instanceof ApplicationArtifactError ? error.message : "application-artifact-build-test-failed");
  process.exitCode = 1;
}
