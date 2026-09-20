import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installPublishedRelease,
  installPublishedReleaseForTests,
} from "../../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import {
  compileVendorCatalogSuccessor,
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
} from "../../../../scripts/compile-vendor-catalog-release";
import {
  AUTHOR,
  REVIEWER,
  bootstrapFirstAcme,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  reviewerPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { authorizePublish } from "../authorization/authorize";
import { asCoordinator, enablePublicationPolicy } from "../authorization/testHarness";
import {
  CATALOG_CAPABILITY_V3_ALLOW_LIST,
} from "../builder/capabilities";
import { createJob } from "../persistence/store";
import {
  asQueryable,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "../persistence/integrationHarness";
import { PublicationJobId } from "../../parameter-catalog-contract/index";
import {
  createDatabase,
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { importVendorCatalog, type VendorIdKind } from "./vendorAdapter";
import { vendorDirectoryHash } from "./vendorYaml";
import { CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS } from "../runtime/capabilities";

await requirePgvectorTestDatabase();

const chargingCoreYaml = `$id: wiseeff/nodename-charging-core.yaml
title: charging_core
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/nodename/charging_core
nodename:
  - charging_core
properties:
  fast-charge-profile-matrix:
    valueShape: nested-string-array
    constraints: {}
    documentation: Nested string matrix.
  battery-thermal-derate-curve:
    valueShape: nested-u32-array
    constraints: {}
    documentation: Nested integer matrix.
`;

const writeChargingCoreTree = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-v4-"));
  const schemasRoot = path.join(root, "schemas/dts");
  const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(path.join(vendorDir, "nodename-charging-core.yaml"), chargingCoreYaml);
  writeFileSync(
    path.join(schemasRoot, "catalog.json"),
    JSON.stringify({
      vendorContentHash: vendorDirectoryHash(vendorDir),
      schemaPaths: ["vendor/wiseeff/nodename-charging-core.yaml"],
    }),
  );
  return schemasRoot;
};

const sequentialIds = (label: string) => {
  const counts: Partial<Record<VendorIdKind, number>> = {};
  return (kind: VendorIdKind): string => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return `${kind}_${label}_${counts[kind]}`;
  };
};

describe("catalog-capability/v4 charging_core publication", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("capv4");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  it("installs charging_core as a NodeType and lets a frozen v3 consumer refuse before writes", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const label = uniqueToken("v4");
    const imported = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot: writeChargingCoreTree(),
      identity: {
        publishedAt: "2026-09-17T12:00:00Z",
        releaseVersion: "1.2.0",
        candidateId: `ccand_${label}`,
        artifactId: `cart_${label}`,
        releaseId: `crel_${label}`,
        allocateId: sequentialIds(label),
      },
      authorPrincipalId: AUTHOR,
      authorOrganizationId: "org-test",
      persist: { db: createDatabase(asQueryable(client)) },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok || imported.value.kind !== "successor" || imported.value.built.kind !== "successor") {
      throw new Error(`import failed: ${JSON.stringify(imported)}`);
    }
    expect(imported.value.built.persistence.kind).toBe("persisted");
    if (imported.value.built.persistence.kind !== "persisted") {
      throw new Error("candidate not persisted");
    }
    const candidate = imported.value.built.persistence.candidate;
    expect(imported.value.built.capabilityContract.revision).toBe("catalog-capability/v4");

    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const capability = await client.query<{ digest: string }>(
        `select catalog_publication.digest_jsonb(capability_contract) as digest
           from catalog_publication.candidates where id = $1`,
        [candidate.id],
      );
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidate: {
          candidateId: candidate.id,
          artifactDigest: candidate.artifactDigest,
          expectedBaseReleaseId: candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
          proposalRevisionId: candidate.proposalRevisionId,
          impactReportDigest: candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: imported.value.impactFacts,
        policyRevision,
      });
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) throw new Error(`authorize failed: ${JSON.stringify(authorized.error)}`);
    const token = uniqueToken("v4job");
    const job = await asCoordinator(client, () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${token}`),
        candidateId: candidate.id,
        authorizationId: authorized.value.authorization.id,
        requestScope: "instance:t12-v4",
        idempotencyKey: `key-${token}`,
        requestDigest: sha256Digest(`req-${token}`),
      }),
    );
    expect(job.ok).toBe(true);
    if (!job.ok) throw new Error(`job failed: ${JSON.stringify(job.error)}`);

    const command = {
      mode: "online-publication" as const,
      jobId: job.value.id,
      candidateId: candidate.id,
      authorizationId: authorized.value.authorization.id,
      expectedCurrent: {
        id: candidate.expectedBaseReleaseId,
        digest: candidate.expectedBaseReleaseDigest,
      },
      fencingToken: job.value.fencingToken,
      trustedActor: userActor(REVIEWER, reviewerPermissions),
      impactFacts: imported.value.impactFacts,
    };

    const before = await domainSnapshot(client);
    const refused = await installPublishedReleaseForTests(pool, command, {
      consumerCapability: {
        revisions: CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS,
        allowList: CATALOG_CAPABILITY_V3_ALLOW_LIST,
      },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({
        kind: "publication-not-authorized",
        reason: "unsupported-consumer-capability-revision",
      });
    }
    expect(await domainSnapshot(client)).toEqual(before);

    const installed = await installPublishedRelease(pool, command);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    const subjects = await client.query<{ canonical_key: string; kind: string }>(
      `select canonical_key, kind from parameter_catalog.catalog_subjects order by canonical_key`,
    );
    const keys = subjects.rows.map((row) => `${row.kind}:${row.canonical_key}`);
    expect(keys).toContain("node-type:charging_core");
    expect(keys.some((key) => key.includes("huawei,charging_core"))).toBe(false);
  }, 60_000);

  it("refuses a nested-array compiled vendor successor on advance for a frozen v3 consumer", async () => {
    await bootstrapFirstAcme(pool);
    const successor = compileVendorCatalogSuccessor();
    const before = await domainSnapshot(client);
    const refused = await installPublishedReleaseForTests(
      pool,
      {
        mode: "advance",
        source: jsonCatalogReleaseSource(successor.bundle),
        expectedCurrent: {
          id: FIRST_ACME_RELEASE_ID,
          digest: FIRST_ACME_RELEASE_DIGEST,
        },
        expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      },
      {
        consumerCapability: {
          revisions: CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS,
          allowList: CATALOG_CAPABILITY_V3_ALLOW_LIST,
        },
      },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({
        kind: "publication-not-authorized",
        reason: "unsupported-consumer-capability-revision",
      });
    }
    expect(await domainSnapshot(client)).toEqual(before);
  }, 60_000);
});
