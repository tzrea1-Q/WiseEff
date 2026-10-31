import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentInvocation, createUserInvocation } from "../../auth/trustedInvocation";
import {
  CATALOG_SYNCHRONIZER_ROLE,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import { integerContent } from "../../catalog-publication/builder/predecessorHarness";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { getReceiptByJobId } from "../../catalog-publication/persistence/store";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import {
  enablePublicationPolicy,
  persistHandBuiltCandidate,
  publisherPermissions,
  authorPermissions,
  PUBLISHER,
  AUTHOR,
  userActor,
  asCoordinator,
} from "../../catalog-publication/authorization/testHarness";
import { withProductionLogin } from "../../catalog-publication/persistence/integrationHarness";
import {
  bootstrapFirstAcme,
  persistPredecessorArtifact,
  connect,
} from "../../catalog-kernel/install/publicationTestHarness";
import { CATALOG_RELEASE_HEADER, catalogMarkdownImportResponseSchema, catalogPublicationCandidateResponseSchema, catalogPublicationJobResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { PublicationJobId } from "../../parameter-catalog-contract/index";
import {
  createPostgresDatabase,
  createDatabase,
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

  it("plans Markdown on the server, preserves evidence, and refuses invalid or unauthorized requests", async () => {
    const document = "# Driver `acme,power`\n## `import_a` 导入 A\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n";
    const markdownImport = { document, fileName: "defs.md" };
    const post = (body: unknown) => request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId }, body,
    });
    authenticateAs(publisherScope());
    const hinted = await post({ markdownImport: { ...markdownImport,
      document: document.replace("# Driver `acme,power`", "# Driver `acme,new`\nnature: physical-device · cardinality: multiple · 业务分类：不存在 · 模块名称：设备") } });
    expect(hinted.status).toBe(201);
    expect(hinted.body).toMatchObject({ item: { entries: [{ outcome: "create" }], placementHints: [
      { selector: "acme,new", categoryPath: "不存在", moduleName: "设备", warnings: [expect.stringContaining("不存在")] },
    ] } });
    expect((await post({ markdownImport, changeSet: changeSetFor("ambiguous") })).status).toBe(400);
    const before = await asCoordinator(client, () => client.query<{ n: string }>(`select count(*)::text as n from catalog_publication.candidates`));
    const invalid = await post({ markdownImport: { ...markdownImport, document: document.replace("integer", "enum") } });
    expect(invalid.status).toBe(200);
    expect(invalid.body).toMatchObject({ item: { candidate: null, entries: [{ outcome: "error" }] } });
    expect(catalogMarkdownImportResponseSchema.parse(invalid.body).item.entries[0]?.diagnostics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "类型", line: 5 })]));
    const after = await asCoordinator(client, () => client.query<{ n: string }>(`select count(*)::text as n from catalog_publication.candidates`));
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const created = await post({ markdownImport });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ item: { candidate: { riskClass: "low" }, entries: [{
      outcome: "create", selector: "acme,power", propertyKey: "import_a", displayName: "导入 A",
    }] } });
    const highRisk = await post({ markdownImport: { ...markdownImport,
      document: document.replace("# Driver `acme,power`", "# Driver `acme,new`\nnature: physical-device · cardinality: multiple") } });
    expect(highRisk.status).toBe(201);
    expect(highRisk.body).toMatchObject({ item: { candidate: { riskClass: "high", impactSummary: { addedSubjectCount: 1 } } } });
    for (const kind of ["NodeType", "ConfigurationSchema"]) {
      const response = await post({ markdownImport: { ...markdownImport,
        document: document.replace("Driver `acme,power`", `${kind} \`new-subject\``) } });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ item: { candidate: { riskClass: "high", impactSummary: { addedSubjectCount: 1 } } } });
    }
    const id = (created.body as { item: { candidate: { id: string } } }).item.candidate.id;
    const artifacts = await asCoordinator(client, () => client.query<{ source_kind: string; toolchain: Record<string, unknown> }>(
      `select a.source_kind, a.toolchain from catalog_publication.release_artifacts a join catalog_publication.candidates c on c.artifact_id = a.id where c.id = $1`, [id],
    ));
    expect(artifacts.rows[0]).toMatchObject({ source_kind: "markdown-import", toolchain: { markdownImport: {
      fileName: "defs.md", sha256: `sha256:${createHash("sha256").update(document).digest("hex")}`, parserVersion: "markdown-import/v1",
    } } });
    const publisher = publisherScope();
    authenticateAs({ ...publisher, permissions: ["catalog:publish"] });
    expect((await post({ markdownImport })).status).toBe(403);
    const auth = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG, permissions: [...authorPermissions], roleId: "admin" });
    authenticateAs({ principalId: AUTHOR, organizationId: ORG, actorKind: "agent", permissions: auth.permissions,
      trustedActor: createAgentInvocation(auth, { sessionId: "import-session", toolCallId: "import-tool", approval: { required: true, approvalId: "import-approval" } }) });
    expect((await post({ markdownImport })).status).toBe(403);
    expect((await request("POST", `/api/v2/catalog/publication-candidates/${id}/publish`, {
      headers: { [CATALOG_RELEASE_HEADER]: pinId }, body: { idempotencyKey: "agent-import-publish" },
    })).status).toBe(403);
  });

  it("reports all-skip and conflict without freezing a Candidate", async () => {
    authenticateAs(publisherScope());
    const document = "# Driver `acme,power`\n## `iin_max` Input current limit\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | mA |\n| 最小值 | 0 |\n\nMaximum accepted input current.";
    const post = (text: string) => request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId }, body: { markdownImport: { document: text, fileName: "repeat.md" } },
    });
    const before = await asCoordinator(client, () => client.query<{ n: string }>(`select count(*)::text as n from catalog_publication.candidates`));
    const skipped = await post(document);
    expect(skipped.status).toBe(200);
    expect(catalogMarkdownImportResponseSchema.parse(skipped.body).item).toMatchObject({ candidate: null, noChange: true, entries: [{ outcome: "skip" }] });
    const conflict = await post(document.replace("Input current limit", "Changed"));
    expect(conflict.status).toBe(200);
    expect(catalogMarkdownImportResponseSchema.parse(conflict.body).item).toMatchObject({ candidate: null, noChange: false, entries: [{ outcome: "conflict" }] });
    const after = await asCoordinator(client, () => client.query<{ n: string }>(`select count(*)::text as n from catalog_publication.candidates`));
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("warns about organization placement without changing preview outcomes", async () => {
    const org = "org-placement-1450";
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Placement')`, [org]);
    for (const [id, parent, name] of [["p1450-a", null, "电源"], ["p1450-b", "p1450-a", "充电"],
      ["p1450-c", null, "电源 / 充电"], ["p1450-used", "p1450-a", "设备"], ["p1450-default", "p1450-a", "node-type:new-subject"]] as const) {
      await pool.query(`insert into public.parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin)
        values ($1, $2, $3, $4, $1, 1, 'business', 'curated')`, [id, org, parent, name]);
    }
    await pool.query(`insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
      values ('asub1450', $1, 'driver-registration', '既有设备', 'curated', 'acme,power')`, [org]);
    await pool.query(`insert into public.parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, attribution_subject_id)
      values ('p1450-driver', $1, 'p1450-a', '既有设备', 'p1450-driver', 2, 'driver-group', 'curated', 'asub1450')`, [org]);
    const registrationClient = await pool.connect();
    try {
      await registrationClient.query("begin");
      await registrationClient.query("set constraints all deferred");
      await registrationClient.query(`insert into parameter_catalog.organization_subject_registrations
        (id, organization_id, subject_id, status, registration_method, proof, current_placement_id)
        values ('reg1450', $1, 'csub_acme_power', 'active', 'explicit', '{}'::jsonb, 'placement1450')`, [org]);
      await registrationClient.query(`insert into parameter_catalog.subject_placements (id, registration_id, organization_id, module_id, origin)
        values ('placement1450', 'reg1450', $1, 'p1450-driver', 'curated')`, [org]);
      await registrationClient.query("commit");
    } finally { registrationClient.release(); }
    const post = (text: string) => request("POST", "/api/v2/catalog/publication-candidates", {
      headers: { [CATALOG_RELEASE_HEADER]: pinId }, body: { markdownImport: { document: text, fileName: "placement.md" } },
    });
    const base = "# NodeType `new-subject`\n业务分类：电源 · 模块名称：设备\n## `one` 参数\n| 字段 | 值 |\n| --- | --- |\n| 类型 | string |";
    authenticateAs(publisherScope(org));
    const collision = await post(base);
    expect(collision.body).toMatchObject({ item: { entries: [{ outcome: "create" }], placementHints: [{ warnings: ["同一分类下已有同名模块。"] }] } });
    expect((await post(base.replace(" · 模块名称：设备", ""))).body)
      .toMatchObject({ item: { entries: [{ outcome: "create" }], placementHints: [{ warnings: ["同一分类下已有同名模块。"] }] } });
    const ambiguous = await post(base.replace("业务分类：电源", "业务分类：电源 / 充电"));
    expect(ambiguous.body).toMatchObject({ item: { entries: [{ outcome: "create" }], placementHints: [{ warnings: ["业务分类路径不唯一。"] }] } });
    authenticateAs(publisherScope(OTHER_ORG));
    expect((await post(base)).body).toMatchObject({ item: { placementHints: [{ warnings: ["业务分类不存在。"] }] } });
    authenticateAs(publisherScope(org));
    const existing = "# Driver `acme,power`\n业务分类：不存在\n## `iin_max` Input current limit\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | mA |\n| 最小值 | 0 |\n\nMaximum accepted input current.";
    const skipped = await post(existing);
    expect(skipped.body).toMatchObject({ item: { candidate: null, noChange: true, entries: [{ outcome: "skip" }],
      placementHints: [{ warnings: ["已登记于 电源 / 既有设备，未改动"] }] } });
    expect((await post(existing.replace("Input current limit", "Changed"))).body)
      .toMatchObject({ item: { candidate: null, noChange: false, entries: [{ outcome: "conflict" }] } });
    expect((await post(existing.replace("integer", "enum"))).body)
      .toMatchObject({ item: { candidate: null, noChange: false, entries: [{ outcome: "error" }] } });
  });

  it("accepts 128 changes on the preview route and rejects 129", async () => {
    authenticateAs(publisherScope());
    const changes = Array.from({ length: 129 }, (_, i) => changeSetFor(`cap_${i}`)[0]);
    const post = (body: unknown) => request("POST", "/api/v2/catalog/publication-candidates", { headers: { [CATALOG_RELEASE_HEADER]: pinId }, body });
    const accepted = await post({ changeSet: changes.slice(0, 128) });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ item: { impactSummary: { addedDefinitionCount: 128 } } });
    expect((await post({ changeSet: changes })).status).toBe(400);
  });

  it("freezes an import with the restricted publication coordinator role", async () => {
    await withProductionLogin(client, database.url, "mdcoord", async (login) => {
      await login.query(`set role catalog_publication_coordinator_role`);
      const identity = await login.query<{ current_user: string; superuser: boolean }>(`select current_user, (select rolsuper from pg_roles where rolname = session_user) as superuser`);
      expect(identity.rows[0]).toEqual({ current_user: CATALOG_PUBLICATION_COORDINATOR_ROLE, superuser: false });
      const restrictedDb = createDatabase(asQueryable(login));
      const ports: CatalogPublicationPorts = {
        authenticate: async () => ({ ok: true, scope: publisherScope() }),
        currentRelease: async () => {
          const pointer = await readCurrentCatalogPointer(pool);
          return pointer.kind === "installed" ? { id: pointer.current.id, digest: pointer.current.digest } : null;
        },
        ...bindCatalogPublicationCommands({ db: restrictedDb, pool }),
      };
      const server = await listenCatalogPublicationHttpServer(ports);
      try {
        const response = await fetch(`${server.baseUrl}/api/v2/catalog/publication-candidates`, {
          method: "POST", headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: pinId },
          body: JSON.stringify({ markdownImport: { fileName: "role.md", document: "# Driver `acme,power`\n## `role_import` 定义\n| 字段 | 值 |\n| --- | --- |\n| 类型 | boolean |" } }),
        });
        expect(response.status).toBe(201);
        expect(catalogMarkdownImportResponseSchema.parse(await response.json()).item.candidate).not.toBeNull();
      } finally {
        await server.close();
        await login.query(`reset role`);
      }
    }, CATALOG_PUBLICATION_COORDINATOR_ROLE);
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

  it("GET publication-surface reads current pin without coordinator catalog_state", async () => {
    authenticateAs(publisherScope());
    const response = await request("GET", "/api/v2/catalog/publication-surface");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const item = (response.body as {
      item: {
        currentReleaseId: string | null;
        adopted: boolean;
        publicationEnabled: boolean;
        authoringAllowed: boolean;
        blockers: string[];
      };
    }).item;
    expect(item.currentReleaseId).toBe(pinId);
    expect(item.publicationEnabled).toBe(true);
    expect(item.adopted).toBe(false);
    expect(item.authoringAllowed).toBe(false);
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

it.each([false, true])("publishes a three-definition Markdown import (new subject: %s) through the manager and records an activation receipt", async (newSubject) => {
  const database = await createEphemeralTestDatabase("mdimport");
  const db = createPostgresDatabase(database.url);
  const pool = getRootPostgresPool(db)!;
  const client = await connect(database.url);
  let close = async () => {};
  try {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: true });
    let currentRelease = { id: predecessor.compiled.release.id, digest: predecessor.compiled.release.digest };
    const auth = makeTestAuthContext({ userId: PUBLISHER, organizationId: ORG, permissions: [...publisherPermissions, ...authorPermissions], roleId: "admin" });
    const ports: CatalogPublicationPorts = {
      authenticate: async () => ({ ok: true, scope: { principalId: PUBLISHER, organizationId: ORG, actorKind: "org-admin", permissions: auth.permissions, trustedActor: createUserInvocation(auth) } }),
      currentRelease: async () => currentRelease,
      ...bindCatalogPublicationCommands({ db, pool }),
    };
    const server = await listenCatalogPublicationHttpServer(ports);
    close = server.close;
    const post = async (path: string, body: unknown, pin = predecessor.compiled.release.id) => {
      const response = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: pin }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const document = `# Driver \`${newSubject ? "acme,new" : "acme,power"}\`\n${newSubject ? "nature: physical-device · cardinality: multiple\n" : ""}${["a", "b", "c"].map((key) => `## \`batch_${key}\` 参数 ${key}\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |`).join("\n")}`;
    const preview = await post("/api/v2/catalog/publication-candidates", { markdownImport: { document, fileName: "three.md" } });
    expect(preview.status).toBe(201);
    const plan = catalogMarkdownImportResponseSchema.parse(preview.body).item;
    expect(plan.entries).toHaveLength(3);
    expect(plan.candidate).not.toBeNull();
    expect(plan.candidate?.riskClass).toBe(newSubject ? "high" : "low");
    const candidateId = plan.candidate!.id;
    const published = await post(`/api/v2/catalog/publication-candidates/${candidateId}/publish`, { idempotencyKey: "md-three" });
    expect(published.status).toBe(201);
    const jobId = catalogPublicationJobResponseSchema.parse(published.body).item.id;
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool), resolvePublisherActor: async () => userActor(PUBLISHER, publisherPermissions), ownerId: "markdown-test" })).toBe("claimed");
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, PublicationJobId(jobId)));
    expect(receipt.ok).toBe(true);
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") throw new Error("publication did not install a release");
    const before = await asCoordinator(client, () => client.query<{ n: string }>(
      `select count(*)::text as n from catalog_publication.candidates`,
    ));
    const stale = await post("/api/v2/catalog/publication-candidates", { markdownImport: { document, fileName: "three.md" } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { details: { reason: "candidate-stale" } } });
    currentRelease = pointer.current;
    const repeat = await post("/api/v2/catalog/publication-candidates", { markdownImport: { document, fileName: "three.md" } }, currentRelease.id);
    expect(repeat.status).toBe(200);
    expect(catalogMarkdownImportResponseSchema.parse(repeat.body).item).toMatchObject({
      candidate: null, noChange: true, entries: [{ outcome: "skip" }, { outcome: "skip" }, { outcome: "skip" }],
    });
    const after = await asCoordinator(client, () => client.query<{ n: string }>(
      `select count(*)::text as n from catalog_publication.candidates`,
    ));
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const definitions = await client.query<{ property_key: string }>(`select d.property_key from parameter_catalog.parameter_definitions d
      join parameter_catalog.catalog_release_definition_heads h on h.definition_id = d.id
      join parameter_catalog.catalog_state s on s.current_catalog_release_id = h.release_id
      where d.property_key in ('batch_a', 'batch_b', 'batch_c') order by d.property_key`);
    expect(definitions.rows.map((row) => row.property_key)).toEqual(["batch_a", "batch_b", "batch_c"]);
    if (newSubject) {
      const subject = await client.query<{ n: string }>(`select count(*)::text as n from parameter_catalog.catalog_subjects where canonical_key = 'acme,new'`);
      expect(subject.rows[0]?.n).toBe("1");
    }
  } finally {
    await close();
    await client.end();
    await db.close();
    await database.drop();
  }
}, 120_000);

it("publishes batch retire and restore atomically and rejects a batch with a failing row", async () => {
  const database = await createEphemeralTestDatabase("batchlife");
  const db = createPostgresDatabase(database.url);
  const pool = getRootPostgresPool(db)!;
  const client = await connect(database.url);
  let close = async () => {};
  try {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: true });
    let currentRelease = { id: predecessor.compiled.release.id, digest: predecessor.compiled.release.digest };
    const auth = makeTestAuthContext({ userId: PUBLISHER, organizationId: ORG, permissions: [...publisherPermissions, ...authorPermissions], roleId: "admin" });
    const server = await listenCatalogPublicationHttpServer({
      authenticate: async () => ({ ok: true, scope: { principalId: PUBLISHER, organizationId: ORG, actorKind: "org-admin", permissions: auth.permissions, trustedActor: createUserInvocation(auth) } }),
      currentRelease: async () => currentRelease,
      ...bindCatalogPublicationCommands({ db, pool })
    });
    close = server.close;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: currentRelease.id }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const publish = async (changeSet: unknown[], key: string) => {
      const candidate = await post("/api/v2/catalog/publication-candidates", { changeSet });
      expect(candidate.status).toBe(201);
      const candidateId = catalogPublicationCandidateResponseSchema.parse(candidate.body).item.id;
      const result = await post(`/api/v2/catalog/publication-candidates/${candidateId}/publish`, { idempotencyKey: key });
      expect(result.status).toBe(201);
      expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool), resolvePublisherActor: async () => userActor(PUBLISHER, publisherPermissions), ownerId: "batch-lifecycle-test" })).toBe("claimed");
      const pointer = await readCurrentCatalogPointer(pool);
      if (pointer.kind !== "installed") throw new Error("publication did not install a release");
      currentRelease = pointer.current;
    };
    const keys = ["lifecycle_a", "lifecycle_b", "lifecycle_c"];
    await publish(keys.flatMap(changeSetFor), "lifecycle-create");
    const read = () => client.query<{ id: string; property_key: string; lifecycle: string }>(
      `select d.id, d.property_key, r.content->>'lifecycle' as lifecycle from parameter_catalog.parameter_definitions d
       join parameter_catalog.catalog_release_definition_heads h on h.definition_id = d.id
       join parameter_catalog.catalog_state s on s.current_catalog_release_id = h.release_id
       join parameter_catalog.definition_revisions r on r.id = h.revision_id
       where d.property_key in ('lifecycle_a', 'lifecycle_b', 'lifecycle_c') order by d.property_key`);
    const definitions = (await read()).rows;
    expect(definitions).toHaveLength(3);
    const changes = (op: "retire-definition" | "restore-definition") => definitions.map((d) => ({
      op, definitionId: d.id, class: "semantic", content: integerContent(`Input ${d.property_key}`, `Documentation for ${d.property_key}.`)
    }));
    const rejected = await post("/api/v2/catalog/publication-candidates", { changeSet: [...changes("retire-definition").slice(0, 2), { ...changes("retire-definition")[2], definitionId: "pdef_missing" }] });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect((await read()).rows.map((row) => row.lifecycle)).toEqual(["active", "active", "active"]);
    await publish(changes("retire-definition"), "lifecycle-retire");
    expect((await read()).rows.map((row) => row.lifecycle)).toEqual(["retired", "retired", "retired"]);
    await publish(changes("restore-definition"), "lifecycle-restore");
    expect((await read()).rows.map((row) => row.lifecycle)).toEqual(["active", "active", "active"]);
  } finally {
    await close();
    await client.end();
    await db.close();
    await database.drop();
  }
}, 120_000);
