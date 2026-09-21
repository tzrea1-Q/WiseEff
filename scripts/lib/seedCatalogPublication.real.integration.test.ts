import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../server/shared/database/client";
import {
  adoptPreexistingCatalog,
} from "../../server/modules/catalog-publication/runtime/adoption";
import {
  bootstrapFirstAcme,
} from "../../server/modules/catalog-kernel/install/publicationTestHarness";
import { firstAcmePredecessor } from "../../server/modules/catalog-publication/builder/predecessorHarness";
import {
  collectPublicationPolicyInstanceSnapshot,
} from "../../server/modules/catalog-publication/authorization/instanceSnapshot";
import {
  asQueryable,
  withCommittedRole,
} from "../../server/modules/catalog-publication/persistence/integrationHarness";
import {
  PUBLISHER,
  publisherPermissions,
  userActor,
} from "../../server/modules/catalog-publication/authorization/testHarness";
import { revisePublicationPolicy } from "../../server/modules/catalog-publication/authorization/policy";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../../server/modules/catalog-publication/authorization/types";
import { CATALOG_MIGRATION_OWNER } from "../../server/modules/catalog-kernel/security/catalogRoleManifest";
import {
  freezeSeedCatalogIdentity,
  prepareSeedCatalog,
  publishSeedCatalog,
} from "./seedCatalogPublication";

const databaseUrl = process.env.SEED_PUBLICATION_DATABASE_URL?.trim();

describe.skipIf(!databaseUrl)("reviewed seed publication against assigned PostgreSQL", () => {
  let db: RootDatabase;
  let client: pg.Client;
  let organizationId: string;
  let authorUserId: string;
  let reviewerUserId: string;

  beforeAll(async () => {
    db = createPostgresDatabase(databaseUrl!);
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const token = randomBytes(6).toString("hex");
    organizationId = `seed-real-org-${token}`;
    authorUserId = `seed-real-author-${token}`;
    reviewerUserId = `seed-real-reviewer-${token}`;
    const authorRoleId = `catalog-capability-seed-real-author-${token}`;
    const reviewerRoleId = `catalog-capability-seed-real-reviewer-${token}`;

    await db.query("insert into organizations (id,name) values ($1,$2)", [organizationId, "Seed real test"]);
    await db.query(
      `insert into users (id,organization_id,name,title,is_active) values
       ($1,$3,'Seed author','Author',true),($2,$3,'Seed reviewer','Reviewer',true)`,
      [authorUserId, reviewerUserId, organizationId],
    );
    await db.query(
      `insert into roles (id,name,level,permissions) values
       ($1,'Seed author','user',ARRAY['catalog:author','parameter:view']),
       ($2,'Seed reviewer','user',ARRAY['catalog:review-high-risk','parameter:view'])`,
      [authorRoleId, reviewerRoleId],
    );
    await db.query(
      `insert into user_role_bindings (id,user_id,organization_id,project_id,role_id) values
       ($1,$3,$5,null,$2),($4,$6,$5,null,$7)`,
      [
        `seed-real-author-binding-${token}`,
        authorRoleId,
        authorUserId,
        `seed-real-reviewer-binding-${token}`,
        organizationId,
        reviewerUserId,
        reviewerRoleId,
      ],
    );

    let current = await collectPublicationPolicyInstanceSnapshot(db);
    if (!current.currentReleaseId) {
      await bootstrapFirstAcme(getRootPostgresPool(db)!);
      current = await collectPublicationPolicyInstanceSnapshot(db);
    }
    if (!current.adopted) {
      const predecessor = firstAcmePredecessor();
      const fingerprint = await db.query<{ compiled_fingerprint: string }>(
        "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id=$1",
        [predecessor.compiled.release.id],
      );
      const adopted = await adoptPreexistingCatalog(getRootPostgresPool(db)!, {
        expectedCurrent: {
          id: current.currentReleaseId!,
          digest: current.currentReleaseDigest!,
        },
        actorPrincipalId: authorUserId,
        sourceBytes: predecessor.bytes,
        artifactDigest: predecessor.digest,
        evidenceKind: "synthetic-fixture",
        adoptionEvidence: {
          source_bundle_digest: predecessor.digest,
          verification_digest: fingerprint.rows[0]!.compiled_fingerprint,
          data_mode: "populated",
          collected_at: "2026-09-21T00:00:00Z",
          approved_by: authorUserId,
        },
      });
      expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
    }
    const policySnapshot = await collectPublicationPolicyInstanceSnapshot(db);
    const policy = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: {
          confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
          expectedDatabaseOid: policySnapshot.databaseOid,
          expectedCurrentId: policySnapshot.currentReleaseId!,
          expectedCurrentDigest: policySnapshot.currentReleaseDigest!,
          expectedPolicyRevision: policySnapshot.policyRevision,
          expectedFrozen: policySnapshot.frozen,
          expectedAdopted: policySnapshot.adopted,
        },
      }),
    );
    expect(policy.ok, JSON.stringify(policy)).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
  });

  it("uses native auth, stale pins, and idempotent enqueue on a real candidate", async () => {
    const current = await collectPublicationPolicyInstanceSnapshot(db);
    if (!current.currentReleaseId || !current.currentReleaseDigest || !current.artifactDigest) {
      throw new Error("assigned helper database has no current adopted Catalog");
    }
    const pin = {
      id: current.currentReleaseId,
      digest: current.currentReleaseDigest,
    };
    const token = randomBytes(6).toString("hex");
    const frozen = await freezeSeedCatalogIdentity({
      db,
      organizationId,
      actorUserId: authorUserId,
      runId: `seed-real-run-${token}`,
      stage: "vendor",
      expectedCurrent: pin,
      predecessorArtifactDigest: current.artifactDigest,
      schemasRoot: path.join(process.cwd(), "schemas/dts"),
      candidateId: `ccand_seed_real_${token}`,
      artifactId: `cart_seed_real_${token}`,
      releaseId: `crel_seed_real_${token}`,
      releaseVersion: "2.0.0",
      publishedAt: "2026-09-21T00:00:00Z",
    });
    expect(frozen.ok, JSON.stringify(frozen)).toBe(true);
    if (!frozen.ok) return;

    const prepared = await prepareSeedCatalog({ ...frozen.value, db });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok) return;

    const selfPublish = await publishSeedCatalog({
      db,
      organizationId,
      actorUserId: authorUserId,
      runId: frozen.value.identity.runId,
      stage: "vendor",
      candidateId: prepared.value.candidateId,
      expectedArtifactDigest: prepared.value.artifactDigest,
      expectedCurrent: pin,
      idempotencyKey: `seed-real:${token}`,
    });
    expect(selfPublish.ok).toBe(false);
    if (!selfPublish.ok) expect(selfPublish.error.kind).toBe("publication-denied");

    const stalePublish = await publishSeedCatalog({
      db,
      organizationId,
      actorUserId: reviewerUserId,
      runId: frozen.value.identity.runId,
      stage: "vendor",
      candidateId: prepared.value.candidateId,
      expectedArtifactDigest: prepared.value.artifactDigest,
      expectedCurrent: { ...pin, digest: `sha256:${"f".repeat(64)}` },
      idempotencyKey: `seed-real:${token}:stale`,
    });
    expect(stalePublish).toEqual({
      ok: false,
      error: { kind: "stale", message: "current Catalog pin drifted" },
    });

    const first = await publishSeedCatalog({
      db,
      organizationId,
      actorUserId: reviewerUserId,
      runId: frozen.value.identity.runId,
      stage: "vendor",
      candidateId: prepared.value.candidateId,
      expectedArtifactDigest: prepared.value.artifactDigest,
      expectedCurrent: pin,
      idempotencyKey: `seed-real:${token}`,
    });
    const retry = await publishSeedCatalog({
      db,
      organizationId,
      actorUserId: reviewerUserId,
      runId: frozen.value.identity.runId,
      stage: "vendor",
      candidateId: prepared.value.candidateId,
      expectedArtifactDigest: prepared.value.artifactDigest,
      expectedCurrent: pin,
      idempotencyKey: `seed-real:${token}`,
    });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.value.jobId).toBe(first.value.jobId);
      expect(retry.value.candidateId).toBe(prepared.value.candidateId);
    }
    const jobs = await client.query<{ count: string }>(
      "select count(*)::text as count from catalog_publication.publication_jobs where candidate_id=$1",
      [prepared.value.candidateId],
    );
    expect(jobs.rows[0]?.count).toBe("1");
  });
});
