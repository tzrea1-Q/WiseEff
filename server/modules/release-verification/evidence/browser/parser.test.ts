import { describe, expect, it } from "vitest";

import { digestOf } from "../../core/digest";
import { captureCatalogBrowserEvidence } from "./capture";
import { createCatalogBrowserCandidateDriver } from "./driver";
import { parseCatalogBrowserEvidenceSource } from "./parser";
import {
  CATALOG_BROWSER_GATE_IDS,
  CATALOG_BROWSER_OPERATIONS,
  CATALOG_BROWSER_REDACTION_POLICY,
  CATALOG_BROWSER_REDACTION_VERSION,
  CATALOG_BROWSER_VIEWPORT_IDS,
} from "./probes";
import type { CatalogBrowserEvidenceCaptureInput, CatalogBrowserEvidenceSource } from "./types";

const databaseIdentityPayload = {
  databaseName: "wiseeff_lane_718",
  serverVersion: "16.4",
  serverAddr: "127.0.0.1",
  serverPort: 55438,
};

const observation = (gateId: string, viewport: string, catalogReleaseId: string) => ({
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
});

const completeSource = (): CatalogBrowserEvidenceSource => ({
  producer: "s9-brw",
  runtimeKind: "candidate",
  candidateId: "sha256:web",
  records: CATALOG_BROWSER_GATE_IDS.map((gateId) => ({
    gateId,
    operationId: CATALOG_BROWSER_OPERATIONS[gateId],
    viewports: {
      "1440x900": observation(gateId, "1440x900", "crel_s10_ui"),
      "768x1024": observation(gateId, "768x1024", "crel_s10_ui"),
      "390x844": observation(gateId, "390x844", "crel_s10_ui"),
    },
  })),
});

describe("S10-UI S9-BRW evidence parser", () => {
  it("parses a complete S9-BRW source into fifteen three-viewport records", () => {
    const parsed = parseCatalogBrowserEvidenceSource(completeSource());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.records).toHaveLength(15);
    expect(parsed.value.records.every((record) => CATALOG_BROWSER_VIEWPORT_IDS.every((id) => record.viewports[id]))).toBe(
      true,
    );
  });

  it("refuses a malformed S9-BRW source", () => {
    const parsed = parseCatalogBrowserEvidenceSource({ producer: "other" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.kind).toBe("incomplete-bundle");
  });

  it("captures parsed S9-BRW output as pinned UI evidence", async () => {
    const parsed = parseCatalogBrowserEvidenceSource(completeSource());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const input: CatalogBrowserEvidenceCaptureInput = {
      runtime: { kind: "candidate", candidateId: "sha256:web" },
      driver: createCatalogBrowserCandidateDriver(parsed.value),
      database: async <Row>(text: string) => {
        if (text.includes("current_database()")) {
          return { rows: [databaseIdentityPayload] as unknown as Row[] };
        }
        if (text.includes("catalog_state")) {
          return {
            rows: [{ current_catalog_release_id: "crel_s10_ui", release_digest: "sha256:catalog" }] as unknown as Row[],
          };
        }
        return { rows: [] };
      },
      principal: {
        principalId: "user-org-admin",
        organizationId: "org-s10-ui",
        actorKind: "org-admin",
      },
      plan: {
        purpose: "isolated-candidate-acceptance",
        subject: {
          targetId: "target-s10-ui",
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
        pins: {
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
            targetIdentity: digestOf(databaseIdentityPayload),
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
        },
      },
    };
    const captured = await captureCatalogBrowserEvidence(input);
    expect(captured.ok, JSON.stringify(captured)).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.records).toHaveLength(15);
  });
});
