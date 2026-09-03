import { describe, expect, it } from "vitest";
import {
  comparisonVerificationGateIds,
  databaseVerificationGateIds,
  migrationVerificationGateIds,
  privilegeVerificationGateIds,
  verificationGateStatuses,
  verificationPurposes,
} from "../../parameter-catalog-contract/index";
import {
  RELEASE_VERIFICATION_GATES,
  closedGateIds,
  gateApplicability,
  purposeProfile,
} from "./gateRegistry";
import { VerificationGateId } from "./types";

describe("closed Release Verification gate registry", () => {
  it("reuses frozen V/M/P/D IDs and does not invent V01-V17", () => {
    const ids = closedGateIds();
    expect(ids).toEqual(expect.arrayContaining([...databaseVerificationGateIds]));
    expect(ids).toEqual(expect.arrayContaining([...migrationVerificationGateIds]));
    expect(ids).toEqual(expect.arrayContaining([...privilegeVerificationGateIds]));
    expect(ids).toEqual(expect.arrayContaining([...comparisonVerificationGateIds]));
    expect(ids.filter((id) => id.startsWith("PCAT-DB-V"))).toEqual([...databaseVerificationGateIds]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("PCAT-DB-V18");
  });

  it("never lists waiver or skip as a gate status", () => {
    expect([...verificationGateStatuses]).toEqual([
      "passed",
      "failed",
      "not-yet-executable",
      "not-applicable",
    ]);
    expect(verificationGateStatuses).not.toContain("waived");
    expect(verificationGateStatuses).not.toContain("skipped");
  });

  it("selects applicability by purpose so callers cannot name gates", () => {
    const preActivation = purposeProfile("pre-activation", "populated");
    const v01 = preActivation.find((entry) => entry.gateId === "PCAT-DB-V01");
    const api01 = preActivation.find((entry) => entry.gateId === "PCAT-API-01");
    const ui01 = preActivation.find((entry) => entry.gateId === "PCAT-UI-01");
    expect(v01?.applicability).toEqual({ status: "required-now" });
    expect(api01?.applicability).toEqual({
      status: "not-yet-executable",
      successorPurpose: "isolated-candidate-acceptance",
    });
    expect(ui01?.applicability).toEqual({
      status: "not-yet-executable",
      successorPurpose: "isolated-candidate-acceptance",
    });
    expect(preActivation).toHaveLength(RELEASE_VERIFICATION_GATES.length);
    expect(verificationPurposes).toHaveLength(6);
  });

  it("records mode-proved not-applicable instead of a waiver", () => {
    const fence = RELEASE_VERIFICATION_GATES.find(
      (gate) => gate.id === "PCAT-WRITER-PRE-SWITCH-FENCE",
    );
    expect(fence).toBeDefined();
    expect(gateApplicability(fence!, "pre-activation", "cleanup")).toEqual({
      status: "not-applicable",
      proof: "mode=cleanup/no-pre-switch-fence",
    });
    expect(gateApplicability(fence!, "pre-activation", "populated")).toEqual({
      status: "required-now",
    });
    expect(
      gateApplicability(
        {
          id: VerificationGateId("PCAT-DB-V01"),
          family: "database",
          failureCode: "PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION",
          executionPurposes: ["pre-activation", "post-retirement-runtime", "p16-cleanup"],
        },
        "isolated-candidate-acceptance",
        "populated",
      ),
    ).toEqual({
      status: "not-yet-executable",
      successorPurpose: "p16-cleanup",
    });
  });
});
