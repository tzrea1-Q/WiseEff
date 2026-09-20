import { describe, expect, it } from "vitest";

import { firstAcmePredecessor } from "../builder/predecessorHarness";
import { buildPowerConfigSuccessor, powerConfigFrozenIdentity } from "./configurationSchemaSuccessor";

describe("buildPowerConfigSuccessor", () => {
  it("installs wiseeff.power-config on m2-core from the acme predecessor", async () => {
    const predecessor = firstAcmePredecessor();
    const result = await buildPowerConfigSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      frozenIdentity: powerConfigFrozenIdentity({
        candidateId: "ccand_power_config_1",
        artifactId: "cart_power_config_1",
        releaseId: "crel_power_config_1",
        releaseVersion: "1.2.0",
        publishedAt: "2026-09-17T00:00:00Z",
        toolchain: predecessor.first.manifest.toolchain,
        subjectId: "csub_wiseeff_power_config",
        cvDefinitionId: "pdef_power_config_cv_limit",
        cvRevisionId: "drev_power_config_cv_limit_1",
        thermalDefinitionId: "pdef_power_config_thermal_target",
        thermalRevisionId: "drev_power_config_thermal_target_1",
      }),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok || result.value.kind !== "successor") return;
    const target = result.value.artifact.bundle.releases.find(
      (release) => release.manifest.release.id === result.value.artifact.targetReleaseId,
    );
    expect(target?.documents.some(
      (document) =>
        document.kind === "subject" &&
        document.content.kind === "configuration-schema" &&
        document.content.canonicalKey === "wiseeff.power-config",
    )).toBe(true);
  });
});
