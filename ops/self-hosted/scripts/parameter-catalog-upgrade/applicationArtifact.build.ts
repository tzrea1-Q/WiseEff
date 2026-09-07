/** Explicit real-build acceptance command. No environment opt-in, fake build,
 * Docker default change, running services or release/tag creation. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildApplicationArtifact, applicationVerificationPins, ApplicationArtifactError } from "./applicationArtifact";

const [repository, gitSha, expectedDaemonId, outputParent, apiBaseUrl, buildNetworkFile] = process.argv.slice(2);
if (!repository || !gitSha || !expectedDaemonId || !outputParent || !apiBaseUrl || process.argv.length > 8) {
  throw new Error("application-artifact-build-test-arguments-required");
}
try {
  const artifact = await buildApplicationArtifact({ repository, gitSha, expectedDaemonId, outputParent, apiBaseUrl, buildNetworkFile });
  const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8"));
  assert.equal(manifest.gitSha, gitSha);
  assert.equal(manifest.services.api.manifestDigest, artifact.image.manifestDigest);
  assert.equal(manifest.services.worker.configDigest, artifact.image.configDigest);
  assert.equal(manifest.services.web.archiveDigest, artifact.image.archiveDigest);
  assert.equal(manifest.buildTrust.tlsPolicy, "verify");
  await assert.rejects(applicationVerificationPins(artifact), error => error instanceof ApplicationArtifactError && error.code === "RELEASE-IDENTITY-REQUIRED");
  console.info(JSON.stringify({ scope: "application-build-artifact-only", gitSha,
    packageManifestDigest: artifact.packageManifestDigest, loadedImageId: artifact.image.loadedImageId,
    manifestDigest: artifact.image.manifestDigest, configDigest: artifact.image.configDigest,
    platform: artifact.image.platform, releaseApproved: false }));
} catch (error) {
  console.error(error instanceof ApplicationArtifactError ? error.message : "application-artifact-build-test-failed");
  process.exitCode = 1;
}
