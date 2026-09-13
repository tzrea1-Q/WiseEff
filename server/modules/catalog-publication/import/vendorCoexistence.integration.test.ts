import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import {
  AUTHOR,
  PUBLISHER,
  REVIEWER,
  bootstrapFirstAcme,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  publisherPermissions,
  reviewerPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { authorizePublish } from "../authorization/authorize";
import { asCoordinator, enablePublicationPolicy } from "../authorization/testHarness";
import { allocationFor, frozenPageIdentity, pageIntegerChange } from "../builder/predecessorHarness";
import { buildCompleteSuccessor } from "../builder/completeSuccessor";
import { createJob, getCandidate, getJob, persistCandidate } from "../persistence/store";
import {
  asQueryable,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "../persistence/integrationHarness";
import { createDatabase, createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import { installCatalogRelease } from "../../../../scripts/install-catalog-release";
import { runPublicationManagerOnce } from "../jobs/manager";
import { PublicationJobId } from "../../parameter-catalog-contract/index";
import { importVendorCatalog, type VendorIdKind } from "./vendorAdapter";
import { vendorDirectoryHash } from "./vendorYaml";

await requirePgvectorTestDatabase();

const chargerYaml = `$id: wiseeff/test-charger.yaml
title: acme,test-charger
source: vendor
lifecycle: active
version: 1
schemaNamespace: vendor/acme,test-charger
compatible:
  - acme,test-charger
properties:
  iin_limit:
    valueShape: integer
    units: mA
    constraints: {}
    documentation: Vendor input current limit.
`;

const writeChargerTree = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-cp09-"));
  const schemasRoot = path.join(root, "schemas/dts");
  const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(path.join(vendorDir, "charger.yaml"), chargerYaml);
  writeFileSync(
    path.join(schemasRoot, "catalog.json"),
    JSON.stringify({
      vendorContentHash: vendorDirectoryHash(vendorDir),
      schemaPaths: ["vendor/wiseeff/charger.yaml"],
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

const vendorIdentity = (label: string, releaseVersion = "1.2.0") => ({
  publishedAt: "2026-09-13T12:00:00Z",
  releaseVersion,
  candidateId: `ccand_${label}`,
  artifactId: `cart_${label}`,
  releaseId: `crel_${label}`,
  allocateId: sequentialIds(label),
});

describe("vendor import coexistence", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp09ven");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  const persistVendorCandidate = async (
    label: string,
    predecessor: { digest: string; bytes: Uint8Array },
    releaseVersion = "1.2.0",
  ) => {
    const schemasRoot = writeChargerTree();
    const imported = await importVendorCatalog({
      predecessorArtifact: predecessor,
      schemasRoot,
      identity: vendorIdentity(label, releaseVersion),
      authorPrincipalId: AUTHOR,
      authorOrganizationId: "org-test",
      persist: { db: createDatabase(asQueryable(client)) },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok || imported.value.kind !== "successor" || imported.value.built.kind !== "successor") {
      throw new Error(`vendor import failed: ${JSON.stringify(imported)}`);
    }
    expect(imported.value.built.persistence.kind).toBe("persisted");
    if (imported.value.built.persistence.kind !== "persisted") {
      throw new Error("vendor candidate not persisted");
    }
    return { schemasRoot, imported: imported.value, candidate: imported.value.built.persistence.candidate };
  };

  const authorizeVendor = async (candidate: {
    id: string;
    artifactDigest: string;
    expectedBaseReleaseId: string;
    expectedBaseReleaseDigest: string;
    proposalRevisionId: string | null;
    impactReportDigest: string;
  }, facts: import("./vendorAdapter").VendorImportSuccessor["impactFacts"]) => {
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
          candidateId: candidate.id as never,
          artifactDigest: candidate.artifactDigest,
          expectedBaseReleaseId: candidate.expectedBaseReleaseId as never,
          expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest as never,
          proposalRevisionId: candidate.proposalRevisionId as never,
          impactReportDigest: candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: facts,
        policyRevision,
      });
    });
    if (!authorized.ok) {
      throw new Error(`authorizePublish failed: ${JSON.stringify(authorized.error)}`);
    }
    const token = uniqueToken("vjob");
    const job = await asCoordinator(client, () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${token}`),
        candidateId: candidate.id as never,
        authorizationId: authorized.value.authorization.id,
        requestScope: "instance:cp-09",
        idempotencyKey: `key-${token}`,
        requestDigest: sha256Digest(`req-${token}`),
      }),
    );
    if (!job.ok) {
      throw new Error(`createJob failed: ${JSON.stringify(job.error)}`);
    }
    return { job: job.value, authorization: authorized.value.authorization };
  };

  const runManager = async () =>
    runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async (principalId) => {
        if (principalId === REVIEWER) return userActor(REVIEWER, reviewerPermissions);
        if (principalId === PUBLISHER) return userActor(PUBLISHER, publisherPermissions);
        return null;
      },
      ownerId: uniqueToken("mgr"),
    });

  it("A: vendor import successor of acme keeps acme identities and activates through CP-07", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const prepared = await persistVendorCandidate("act", {
      digest: predecessor.digest,
      bytes: predecessor.bytes,
    });
    await authorizeVendor(prepared.candidate, prepared.imported.impactFacts);
    expect(await runManager()).toBe("claimed");
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds).toContain("online-publication");
    expect(snapshot.current).toBe("crel_act");
    const ids = await client.query<{ id: string }>(
      `select id from parameter_catalog.parameter_definitions
       union
       select id from parameter_catalog.catalog_subjects`,
    );
    const present = ids.rows.map((row) => row.id);
    expect(present).toContain("csub_acme_power");
    expect(present).toContain("pdef_acme_power_iin_max");
    expect(present).toContain("csub_act_1");

    const d1 = compileVendorCatalogSuccessor();
    await expect(
      installCatalogRelease(
        pool,
        {
          mode: "advance",
          filename: "-",
          expectedTargetDigest: d1.compiled.aggregateDigest,
          expectedCurrentId: "crel_act",
          expectedCurrentDigest: snapshot.currentDigest ?? "",
        },
        d1.bundle,
      ),
    ).rejects.toThrow("catalog-install-publication-regime-required");
  }, 120_000);

  it("B: re-importing unchanged vendor after a page increment keeps the page definition", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const vendorPrepared = await persistVendorCandidate("keep", {
      digest: predecessor.digest,
      bytes: predecessor.bytes,
    });
    await authorizeVendor(vendorPrepared.candidate, vendorPrepared.imported.impactFacts);
    expect(await runManager()).toBe("claimed");

    const vendorBuilt = vendorPrepared.imported.built;
    if (vendorBuilt.kind !== "successor") throw new Error("expected successor");
    const page = await buildCompleteSuccessor({
      predecessorArtifact: {
        digest: vendorBuilt.artifact.artifactDigest,
        bytes: vendorBuilt.artifact.artifactBytes,
      },
      changeSet: [pageIntegerChange("page_keep", "Page kept definition")],
      frozenIdentity: frozenPageIdentity([allocationFor("page_keep")], uniqueToken("pagea"), "1.3.0"),
      persist: {
        db: createDatabase(asQueryable(client)),
        ports: {
          persistCandidate: async (tx, candidateInput) =>
            persistCandidate(tx, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: PUBLISHER,
                authorOrganizationId: "org-test",
                impactFacts: {
                  authorPrincipalId: PUBLISHER,
                  operations: [{ op: "create-definition", supported: true }],
                  introducesNewSubject: false,
                  changesSelector: false,
                  changesAlias: false,
                  changesFallback: false,
                  tightensExistingContract: false,
                  changesUnitOrSemantic: false,
                  retiresIdentity: false,
                  unknownImpact: false,
                  sourceKind: "typed-changeset",
                },
              },
            }),
        },
      },
    });
    expect(page.ok).toBe(true);
    if (!page.ok || page.value.kind !== "successor" || page.value.persistence.kind !== "persisted") {
      throw new Error("page successor failed");
    }
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const pageAuth = await asCoordinator(client, async () => {
      const capability = await client.query<{ digest: string }>(
        `select catalog_publication.digest_jsonb(capability_contract) as digest
           from catalog_publication.candidates where id = $1`,
        [page.value.persistence.kind === "persisted" ? page.value.persistence.candidate.id : ""],
      );
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: {
          candidateId: page.value.persistence.kind === "persisted" ? page.value.persistence.candidate.id : ("" as never),
          artifactDigest: page.value.candidate.artifactDigest,
          expectedBaseReleaseId: page.value.candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: page.value.candidate.expectedBaseReleaseDigest,
          proposalRevisionId: page.value.candidate.proposalRevisionId,
          impactReportDigest: page.value.candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: {
          authorPrincipalId: PUBLISHER,
          operations: [{ op: "create-definition", supported: true }],
          introducesNewSubject: false,
          changesSelector: false,
          changesAlias: false,
          changesFallback: false,
          tightensExistingContract: false,
          changesUnitOrSemantic: false,
          retiresIdentity: false,
          unknownImpact: false,
          sourceKind: "typed-changeset",
        },
        policyRevision,
      });
    });
    if (!pageAuth.ok) throw new Error(JSON.stringify(pageAuth.error));
    const pageJob = await asCoordinator(client, () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${uniqueToken("pagea")}`),
        candidateId: page.value.persistence.kind === "persisted" ? page.value.persistence.candidate.id : ("" as never),
        authorizationId: pageAuth.value.authorization.id,
        requestScope: "instance:cp-09",
        idempotencyKey: `pagea-${uniqueToken("k")}`,
        requestDigest: sha256Digest(`pagea-${uniqueToken("d")}`),
      }),
    );
    if (!pageJob.ok) throw new Error(JSON.stringify(pageJob.error));
    expect(await runManager()).toBe("claimed");

    const reimport = await importVendorCatalog({
      predecessorArtifact: {
        digest: page.value.artifact.artifactDigest,
        bytes: page.value.artifact.artifactBytes,
      },
      schemasRoot: vendorPrepared.schemasRoot,
      identity: vendorIdentity("reimport"),
    });
    expect(reimport.ok).toBe(true);
    if (!reimport.ok) return;
    expect(reimport.value.kind).toBe("unchanged");
    const keys = await client.query<{ property_key: string }>(
      "select property_key from parameter_catalog.parameter_definitions order by property_key",
    );
    expect(keys.rows.map((row) => row.property_key)).toEqual(
      expect.arrayContaining(["iin_max", "iin_limit", "page_keep"]),
    );
    const vendorSubject = await client.query<{ id: string }>(
      `select id from parameter_catalog.catalog_subjects where id = 'csub_keep_1'`,
    );
    expect(vendorSubject.rows[0]?.id).toBe("csub_keep_1");
  }, 120_000);

  it("D: page publish after a prepared vendor candidate requires rebase; rebuild keeps A and B", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const pageA = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      changeSet: [pageIntegerChange("page_a", "Page A")],
      frozenIdentity: frozenPageIdentity([allocationFor("page_a")], uniqueToken("pa"), "1.1.0"),
      persist: {
        db: createDatabase(asQueryable(client)),
        ports: {
          persistCandidate: async (tx, candidateInput) =>
            persistCandidate(tx, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: PUBLISHER,
                authorOrganizationId: "org-test",
                impactFacts: {
                  authorPrincipalId: PUBLISHER,
                  operations: [{ op: "create-definition", supported: true }],
                  introducesNewSubject: false,
                  changesSelector: false,
                  changesAlias: false,
                  changesFallback: false,
                  tightensExistingContract: false,
                  changesUnitOrSemantic: false,
                  retiresIdentity: false,
                  unknownImpact: false,
                  sourceKind: "typed-changeset",
                },
              },
            }),
        },
      },
    });
    if (!pageA.ok || pageA.value.kind !== "successor" || pageA.value.persistence.kind !== "persisted") {
      throw new Error("page A failed");
    }
    const policyA = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authA = await asCoordinator(client, async () => {
      const capability = await client.query<{ digest: string }>(
        `select catalog_publication.digest_jsonb(capability_contract) as digest
           from catalog_publication.candidates where id = $1`,
        [pageA.value.persistence.kind === "persisted" ? pageA.value.persistence.candidate.id : ""],
      );
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: {
          candidateId: pageA.value.persistence.candidate.id,
          artifactDigest: pageA.value.candidate.artifactDigest,
          expectedBaseReleaseId: pageA.value.candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: pageA.value.candidate.expectedBaseReleaseDigest,
          proposalRevisionId: pageA.value.candidate.proposalRevisionId,
          impactReportDigest: pageA.value.candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: {
          authorPrincipalId: PUBLISHER,
          operations: [{ op: "create-definition", supported: true }],
          introducesNewSubject: false,
          changesSelector: false,
          changesAlias: false,
          changesFallback: false,
          tightensExistingContract: false,
          changesUnitOrSemantic: false,
          retiresIdentity: false,
          unknownImpact: false,
          sourceKind: "typed-changeset",
        },
        policyRevision: policyA,
      });
    });
    if (!authA.ok) throw new Error(JSON.stringify(authA.error));
    const jobA = await asCoordinator(client, () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${uniqueToken("pa")}`),
        candidateId: pageA.value.persistence.candidate.id,
        authorizationId: authA.value.authorization.id,
        requestScope: "instance:cp-09",
        idempotencyKey: `pa-${uniqueToken("k")}`,
        requestDigest: sha256Digest(`pa-${uniqueToken("d")}`),
      }),
    );
    if (!jobA.ok) throw new Error(JSON.stringify(jobA.error));
    expect(await runManager()).toBe("claimed");

    const vendorPrepared = await persistVendorCandidate(
      "stale",
      {
        digest: pageA.value.artifact.artifactDigest,
        bytes: pageA.value.artifact.artifactBytes,
      },
      "1.4.0",
    );
    const originalCandidate = await asCoordinator(client, () =>
      getCandidate(asQueryable(client), vendorPrepared.candidate.id as never),
    );

    const pageB = await buildCompleteSuccessor({
      predecessorArtifact: {
        digest: pageA.value.artifact.artifactDigest,
        bytes: pageA.value.artifact.artifactBytes,
      },
      changeSet: [pageIntegerChange("page_b", "Page B")],
      frozenIdentity: frozenPageIdentity([allocationFor("page_b")], uniqueToken("pb"), "1.2.0"),
      persist: {
        db: createDatabase(asQueryable(client)),
        ports: {
          persistCandidate: async (tx, candidateInput) =>
            persistCandidate(tx, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: PUBLISHER,
                authorOrganizationId: "org-test",
                impactFacts: {
                  authorPrincipalId: PUBLISHER,
                  operations: [{ op: "create-definition", supported: true }],
                  introducesNewSubject: false,
                  changesSelector: false,
                  changesAlias: false,
                  changesFallback: false,
                  tightensExistingContract: false,
                  changesUnitOrSemantic: false,
                  retiresIdentity: false,
                  unknownImpact: false,
                  sourceKind: "typed-changeset",
                },
              },
            }),
        },
      },
    });
    if (!pageB.ok || pageB.value.kind !== "successor" || pageB.value.persistence.kind !== "persisted") {
      throw new Error("page B failed");
    }
    const policyB = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authB = await asCoordinator(client, async () => {
      const capability = await client.query<{ digest: string }>(
        `select catalog_publication.digest_jsonb(capability_contract) as digest
           from catalog_publication.candidates where id = $1`,
        [pageB.value.persistence.candidate.id],
      );
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: {
          candidateId: pageB.value.persistence.candidate.id,
          artifactDigest: pageB.value.candidate.artifactDigest,
          expectedBaseReleaseId: pageB.value.candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: pageB.value.candidate.expectedBaseReleaseDigest,
          proposalRevisionId: pageB.value.candidate.proposalRevisionId,
          impactReportDigest: pageB.value.candidate.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: {
          authorPrincipalId: PUBLISHER,
          operations: [{ op: "create-definition", supported: true }],
          introducesNewSubject: false,
          changesSelector: false,
          changesAlias: false,
          changesFallback: false,
          tightensExistingContract: false,
          changesUnitOrSemantic: false,
          retiresIdentity: false,
          unknownImpact: false,
          sourceKind: "typed-changeset",
        },
        policyRevision: policyB,
      });
    });
    if (!authB.ok) throw new Error(JSON.stringify(authB.error));
    const jobB = await asCoordinator(client, () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${uniqueToken("pb")}`),
        candidateId: pageB.value.persistence.candidate.id,
        authorizationId: authB.value.authorization.id,
        requestScope: "instance:cp-09",
        idempotencyKey: `pb-${uniqueToken("k")}`,
        requestDigest: sha256Digest(`pb-${uniqueToken("d")}`),
      }),
    );
    if (!jobB.ok) throw new Error(JSON.stringify(jobB.error));
    expect(await runManager()).toBe("claimed");

    const vendorJob = await authorizeVendor(vendorPrepared.candidate, vendorPrepared.imported.impactFacts);
    expect(await runManager()).toBe("claimed");
    const staleJob = await asCoordinator(client, () => getJob(asQueryable(client), vendorJob.job.id));
    expect(staleJob.ok && staleJob.value.status).toBe("needs-rebase");
    expect(originalCandidate.ok && originalCandidate.value.expectedBaseReleaseDigest).toBe(
      pageA.value.artifact.artifactDigest,
    );
    const staleAgain = await asCoordinator(client, () =>
      getCandidate(asQueryable(client), vendorPrepared.candidate.id as never),
    );
    expect(staleAgain.ok && staleAgain.value.artifactDigest).toBe(vendorPrepared.candidate.artifactDigest);

    const rebuilt = await persistVendorCandidate(
      "rebuilt",
      {
        digest: pageB.value.artifact.artifactDigest,
        bytes: pageB.value.artifact.artifactBytes,
      },
      "1.3.0",
    );
    await authorizeVendor(rebuilt.candidate, rebuilt.imported.impactFacts);
    expect(await runManager()).toBe("claimed");
    const keys = await client.query<{ property_key: string }>(
      "select property_key from parameter_catalog.parameter_definitions order by property_key",
    );
    expect(keys.rows.map((row) => row.property_key)).toEqual(
      expect.arrayContaining(["iin_max", "page_a", "page_b", "iin_limit"]),
    );
  }, 180_000);

  it("E: hash mismatch refuses before any catalog write", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const schemasRoot = writeChargerTree();
    writeFileSync(
      path.join(schemasRoot, "catalog.json"),
      JSON.stringify({
        vendorContentHash: "0".repeat(64),
        schemaPaths: ["vendor/wiseeff/charger.yaml"],
      }),
    );
    const before = await domainSnapshot(client);
    const imported = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot,
      identity: vendorIdentity("hash"),
      persist: { db: createDatabase(asQueryable(client)) },
    });
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.error.kind).toBe("catalog-vendor-hash-mismatch");
    }
    expect(await domainSnapshot(client)).toEqual(before);
  }, 120_000);
});
