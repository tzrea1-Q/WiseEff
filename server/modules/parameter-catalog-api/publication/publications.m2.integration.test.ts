import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentInvocation, createUserInvocation } from "../../auth/trustedInvocation";
import { integerContent } from "../../catalog-publication/builder/predecessorHarness";
import {
  enablePublicationPolicy,
  publisherPermissions,
  authorPermissions,
  reviewerPermissions,
  PUBLISHER,
  AUTHOR,
  REVIEWER,
} from "../../catalog-publication/authorization/testHarness";
import {
  bootstrapFirstAcme,
  persistPredecessorArtifact,
  connect,
} from "../../catalog-kernel/install/publicationTestHarness";
import { CATALOG_RELEASE_HEADER } from "../../contracts/dtoSchemas/parameterCatalog";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { listenCatalogPublicationHttpServer } from "./http";
import { bindCatalogPublicationCommands } from "./ports";
import type { CatalogPublicationPorts, TrustedPublicationScope } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("CP-10 M2 HTTP tests require real PostgreSQL with pgvector");
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error("CP-10 M2 HTTP tests require pgvector");
}

const ORG = "org-cp10-http";

describe("CP-10 M2 publication HTTP", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let pinId = "";
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  let scope: TrustedPublicationScope;

  const authenticateAs = (next: TrustedPublicationScope): void => {
    scope = next;
  };

  const scopeFor = (
    userId: string,
    permissions: readonly string[],
    actorKind: TrustedPublicationScope["actorKind"] = "org-admin",
  ): TrustedPublicationScope => {
    const auth = makeTestAuthContext({
      userId,
      organizationId: ORG,
      permissions: [...permissions],
      roleId: actorKind === "platform-admin" ? "platform-admin" : "admin",
    });
    return {
      principalId: userId,
      organizationId: ORG,
      actorKind,
      permissions: auth.permissions,
      trustedActor:
        actorKind === "agent"
          ? createAgentInvocation(auth, {
              sessionId: "session-cp10",
              toolCallId: "tool-cp10",
              approval: { required: true, approvalId: "approval-cp10" },
            })
          : createUserInvocation(auth),
    };
  };

  const request = async (
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ) => {
    const canSendBody = method !== "GET" && method !== "HEAD";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...init.headers },
      body: !canSendBody || init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined,
    };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("cp10http");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    pinId = predecessor.compiled.release.id;
    await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    scope = scopeFor(PUBLISHER, [...publisherPermissions, ...authorPermissions]);
    const ports: CatalogPublicationPorts = {
      authenticate: async () => ({ ok: true, scope }),
      currentRelease: async () => ({
        id: predecessor.compiled.release.id,
        digest: predecessor.compiled.release.digest,
      }),
      ...bindCatalogPublicationCommands({ db, pool }),
    };
    const server = await listenCatalogPublicationHttpServer(ports);
    baseUrl = server.baseUrl;
    close = server.close;
  }, 120_000);

  afterAll(async () => {
    await close();
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  it("T01 still previews a supported create-definition as low", async () => {
    authenticateAs(scopeFor(PUBLISHER, [...publisherPermissions, ...authorPermissions]));
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "create-definition",
            subjectId: "csub_acme_power",
            propertyKey: "iin_hold",
            content: integerContent("Hold current", "Hold current documentation."),
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as { item: { riskClass: string } }).item.riskClass).toBe("low");
  });

  it("previews documentation revise as low and fake documentation as high", async () => {
    authenticateAs(scopeFor(AUTHOR, [...authorPermissions]));
    const docs = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "revise-definition",
            definitionId: "pdef_acme_power_iin_max",
            class: "documentation",
            content: {
              displayName: "Input current limit",
              documentation: "Updated documentation only.",
              unit: "mA",
              valueSchema: { type: "integer", minimum: 0 },
            },
          },
        ],
      },
    });
    expect(docs.status).toBe(201);
    expect((docs.body as { item: { riskClass: string; impactSummary: { changedDefinitionCount: number } } }).item).toMatchObject({
      riskClass: "low",
      impactSummary: { changedDefinitionCount: 1, addedSubjectCount: 0 },
    });

    const fake = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "revise-definition",
            definitionId: "pdef_acme_power_iin_max",
            class: "documentation",
            content: {
              displayName: "Input current limit",
              documentation: "Maximum accepted input current.",
              unit: "mV",
              valueSchema: { type: "integer", minimum: 0 },
            },
          },
        ],
      },
    });
    expect(fake.status).toBe(201);
    expect((fake.body as { item: { riskClass: string } }).item.riskClass).toBe("high");
  });

  it("rejects nested published subjectId and treats new subject as high risk", async () => {
    authenticateAs(scopeFor(AUTHOR, [...authorPermissions]));
    const nested = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "create-subject-with-definitions",
            kind: "driver",
            canonicalKey: "driver:acme,aux-nested",
            selector: { kind: "driver-compatible", value: "acme,aux-nested" },
            nature: "physical-device",
            cardinality: "multiple",
            definitions: [
              {
                subjectId: "csub_acme_power",
                propertyKey: "vbat",
                content: integerContent("Aux", "Aux voltage."),
              },
            ],
          },
        ],
      },
    });
    expect(nested.status).toBe(400);

    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "create-subject-with-definitions",
            kind: "driver",
            canonicalKey: "driver:acme,aux-http",
            selector: { kind: "driver-compatible", value: "acme,aux-http" },
            nature: "physical-device",
            cardinality: "multiple",
            definitions: [
              {
                propertyKey: "vbat",
                content: integerContent("Aux battery", "Auxiliary battery voltage."),
              },
            ],
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const item = (created.body as { item: { id: string; riskClass: string; impactSummary: { addedSubjectCount: number } } }).item;
    expect(item.riskClass).toBe("high");
    expect(item.impactSummary.addedSubjectCount).toBe(1);

    authenticateAs(scopeFor(AUTHOR, [...authorPermissions, ...publisherPermissions, ...reviewerPermissions]));
    const selfPublish = await request("POST", `/api/v2/catalog/publication-candidates/${item.id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-self-high" },
    });
    expect(selfPublish.status).toBe(403);
    expect((selfPublish.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "publication-self-approval-forbidden",
    );

    authenticateAs(scopeFor(REVIEWER, [...reviewerPermissions]));
    const reviewed = await request("POST", `/api/v2/catalog/publication-candidates/${item.id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-review-high" },
    });
    expect(reviewed.status).toBe(201);
  });

  it("denies Agent and org-admin without catalog:publish", async () => {
    authenticateAs(scopeFor(AUTHOR, [...authorPermissions, ...publisherPermissions, ...reviewerPermissions], "agent"));
    const agent = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "create-definition",
            subjectId: "csub_acme_power",
            propertyKey: "iin_agent_m2",
            content: integerContent("Agent", "Agent should not preview."),
          },
        ],
      },
    });
    expect(agent.status).toBe(403);

    authenticateAs(scopeFor(AUTHOR, [...authorPermissions]));
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: [
          {
            op: "create-definition",
            subjectId: "csub_acme_power",
            propertyKey: "iin_nopub",
            content: integerContent("No publish", "Author without publish."),
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const candidateId = (created.body as { item: { id: string } }).item.id;
    authenticateAs(scopeFor(AUTHOR, [...authorPermissions]));
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-nopub" },
    });
    expect(published.status).toBe(403);
  });
});
