import { describe, expect, it } from "vitest";

import type { CutoverPlan } from "../../../../server/modules/catalog-cutover/interface";
import { PRE_ACTIVATION_PHASES } from "../../../../server/modules/catalog-cutover/interface";
import type { PrepareVerificationInput } from "../../../../server/modules/release-verification/core";

import {
  asPrepareVerificationCutover,
  inspectActionGuards,
} from "./actions";

const cutoverPlan = (): CutoverPlan => ({
  planDigest: "sha256:plan-1",
  sourceSnapshotFingerprint: "sha256:source-1",
  targetArtifactSha: "a".repeat(40),
  targetCatalogReleaseDigest: "sha256:release-1",
  migrationContractVersion: "s7-orc-p0-p10-v1",
  phases: PRE_ACTIVATION_PHASES,
});

describe("S11-UPG action guards", () => {
  it("T4 refuses caller gate selection and waivers before any verification port", () => {
    const withGates = inspectActionGuards("prepareVerification", {
      gates: ["V01"],
      purpose: "pre-activation",
    });
    expect(withGates).toEqual(
      expect.objectContaining({ code: "PCAT-UPG-GATE-SELECTION-FORBIDDEN" }),
    );

    const withSelection = inspectActionGuards("prepareVerification", {
      gateSelection: ["PCAT-API-01"],
    });
    expect(withSelection?.code).toBe("PCAT-UPG-GATE-SELECTION-FORBIDDEN");

    const withWaiver = inspectActionGuards("runVerification", {
      planDigest: "sha256:vplan",
      waiver: true,
    });
    expect(withWaiver?.code).toBe("PCAT-UPG-GATE-SELECTION-FORBIDDEN");

    const selectAction = inspectActionGuards("selectGates", { gateIds: ["V01"] });
    expect(selectAction?.code).toBe("PCAT-UPG-GATE-SELECTION-FORBIDDEN");
  });

  it("T5 refuses API startup migration and unknown-commit guesses", () => {
    const migrate = inspectActionGuards("migrateViaApi", { startupMigration: true });
    expect(migrate?.code).toBe("PCAT-UPG-API-MIGRATE-FORBIDDEN");

    const payloadMigrate = inspectActionGuards("execute", { apiMigration: true });
    expect(payloadMigrate?.code).toBe("PCAT-UPG-API-MIGRATE-FORBIDDEN");

    const guess = inspectActionGuards("guessUnknownCommit", { guessedCommit: "abc" });
    expect(guess?.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");

    const guessPayload = inspectActionGuards("resume", { guessedOutcome: "committed" });
    expect(guessPayload?.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");
  });

  it("T6 maps S7-ORC plan fields onto S10-PER prepare pins without choosing gates", () => {
    const pins: PrepareVerificationInput["pins"]["cutover"] = asPrepareVerificationCutover(
      cutoverPlan(),
    );
    expect(pins).toEqual({
      planDigest: "sha256:plan-1",
      contractVersion: "s7-orc-p0-p10-v1",
      sourceSnapshotFingerprint: "sha256:source-1",
    });
    expect(pins).not.toHaveProperty("gates");
    expect(pins).not.toHaveProperty("gateSelection");
  });

  it("allows a legal plan payload without forbidden controls", () => {
    expect(inspectActionGuards("plan", { targetArtifactSha: "a".repeat(40) })).toBeNull();
    expect(
      inspectActionGuards("prepareVerification", {
        purpose: "pre-activation",
        evidenceRequirements: {
          recoveryPointDigest: "sha256:rp",
          mappingEpoch: "epoch-1",
          cutoverPlanDigest: "sha256:plan-1",
          acceptanceContractDigest: "sha256:accept",
        },
      }),
    ).toBeNull();
  });
});
