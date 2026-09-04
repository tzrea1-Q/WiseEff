import { afterEach, describe, expect, it } from "vitest";

import { digestOf } from "../../core/digest";
import { browserVerificationGateIds, purposeProfile } from "../../core/gateRegistry";
import type { VerificationLineage, VerificationPins, VerificationPlan } from "../../core/types";
import { VerificationGateId } from "../../core/types";
import { createCatalogBrowserEvidenceAdapters } from "./adapters";
import { captureCatalogBrowserEvidence, evaluateCatalogBrowserGate } from "./capture";
import {
  CATALOG_BROWSER_OPERATIONS,
  CATALOG_BROWSER_REDACTION_POLICY,
  CATALOG_BROWSER_REDACTION_VERSION,
  CATALOG_BROWSER_VIEWPORT_IDS,
  type CatalogBrowserViewportId,
} from "./probes";
import type {
  CatalogBrowserCandidateDriver,
  CatalogBrowserEvidenceCaptureInput,
  CatalogBrowserEvidenceQuery,
  CatalogBrowserViewportObservation,
} from "./types";

const pins = (): VerificationPins => ({
  artifact: {
    gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseTag: "v-s10-ui",
    packageManifestDigest: "sha256:pkg",
    apiImageDigest: "sha256:api",
    workerImageDigest: "sha256:worker",
    webImageDigest: "sha256:web",
  },
  catalog: {
    releaseId: "crel_s10_ui",
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
    deploymentId: "deploy-s10-ui",
    hostFingerprint: "sha256:host",
  },
  verification: {
    contractVersion: "s10-ui",
    verifierRole: "catalog_verifier",
  },
});

const databaseIdentityPayload = {
  databaseName: "wiseeff_lane_718",
  serverVersion: "16.4",
  serverAddr: "127.0.0.1",
  serverPort: 55438,
};

const liveCatalogRow = {
  current_catalog_release_id: "crel_s10_ui",
  release_digest: "sha256:catalog",
  release_version: "1.0.0",
};

const isolatedLineage = (): VerificationLineage => ({
  phaseSnapshot: "P14a",
  predecessorReportDigests: [],
  p12State: "retired",
  p13State: "retired",
  writerRetirementFingerprint: "sha256:writers",
  runtimePinGeneration: "pin-1",
  pointerRollbackStatus: "closed",
  trafficIsolationState: "isolated",
});

const fakeQuery = (): CatalogBrowserEvidenceQuery => {
  return async <Row>(text: string) => {
    if (text.includes("current_database()")) {
      return { rows: [databaseIdentityPayload] as unknown as Row[] };
    }
    if (text.includes("catalog_state")) {
      return { rows: [liveCatalogRow] as unknown as Row[] };
    }
    if (text.includes("audit_events")) {
      return {
        rows: [{ id: "audit_s10_ui_1", action: "proposal-submit" }] as unknown as Row[],
      };
    }
    return { rows: [] };
  };
};

const completeObservation = (
  gateId: string,
  viewport: CatalogBrowserViewportId,
  catalogReleaseId: string,
  override?: Partial<CatalogBrowserViewportObservation>,
): CatalogBrowserViewportObservation => ({
  snapshotDigest: `sha256:snap:${gateId}:${viewport}`,
  screenshotDigest: `sha256:shot:${gateId}:${viewport}`,
  console: { errors: [], pageErrors: [] },
  network: {
    exchanges: [
      {
        method: "GET",
        path: "/api/v2/catalog",
        status: 200,
        requestId: `s10ui_${gateId}_${viewport}`,
        catalogReleaseId,
        runtimeKind: "candidate",
        summary: "catalog ready",
      },
    ],
  },
  interactions: [{ name: "inspect", outcome: "recorded" }],
  redaction: {
    status: "passed",
    policy: CATALOG_BROWSER_REDACTION_POLICY,
    version: CATALOG_BROWSER_REDACTION_VERSION,
  },
  browser: { name: "chromium", version: "test" },
  catalogPageMounted: false,
  parity:
    gateId === "PCAT-UI-13"
      ? {
          mockHasExtraPower: false,
          apiStates: ["ready", "unregistered", "empty", "loading", "error", "retired", "conflict"],
          mockStates: ["ready", "unregistered", "empty", "loading", "error", "retired", "conflict"],
        }
      : undefined,
  ...override,
});

const collectingDriver = (
  collect: CatalogBrowserCandidateDriver["collect"],
): CatalogBrowserCandidateDriver => ({
  kind: "candidate",
  collect,
});

const completeDriver = (
  catalogReleaseId: string,
  observe?: (input: { gateId: string; viewport: CatalogBrowserViewportId }) => void,
  override?: (
    gateId: string,
    viewport: CatalogBrowserViewportId,
  ) => Partial<CatalogBrowserViewportObservation> | undefined,
): CatalogBrowserCandidateDriver =>
  collectingDriver(async ({ gateId, viewport }) => {
    observe?.({ gateId, viewport });
    return completeObservation(gateId, viewport, catalogReleaseId, override?.(gateId, viewport));
  });

const captureInput = (
  overrides: Partial<CatalogBrowserEvidenceCaptureInput> & {
    readonly pins?: VerificationPins;
    readonly lineage?: VerificationLineage;
  } = {},
): CatalogBrowserEvidenceCaptureInput => {
  const planPins = overrides.pins ?? {
    ...pins(),
    database: { ...pins().database, targetIdentity: digestOf(databaseIdentityPayload) },
  };
  const { pins: _pins, lineage: _lineage, ...rest } = overrides;
  void _pins;
  void _lineage;
  return {
    runtime: { kind: "candidate", candidateId: "sha256:web" },
    driver: completeDriver(planPins.catalog.releaseId),
    database: fakeQuery(),
    principal: {
      principalId: "user-org-admin",
      organizationId: "org-s10-ui",
      actorKind: "org-admin",
    },
    ...rest,
    plan: {
      purpose: "isolated-candidate-acceptance",
      subject: {
        targetId: "target-s10-ui",
        deploymentClass: "self-hosted",
        environmentId: "env-isolated",
      },
      lineage: overrides.lineage ?? isolatedLineage(),
      ...rest.plan,
      pins: rest.plan?.pins ?? planPins,
    },
  };
};

afterEach(() => {
  delete process.env.VITE_WISEEFF_RUNTIME_MODE;
});

describe("S10-UI capture fail-closed identity", () => {
  it("refuses mock runtime before any collect", async () => {
    let collected = 0;
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        runtime: { kind: "mock", candidateId: "sha256:web" },
        driver: completeDriver("crel_s10_ui", () => {
          collected += 1;
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("mock-runtime");
    expect(collected).toBe(0);
  });

  it("refuses VITE_WISEEFF_RUNTIME_MODE=mock before any collect", async () => {
    process.env.VITE_WISEEFF_RUNTIME_MODE = "mock";
    let collected = 0;
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        driver: completeDriver("crel_s10_ui", () => {
          collected += 1;
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("mock-runtime");
    expect(collected).toBe(0);
  });

  it("refuses a stale catalog pin", async () => {
    const stalePins = {
      ...pins(),
      catalog: { ...pins().catalog, releaseId: "crel_stale" },
      database: { ...pins().database, targetIdentity: digestOf(databaseIdentityPayload) },
    };
    const result = await captureCatalogBrowserEvidence(captureInput({ pins: stalePins }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("stale-pins");
  });

  it("refuses screenshot-only viewport evidence", async () => {
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        driver: completeDriver("crel_s10_ui", undefined, (gateId, viewport) =>
          gateId === "PCAT-UI-01" && viewport === "1440x900"
            ? {
                snapshotDigest: "",
                console: { errors: [], pageErrors: [] },
                network: { exchanges: [] },
                interactions: [],
              }
            : undefined,
        ),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("screenshot-only");
  });

  it("refuses pre-P13 traffic before any collect", async () => {
    let collected = 0;
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        lineage: {
          ...isolatedLineage(),
          phaseSnapshot: "P12",
          p13State: "active",
          writerRetirementFingerprint: null,
        },
        driver: completeDriver("crel_s10_ui", () => {
          collected += 1;
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("pre-p13");
    expect(collected).toBe(0);
  });

  it("refuses public traffic as pre-P13", async () => {
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        lineage: { ...isolatedLineage(), trafficIsolationState: "public" },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("pre-p13");
  });

  it("refuses failed redaction and leftover secrets", async () => {
    const failedStatus = await captureCatalogBrowserEvidence(
      captureInput({
        driver: completeDriver("crel_s10_ui", undefined, (gateId, viewport) =>
          gateId === "PCAT-UI-01" && viewport === "1440x900"
            ? { redaction: { status: "failed", policy: "s10-ui-redaction", version: "1" } }
            : undefined,
        ),
      }),
    );
    expect(failedStatus.ok).toBe(false);
    if (failedStatus.ok) return;
    expect(failedStatus.error.kind).toBe("redaction-failed");

    const leftover = await captureCatalogBrowserEvidence(
      captureInput({
        driver: completeDriver("crel_s10_ui", undefined, (gateId, viewport) =>
          gateId === "PCAT-UI-02" && viewport === "768x1024"
            ? { console: { errors: ["Authorization: Bearer super-secret-token"], pageErrors: [] } }
            : undefined,
        ),
      }),
    );
    expect(leftover.ok).toBe(false);
    if (leftover.ok) return;
    expect(leftover.error.kind).toBe("redaction-failed");
  });

  it("refuses caller gate selection", async () => {
    const result = await captureCatalogBrowserEvidence({
      ...captureInput(),
      ...({ gateIds: ["PCAT-UI-01"] } as unknown as object),
    } as CatalogBrowserEvidenceCaptureInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("gate-selection-forbidden");
  });

  it("refuses mock network identity on a candidate runtime", async () => {
    const result = await captureCatalogBrowserEvidence(
      captureInput({
        driver: completeDriver("crel_s10_ui", undefined, (gateId, viewport) =>
          gateId === "PCAT-UI-01" && viewport === "390x844"
            ? {
                network: {
                  exchanges: [
                    {
                      method: "GET",
                      path: "/api/v2/catalog",
                      status: 200,
                      requestId: "s10ui_mock",
                      catalogReleaseId: "crel_s10_ui",
                      runtimeKind: "mock",
                      summary: "mock catalog",
                    },
                  ],
                },
              }
            : undefined,
        ),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("mock-runtime");
  });

  it("returns an exact fifteen-gate three-viewport candidate bundle on a live pin", async () => {
    const result = await captureCatalogBrowserEvidence(captureInput());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const bundle = result.value;
    expect(bundle.records).toHaveLength(browserVerificationGateIds.length);
    expect(bundle.evidenceRefs.map((ref) => ref.gateId)).toEqual([...browserVerificationGateIds]);
    const pinDigest = digestOf(bundle.records[0]?.pins);
    for (const record of bundle.records) {
      expect(record.viewports.map((viewport) => viewport.viewport)).toEqual([...CATALOG_BROWSER_VIEWPORT_IDS]);
      expect(record.operationId).toBe(CATALOG_BROWSER_OPERATIONS[record.gateId as keyof typeof CATALOG_BROWSER_OPERATIONS]);
      expect(record.viewports.every((viewport) => viewport.observation.snapshotDigest.startsWith("sha256:"))).toBe(true);
      expect(record.viewports.every((viewport) => viewport.observation.screenshotDigest.startsWith("sha256:"))).toBe(true);
      expect(record.viewports.every((viewport) => viewport.observation.network.exchanges.length > 0)).toBe(true);
      expect(digestOf(record.pins)).toBe(pinDigest);
      expect(record.databaseIdentity).toBe(bundle.databaseIdentity);
      expect(record.principalId).toBe(bundle.principalId);
      expect(record.observations.catalogPageMounted).toBe(false);
      expect(evaluateCatalogBrowserGate(record).passed, record.gateId).toBe(true);
    }
    expect(bundle.targetIdentity).toBe(bundle.records[0]?.pins.target.deploymentId);
    expect(bundle.runtimeId).toBe("sha256:web");
    expect(bundle.evidenceRefs.every((ref) => ref.producer === "s10-ui" && ref.digest.startsWith("sha256:"))).toBe(true);
  });
});

describe("S10-UI gate adapters", () => {
  const isolatedPlan = (): VerificationPlan =>
    ({
      id: "vplan_s10_ui",
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

  it("does not collect browser evidence before isolated-candidate-acceptance", async () => {
    let collected = 0;
    const adapters = createCatalogBrowserEvidenceAdapters({
      driver: completeDriver("crel_s10_ui", () => {
        collected += 1;
      }),
      database: fakeQuery(),
      principal: captureInput().principal,
      runtime: { kind: "candidate", candidateId: "sha256:web" },
    });
    const plan = {
      ...isolatedPlan(),
      purpose: "pre-activation",
      applicabilityProfile: purposeProfile("pre-activation", "populated"),
    } as VerificationPlan;
    const result = await adapters.get("PCAT-UI-01")?.({
      gateId: VerificationGateId("PCAT-UI-01"),
      plan,
    });
    expect(result?.status).toBe("not-yet-executable");
    expect(result?.successorPurpose).toBe("isolated-candidate-acceptance");
    expect(collected).toBe(0);
  });

  it("captures required-now UI gates without skip or waiver", async () => {
    const adapters = createCatalogBrowserEvidenceAdapters({
      driver: completeDriver("crel_s10_ui"),
      database: fakeQuery(),
      principal: captureInput().principal,
      runtime: { kind: "candidate", candidateId: "sha256:web" },
    });
    const plan = isolatedPlan();
    expect(adapters.size).toBe(15);
    for (const gateId of browserVerificationGateIds) {
      const result = await adapters.get(gateId)?.({
        gateId: VerificationGateId(gateId),
        plan,
      });
      expect(result?.gateId).toBe(gateId);
      expect(result?.status).toBe("passed");
      expect(result?.evidenceDigest).toBeTruthy();
      expect(result?.status as string).not.toBe("skipped");
      expect(result?.status as string).not.toBe("waived");
    }
  });
});
