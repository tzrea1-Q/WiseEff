import type { Server } from "node:http";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../app";
import { getAuthContext } from "../modules/auth/repository";
import { createUserInvocation } from "../modules/auth/trustedInvocation";
import { createCatalogInstaller } from "../modules/catalog-kernel/install/installer";
import {
  bootstrapFirstAcme,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
} from "../modules/catalog-kernel/install/publicationTestHarness";
import { CATALOG_MIGRATION_OWNER } from "../modules/catalog-kernel/security/catalogRoleManifest";
import { inspectPublicationPolicy, revisePublicationPolicy } from "../modules/catalog-publication/authorization/policy";
import { AUTHOR, PUBLISHER } from "../modules/catalog-publication/authorization/testHarness";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../modules/catalog-publication/authorization/types";
import { integerContent } from "../modules/catalog-publication/builder/predecessorHarness";
import { runPublicationManagerOnce } from "../modules/catalog-publication/jobs/manager";
import { asQueryable, withCommittedRole } from "../modules/catalog-publication/persistence/integrationHarness";
import { adoptPreexistingCatalog } from "../modules/catalog-publication/runtime/adoption";
import { CATALOG_RELEASE_HEADER } from "../modules/contracts/dtoSchemas/parameterCatalog";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../shared/database/client";
import { seedCoreGraph } from "../testing/fixtures";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testing/testDatabase";
import { requestJson } from "./testClient";

const ORGANIZATION_ID = "org-canonical-frontend-cleanup";
const DEFINITION_ID = "pdef_acme_power_iin_max";
const content = integerContent("Input current limit", "Maximum accepted input current.");

describe("assembled canonical publication refusals preserve persisted state", () => {
  let fixture: EphemeralTestDatabase;
  let db: RootDatabase;
  let client: pg.Client;
  let server: Server;
  let releaseId: string;

  async function post(path: string, body: unknown, userId = AUTHOR) {
    return requestJson<{ item: { id: string; status: string }; error: { code: string; details: Record<string, unknown> } }>(
      server,
      path,
      {
        method: "POST",
        headers: { "X-WiseEff-User": userId, [CATALOG_RELEASE_HEADER]: releaseId },
        body: JSON.stringify(body),
      },
    );
  }

  async function snapshot() {
    return {
      domain: await domainSnapshot(client),
      candidates: (await client.query("select * from catalog_publication.candidates order by id")).rows,
      artifacts: (await client.query("select * from catalog_publication.release_artifacts order by id")).rows,
      heads: (await client.query("select * from parameter_catalog.catalog_release_definition_heads order by release_id, definition_id")).rows,
      definitions: (await client.query("select * from parameter_catalog.parameter_definitions order by id")).rows,
      revisions: (await client.query("select * from parameter_catalog.definition_revisions order by id")).rows,
    };
  }

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("frontendcleanup");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db)!;
    client = await connect(fixture.url);
    await seedCoreGraph(db, {
      organization: { id: ORGANIZATION_ID },
      users: [{ id: AUTHOR }, { id: PUBLISHER }],
    });
    await db.query(`insert into roles (id, name, level, permissions)
      values ('admin', 'Admin', 100, array['parameter:view','catalog:author','catalog:publish','catalog:review-high-risk'])
      on conflict (id) do nothing`);
    for (const userId of [AUTHOR, PUBLISHER]) {
      await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id, project_id)
        values ($1, $2, $3, 'admin', null)`, [`${userId}-frontend-cleanup`, userId, ORGANIZATION_ID]);
    }
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    releaseId = predecessor.compiled.release.id;
    const materialization = await client.query<{ compiled_fingerprint: string }>(
      "select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1", [releaseId]);
    const adopted = await adoptPreexistingCatalog(pool, {
      expectedCurrent: { id: releaseId, digest: predecessor.digest },
      sourceBytes: predecessor.bytes,
      artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: materialization.rows[0]!.compiled_fingerprint,
        data_mode: "fresh",
        collected_at: new Date().toISOString(),
        approved_by: PUBLISHER,
      },
      actorPrincipalId: PUBLISHER,
    });
    expect(adopted.ok).toBe(true);
    const policy = await inspectPublicationPolicy(asQueryable(client));
    const enabled = await withCommittedRole(client, CATALOG_MIGRATION_OWNER, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: createUserInvocation(await getAuthContext(db, PUBLISHER)),
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        capabilityContractRevision: "catalog-capability/v1",
        mode: "execute",
        managedInstance: {
          confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION,
          expectedDatabaseOid: policy.databaseOid,
          expectedCurrentId: policy.currentReleaseId!,
          expectedCurrentDigest: policy.currentReleaseDigest!,
          expectedPolicyRevision: policy.policyRevision,
          expectedFrozen: policy.frozen,
          expectedAdopted: policy.adopted,
        },
      }));
    expect(enabled.ok).toBe(true);
    server = createWiseEffServer({ db, auth: { mode: "development" } });

    const candidate = await post("/api/v2/catalog/publication-candidates", {
      changeSet: [{ op: "retire-definition", definitionId: DEFINITION_ID, content }],
    });
    expect(candidate.status, candidate.bodyText).toBe(201);
    const publication = await post(`/api/v2/catalog/publication-candidates/${candidate.body.item.id}/publish`,
      { idempotencyKey: "frontend-cleanup-retirement" }, PUBLISHER);
    expect(publication.status, publication.bodyText).toBe(201);
    expect(await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => createUserInvocation(await getAuthContext(db, PUBLISHER)),
    })).toBe("claimed");
    expect((await client.query("select status from catalog_publication.publication_jobs where id = $1",
      [publication.body.item.id])).rows).toEqual([{ status: "active" }]);
    const state = await domainSnapshot(client);
    expect(state.current).not.toBe(releaseId);
    releaseId = state.current!;
    expect((await client.query(`select definition.id, definition.property_key, revision.content->>'lifecycle' as lifecycle
      from parameter_catalog.parameter_definitions definition
      join parameter_catalog.catalog_release_definition_heads head
        on head.definition_id = definition.id and head.release_id = $1
      join parameter_catalog.definition_revisions revision on revision.id = head.revision_id
      where definition.id = $2`, [releaseId, DEFINITION_ID])).rows)
      .toEqual([{ id: DEFINITION_ID, property_key: "iin_max", lifecycle: "retired" }]);
    const supported = await post("/api/v2/catalog/publication-candidates", {
      changeSet: [{ op: "create-definition", subjectId: "csub_acme_power", propertyKey: "iin_new", content }],
    });
    expect(supported.status, supported.bodyText).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await db?.close();
    await fixture?.drop();
  });

  it.each(["create-definition", "revise-definition"])("refuses policyTarget in %s content without persistence", async (op) => {
    const before = await snapshot();
    const change = op === "create-definition"
      ? { op, subjectId: "csub_acme_power", propertyKey: "iin_new" }
      : { op, definitionId: DEFINITION_ID, class: "semantic" };
    const response = await post("/api/v2/catalog/publication-candidates", {
      changeSet: [{ ...change, content: { ...content, policyTarget: 1500 } }],
    });
    expect(response.status, response.bodyText).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { retryable: false, field: "changeSet" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { label: "non-object schema", valueSchema: null },
    { label: "missing type", valueSchema: {} },
    { label: "unsupported type", valueSchema: { type: "object" } },
    { label: "missing item type", valueSchema: { type: "array", items: {} } },
    { label: "fractional minimum cardinality", valueSchema: { type: "array", minItems: 1.5, items: { type: "integer" } } },
    { label: "fractional maximum cardinality", valueSchema: { type: "array", maxItems: 2.5, items: { type: "integer" } } },
  ])("refuses $label without persistence", async ({ valueSchema }) => {
    const before = await snapshot();
    const response = await post("/api/v2/catalog/publication-candidates", {
      changeSet: [{ op: "create-definition", subjectId: "csub_acme_power", propertyKey: "iin_new",
        content: { ...content, valueSchema } }],
    });
    expect(response.status, response.bodyText).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { retryable: false, field: "changeSet" } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses to reuse a retired Definition natural key or replace its identity", async () => {
    const before = await snapshot();
    const response = await post("/api/v2/catalog/publication-candidates", {
      changeSet: [{ op: "create-definition", subjectId: "csub_acme_power", propertyKey: "iin_max", content }],
    });
    expect(response.status, response.bodyText).toBe(422);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_FAILED",
      details: { reason: "unsupported-catalog-capability", retryable: false } });
    expect(await snapshot()).toEqual(before);
  });
});
