import { describe, expect, it } from "vitest";

import { digestOf } from "../../core/digest";
import { apiVerificationGateIds, purposeProfile } from "../../core/gateRegistry";
import type { VerificationPins, VerificationPlan } from "../../core/types";
import { VerificationGateId } from "../../core/types";
import { captureCatalogApiEvidence } from "./capture";
import { createCatalogApiEvidenceAdapters } from "./adapters";
import { CATALOG_API_PROBE_CONTEXT } from "./probes";
import type {
  CatalogApiCandidateDriver,
  CatalogApiDispatchOutput,
  CatalogApiEvidenceCaptureInput,
  CatalogApiEvidenceQuery,
} from "./types";

const pins = (): VerificationPins => ({
  artifact: {
    gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseTag: "v-s10-api",
    packageManifestDigest: "sha256:pkg",
    apiImageDigest: "sha256:api",
    workerImageDigest: "sha256:worker",
    webImageDigest: "sha256:web",
  },
  catalog: {
    releaseId: "crel_s10_api",
    releaseDigest: "sha256:catalog",
    compiledModelDigest: "sha256:compiled",
    materializationFingerprint: "sha256:material",
  },
  database: {
    targetIdentity: "pending",
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
    recoveryPointDigest: "sha256:rp",
  },
  acceptance: {
    openApiDigest: "sha256:openapi",
    browserBundleSha: "sha256:browser",
  },
  target: {
    deploymentId: "deploy-s10-api",
    hostFingerprint: "sha256:host",
  },
  verification: {
    contractVersion: "s10-api",
    verifierRole: "catalog_verifier",
  },
});

const databaseIdentityPayload = {
  databaseName: "wiseeff_lane_717",
  serverVersion: "16.4",
  serverAddr: "127.0.0.1",
  serverPort: 55438,
};

const liveCatalogRow = {
  current_catalog_release_id: "crel_s10_api",
  release_digest: "sha256:catalog",
  release_version: "1.0.0",
};

const fakeQuery = (): CatalogApiEvidenceQuery => {
  return async <Row>(text: string) => {
    if (text.includes("current_database()")) {
      return { rows: [databaseIdentityPayload] as unknown as Row[] };
    }
    if (text.includes("catalog_state")) {
      return { rows: [liveCatalogRow] as unknown as Row[] };
    }
    if (text.includes("audit_events")) {
      return {
        rows: [{ id: "audit_s10_api_1", action: "proposal-submit" }] as unknown as Row[],
      };
    }
    if (text.includes("organization_subject_registrations")) {
      return { rows: [{ registrations: "1", placements: "1" }] as unknown as Row[] };
    }
    return { rows: [] };
  };
};

const echoingDriver = (
  override?: (input: { requestId: string; path: string }) => Partial<CatalogApiDispatchOutput>,
): CatalogApiCandidateDriver => ({
  kind: "candidate",
  async dispatch(input) {
    const extra = override?.({ requestId: input.requestId, path: input.path }) ?? {};
    const status = extra.status ?? (input.principal === "unauthenticated" ? 401 : input.principal === "agent" && input.method !== "GET" ? 403 : 200);
    const body =
      extra.body ??
      (status >= 400
        ? { error: { requestId: input.requestId, details: { reason: status === 409 ? "release-drift" : "forbidden" } } }
        : {
            item: {
              status: "ready",
              catalogReleaseId: "crel_s10_api",
              digest: "sha256:catalog",
              materializationFingerprint: "sha256:material",
              definitionId: "pdef_acme_power_iin_min",
              effectiveRevisionId: "drev_acme_power_iin_min_1",
              currentValueId: "pval_s10_api",
            },
            items: [],
          });
    return {
      status,
      headers: {
        "X-Request-Id": extra.headers?.["X-Request-Id"] ?? extra.headers?.["x-request-id"] ?? input.requestId,
        "X-WiseEff-Catalog-Release": "crel_s10_api",
        ETag: '"etag-s10-api"',
        Deprecation: "true",
        Sunset: "Fri, 31 Dec 2027 00:00:00 GMT",
        Link: '</api/v2/catalog>; rel="successor-version"',
        ...(extra.headers ?? {}),
      },
      body,
    };
  },
});

const captureInput = (
  overrides: Partial<CatalogApiEvidenceCaptureInput> & {
    readonly pins?: VerificationPins;
  } = {},
): CatalogApiEvidenceCaptureInput => {
  const planPins = overrides.pins ?? {
    ...pins(),
    database: { ...pins().database, targetIdentity: digestOf(databaseIdentityPayload) },
  };
  const { pins: _pins, ...rest } = overrides;
  void _pins;
  return {
    runtime: { kind: "candidate", candidateId: "sha256:api" },
    driver: echoingDriver(),
    database: fakeQuery(),
    principal: {
      principalId: "user-org-admin",
      organizationId: "org-s10-api",
      actorKind: "org-admin",
    },
    probeContext: CATALOG_API_PROBE_CONTEXT,
    ...rest,
    plan: {
      purpose: "isolated-candidate-acceptance",
      subject: {
        targetId: "target-s10-api",
        deploymentClass: "self-hosted",
        environmentId: "env-isolated",
      },
      lineage: {
        phaseSnapshot: "P14a",
        predecessorReportDigests: [],
        p12State: "retired",
        p13State: "retired",
        writerRetirementFingerprint: "sha256:writers",
        runtimePinGeneration: "pin-1",
        pointerRollbackStatus: "closed",
        trafficIsolationState: "isolated",
      },
      ...rest.plan,
      pins: rest.plan?.pins ?? planPins,
    },
  };
};

describe("S10-API capture fail-closed identity", () => {
  it("refuses mock runtime before any dispatch", async () => {
    let dispatched = 0;
    const driver: CatalogApiCandidateDriver = {
      kind: "candidate",
      async dispatch(input) {
        dispatched += 1;
        return echoingDriver().dispatch(input);
      },
    };
    const result = await captureCatalogApiEvidence(
      captureInput({ runtime: { kind: "mock", candidateId: "mock" }, driver }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("mock-runtime");
    expect(dispatched).toBe(0);
  });

  it("refuses a stale catalog pin", async () => {
    const stalePins = {
      ...pins(),
      catalog: { ...pins().catalog, releaseId: "crel_stale" },
      database: { ...pins().database, targetIdentity: digestOf(databaseIdentityPayload) },
    };
    const result = await captureCatalogApiEvidence(captureInput({ pins: stalePins }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("stale-pins");
  });

  it("refuses a missing or mismatched request id", async () => {
    const missing = await captureCatalogApiEvidence(
      captureInput({
        driver: echoingDriver(() => ({ headers: { "X-Request-Id": "" }, body: { item: { status: "ready" } } })),
      }),
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.kind).toBe("missing-request-id");

    const mismatched = await captureCatalogApiEvidence(
      captureInput({
        driver: echoingDriver(() => ({ headers: { "X-Request-Id": "other-id" } })),
      }),
    );
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.error.kind).toBe("missing-request-id");
  });

  it("refuses caller gate selection", async () => {
    const result = await captureCatalogApiEvidence({
      ...captureInput(),
      ...( { gateIds: ["PCAT-API-01"] } as unknown as object),
    } as CatalogApiEvidenceCaptureInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("gate-selection-forbidden");
  });

  it("returns an exact twelve-gate candidate bundle on a live pin", async () => {
    const result = await captureCatalogApiEvidence(captureInput());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const bundle = result.value;
    expect(bundle.records).toHaveLength(apiVerificationGateIds.length);
    expect(bundle.evidenceRefs.map((ref) => ref.gateId)).toEqual([...apiVerificationGateIds]);
    const pinDigest = digestOf(bundle.records[0]?.pins);
    for (const record of bundle.records) {
      expect(record.exchanges.length).toBeGreaterThan(0);
      expect(record.exchanges.every((exchange) => exchange.requestId.length > 0)).toBe(true);
      expect(digestOf(record.pins)).toBe(pinDigest);
      expect(record.databaseIdentity).toBe(bundle.databaseIdentity);
      expect(record.principalId).toBe(bundle.principalId);
    }
    expect(bundle.targetIdentity).toBe(bundle.records[0]?.pins.target.deploymentId);
    expect(bundle.runtimeId).toBe("sha256:api");
  });
});

describe("S10-API gate adapters", () => {
  const isolatedPlan = (): VerificationPlan =>
    ({
      id: "vplan_s10_api",
      digest: "sha256:plan",
      canonicalBytes: "{}",
      purpose: "isolated-candidate-acceptance",
      mode: "populated",
      subject: captureInput().plan.subject,
      lineage: captureInput().plan.lineage,
      pins: captureInput().plan.pins,
      evidenceRequirements: {
        recoveryPointDigest: "sha256:rp",
        mappingEpoch: "epoch-1",
        cutoverPlanDigest: "sha256:cutover",
        acceptanceContractDigest: "sha256:accept",
      },
      registryDigest: "sha256:registry",
      gateSelectionSource: "registry",
      applicabilityProfile: purposeProfile("isolated-candidate-acceptance", "populated"),
      createdAt: "2026-09-04T00:00:00Z",
    }) as VerificationPlan;

  it("does not dispatch HTTP before isolated-candidate-acceptance", async () => {
    let dispatched = 0;
    const adapters = createCatalogApiEvidenceAdapters({
      driver: {
        kind: "candidate",
        async dispatch(input) {
          dispatched += 1;
          return echoingDriver().dispatch(input);
        },
      },
      database: fakeQuery(),
      principal: captureInput().principal,
      runtime: { kind: "candidate", candidateId: "sha256:api" },
    });
    const plan = {
      ...isolatedPlan(),
      purpose: "pre-activation",
      applicabilityProfile: purposeProfile("pre-activation", "populated"),
    } as VerificationPlan;
    const result = await adapters.get("PCAT-API-01")?.({
      gateId: VerificationGateId("PCAT-API-01"),
      plan,
    });
    expect(result?.status).toBe("not-yet-executable");
    expect(result?.successorPurpose).toBe("isolated-candidate-acceptance");
    expect(dispatched).toBe(0);
  });

  it("captures required-now API gates without skip or waiver", async () => {
    const adapters = createCatalogApiEvidenceAdapters({
      driver: echoingDriver(),
      database: fakeQuery(),
      principal: captureInput().principal,
      runtime: { kind: "candidate", candidateId: "sha256:api" },
      probeContext: CATALOG_API_PROBE_CONTEXT,
    });
    const plan = isolatedPlan();
    expect(adapters.size).toBe(12);
    for (const gateId of apiVerificationGateIds) {
      const result = await adapters.get(gateId)?.({
        gateId: VerificationGateId(gateId),
        plan,
      });
      expect(result?.gateId).toBe(gateId);
      expect(["passed", "failed"]).toContain(result?.status);
      expect(result?.evidenceDigest).toBeTruthy();
      expect(result?.status as string).not.toBe("skipped");
      expect(result?.status as string).not.toBe("waived");
    }
  });
});
