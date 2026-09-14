import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootstrapFirstAcme,
  persistPredecessorArtifact,
} from "../../catalog-kernel/install/publicationTestHarness";
import { createManagedInstanceTestDatabase } from "../../../testing/testDatabase";
import { adoptPreexistingCatalog } from "../runtime/adoption";
import { setPublicationFreeze } from "../runtime/freeze";
import { asQueryable, requirePgvectorTestDatabase, withCommittedRole } from "../persistence/integrationHarness";
import {
  checkPublicationPolicyRevision,
  inspectPublicationPolicy,
  revisePublicationPolicy,
} from "./policy";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION, MANAGED_INSTANCE_POLICY_CONFIRMATION } from "./types";
import { PUBLISHER, publisherPermissions, systemActor, userActor } from "./testHarness";

await requirePgvectorTestDatabase();

const CATALOG_MIGRATION_OWNER = "catalog_migration_owner";

const pinsOf = async (client: pg.Client) => {
  const snapshot = await inspectPublicationPolicy(asQueryable(client));
  return {
    snapshot,
    pins: {
      confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
      expectedDatabaseOid: snapshot.databaseOid,
      expectedCurrentId: snapshot.currentReleaseId ?? "",
      expectedCurrentDigest: snapshot.currentReleaseDigest ?? "",
      expectedPolicyRevision: snapshot.policyRevision,
      expectedFrozen: snapshot.frozen,
      expectedAdopted: snapshot.adopted,
    } as const,
  };
};

describe("managed instance publication policy", () => {
  let url: string;
  let client: pg.Client;
  let pool: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createManagedInstanceTestDatabase("polm");
    url = database.url;
    drop = database.drop;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    pool = new pg.Pool({ connectionString: url, max: 4 });
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await drop?.();
  });

  it("refuses ephemeral confirmation on a non-ephemeral database name", async () => {
    const snapshot = await inspectPublicationPolicy(asQueryable(client));
    expect(snapshot.ephemeralName).toBe(false);
    expect(snapshot.publicationEnabled).toBe(false);
    const refused = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION,
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.reason).toBe("publication-policy-disabled");
    }
  });

  it("refuses enable before adoption and does not write", async () => {
    const { snapshot, pins } = await pinsOf(client);
    expect(snapshot.adopted).toBe(false);
    const checked = await checkPublicationPolicyRevision(asQueryable(client), {
      trustedActor: userActor(PUBLISHER, publisherPermissions),
      publicationEnabled: true,
      lowRiskSingleActorPublish: false,
      capabilityContractRevision: "catalog-capability/v1",
      mode: "check",
      managedInstance: pins,
    });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.refusals.map((row) => row.reason)).toContain("adoption-evidence-invalid");
    }
    const executed = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: pins,
      }),
    );
    expect(executed.ok).toBe(false);
    const after = await inspectPublicationPolicy(asQueryable(client));
    expect(after.publicationEnabled).toBe(false);
  });

  it("enables without bundling low-risk, preserves freeze, and is idempotent", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const fingerprint = await client.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [predecessor.compiled.release.id],
    );
    const adopted = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      sourceBytes: predecessor.bytes,
      artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: fingerprint.rows[0]!.compiled_fingerprint,
        data_mode: "fresh",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
      actorPrincipalId: PUBLISHER,
    });
    expect(adopted.ok).toBe(true);

    await withCommittedRole(client, "catalog_publication_coordinator_role", async () =>
      setPublicationFreeze(asQueryable(client), {
        frozen: true,
        actorPrincipalId: "operator-freeze",
      }),
    );

    const { snapshot, pins } = await pinsOf(client);
    expect(snapshot.adopted).toBe(true);
    expect(snapshot.frozen).toBe(true);
    expect(snapshot.databaseName.startsWith("wiseeffm")).toBe(true);

    const stale = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: { ...pins, expectedPolicyRevision: pins.expectedPolicyRevision + 1 },
      }),
    );
    expect(stale.ok).toBe(false);

    const enabled = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: pins,
      }),
    );
    expect(enabled.ok).toBe(true);
    if (enabled.ok) {
      expect(enabled.value.publicationEnabled).toBe(true);
      expect(enabled.value.lowRiskSingleActorPublish).toBe(false);
    }
    const frozen = await inspectPublicationPolicy(asQueryable(client));
    expect(frozen.frozen).toBe(true);
    expect(frozen.publicationEnabled).toBe(true);
    expect(frozen.lowRiskSingleActorPublish).toBe(false);

    const againPins = {
      confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
      expectedDatabaseOid: frozen.databaseOid,
      expectedCurrentId: frozen.currentReleaseId ?? "",
      expectedCurrentDigest: frozen.currentReleaseDigest ?? "",
      expectedPolicyRevision: frozen.policyRevision,
      expectedFrozen: frozen.frozen,
      expectedAdopted: frozen.adopted,
    } as const;
    const repeated = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: againPins,
      }),
    );
    expect(repeated.ok).toBe(true);

    const disabled = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () => {
      const current = await inspectPublicationPolicy(asQueryable(client));
      return revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: false,
        lowRiskSingleActorPublish: current.lowRiskSingleActorPublish,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: {
          confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
          expectedDatabaseOid: current.databaseOid,
          expectedCurrentId: current.currentReleaseId ?? "",
          expectedCurrentDigest: current.currentReleaseDigest ?? "",
          expectedPolicyRevision: current.policyRevision,
          expectedFrozen: current.frozen,
          expectedAdopted: current.adopted,
        },
      });
    });
    expect(disabled.ok).toBe(true);
    const afterDisable = await inspectPublicationPolicy(asQueryable(client));
    expect(afterDisable.publicationEnabled).toBe(false);
    expect(afterDisable.frozen).toBe(true);
    expect(afterDisable.adopted).toBe(true);
  });

  it("refuses a non-user actor", async () => {
    const { pins } = await pinsOf(client);
    const refused = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: systemActor(),
        publicationEnabled: false,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: pins,
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.reason).toBe("publication-not-authorized");
    }
  });
});
