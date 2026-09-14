import { describe, expect, it } from "vitest";

import { evaluateManagedPolicyRevision } from "./policy";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION, type PublicationPolicyInstanceSnapshot } from "./types";

const snapshot = (
  overrides: Partial<PublicationPolicyInstanceSnapshot> = {},
): PublicationPolicyInstanceSnapshot => ({
  databaseOid: "16384",
  databaseName: "wiseeff",
  ephemeralName: false,
  currentReleaseId: "crel_acme_1",
  currentReleaseDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  artifactDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  artifactSourceKind: "adopted-preexisting",
  adopted: true,
  receiptKinds: ["adopted-preexisting"],
  policyRevision: 1,
  publicationEnabled: false,
  lowRiskSingleActorPublish: false,
  frozen: false,
  capabilityContractRevision: "catalog-capability/v1",
  ...overrides,
});

const pinsOf = (current: PublicationPolicyInstanceSnapshot) => ({
  confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
  expectedDatabaseOid: current.databaseOid,
  expectedCurrentId: current.currentReleaseId ?? "",
  expectedCurrentDigest: current.currentReleaseDigest ?? "",
  expectedPolicyRevision: current.policyRevision,
  expectedFrozen: current.frozen,
  expectedAdopted: current.adopted,
});

describe("managed instance publication policy evaluation", () => {
  it("allows enable when identity pins match an adopted unfrozen instance", () => {
    const current = snapshot();
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: pinsOf(current),
        publicationEnabled: true,
      }),
    ).toEqual([]);
  });

  it("does not require a prior online publication and does not treat freeze as an enable blocker", () => {
    const current = snapshot({ frozen: true, receiptKinds: ["adopted-preexisting"] });
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: pinsOf(current),
        publicationEnabled: true,
      }),
    ).toEqual([]);
  });

  it("refuses enable when the catalog is not adopted", () => {
    const current = snapshot({
      adopted: false,
      artifactDigest: null,
      artifactSourceKind: null,
      receiptKinds: [],
    });
    const refusals = evaluateManagedPolicyRevision({
      snapshot: current,
      pins: pinsOf(current),
      publicationEnabled: true,
    });
    expect(refusals.map((row) => row.reason)).toContain("adoption-evidence-invalid");
  });

  it("allows disable of an unadopted instance", () => {
    const current = snapshot({ adopted: false, receiptKinds: [], artifactDigest: null });
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: pinsOf(current),
        publicationEnabled: false,
      }),
    ).toEqual([]);
  });

  it("refuses stale policy revision, wrong release, and wrong database oid", () => {
    const current = snapshot();
    const matched = pinsOf(current);
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: { ...matched, expectedPolicyRevision: current.policyRevision + 1 },
        publicationEnabled: true,
      })[0]?.reason,
    ).toBe("publication-instance-stale");
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: { ...matched, expectedCurrentId: "crel_other" },
        publicationEnabled: true,
      })[0]?.reason,
    ).toBe("publication-instance-stale");
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: { ...matched, expectedDatabaseOid: "1" },
        publicationEnabled: true,
      })[0]?.reason,
    ).toBe("publication-instance-stale");
  });

  it("does not treat low-risk single-actor as required for enable", () => {
    const current = snapshot({ lowRiskSingleActorPublish: false });
    expect(
      evaluateManagedPolicyRevision({
        snapshot: current,
        pins: pinsOf(current),
        publicationEnabled: true,
      }),
    ).toEqual([]);
  });
});
