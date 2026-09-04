import { digestOf } from "../core/digest";
import { RELEASE_VERIFICATION_GATES } from "../core/gateRegistry";
import type {
  GateAdapter,
  PrepareVerificationInput,
  TypedEvidenceRef,
  VerificationLineage,
  VerificationPins,
  VerificationPlan,
} from "../core/types";

export const reportPins = (recoveryPointDigest = "sha256:rp"): VerificationPins => ({
  artifact: {
    gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseTag: "v-s10-rpt",
    packageManifestDigest: "sha256:pkg",
    apiImageDigest: "sha256:api",
    workerImageDigest: "sha256:worker",
    webImageDigest: "sha256:web",
  },
  catalog: {
    releaseId: "crel-s10-rpt",
    releaseDigest: "sha256:catalog",
    compiledModelDigest: "sha256:compiled",
    materializationFingerprint: "sha256:material",
  },
  database: {
    targetIdentity: "pg-s10-rpt",
    schemaVersion: "0139",
    migrationInventoryDigest: "sha256:migrations",
  },
  cutover: {
    planDigest: "sha256:cutover",
    contractVersion: "v1",
    sourceSnapshotFingerprint: "sha256:source",
  },
  mappingArchive: {
    mappingEpoch: "epoch-1",
    mappingHeadDigest: "sha256:map",
    archiveManifestDigest: "sha256:archive",
  },
  recovery: {
    recoveryPointId: "rp-1",
    recoveryPointDigest,
  },
  acceptance: {
    openApiDigest: "sha256:openapi",
    browserBundleSha: "sha256:browser",
  },
  target: {
    deploymentId: "deploy-1",
    hostFingerprint: "sha256:host",
  },
  verification: {
    contractVersion: "s10-rpt",
    verifierRole: "catalog_verifier",
  },
});

export const reportLineage = (
  overrides: Partial<VerificationLineage> = {},
): VerificationLineage => ({
  phaseSnapshot: "P11",
  predecessorReportDigests: [],
  p12State: "not-started",
  p13State: "not-started",
  writerRetirementFingerprint: null,
  runtimePinGeneration: null,
  pointerRollbackStatus: "open",
  trafficIsolationState: "isolated",
  ...overrides,
});

export const validPrepare = (
  overrides: Partial<PrepareVerificationInput> = {},
): PrepareVerificationInput => ({
  subject: {
    targetId: "target-s10-rpt",
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "populated",
  lineage: reportLineage(),
  pins: reportPins(),
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:cutover",
    acceptanceContractDigest: "sha256:accept",
  },
  ...overrides,
});

export const evidenceDigestFor = (gateId: string): string =>
  digestOf({ gateId, producer: "s10-rpt-test-adapter" });

export const planBoundEvidence = (plan: VerificationPlan): TypedEvidenceRef[] =>
  plan.applicabilityProfile
    .filter((entry) => entry.applicability.status === "required-now")
    .map((entry) => ({
      gateId: entry.gateId,
      digest: evidenceDigestFor(entry.gateId),
      producer: "s10-rpt-test-adapter",
      purpose: plan.purpose,
      subject: plan.subject,
      phaseSnapshot: plan.lineage.phaseSnapshot,
      pins: plan.pins,
    }));

export const passingAdapters = (): Map<string, GateAdapter> => {
  const adapters = new Map<string, GateAdapter>();
  for (const gate of RELEASE_VERIFICATION_GATES) {
    adapters.set(gate.id, async ({ gateId }) => ({
      gateId,
      status: "passed",
      failureCode: null,
      evidenceDigest: evidenceDigestFor(gateId),
      successorPurpose: null,
      notApplicableProof: null,
    }));
  }
  return adapters;
};
