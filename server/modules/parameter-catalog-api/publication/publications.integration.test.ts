import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentInvocation, createUserInvocation } from "../../auth/trustedInvocation";
import {
  CATALOG_SYNCHRONIZER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import { integerContent } from "../../catalog-publication/builder/predecessorHarness";
import {
  enablePublicationPolicy,
  persistHandBuiltCandidate,
  publisherPermissions,
  authorPermissions,
  PUBLISHER,
  AUTHOR,
  asCoordinator,
} from "../../catalog-publication/authorization/testHarness";
import { withProductionLogin } from "../../catalog-publication/persistence/integrationHarness";
import {
  bootstrapFirstAcme,
  persistPredecessorArtifact,
  connect,
} from "../../catalog-kernel/install/publicationTestHarness";
import { CATALOG_RELEASE_HEADER } from "../../contracts/dtoSchemas/parameterCatalog";
import {
  createPostgresDatabase,
  createSavepointDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../../shared/database/client";
import { asQueryable } from "../../catalog-publication/persistence/integrationHarness";
import { enqueuePublicationJob } from "../../catalog-publication/enqueue";
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
  throw new Error(
    "CP-07 publication HTTP tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
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
  throw new Error(
    "CP-07 publication HTTP tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-cp07-pub";
const OTHER_ORG = "org-cp07-other";

const changeSetFor = (propertyKey: string) => [
  {
    op: "create-definition" as const,
    subjectId: "csub_acme_power",
    propertyKey,
    content: integerContent(`Input ${propertyKey}`, `Documentation for ${propertyKey}.`),
  },
];

describe("CP-07 publication HTTP against real PostgreSQL", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let pinId = "";
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  let scope: TrustedPublicationScope;
  const productionWireSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../productionWire.ts"),
    "utf8",
  );

  const authenticateAs = (next: TrustedPublicationScope): void => {
    scope = next;
  };

  const publisherScope = (organizationId = ORG): TrustedPublicationScope => {
    const auth = makeTestAuthContext({
      userId: PUBLISHER,
      organizationId,
      permissions: [...publisherPermissions, ...authorPermissions],
      roleId: "admin",
    });
    return {
      principalId: PUBLISHER,
      organizationId,
      actorKind: "org-admin",
      permissions: auth.permissions,
      trustedActor: createUserInvocation(auth),
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
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      body: !canSendBody || init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined,
    };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("cp07pub");
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
    scope = publisherScope();
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

  it("T04.a/d publishes twice with the same scope+key+digest as one job", async () => {
    authenticateAs(publisherScope());
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_t04a") },
    });
    expect(created.status).toBe(201);
    const candidate = (created.body as { item: { id: string } }).item;
    expect(candidate.id.startsWith("ccand_")).toBe(true);

    const first = await request("POST", `/api/v2/catalog/publication-candidates/${candidate.id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t04a" },
    });
    expect(first.status).toBe(201);
    const job = (first.body as { item: { id: string; status: string; effective: boolean } }).item;
    expect(job.id.startsWith("cjob_")).toBe(true);
    expect(job.status).toBe("queued");
    expect(job.effective).toBe(false);

    const second = await request("POST", `/api/v2/catalog/publication-candidates/${candidate.id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t04a" },
    });
    expect(second.status).toBe(200);
    expect((second.body as { item: { id: string } }).item.id).toBe(job.id);

    const counted = await asCoordinator(client, async () =>
      client.query<{ n: string }>(`select count(*)::text as n from catalog_publication.publication_jobs`),
    );
    expect(Number(counted.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("T04.b rejects the same key with a different candidate as idempotency-key-conflict", async () => {
    authenticateAs(publisherScope());
    const first = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_t04b1") },
    });
    const second = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_t04b2") },
    });
    const firstId = (first.body as { item: { id: string } }).item.id;
    const secondId = (second.body as { item: { id: string } }).item.id;
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${firstId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t04b" },
    });
    expect(published.status).toBe(201);
    const conflicted = await request("POST", `/api/v2/catalog/publication-candidates/${secondId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t04b" },
    });
    expect(conflicted.status).toBe(409);
    expect((conflicted.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "idempotency-key-conflict",
    );
  });

  it("T04.c rolled-back job insert leaves no durable job", async () => {
    authenticateAs(publisherScope());
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_t04c") },
    });
    const candidateId = (created.body as { item: { id: string } }).item.id;
    const before = await client.query<{ n: string }>(
      `select count(*)::text as n from catalog_publication.publication_jobs`,
    );
    await client.query("begin");
    try {
      await enqueuePublicationJob({
        db: createSavepointDatabase(asQueryable(client)),
        candidateId,
        idempotencyKey: "key-t04c",
        trustedActor: publisherScope().trustedActor,
      });
    } finally {
      await client.query("rollback");
    }
    const after = await client.query<{ n: string }>(
      `select count(*)::text as n from catalog_publication.publication_jobs`,
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const retry = await request("POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t04c" },
    });
    expect(retry.status).toBe(201);
  });

  it("AGENT.z denies Agent preview and publish even with injected capabilities", async () => {
    const auth = makeTestAuthContext({
      userId: AUTHOR,
      organizationId: ORG,
      permissions: [...publisherPermissions, ...authorPermissions, "catalog:review-high-risk"],
      roleId: "admin",
    });
    authenticateAs({
      principalId: AUTHOR,
      organizationId: ORG,
      actorKind: "agent",
      permissions: auth.permissions,
      trustedActor: createAgentInvocation(auth, {
        sessionId: "session-cp07",
        toolCallId: "tool-cp07",
        approval: { required: true, approvalId: "approval-cp07" },
      }),
    });
    const preview = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: {
        changeSet: changeSetFor("iin_agent"),
        approved: true,
        riskClass: "low",
        capabilities: ["catalog:publish"],
      },
    });
    expect(preview.status).toBe(403);
    expect((preview.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "publication-not-authorized",
    );
  });

  it("SCOPE.z hides other-org candidates and jobs", async () => {
    authenticateAs(publisherScope(ORG));
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_scope") },
    });
    const candidateId = (created.body as { item: { id: string } }).item.id;
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-scope" },
    });
    const jobId = (published.body as { item: { id: string } }).item.id;
    authenticateAs(publisherScope(OTHER_ORG));
    const leakedCandidate = await request("GET", `/api/v2/catalog/publication-candidates/${candidateId}`);
    expect(leakedCandidate.status).toBe(404);
    expect(JSON.stringify(leakedCandidate.body)).not.toContain("iin_scope");
    expect(JSON.stringify(leakedCandidate.body)).not.toContain("impactSummary");
    const leakedJob = await request("GET", `/api/v2/catalog/publications/${jobId}`);
    expect(leakedJob.status).toBe(404);
    expect(JSON.stringify(leakedJob.body)).not.toContain(candidateId);
  });

  it("POLICY.z refuses publish while publication_enabled is false", async () => {
    await enablePublicationPolicy(client, {
      publicationEnabled: false,
      lowRiskSingleActorPublish: true,
    });
    authenticateAs(publisherScope());
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_pol") },
    });
    expect(created.status).toBe(201);
    const candidateId = (created.body as { item: { id: string } }).item.id;
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-policy" },
    });
    expect(published.status).toBe(403);
    expect((published.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "publication-policy-disabled",
    );
    await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
  });

  it("P0 HTTP enqueue of a truncated allocation is candidate-tampered, not low-risk", async () => {
    authenticateAs(publisherScope());
    const truncated = await persistHandBuiltCandidate(client, {
      authorPrincipalId: PUBLISHER,
      authorOrganizationId: ORG,
    });
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${truncated.id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-p0-http" },
    });
    expect(published.status).toBe(409);
    expect((published.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "candidate-tampered",
    );
  });

  it("T25 keeps published catalog and jobs readable while the manager is down", async () => {
    authenticateAs(publisherScope());
    const created = await request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { changeSet: changeSetFor("iin_t25") },
    });
    const candidateId = (created.body as { item: { id: string } }).item.id;
    const published = await request("POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId },
      body: { idempotencyKey: "key-t25" },
    });
    const jobId = (published.body as { item: { id: string } }).item.id;
    const got = await request("GET", `/api/v2/catalog/publications/${jobId}`);
    expect(got.status).toBe(200);
    expect((got.body as { item: { status: string } }).item.status).toBe("queued");
    const current = await pool.query(`select current_catalog_release_id from parameter_catalog.catalog_state`);
    expect(current.rows[0]?.current_catalog_release_id).toBe(pinId);
  });

  it("AUTH.z ordinary login cannot execute mark_job_activated or insert receipts", async () => {
    expect(productionWireSource).not.toContain("createCatalogInstaller");
    expect(productionWireSource).not.toContain("catalog_synchronizer_role");
    await withProductionLogin(client, database.url, "api", async (login) => {
      const execute = await login
        .query(`select catalog_publication.mark_job_activated('cjob_missing', 1)`)
        .then(
          () => null,
          (error: unknown) => error as pg.DatabaseError,
        );
      expect(execute).toBeInstanceOf(pg.DatabaseError);
      expect((execute as pg.DatabaseError).code).toBe("42501");
      const insert = await login
        .query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest, actor_principal_id
           ) values ('crct_api_forbidden', 'bootstrap', 'crel_x', $1, $1, 'user')`,
          ["sha256:" + "cd".repeat(32)],
        )
        .then(
          () => null,
          (error: unknown) => error as pg.DatabaseError,
        );
      expect(insert).toBeInstanceOf(pg.DatabaseError);
      expect((insert as pg.DatabaseError).code).toBe("42501");
      const setRole = await login
        .query(`set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`)
        .then(
          () => null,
          (error: unknown) => error as pg.DatabaseError,
        );
      expect(setRole).toBeInstanceOf(pg.DatabaseError);
      expect((setRole as pg.DatabaseError).code).toBe("42501");
    });
  });
});
