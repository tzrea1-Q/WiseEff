import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { decodeCatalogCursor, encodeCatalogCursor } from "../../catalog-kernel/runtime/cursors";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogProposalResponseSchema,
  catalogRegistrationResponseSchema,
  catalogRegistrationListResponseSchema,
  catalogReviewResolutionResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { CatalogSubjectId, SubjectRegistrationId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../../parameter-governance/evidence/index";
import type { IngestEvidenceCommand } from "../../parameter-governance/evidence/types";
import { executeProposal } from "../../parameter-governance/proposals/index";
import { executeRegistration } from "../../parameter-governance/registration/index";
import { createAgentInvocation, createUserInvocation, TrustedInvocationContextError } from "../../auth/trustedInvocation";
import { executeBatchRegistration } from "../../parameter-governance/registration/batch";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { bootstrapFirstAcme, persistPredecessorArtifact, connect, PUBLISHER, publisherPermissions, userActor } from "../../catalog-kernel/install/publicationTestHarness";
import { enablePublicationPolicy, authorPermissions } from "../../catalog-publication/authorization/testHarness";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { listenCatalogPublicationHttpServer } from "../publication/http";
import { bindCatalogPublicationCommands } from "../publication/ports";
import { catalogMarkdownImportResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { compileVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import { createRouter } from "../../../shared/http/router";
import { registerParameterCatalogApi } from "../productionWire";
import { createGovernanceCatalogQueries } from "../../parameter-governance/queries/index";
import { resolveReviewItem } from "../../parameter-governance/resolveReviewItem/index";
import { createReviewQueueReader } from "../../parameter-governance/review/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { listenCatalogGovernanceHttpServer } from "./http";
import { bindCatalogGovernanceCommands, bindGovernanceCatalogQueryPorts, emptyGovernanceQueryPorts } from "./ports";
import type { CatalogGovernancePorts, TrustedGovernanceScope } from "./types";
import { listUnregisteredSubjects } from "../../parameter-governance/registration/readRepository";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S8-GOV requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S8-GOV requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s8-gov";
const ATTR_ID = "attr-s8-gov";
const MODULE_ID = "pmod-s8-gov-driver";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const MATCHER_REVISION = "matcher-s8-gov-1";

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

describe("S8-GOV HTTP against real PostgreSQL", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let apiPool: pg.Pool;
  let runtimeToken = "";
  let pin: CatalogReleasePin;
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  let scope: TrustedGovernanceScope;

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
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s8gov");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const base = firstReleaseBundle();
    const release = structuredClone(base.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    const subject = release.documents.find((document) => document.kind === "subject");
    if (!subject || subject.kind !== "subject") throw new Error("missing fixture subject");
    for (const suffix of ["second", "third"]) {
      const extra = structuredClone(subject);
      extra.content.id = `csub_batch_${suffix}`;
      extra.content.canonicalKey = `driver:acme,${suffix}`;
      extra.content.selector.value = `acme,${suffix}`;
      release.documents.push(extra);
    }
    refreshAuthoritativeSource(release);
    const bundle = { ...base, releases: [release] };
    const first = compileOrThrow(bundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    runtimeToken = `batch${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: runtimeToken });
    apiPool = new pg.Pool({ connectionString: runtime.apiUrl, max: 4 });
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S8 GOV')`, [ORG_ID]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S8 GOV driver', 'compatible:acme,power')`,
      [ATTR_ID, ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR_ID],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE_ID, ORG_ID, ATTR_ID],
    );

    scope = {
      principalId: "user-org-admin",
      organizationId: ORG_ID,
      actorKind: "org-admin",
      canReadGovernance: true,
      canMutateOrganization: true,
      canReviewProposals: false,
      defaultDestinationModuleId: MODULE_ID,
      defaultSubjectKind: "driver",
    };
    const reader = createReviewQueueReader(pool);
    const ports: CatalogGovernancePorts = {
      authenticate: async () => ({ ok: true, scope }),
      currentRelease: async () => pin,
      listUnregisteredSubjects: (organizationId, releaseId, source) => listUnregisteredSubjects(apiPool, organizationId, releaseId, source),
      executeBatchRegistration: (input) => executeBatchRegistration(apiPool, input),
      ...bindCatalogGovernanceCommands({
        executeRegistration: (command) => executeRegistration(pool, command),
        resolveReviewItem: (command) => resolveReviewItem(pool, command),
        executeProposal: (command) => executeProposal(pool, command),
        listReviewQueue: (query) => reader.list(query),
        getReviewItem: (query) => reader.get(query),
      }),
      ...emptyGovernanceQueryPorts,
    };
    const server = await listenCatalogGovernanceHttpServer(ports);
    baseUrl = server.baseUrl;
    close = server.close;
  }, 60_000);

  afterAll(async () => {
    await close();
    await apiPool?.end();
    if (runtimeToken) await dropLabRuntimeLogins(database.url, runtimeToken);
    await pool?.end();
    await database?.drop();
  });

  it("lists current unregistered subjects and filters bootstrap subjects from organization publications", async () => {
    const all = await request("GET", `/api/v2/organizations/${ORG_ID}/unregistered-subjects?source=all`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body).toMatchObject({ catalogReleaseId: pin.id, items: expect.arrayContaining([expect.objectContaining({ id: SUBJECT_ID, kind: "driver" })]) });
    const own = await request("GET", `/api/v2/organizations/${ORG_ID}/unregistered-subjects?source=organization`);
    expect(own.status).toBe(200);
    expect((own.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(SUBJECT_ID);
  });

  it("rejects a batch above 128 rows before writing any registrations", async () => {
    const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations/batch`, {
      headers: {
        [CATALOG_RELEASE_HEADER]: pin.id,
        [CATALOG_IDEMPOTENCY_HEADER]: `batch:${randomUUID()}`,
      },
      body: {
        rows: Array.from({ length: 129 }, () => ({
          subjectId: SUBJECT_ID,
          target: { type: "existing-module", moduleId: MODULE_ID },
        })),
      },
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain("128");
    const stored = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.organization_subject_registrations where organization_id = $1`,
      [ORG_ID],
    );
    expect(stored.rows[0]?.count).toBe("0");
  });

  it("rejects malformed batch identifiers and names at the route boundary", async () => {
    const targets = [
      { subjectId: " ", target: { type: "unclassified", name: "valid" } },
      { subjectId: SUBJECT_ID, target: { type: "existing-module", moduleId: " " } },
      { subjectId: SUBJECT_ID, target: { type: "new-module", parentModuleId: " ", name: "valid" } },
      ...[" ", "x".repeat(121), "x\u0001y"].map((name) => ({ subjectId: SUBJECT_ID, target: { type: "unclassified", name } })),
    ];
    for (const row of targets) {
      const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations/batch`, {
        headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [row] },
      });
      expect(result.status).toBe(400);
    }
  });

  it("rejects an untrusted batch invocation before opening the transaction", async () => {
    const invocation = createUserInvocation(makeTestAuthContext({ userId: "real-user", organizationId: ORG_ID }));
    await expect(executeBatchRegistration(pool, { organizationId: ORG_ID, rows: [], expectedRelease: pin,
      idempotencyKey: "untrusted", actorKind: "org-admin", principalId: "another-user", invocation, requestId: "request" }))
      .rejects.toBeInstanceOf(TrustedInvocationContextError);
  });

  it("registers a new module under the explicit unclassified root through the single route", async () => {
    const organizationId = "org-single-root";
    const principalId = "user-single-root";
    await pool.query("insert into public.organizations (id, name) values ($1, 'Single root')", [organizationId]);
    await pool.query("insert into public.users (id, organization_id, name, title, is_active) values ($1,$2,'Admin','Admin',true)", [principalId, organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin) values ('single-root',$1,'未分类','single-root',1,'unclassified','auto')", [organizationId]);
    const previous = scope;
    scope = { ...scope, organizationId, principalId, actorKind: "org-admin", canMutateOrganization: true,
      trustedActor: createUserInvocation(makeTestAuthContext({ userId: principalId, organizationId })) };
    try {
      const result = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations`, {
        headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() },
        body: { subjectId: SUBJECT_ID, placement: { mode: "use-default" }, newDestination: { parentModuleId: "single-root", name: "New module" } },
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      const stored = await pool.query("select id from public.parameter_modules where organization_id=$1 and parent_id='single-root' and name='New module'", [organizationId]);
      expect(stored.rowCount).toBe(1);
    } finally { scope = previous; }
  });

  it("rolls back a bad batch and registers under the unclassified root with a trusted audit", async () => {
    const organizationId = "org-batch-http";
    const userId = "user-batch-http";
    await pool.query("insert into public.organizations (id, name) values ($1, 'Batch')", [organizationId]);
    await pool.query("insert into public.users (id, organization_id, name, title, is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin) values ($1,$2,'未分类',$1,1,'unclassified','auto')", ["batch-root", organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin) values ('batch-category',$1,'电源分类','batch-category',1,'business','curated')", [organizationId]);
    await pool.query("insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key) values ('batch-used-attr',$1,'driver-registration','重名','curated','batch-used')", [organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, attribution_subject_id) values ('batch-used',$1,'batch-category','重名','batch-category/batch-used',2,'driver-group','curated','batch-used-attr')", [organizationId]);
    const previous = scope;
    scope = { ...scope, organizationId, principalId: userId, trustedActor: createUserInvocation(makeTestAuthContext({ organizationId, userId })) };
    try {
      const headers = { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: `batch:${randomUUID()}` };
      const valid = { subjectId: SUBJECT_ID, target: { type: "unclassified", name: " 电源 " } };
      const failed = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
        headers, body: { rows: [valid, { subjectId: "csub_missing", target: { type: "unclassified", name: "未知" } },
          { subjectId: "csub_batch_second", target: { type: "new-module", parentModuleId: "missing", name: "名称" } }] },
      });
      expect(failed.status, JSON.stringify(failed.body)).toBe(409);
      expect(failed.body).toMatchObject({ error: { details: { rows: expect.arrayContaining([expect.objectContaining({ index: 1, code: "subject-inactive", field: "subject" }), expect.objectContaining({ index: 2, code: "category-missing", field: "category" })]) } } });
      expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id = $1", [organizationId])).rowCount).toBe(0);
      expect((await pool.query("select id from public.parameter_modules where parent_id = $1", ["batch-root"])).rowCount).toBe(0);
      for (const target of [{ type: "new-module", parentModuleId: "missing", name: "名称" }, { type: "new-module", parentModuleId: "batch-category", name: "重名" }]) {
        const invalid = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
          headers: { ...headers, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [valid, { subjectId: "csub_batch_second", target }] },
        });
        expect(invalid.status, JSON.stringify(invalid.body)).toBe(409);
        expect(invalid.body).toMatchObject({ error: { details: { rows: [expect.objectContaining({ index: 1, code: expect.any(String), field: expect.any(String) })] } } });
        if (target.parentModuleId === "batch-category") expect(invalid.body).toMatchObject({ error: { details: { rows: [{ code: "name-taken", field: "name" }] } } });
        expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [organizationId])).rowCount).toBe(0);
      }
      const stale = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
        headers: { ...headers, [CATALOG_RELEASE_HEADER]: "crel_stale" }, body: { rows: [valid] },
      });
      expect(stale.status).toBe(409);
      expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [organizationId])).rowCount).toBe(0);
      const successfulRows = [valid, { subjectId: "csub_batch_second", target: { type: "unclassified", name: "第二个" } }];
      const success = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, { headers, body: { rows: successfulRows } });
      expect(success.status, JSON.stringify(success.body)).toBe(201);
      expect((await pool.query("select id from public.parameter_modules where organization_id=$1 and parent_id='batch-root' and name='电源'", [organizationId])).rowCount).toBe(1);
      const batchId = (success.body as { batchId: string }).batchId;
      const replay = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, { headers, body: { rows: successfulRows } });
      expect(replay.status, JSON.stringify(replay.body)).toBe(201);
      expect((replay.body as { batchId: string }).batchId).toBe(batchId);
      const stored = await pool.query<{ name: string; parent_id: string; kind: string }>(
        `select module.name, module.parent_id, module.kind from parameter_catalog.subject_placements placement
         join public.parameter_modules module on module.id = placement.module_id where placement.organization_id = $1`, [organizationId]);
      expect(stored.rows).toEqual(expect.arrayContaining([{ name: "电源", parent_id: "batch-root", kind: "driver-group" }, { name: "第二个", parent_id: "batch-root", kind: "driver-group" }]));
      const audits = await pool.query<{ batch_id: string }>("select metadata->>'batchId' as batch_id from public.audit_events where organization_id = $1 and action = 'registration-register'", [organizationId]);
      expect(audits.rows).toEqual([{ batch_id: batchId }, { batch_id: batchId }]);
      const registrationId = (success.body as { items: Array<{ id: string }> }).items[1]!.id;
      const retired = await executeRegistration(pool, { kind: "retire", organizationId, registrationId: SubjectRegistrationId(registrationId),
        expectedRelease: pin, idempotencyKey: "retire-batch-fixture", context: { actorKind: "org-admin", principalId: userId }, reason: "retired fixture" });
      expect(retired.ok).toBe(true);
      const remaining = await request("GET", `/api/v2/organizations/${organizationId}/unregistered-subjects?source=all`);
      expect((remaining.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(["csub_batch_third"]);
      expect((remaining.body as { items: Array<{ availableModuleIds: string[] }> }).items[0]?.availableModuleIds).toContain("batch-used");
      const existing = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
        headers: { ...headers, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() },
        body: { rows: [{ subjectId: "csub_batch_third", target: { type: "existing-module", moduleId: "batch-used" } }] },
      });
      expect(existing.status, JSON.stringify(existing.body)).toBe(201);
    } finally { scope = previous; }
  });

  it("rejects the entire batch when a subject was auto-registered or its target became occupied", async () => {
    const organizationId = "org-batch-race";
    const userId = "user-batch-race";
    await pool.query("insert into public.organizations (id, name) values ($1, 'Race')", [organizationId]);
    await pool.query("insert into public.users (id, organization_id, name, title, is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin) values ('race-root',$1,'未分类','race-root',1,'unclassified','auto')", [organizationId]);
    await pool.query("insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key) values ('race-attr',$1,'driver-registration','Occupied','curated','race')", [organizationId]);
    await pool.query("insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id) values ('race-module',$1,'Occupied','race-module',1,'driver-group','curated','race-attr')", [organizationId]);
    const previous = scope;
    scope = { ...scope, organizationId, principalId: userId, trustedActor: createUserInvocation(makeTestAuthContext({ organizationId, userId })) };
    try {
      const before = await request("GET", `/api/v2/organizations/${organizationId}/unregistered-subjects?source=all`);
      expect((before.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain("csub_batch_second");
      const auto = await executeRegistration(pool, { kind: "register", organizationId, subjectId: CatalogSubjectId("csub_batch_second"), subjectKind: "driver", expectedRelease: pin,
        placement: { mode: "use-default" }, destinationModuleId: "race-module", method: "automatic", proof: {}, idempotencyKey: "auto-race", context: { actorKind: "trusted-system", principalId: "ingest" } });
      expect(auto.ok).toBe(true);
      const good = { subjectId: SUBJECT_ID, target: { type: "unclassified", name: "有效行" } };
      for (const bad of [
        { subjectId: "csub_batch_second", target: { type: "existing-module", moduleId: "race-module" } },
        { subjectId: "csub_batch_third", target: { type: "existing-module", moduleId: "race-module" } },
      ]) {
        const result = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
          headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [good, bad] },
        });
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(result.body).toMatchObject({ error: { details: { rows: [expect.objectContaining({ index: 1 })] } } });
        expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [organizationId])).rowCount).toBe(1);
        expect((await pool.query("select id from public.parameter_modules where parent_id='race-root'", [])).rowCount).toBe(0);
      }
      const after = await request("GET", `/api/v2/organizations/${organizationId}/unregistered-subjects?source=all`);
      expect((after.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain("csub_batch_second");
      const cross = await request("GET", `/api/v2/organizations/${ORG_ID}/unregistered-subjects?source=all`);
      expect(cross.status).toBe(404);
      const adminScope = scope;
      for (const deniedScope of [
        { ...adminScope, actorKind: "agent" as const },
        { ...adminScope, canMutateOrganization: false },
        { ...adminScope, trustedActor: createAgentInvocation(makeTestAuthContext({ organizationId, userId }), { sessionId: "session", toolCallId: "tool", approval: { required: false } }) },
      ]) {
        scope = deniedScope;
        const denied = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
          headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [good] },
        });
        expect(denied.status).toBe(403);
      }
      scope = adminScope;
      const wrongOrg = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations/batch`, {
        headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [good] },
      });
      expect(wrongOrg.status).toBe(403);
      await pool.query("insert into public.parameter_modules (id,organization_id,name,path,depth,kind,origin) values ('race-category',$1,'电源','race-category',1,'business','curated')", [organizationId]);
      await pool.query("insert into public.attribution_subjects (id,organization_id,subject_kind,display_name,origin,source_key) values ('race-free-attr',$1,'driver-registration','Free','curated','race-free')", [organizationId]);
      await pool.query("insert into public.parameter_modules (id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ('race-free',$1,'Free','race-free',1,'driver-group','curated','race-free-attr')", [organizationId]);
      const success = await request("POST", `/api/v2/organizations/${organizationId}/subject-registrations/batch`, {
        headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: randomUUID() }, body: { rows: [
          { subjectId: SUBJECT_ID, target: { type: "new-module", parentModuleId: "race-category", name: "新模块" } },
          { subjectId: "csub_batch_third", target: { type: "existing-module", moduleId: "race-free" } },
        ] },
      });
      expect(success.status, JSON.stringify(success.body)).toBe(201);
      const destinations = await pool.query<{ subject_id: string; module_id: string; parent_id: string | null }>(
        `select registration.subject_id, placement.module_id, module.parent_id from parameter_catalog.organization_subject_registrations registration
         join parameter_catalog.subject_placements placement on placement.registration_id=registration.id
         join public.parameter_modules module on module.id=placement.module_id where registration.organization_id=$1`, [organizationId]);
      expect(destinations.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ subject_id: SUBJECT_ID, parent_id: "race-category" }),
        expect.objectContaining({ subject_id: "csub_batch_third", module_id: "race-free" }),
      ]));
    } finally { scope = previous; }
  });

  it("uses the same persisted organization-admin authority as single registration in the production router", async () => {
    const organizationId = "org-batch-authority";
    const principalId = "user-batch-authority";
    await pool.query("insert into public.organizations (id,name) values ($1,'Authority')", [organizationId]);
    await pool.query("insert into public.users (id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [principalId, organizationId]);
    let auth = makeTestAuthContext({ userId: principalId, organizationId, roles: [{ roleId: "admin", projectId: "project-only" }] });
    const db = createPostgresDatabase(database.url);
    try {
      const router = createRouter();
      registerParameterCatalogApi(router, { db, resolveAuth: () => auth });
      const send = () => router.handle({ method: "POST", path: `/api/v2/organizations/${organizationId}/subject-registrations/batch`, params: {}, query: {},
        headers: { [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: "authority" }, requestId: "authority-request",
        body: { rows: Array.from({ length: 129 }, () => ({ subjectId: SUBJECT_ID, target: { type: "unclassified", name: "名称" } })) } });
      expect((await send()).status).toBe(403);
      auth = makeTestAuthContext({ userId: principalId, organizationId });
      expect((await send()).status).toBe(403);
      await pool.query("insert into public.user_role_bindings (id,user_id,organization_id,project_id,role_id) values ('batch-authority-binding',$1,$2,null,'admin')", [principalId, organizationId]);
      expect((await send()).status).toBe(400);
    } finally { await db.close(); }
  });

  it("registers a subject through HTTP and writes one Registration/Placement pair", async () => {
    const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations`, {
      headers: {
        [CATALOG_RELEASE_HEADER]: pin.id,
        [CATALOG_IDEMPOTENCY_HEADER]: `reg:${randomUUID()}`,
      },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
        reason: "explicit HTTP registration",
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.headers.get(CATALOG_RELEASE_HEADER)).toBe(pin.id);
    expect(result.headers.get("etag")).toBeTruthy();
    const body = catalogRegistrationResponseSchema.parse(result.body);
    expect(body.item.subjectId).toBe(SUBJECT_ID);
    expect(body.item.status).toBe("active");
    expect(body.item.organizationId).toBe(ORG_ID);

    const stored = await pool.query<{ registrations: string; placements: string }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $1 and subject_id = $2) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $1) as placements
      `,
      [ORG_ID, SUBJECT_ID],
    );
    expect(stored.rows[0]).toEqual({ registrations: "1", placements: "1" });
  });

  it("does not invoke a domain write when Idempotency-Key is missing", async () => {
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.governance_command_idempotency
        where organization_id = $1`,
      [ORG_ID],
    );
    const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations`, {
      headers: { [CATALOG_RELEASE_HEADER]: pin.id },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
      },
    });
    expect(result.status).toBe(409);
    expect((result.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "revision-conflict",
    );
    const after = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.governance_command_idempotency
        where organization_id = $1`,
      [ORG_ID],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("creates a proposal over HTTP and appends a trusted audit event", async () => {
    const result = await request("POST", "/api/v2/catalog/definition-proposals", {
      headers: {
        [CATALOG_RELEASE_HEADER]: pin.id,
        [CATALOG_IDEMPOTENCY_HEADER]: `prop:${randomUUID()}`,
      },
      body: {
        base: {
          catalogReleaseId: pin.id,
          definitionId: "pdef_acme_power_iin_max",
          definitionRevisionId: "drev_acme_power_iin_max_1",
        },
        requestedChange: { kind: "revise-definition", note: "s8-gov" },
        reason: "field measurement requires a higher limit",
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const body = catalogProposalResponseSchema.parse(result.body);
    expect(body.item.status).toBe("draft");
    expect(body.item.organizationId).toBe(ORG_ID);
    const audits = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and action = 'proposal-create-draft'`,
      [ORG_ID],
    );
    expect(Number(audits.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("resolves a review item over HTTP with If-Match and records success audit", async () => {
    const ingest = createEvidenceIngest(pool);
    const reader = createReviewQueueReader(pool);
    const command: IngestEvidenceCommand = {
      organizationId: ORG_ID,
      sourceIdentity: `unknown:${randomUUID()}`,
      catalogReleaseId: pin.id,
      matcherRevision: MATCHER_REVISION,
      matcherOutput: { status: "unknown" },
      evidence: { propertyKey: `iin_max_${randomUUID()}` },
      provenance: null,
    };
    const ingested = await ingest.ingest(command);
    expect(ingested.ok).toBe(true);
    const listed = await reader.list({
      organizationId: ORG_ID,
      capturedRelease: pin,
      context: {
        actorKind: "org-admin",
        principalId: scope.principalId,
        organizationId: ORG_ID,
      },
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const item = listed.value.items[0];
    expect(item).toBeDefined();
    if (!item) return;

    const result = await request(
      "POST",
      `/api/v2/organizations/${ORG_ID}/parameter-review-items/${item.id}/resolve`,
      {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: `resolve:${randomUUID()}`,
          [CATALOG_IF_MATCH_HEADER]: `"${item.etag}"`,
        },
        body: {
          resolution: { type: "mark-out-of-scope" },
          reason: "unknown",
        },
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    catalogReviewResolutionResponseSchema.parse(result.body);
    const audits = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and action = 'review-item-resolved'`,
      [ORG_ID],
    );
    expect(Number(audits.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("ignores spoofed identity headers on a real HTTP read", async () => {
    const result = await request("GET", `/api/v2/organizations/${ORG_ID}/parameter-review-items`, {
      headers: {
        "X-WiseEff-Role": "platform-admin",
        "X-WiseEff-Organization": "org-attacker",
        "X-WiseEff-Actor-Kind": "agent",
        "X-WiseEff-Agent": "true",
      },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get(CATALOG_RELEASE_HEADER)).toBe(pin.id);
  });
});

it("attributes an introduced subject to the Candidate author's organization after real publication", async () => {
  const database = await createEphemeralTestDatabase("batchorigin");
  const db = createPostgresDatabase(database.url);
  const pool = getRootPostgresPool(db)!;
  const client = await connect(database.url);
  let closePublication = async () => {};
  let closeGovernance = async () => {};
  try {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: true });
    const organizationId = "org-batch-origin";
    await pool.query("insert into public.organizations (id, name) values ($1,'Origin'),('org-batch-other','Other')", [organizationId]);
    const auth = makeTestAuthContext({ userId: PUBLISHER, organizationId, permissions: [...publisherPermissions, ...authorPermissions], roleId: "admin" });
    const publication = await listenCatalogPublicationHttpServer({
      authenticate: async () => ({ ok: true, scope: { principalId: PUBLISHER, organizationId, actorKind: "org-admin", permissions: auth.permissions, trustedActor: createUserInvocation(auth) } }),
      currentRelease: async () => ({ id: predecessor.compiled.release.id, digest: predecessor.compiled.release.digest }),
      ...bindCatalogPublicationCommands({ db, pool }),
    });
    closePublication = publication.close;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${publication.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: predecessor.compiled.release.id }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const document = "# Driver `acme,batch-origin`\nnature: physical-device · cardinality: multiple\n## `batch_origin` 参数\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |";
    const preview = await post("/api/v2/catalog/publication-candidates", { markdownImport: { document, fileName: "origin.md" } });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    const candidateId = catalogMarkdownImportResponseSchema.parse(preview.body).item.candidate!.id;
    const published = await post(`/api/v2/catalog/publication-candidates/${candidateId}/publish`, { idempotencyKey: "batch-origin" });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool), resolvePublisherActor: async () => userActor(PUBLISHER, publisherPermissions), ownerId: "batch-origin" })).toBe("claimed");
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") throw new Error("publication did not install a release");
    const pin = { id: pointer.current.id, digest: pointer.current.digest };
    let scope: TrustedGovernanceScope = { principalId: PUBLISHER, organizationId, actorKind: "org-admin", canReadGovernance: true,
      canMutateOrganization: true, canReviewProposals: false, defaultDestinationModuleId: "", defaultSubjectKind: "driver" };
    const reader = createReviewQueueReader(pool);
    const governance = await listenCatalogGovernanceHttpServer({
      authenticate: async () => ({ ok: true, scope }), currentRelease: async () => pin,
      listUnregisteredSubjects: (org, release, source) => listUnregisteredSubjects(pool, org, release, source),
      ...bindCatalogGovernanceCommands({ executeRegistration: (command) => executeRegistration(pool, command),
        resolveReviewItem: (command) => resolveReviewItem(pool, command), executeProposal: (command) => executeProposal(pool, command),
        listReviewQueue: (query) => reader.list(query), getReviewItem: (query) => reader.get(query) }), ...emptyGovernanceQueryPorts,
    });
    closeGovernance = governance.close;
    const read = async (org: string, source: string) => {
      const response = await fetch(`${governance.baseUrl}/api/v2/organizations/${org}/unregistered-subjects?source=${source}`);
      expect(response.status).toBe(200);
      return await response.json() as { items: Array<{ canonicalName: string }> };
    };
    expect((await read(organizationId, "organization")).items.map((item) => item.canonicalName)).toEqual(["acme,batch-origin"]);
    expect((await read(organizationId, "all")).items.map((item) => item.canonicalName)).toContain("acme,power");
    scope = { ...scope, organizationId: "org-batch-other" };
    expect((await read("org-batch-other", "organization")).items).toEqual([]);
    expect((await read("org-batch-other", "all")).items.map((item) => item.canonicalName)).toContain("acme,batch-origin");
  } finally {
    await closeGovernance(); await closePublication(); await client.end(); await db.close(); await database.drop();
  }
}, 120_000);

it("excludes retired current-release membership and rejects it when submitted", async () => {
  const database = await createEphemeralTestDatabase("batchretired");
  const pool = new pg.Pool({ connectionString: database.url });
  let close = async () => {};
  try {
    const vendor = compileVendorCatalogSuccessor();
    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const bootstrap = await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(firstBundle), expectedTargetDigest: first.aggregateDigest });
    expect(bootstrap.ok).toBe(true);
    const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(vendor.bundle),
      expectedCurrent: { id: first.release.id, digest: first.release.digest }, expectedTargetDigest: vendor.compiled.aggregateDigest });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const pin = { id: vendor.compiled.release.id, digest: vendor.compiled.release.digest };
    const organizationId = "org-batch-retired";
    const principalId = "user-batch-retired";
    await pool.query("insert into public.organizations (id,name) values ($1,'Retired')", [organizationId]);
    await pool.query("insert into public.users (id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [principalId, organizationId]);
    await pool.query("insert into public.parameter_modules (id,organization_id,name,path,depth,kind,origin) values ('retired-root',$1,'未分类','retired-root',1,'unclassified','auto')", [organizationId]);
    const reader = createReviewQueueReader(pool);
    const server = await listenCatalogGovernanceHttpServer({
      authenticate: async () => ({ ok: true, scope: { principalId, organizationId, actorKind: "org-admin", canReadGovernance: true,
        canMutateOrganization: true, canReviewProposals: false, defaultDestinationModuleId: "", defaultSubjectKind: "driver",
        trustedActor: createUserInvocation(makeTestAuthContext({ userId: principalId, organizationId })) } }),
      currentRelease: async () => pin, listUnregisteredSubjects: (org, release, source) => listUnregisteredSubjects(pool, org, release, source),
      executeBatchRegistration: (input) => executeBatchRegistration(pool, input),
      ...bindCatalogGovernanceCommands({ executeRegistration: (command) => executeRegistration(pool, command), resolveReviewItem: (command) => resolveReviewItem(pool, command),
        executeProposal: (command) => executeProposal(pool, command), listReviewQueue: (query) => reader.list(query), getReviewItem: (query) => reader.get(query) }),
      ...emptyGovernanceQueryPorts,
    });
    close = server.close;
    const list = await fetch(`${server.baseUrl}/api/v2/organizations/${organizationId}/unregistered-subjects?source=all`);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(SUBJECT_ID);
    const write = await fetch(`${server.baseUrl}/api/v2/organizations/${organizationId}/subject-registrations/batch`, { method: "POST",
      headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: pin.id, [CATALOG_IDEMPOTENCY_HEADER]: "retired" },
      body: JSON.stringify({ rows: [{ subjectId: SUBJECT_ID, target: { type: "unclassified", name: "退役" } }] }) });
    expect(write.status).toBe(409);
    expect(await write.json()).toMatchObject({ error: { details: { rows: [expect.objectContaining({ index: 0, code: "subject-inactive", field: "subject" })] } } });
    expect((await pool.query("select id from parameter_catalog.organization_subject_registrations where organization_id=$1", [organizationId])).rowCount).toBe(0);
  } finally { await close(); await pool.end(); await database.drop(); }
}, 120_000);

describe("registration pagination through public HTTP and real PostgreSQL", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let scope: TrustedGovernanceScope;
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  const organizationId = "org-registration-pages";
  const emptyOrganizationId = "org-registration-pages-empty";
  const expected = new Map<string, { subjectId: string; placementId: string }>();
  const path = (org = organizationId) => `/api/v2/organizations/${org}/subject-registrations`;
  const get = async (query: Record<string, string> = {}, org = organizationId, headers: Record<string, string> = {}) => {
    const response = await fetch(`${baseUrl}${path(org)}?${new URLSearchParams(query)}`, { headers });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("registration_pages");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const bundle = firstReleaseBundle();
    const release = structuredClone(bundle.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    const subject = release.documents.find((document) => document.kind === "subject")!;
    if (subject.kind !== "subject") throw new Error("missing fixture subject");
    for (let index = 1; index <= 100; index += 1) {
      const document = structuredClone(subject);
      document.content.id = `csub_page_${index}`;
      document.content.canonicalKey = `driver:acme,page-${index}`;
      document.content.selector.value = `acme,page-${index}`;
      release.documents.push(document);
    }
    refreshAuthoritativeSource(release);
    const expanded = { ...bundle, releases: [release] };
    const compiled = compileOrThrow(expanded);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(expanded), expectedTargetDigest: compiled.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.release.id, digest: compiled.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Pagination'), ($2, 'Empty')`, [organizationId, emptyOrganizationId]);
    await pool.query(`insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
      values ('attr-registration-pages', $1, 'driver-registration', 'Pages', 'compatible:acme,pages')`, [organizationId]);
    await pool.query(`insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
      values ('attr-registration-pages', 'physical-device', 'multiple')`);
    await pool.query(`insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
      values ('pmod-registration-pages', $1, 'Pages', 'pmod-registration-pages', 1, 'driver-group', 'curated', 'attr-registration-pages')`, [organizationId]);
    scope = { principalId: "user-registration-pages", organizationId, actorKind: "org-admin", canReadGovernance: true,
      canMutateOrganization: true, canReviewProposals: false, defaultDestinationModuleId: "pmod-registration-pages", defaultSubjectKind: "driver" };
    for (const document of release.documents) {
      if (document.kind !== "subject") continue;
      const moduleId = `pmod_${document.content.id}`;
      await pool.query(`insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
        values ($1, $2, $1, $1, 1, 'driver-group', 'curated', 'attr-registration-pages')`, [moduleId, organizationId]);
      const result = await executeRegistration(pool, {
        kind: "register", organizationId, subjectId: CatalogSubjectId(document.content.id), subjectKind: "driver",
        expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
        method: "explicit", proof: {}, idempotencyKey: `page:${document.content.id}`,
        context: { actorKind: "org-admin", principalId: scope.principalId },
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error("registration failed");
      expected.set(result.value.registrationId, { subjectId: result.value.subjectId, placementId: result.value.placementId });
    }
    const reader = createReviewQueueReader(pool);
    const server = await listenCatalogGovernanceHttpServer({
      authenticate: async () => ({ ok: true, scope }), currentRelease: async () => pin,
      ...bindCatalogGovernanceCommands({ executeRegistration: (command) => executeRegistration(pool, command),
        executeProposal: (command) => executeProposal(pool, command), resolveReviewItem: (command) => resolveReviewItem(pool, command),
        listReviewQueue: (query) => reader.list(query), getReviewItem: (query) => reader.get(query) }),
      ...bindGovernanceCatalogQueryPorts(createGovernanceCatalogQueries(pool)),
    });
    baseUrl = server.baseUrl;
    close = server.close;
  }, 60_000);

  afterAll(async () => { await close(); await pool?.end(); await database?.drop(); });

  it("returns all 101 guarded registrations with truthful bounded pages and bound public cursors", async () => {
    expect(expected.size).toBe(101);
    const first100 = await get({ limit: "100", catalogReleaseId: pin.id });
    expect(first100.status, JSON.stringify(first100.body)).toBe(200);
    const page100 = catalogRegistrationListResponseSchema.parse(first100.body);
    expect(page100.items).toHaveLength(100);
    expect(page100.totalCount).toBe(101);
    expect(page100.hasMore).toBe(true);
    expect(page100.nextCursor).toBeTruthy();
    const tail = catalogRegistrationListResponseSchema.parse((await get({ limit: "100", cursor: page100.nextCursor! })).body);
    expect(tail.items).toHaveLength(1);
    expect(tail.totalCount).toBe(101);
    expect(tail.hasMore).toBe(false);
    expect(tail.nextCursor).toBeNull();
    const all = [...page100.items, ...tail.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(101);
    expect(all.map((item) => item.id).sort()).toEqual([...expected.keys()].sort());
    for (const item of all) expect({ subjectId: item.subjectId, placementId: item.placement.id }).toEqual(expected.get(item.id));
    const defaultPages = [];
    let cursor: string | undefined;
    do {
      const response = await get(cursor ? { cursor } : {});
      expect(response.status).toBe(200);
      const page = catalogRegistrationListResponseSchema.parse(response.body);
      expect(page.totalCount).toBe(101);
      expect(page.hasMore).toBe(page.nextCursor !== null);
      defaultPages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(defaultPages.map((page) => page.items.length)).toEqual([50, 50, 1]);
    expect(defaultPages.flatMap((page) => page.items.map((item) => item.id))).toEqual(all.map((item) => item.id));
    const last = all.at(-1)!;
    const detail = await fetch(`${baseUrl}${path()}/${last.id}`);
    expect(detail.status).toBe(200);
    expect(catalogRegistrationResponseSchema.parse(await detail.json()).item).toEqual({ ...last, impact: { bindingCount: 0, projectCount: 0, projects: [] } });
    const placement = await fetch(`${baseUrl}${path()}/${last.id}/placement`);
    expect(placement.status).toBe(200);
    expect(await placement.json()).toMatchObject({ item: { id: last.placement.id } });
    const decoded = decodeCatalogCursor(page100.nextCursor!);
    if ("malformed" in decoded) throw new Error("public cursor malformed");
    expect(decoded.releaseId).toBe(pin.id);
    expect(decoded.digest).toBe(pin.digest);
    expect(decoded.last).toHaveLength(1);
    const changedPageSize = catalogRegistrationListResponseSchema.parse((await get({ cursor: defaultPages[0]!.nextCursor!, limit: "100" })).body);
    expect(changedPageSize.items).toHaveLength(51);
    expect(changedPageSize.totalCount).toBe(101);
    for (const limit of ["0", "-1", "1.5", "nope", "101", ""]) expect((await get({ limit })).status).toBe(400);
    for (const bad of ["malformed", String(decoded.last[0]), encodeCatalogCursor({ ...decoded, queryFingerprint: "wrong" }),
      encodeCatalogCursor({ ...decoded, last: [] }), encodeCatalogCursor({ ...decoded, last: [""] })]) {
      expect((await get({ cursor: bad })).status).toBe(400);
    }
    for (const bad of [encodeCatalogCursor({ ...decoded, releaseId: "crel_stale" }), encodeCatalogCursor({ ...decoded, digest: "sha256:wrong" })]) {
      expect((await get({ cursor: bad })).status).toBe(409);
    }
    expect((await get({ catalogReleaseId: "crel_stale" })).status).toBe(409);
    expect((await get({}, organizationId, { [CATALOG_RELEASE_HEADER]: "crel_stale" })).status).toBe(409);
    expect((await get({ catalogReleaseId: "crel_stale" }, organizationId, { [CATALOG_RELEASE_HEADER]: pin.id })).status).toBe(409);
    expect((await get({ catalogReleaseId: pin.id }, organizationId, { [CATALOG_RELEASE_HEADER]: pin.id })).status).toBe(200);
    const originalPin = pin;
    pin = { ...pin, digest: `${pin.digest}-changed` as CatalogReleasePin["digest"] };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(409);
    pin = { ...originalPin, id: "crel_changed" as CatalogReleasePin["id"] };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(409);
    pin = originalPin;
    expect((await get({}, emptyOrganizationId)).status).toBe(404);
    const originalScope = scope;
    scope = { ...scope, principalId: "user-other" };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(400);
    scope = { ...originalScope, organizationId: emptyOrganizationId };
    expect((await get({ cursor: page100.nextCursor! }, emptyOrganizationId)).status).toBe(400);
    const empty = catalogRegistrationListResponseSchema.parse((await get({}, emptyOrganizationId)).body);
    expect(empty).toMatchObject({ items: [], totalCount: 0, nextCursor: null, hasMore: false, emptyReason: "no-registrations" });
    scope = originalScope;
    const inner = JSON.parse(Buffer.from(String(decoded.last[0]), "base64url").toString("utf8"));
    const foreignInner = Buffer.from(JSON.stringify({ ...inner, principalId: "user-other" })).toString("base64url");
    expect((await get({ cursor: encodeCatalogCursor({ ...decoded, last: [foreignInner] }) })).status).toBe(400);
    inner.lastId = last.id;
    const exhausted = catalogRegistrationListResponseSchema.parse((await get({ cursor: encodeCatalogCursor({ ...decoded,
      last: [Buffer.from(JSON.stringify(inner)).toString("base64url")] }) })).body);
    expect(exhausted).toMatchObject({ items: [], totalCount: 101, nextCursor: null, hasMore: false, emptyReason: "no-filter-match" });
  });
});
