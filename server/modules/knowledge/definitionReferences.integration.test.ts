import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { countLegacySpecsById, seedSpecBindingGraph } from "../../testing/fixtures";
import {
  createDisposableParameterCatalogDatabase,
  installKnowledgeDefinitionReferencesCatalogFixture,
  type ParameterCatalogDatabase
} from "../../testing/parameterCatalog";
import { registerParameterCatalogApi } from "../parameter-catalog-api/productionWire";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import type { ObjectStore } from "../logs/objectStore";
import { registerKnowledgeRoutes } from "./routes";
import { createKnowledgeTools } from "../agent/tools/knowledgeTools";
import { classifyFrozenP0Graph, CLASSIFIER_VERSION, fingerprintP0Graph } from "../catalog-cutover/classifier";
import { FROZEN_P0_GRAPH_FIXTURE } from "../catalog-cutover/classifier/__fixtures__/p0GraphFixture";
import { appendMappingVersion } from "../catalog-cutover/mapping";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_A = "org-kb-definition-a";
const ORG_B = "org-kb-definition-b";
const USER_A = "user-kb-definition-a";
const USER_B = "user-kb-definition-b";
const REFERENCE_CREATOR = "user-kb-definition-ref-creator";
const PERMISSIONS: BackendPermission[] = ["parameter:view", "knowledge:view", "knowledge:edit", "knowledge:manage"];

function makeAuth(userId: string, organizationId: string): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Admin", isActive: true },
    organization: { id: organizationId, name: organizationId },
    roles: [{ roleId: "admin", projectId: null }],
    permissions: PERMISSIONS
  };
}

const objectStore: ObjectStore = {
  async put() {
    throw new Error("file storage is unused by Markdown entries");
  },
  async get() {
    throw new Error("file storage is unused by Markdown entries");
  }
};

describe.skipIf(!databaseAvailable)("Knowledge Definition references over HTTP and real PostgreSQL", () => {
  let fixture: ParameterCatalogDatabase;
  let db: RootDatabase;
  let server: Server;
  let baseUrl: string;
  let auth: AuthContext;
  let authB: AuthContext;
  let activeDefinitionId: string;
  let retiredDefinitionId: string;
  let searchTerm: string;
  let searchableDefinitionCount: number;
  let catalogReleaseId: string;

  beforeAll(async () => {
    fixture = await createDisposableParameterCatalogDatabase("kbdefref");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db);
    if (!pool) throw new Error("Knowledge Definition reference tests require a root PostgreSQL pool.");
    const catalogFixture = await installKnowledgeDefinitionReferencesCatalogFixture(pool);
    activeDefinitionId = catalogFixture.activeDefinitionId;
    retiredDefinitionId = catalogFixture.retiredDefinitionId;
    searchTerm = catalogFixture.searchTerm;
    searchableDefinitionCount = catalogFixture.searchableDefinitionCount;
    catalogReleaseId = catalogFixture.pin.id;
    await pool.query("insert into organizations (id,name) values ($1,'Knowledge A'),($2,'Knowledge B')", [ORG_A, ORG_B]);
    for (const [id, organizationId] of [[USER_A, ORG_A], [USER_B, ORG_B], [REFERENCE_CREATOR, ORG_A]] as const) {
      await pool.query(
        "insert into users (id,organization_id,name,title,is_active) values ($1,$2,$1,'Admin',true)",
        [id, organizationId]
      );
    }

    auth = makeAuth(USER_A, ORG_A);
    authB = makeAuth(USER_B, ORG_B);
    let activeAuth = auth;
    const router = createRouter();
    registerKnowledgeRoutes(router, {
      db,
      objectStore,
      textExtractor: createDefaultKnowledgeTextExtractor(),
      getCurrentAuthContext: () => activeAuth
    });
    registerParameterCatalogApi(router, { db, resolveAuth: () => activeAuth });
    server = createHttpServer(router);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Keep the fixture-owned identity selector server-side, like the auth adapter.
    setCurrentAuth = (context) => {
      activeAuth = context;
    };
  });

  let setCurrentAuth: (context: AuthContext) => void = () => {
    throw new Error("HTTP test server is not initialized");
  };

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await db?.close();
    await fixture?.close();
  });

  async function request(context: AuthContext, method: string, path: string, body?: unknown) {
    setCurrentAuth(context);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  }

  async function createEntry(context: AuthContext, title: string, publish = true) {
    const created = await request(context, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown",
      title,
      tags: ["definition-reference"],
      contentMarkdown: "Canonical Definition reference fixture."
    });
    expect(created.status).toBe(201);
    const entryId = created.body.item.id as string;
    if (publish) {
      const published = await request(context, "POST", `/api/v1/knowledge/entries/${entryId}/publish`);
      expect(published.status).toBe(200);
    }
    return entryId;
  }

  it("writes canonical-only identity, rejects new legacy writes, and audits one idempotent add", async () => {
    const entryId = await createEntry(auth, "Canonical identity");
    const legacy = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/parameter-references/pspec%3Aold`);
    expect(legacy.status).toBe(409);
    expect(legacy.body.error.details.reason).toBe("legacy-reference-write-disabled");

    const withoutCatalogView: AuthContext = {
      ...auth,
      roles: [{ roleId: "hardware-user", projectId: null }],
      permissions: auth.permissions.filter((permission) => permission !== "parameter:view")
    };
    const denied = await request(withoutCatalogView, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
    expect(denied.status).toBe(403);
    const pool = getRootPostgresPool(db)!;
    const deniedRows = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge_definition_references where entry_id = $1",
      [entryId]
    );
    expect(deniedRows.rows[0]?.count).toBe(0);

    const added = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
    expect(added.status).toBe(200);
    const reference = added.body.item.parameterReferences[0];
    expect(reference).toMatchObject({
      kind: "definition",
      definitionId: activeDefinitionId,
      availability: "current",
      lifecycle: "active"
    });
    expect(reference).not.toHaveProperty("specId");

    const repeated = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
    expect(repeated.status).toBe(200);
    expect(repeated.body.item.parameterReferences).toHaveLength(1);
    const counts = await pool.query<{ definition_count: number; legacy_count: number; add_audit_count: number }>(
      `select
         (select count(*)::int from knowledge_definition_references where entry_id = $1) as definition_count,
         (select count(*)::int from knowledge_parameter_references where entry_id = $1) as legacy_count,
         (select count(*)::int from audit_events where target_id = $2 and kind = 'knowledge-definition-reference-add') as add_audit_count`,
      [entryId, entryId]
    );
    expect(counts.rows[0]).toEqual({ definition_count: 1, legacy_count: 0, add_audit_count: 1 });
    expect(await countLegacySpecsById(db, activeDefinitionId)).toBe(0);
  });

  it("keeps existing Spec references readable and deletable while refusing new legacy keys", async () => {
    const entryId = await createEntry(auth, "Legacy history survives", false);
    const legacySpecId = "pspec_knowledge_historical_record";
    const pool = getRootPostgresPool(db)!;
    await seedSpecBindingGraph(db, {
      organizationId: ORG_A,
      specs: [{
        id: legacySpecId,
        sourceKind: "manual",
        specificationKey: `manual/${legacySpecId}/historical_property`
      }]
    });
    await pool.query(
      `insert into knowledge_parameter_references
       (id,organization_id,entry_id,parameter_spec_id,created_by_user_id)
       values ($1,$2,$3,$4,$5)`,
      [randomUUID(), ORG_A, entryId, legacySpecId, USER_A]
    );

    const loaded = await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "legacy-spec",
      specId: legacySpecId,
      historicalOnly: false,
      mappingStatus: "unmapped"
    }));

    const rejected = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/parameter-references/pspec%3Anew`);
    expect(rejected.status).toBe(409);
    const replay = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/parameter-references/${legacySpecId}`);
    expect(replay.status).toBe(200);
    const deleted = await request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}/parameter-references/${legacySpecId}`);
    expect(deleted.status).toBe(200);
    const row = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge_parameter_references where entry_id = $1 and parameter_spec_id = $2",
      [entryId, legacySpecId]
    );
    expect(row.rows[0]?.count).toBe(0);
    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where target_id = $1 and kind = 'knowledge-parameter-reference-remove'`,
      [entryId]
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it("keeps real unmapped and archived history distinct from injected lookup failures on HTTP and Agent reads", async () => {
    const entryId = await createEntry(auth, "Legacy mapping failure boundary");
    const pool = getRootPostgresPool(db)!;
    const graph = {
      ...FROZEN_P0_GRAPH_FIXTURE,
      identities: FROZEN_P0_GRAPH_FIXTURE.identities.map((row) => row.id === "s7cls-lid-r1-status"
        ? { ...row, ownerScopeKind: "organization" as const, ownerScopeId: ORG_A } : row),
      specs: FROZEN_P0_GRAPH_FIXTURE.specs.map((row) => row.id === "s7cls-spec-r1-status"
        ? { ...row, organizationId: ORG_A } : row)
    };
    const identity = graph.identities.find((row) => row.id === "s7cls-lid-r1-status")!;
    await seedSpecBindingGraph(db, {
      organizationId: ORG_A,
      specs: [{ id: identity.sourceId, sourceKind: "dts", specificationKey: "s7cls.r1.status" }]
    });
    await pool.query(`insert into knowledge_parameter_references
      (id,organization_id,entry_id,parameter_spec_id,created_by_user_id) values ($1,$2,$3,$4,$5)`,
    [randomUUID(), ORG_A, entryId, identity.sourceId, USER_A]);
    const document = createKnowledgeTools({ db }).find((tool) => tool.name === "knowledge.getDocument")!;
    const readDocument = () => document.run({ auth, requestId: "kb903-legacy-read", sessionId: "kb903" }, { entryId });
    const reference = { kind: "legacy-spec", specId: identity.sourceId };
    const unmapped = await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(unmapped.status).toBe(200);
    expect(unmapped.body.item.parameterReferences).toContainEqual(expect.objectContaining({ ...reference, mappingStatus: "unmapped" }));
    expect((await readDocument()).data.referencedParameters).toContainEqual(expect.objectContaining({ ...reference, mappingStatus: "unmapped" }));

    // Reuse the S7 classifier/append owner for a real Archive mapping, never a lookup substitute.
    const classified = classifyFrozenP0Graph(graph);
    if (!classified.ok) throw new Error(JSON.stringify(classified.error));
    const fingerprint = fingerprintP0Graph(graph);
    await pool.query(`insert into parameter_catalog.legacy_identities
      (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values ($1,$2,$3,$4,$5,$6)`,
    [identity.id, identity.sourceSystem, identity.sourceKind, identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId]);
    await pool.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values ('kb903-legacy-run',$1,$2,'sha256:kb903-release',$3,'sha256:kb903-plan','P7','running')`,
    [fingerprint, "b".repeat(40), CLASSIFIER_VERSION]);
    await pool.query(`insert into parameter_catalog.parameter_catalog_archives
      (id,legacy_identity_id,owner_scope_kind,owner_scope_id,r_class,reason,source_checksum,graph_checksum,
       encrypted_object_ref,protected_references,cutover_run_id,catalog_release_id,success_audit_ref,retain_until)
      values ('kb903-legacy-archive',$1,$2,$3,'R1','historical compatibility fixture','sha256:kb903-source',$4,
        'object://kb903/history','[]','kb903-legacy-run',$5,'audit-kb903-history','2027-10-01T00:00:00Z')`,
    [identity.id, identity.ownerScopeKind, identity.ownerScopeId, fingerprint, catalogReleaseId]);
    const client = await pool.connect();
    try {
      const archived = await appendMappingVersion({ client, cutoverRunId: "kb903-legacy-run",
        classification: classified.value, identityId: identity.id, sourceChecksum: "sha256:kb903-source",
        expectedHead: null, outcome: { kind: "archived", archiveId: "kb903-legacy-archive" } });
      expect(archived.ok).toBe(true);
    } finally { client.release(); }
    const archived = await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(archived.status).toBe(200);
    expect(archived.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      ...reference, mappingStatus: "archived", historicalOnly: true, canonicalTargetKind: "Archive", canonicalTargetId: null
    }));
    expect((await readDocument()).data.referencedParameters).toContainEqual(expect.objectContaining({
      ...reference, mappingStatus: "archived", historicalOnly: true
    }));

    const snapshot = async () => (await pool.query(`select
      (select jsonb_agg(to_jsonb(e) order by id) from knowledge_entries e) as entries,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_revisions r) as revisions,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_parameter_references r) as legacy_refs,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_definition_references r) as definition_refs,
      (select jsonb_agg(to_jsonb(a) order by id) from audit_events a) as audits,
      (select jsonb_agg(to_jsonb(h) order by legacy_identity_id) from parameter_catalog.legacy_mapping_heads h) as heads,
      (select jsonb_agg(to_jsonb(v) order by id) from parameter_catalog.legacy_mapping_versions v) as mappings
    `)).rows;
    const before = await snapshot();
    const query = pool.query.bind(pool);
    const failure = new Error("simulated legacy lookup PostgreSQL transport failure");
    const injected = vi.spyOn(pool, "query").mockImplementation(((text: string, values?: unknown[]) => {
      if (text.includes("from parameter_catalog.legacy_identities")) throw failure;
      return query(text, values);
    }) as typeof pool.query);
    try {
      for (const path of [`/api/v1/knowledge/entries/${entryId}`, "/api/v1/knowledge/entries"]) {
        const failed = await request(auth, "GET", path);
        expect(failed.status).toBe(500);
        expect(failed.body).toMatchObject({ error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: {} } });
        expect(failed.body.item).toBeUndefined();
      }
      await expect(readDocument()).rejects.toBe(failure);
      expect((await request(authB, "GET", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(404);
      expect((await request({ ...auth, roles: [], permissions: [] }, "GET", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(403);
    } finally { injected.mockRestore(); }
    expect(await snapshot()).toEqual(before);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`)).body.item.parameterReferences)
      .toEqual(archived.body.item.parameterReferences);
  });

  it("rejects new retired Definition references but keeps an exact historical replay", async () => {
    const entryId = await createEntry(auth, "Retired identity", false);
    const pool = getRootPostgresPool(db)!;
    const route = `/api/v1/knowledge/entries/${entryId}/definition-references/${retiredDefinitionId}`;

    const rejected = await request(auth, "PUT", route);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.details.reason).toBe("definition-retired");

    await pool.query(
      `insert into knowledge_definition_references
       (id,organization_id,entry_id,definition_id,created_by_user_id)
       values ($1,$2,$3,$4,$5)`,
      [randomUUID(), ORG_A, entryId, retiredDefinitionId, USER_A]
    );
    const replay = await request(auth, "PUT", route);
    expect(replay.status).toBe(200);
    expect(replay.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "definition",
      definitionId: retiredDefinitionId,
      availability: "current",
      lifecycle: "retired"
    }));
    const audits = await pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where target_id = $1 and kind = 'knowledge-definition-reference-add'`,
      [entryId]
    );
    expect(audits.rows[0]?.count).toBe(0);
  });

  it("keeps reverse lookup tenant-scoped and projects unavailable IDs without catalog labels", async () => {
    const entryA = await createEntry(auth, "Org A related entry");
    const entryB = await createEntry(authB, "Org B related entry");
    for (const [context, entryId] of [[auth, entryA], [authB, entryB]] as const) {
      const added = await request(context, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
      expect(added.status).toBe(200);
    }

    const pool = getRootPostgresPool(db)!;
    await pool.query(
      `insert into knowledge_definition_references
       (id,organization_id,entry_id,definition_id,created_by_user_id)
       values ($1,$2,$3,'pdef_unavailable_private_label',$4)`,
      [randomUUID(), ORG_A, entryA, USER_A]
    );
    const loaded = await request(auth, "GET", `/api/v1/knowledge/entries/${entryA}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "definition",
      definitionId: "pdef_unavailable_private_label",
      availability: "unavailable",
      propertyKey: null,
      displayName: null,
      driverModule: null,
      lifecycle: null
    }));

    const relatedA = await request(auth, "GET", `/api/v1/knowledge/related-to-definition?definitionId=${activeDefinitionId}`);
    const relatedB = await request(authB, "GET", `/api/v1/knowledge/related-to-definition?definitionId=${activeDefinitionId}`);
    expect(relatedA.status).toBe(200);
    expect(relatedA.body.items.map((item: { entryId: string }) => item.entryId)).toContain(entryA);
    expect(relatedA.body.items.map((item: { entryId: string }) => item.entryId)).not.toContain(entryB);
    expect(relatedB.status).toBe(200);
    expect(relatedB.body.items.map((item: { entryId: string }) => item.entryId)).toContain(entryB);
    expect(relatedB.body.items.map((item: { entryId: string }) => item.entryId)).not.toContain(entryA);

    const crossTenant = await request(authB, "PUT", `/api/v1/knowledge/entries/${entryA}/definition-references/${activeDefinitionId}`);
    expect(crossTenant.status).toBe(404);
  });

  it("selects an exact Definition from a later page of a 60-result Catalog search", async () => {
    expect(searchableDefinitionCount).toBeGreaterThan(50);
    const query = new URLSearchParams({ search: searchTerm, limit: "25" });
    const first = await request(auth, "GET", `/api/v2/catalog/definitions?${query}`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(25);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    query.set("cursor", first.body.nextCursor);
    const second = await request(auth, "GET", `/api/v2/catalog/definitions?${query}`);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(25);
    expect(second.body.nextCursor).toEqual(expect.any(String));
    const firstPageIds = new Set(first.body.items.map((item: { id: string }) => item.id));
    const selected = second.body.items[7] as { id: string };
    expect(firstPageIds.has(selected.id)).toBe(false);

    const entryId = await createEntry(auth, "Later page Definition selection", false);
    const added = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${selected.id}`);
    expect(added.status).toBe(200);
    expect(added.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "definition",
      definitionId: selected.id,
      availability: "current"
    }));
  });

  it("deletes reference rows without deleting their audit and preserves ref rows if their creator is removed", async () => {
    const entryId = await createEntry(auth, "Delete and creator history", false);
    const pool = getRootPostgresPool(db)!;
    await pool.query(
      `insert into knowledge_definition_references
       (id,organization_id,entry_id,definition_id,created_by_user_id)
       values ($1,$2,$3,$4,$5)`,
      [randomUUID(), ORG_A, entryId, activeDefinitionId, REFERENCE_CREATOR]
    );

    await pool.query("delete from users where id = $1", [REFERENCE_CREATOR]);
    const author = await pool.query<{
      organization_id: string;
      definition_id: string;
      created_by_user_id: string | null;
    }>(
      "select organization_id, definition_id, created_by_user_id from knowledge_definition_references where entry_id = $1",
      [entryId]
    );
    expect(author.rows).toEqual([{
      organization_id: ORG_A,
      definition_id: activeDefinitionId,
      created_by_user_id: null
    }]);
    const visible = await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(visible.status).toBe(200);
    expect(visible.body.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "definition", definitionId: activeDefinitionId
    }));
    const hidden = await request(authB, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(hidden.status).toBe(404);

    const removed = await request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
    expect(removed.status).toBe(200);
    const repeatedRemoval = await request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
    expect(repeatedRemoval.status).toBe(200);
    const removalAudit = await pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where target_id = $1 and kind = 'knowledge-definition-reference-remove'`,
      [entryId]
    );
    expect(removalAudit.rows[0]?.count).toBe(1);
    const refRows = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge_definition_references where entry_id = $1",
      [entryId]
    );
    expect(refRows.rows[0]?.count).toBe(0);

    const cascadeEntryId = await createEntry(auth, "Hard-delete audit survives", false);
    await pool.query(
      `insert into knowledge_definition_references
       (id,organization_id,entry_id,definition_id,created_by_user_id)
       values ($1,$2,$3,$4,$5)`,
      [randomUUID(), ORG_A, cascadeEntryId, activeDefinitionId, USER_A]
    );
    const deleted = await request(auth, "DELETE", `/api/v1/knowledge/entries/${cascadeEntryId}`);
    expect(deleted.status).toBe(200);
    const deletionAudit = await pool.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_events where target_id = $1 and kind = 'knowledge-entry-delete'`,
      [cascadeEntryId]
    );
    expect(deletionAudit.rows[0]?.metadata).toMatchObject({ parameterReferenceCount: 1 });
    const cascaded = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge_definition_references where entry_id = $1",
      [cascadeEntryId]
    );
    expect(cascaded.rows[0]?.count).toBe(0);
  });
});
