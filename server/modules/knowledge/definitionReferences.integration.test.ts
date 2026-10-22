import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  installLegacyReferenceFixture,
  type ParameterCatalogDatabase
} from "../../testing/parameterCatalog";
import { registerParameterCatalogApi } from "../parameter-catalog-api/productionWire";
import * as catalogApi from "../parameter-catalog-api/productionWire";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { registerKnowledgeRoutes } from "./routes";
import { createKnowledgeTools } from "../agent/tools/knowledgeTools";
import * as legacyApi from "../parameter-catalog-api/legacy";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import * as referenceScans from "./indexing/referenceSuggestionsEnsure";
import { ApiError } from "../../shared/http/errors";

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
  let catalogRelease: { id: string; digest: string };
  let addCatalogDefinition: (id: string, propertyKey: string) => Promise<{ id: string; digest: string }>;
  let archiveRoot: string;
  let objectStore: ObjectStore;

  beforeAll(async () => {
    fixture = await createDisposableParameterCatalogDatabase("kbdefref");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db);
    if (!pool) throw new Error("Knowledge Definition reference tests require a root PostgreSQL pool.");
    const catalogFixture = await installKnowledgeDefinitionReferencesCatalogFixture(pool, (release) => {
      for (const document of release.documents) {
        if (document.kind !== "definition") continue;
        if (["pdef_kb_batch_28_0", "pdef_kb_batch_29_0"].includes(document.content.id)) {
          document.content.propertyKey = "ambiguous_key";
          document.content.revision.matching.sourceProperty = "ambiguous_key";
        }
        if (document.content.id === "pdef_kb_batch_29_0") {
          document.content.revision.lifecycle = "deprecated";
          document.content.revision.successorDefinitionId = "pdef_kb_batch_29_1";
        }
        if (document.content.id === "pdef_kb_batch_29_1") {
          document.content.propertyKey = "abc";
          document.content.revision.matching.sourceProperty = "abc";
        }
      }
      const template = release.documents.find((document) => document.kind === "definition" && document.content.id === "pdef_kb_batch_0_0");
      if (!template || template.kind !== "definition") throw new Error("Missing definition fixture");
      for (let index = 0; index < 55; index++) {
        const extra = structuredClone(template);
        extra.content.id = `pdef_extra_${index}`;
        extra.content.propertyKey = `extra_property_${index}`;
        extra.content.revision.id = `drev_extra_${index}`;
        extra.content.revision.matching.sourceProperty = extra.content.propertyKey;
        release.documents.push(extra);
      }
    });
    activeDefinitionId = catalogFixture.activeDefinitionId;
    retiredDefinitionId = catalogFixture.retiredDefinitionId;
    searchTerm = catalogFixture.searchTerm;
    searchableDefinitionCount = catalogFixture.searchableDefinitionCount;
    catalogRelease = catalogFixture.pin;
    addCatalogDefinition = catalogFixture.addDefinition;
    archiveRoot = await mkdtemp(join(tmpdir(), "wiseeff-kb903-legacy-archive-"));
    objectStore = createLocalObjectStore(join(archiveRoot, "objects"));
    await pool.query("insert into organizations (id,name) values ($1,'Knowledge A'),($2,'Knowledge B')", [ORG_A, ORG_B]);
    for (const [id, organizationId] of [[USER_A, ORG_A], [USER_B, ORG_B], [REFERENCE_CREATOR, ORG_A]] as const) {
      await pool.query(
        "insert into users (id,organization_id,name,title,is_active) values ($1,$2,$1,'Admin',true)",
        [id, organizationId]
      );
    }

    auth = makeAuth(USER_A, ORG_A);
    authB = makeAuth(USER_B, ORG_B);
    await pool.query("insert into user_role_bindings (id, organization_id, user_id, role_id) values ('k1339-a', $1, $2, 'admin'), ('k1339-b', $3, $4, 'admin'), ('k1339-manager', $1, $5, 'admin')", [ORG_A, USER_A, ORG_B, USER_B, REFERENCE_CREATOR]);
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
    if (archiveRoot) await rm(archiveRoot, { recursive: true, force: true });
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

  it("detects draft property keys without binding them and accepts a suggestion through the governed reference path", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Suggested references", tags: [],
      contentMarkdown: "knowledge_batch_property_0_0 knowledge_batch_property_0_0 (knowledge_batch_property_0_1)"
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    for (let i = 0; i < 100; i++) {
      if (await processNextKnowledgeIndexJob({ db }) === "idle") break;
    }
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    const suggestions = await request(auth, "GET", path);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.items).toEqual([
      expect.objectContaining({ definitionId: "pdef_kb_batch_0_0", propertyKey: "knowledge_batch_property_0_0", displayName: "Knowledge batch property 0-0", mentionCount: 2, detectedRevisionId: created.body.item.headRevisionId }),
      expect.objectContaining({ definitionId: "pdef_kb_batch_0_1", mentionCount: 1 })
    ]);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${id}`)).body.item.parameterReferences).toEqual([]);
    const reader = { ...auth, user: { ...auth.user, id: REFERENCE_CREATOR }, permissions: ["knowledge:view"] as BackendPermission[] };
    expect((await request(reader, "GET", path)).status).toBe(404);
    expect((await request(authB, "GET", path)).status).toBe(404);
    const owner = { ...auth, permissions: auth.permissions.filter((permission) => permission !== "knowledge:manage") };
    const accepted = await request(owner, "POST", `${path}/pdef_kb_batch_0_0/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.item.parameterReferences).toContainEqual(expect.objectContaining({ definitionId: "pdef_kb_batch_0_0" }));
    expect((await request(auth, "GET", path)).body.items).toHaveLength(1);
  });

  async function drainSuggestions() {
    for (let i = 0; i < 150; i++) {
      if (await processNextKnowledgeIndexJob({ db }) === "idle") return;
    }
    throw new Error("Index queue did not drain");
  }

  it("withdraws absent keys and revives only pending or withdrawn suggestions against the head revision", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Current suggestion evidence", tags: [],
      contentMarkdown: "knowledge_batch_property_5_0 knowledge_batch_property_5_1 knowledge_batch_property_5_2"
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    await drainSuggestions();
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_5_1/accept`)).status).toBe(200);
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_5_2/dismiss`)).status).toBe(200);
    expect((await request(auth, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 1, contentMarkdown: "No parameter keys remain."
    })).status).toBe(200);
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toEqual([]);
    const restored = await request(auth, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 2,
      contentMarkdown: "knowledge_batch_property_5_0 knowledge_batch_property_5_0 knowledge_batch_property_5_1 knowledge_batch_property_5_2"
    });
    expect(restored.status).toBe(200);
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toEqual([expect.objectContaining({
      definitionId: "pdef_kb_batch_5_0", mentionCount: 2, detectedRevisionId: restored.body.item.headRevisionId
    })]);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${id}`)).body.item.parameterReferences)
      .toContainEqual(expect.objectContaining({ definitionId: "pdef_kb_batch_5_1" }));
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_5_2/accept`)).status).toBe(409);
  });

  it("hides archived suggestions, skips detection while archived and checks the head on restore", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Archived suggestion evidence", tags: [], contentMarkdown: "knowledge_batch_property_6_0"
    });
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toHaveLength(1);
    const head = await request(auth, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 1, contentMarkdown: "knowledge_batch_property_6_1"
    });
    expect(head.status).toBe(200);
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/publish`)).status).toBe(200);
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/archive`)).status).toBe(200);
    expect((await request(auth, "GET", path)).body.items).toEqual([]);
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toEqual([]);
    // Archived workers must not replace or withdraw any previously detected evidence.
    expect((await db.query("select definition_id, status from knowledge_reference_suggestions where entry_id = $1", [id])).rows)
      .toEqual([{ definition_id: "pdef_kb_batch_6_0", status: "pending" }]);
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/restore`)).status).toBe(200);
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toEqual([expect.objectContaining({
      definitionId: "pdef_kb_batch_6_1", detectedRevisionId: head.body.item.headRevisionId
    })]);
  });

  it("runs detection-only organization rescans for managers, preserves decisions and audits each admin action", async () => {
    const scans = vi.spyOn(referenceScans, "scanKnowledgeReferenceSuggestions");
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Rescan decisions", tags: [],
      contentMarkdown: "knowledge_batch_property_8_0 knowledge_batch_property_8_1 k1340_new_catalog_key"
    });
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    const foreign = await createEntry(authB, "Foreign rescan", false);
    const archived = await createEntry(auth, "Archived rescan");
    await request(auth, "POST", `/api/v1/knowledge/entries/${archived}/archive`);
    await drainSuggestions();
    await request(auth, "POST", `${path}/pdef_kb_batch_8_0/accept`);
    await request(auth, "POST", `${path}/pdef_kb_batch_8_1/dismiss`);
    expect((await request(auth, "GET", path)).body.items).toEqual([]);
    catalogRelease = await addCatalogDefinition("pdef_k1340_new", "k1340_new_catalog_key");
    const rescan = "/api/v1/knowledge/reference-suggestions/rescan";
    const editor = { ...auth, permissions: auth.permissions.filter((permission) => permission !== "knowledge:manage") };
    expect((await request(editor, "POST", rescan)).status).toBe(403);
    expect((await request({ ...auth, permissions: [] }, "POST", rescan)).status).toBe(403);
    const count = await db.query<{ count: string }>("select count(*) from knowledge_entries where organization_id = $1 and status <> 'archived'", [ORG_A]);
    for (let run = 0; run < 2; run++) {
      const indexBefore = await db.query("select * from knowledge_index_status order by entry_id");
      const chunksBefore = await db.query("select * from knowledge_chunks order by id");
      const result = await request(auth, "POST", rescan);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ enqueued: Number(count.rows[0].count) });
      const health = await request(auth, "GET", "/api/v1/knowledge/index/status");
      expect(health.body.items.find((item: { entryId: string }) => item.entryId === id)?.status).toBe("succeeded");
      expect(health.body.items.find((item: { entryId: string }) => item.entryId === archived)?.status).toBe("succeeded");
      const otherHealth = await request(authB, "GET", "/api/v1/knowledge/index/status");
      expect(otherHealth.body.items.find((item: { entryId: string }) => item.entryId === foreign)?.status).toBe("succeeded");
      await scans.mock.results.at(-1)?.value;
      expect((await db.query("select * from knowledge_index_status order by entry_id")).rows).toEqual(indexBefore.rows);
      expect((await db.query("select * from knowledge_chunks order by id")).rows).toEqual(chunksBefore.rows);
      expect((await request(auth, "GET", path)).body.items).toEqual([expect.objectContaining({ definitionId: "pdef_k1340_new" })]);
      expect((await request(auth, "GET", `/api/v1/knowledge/entries/${id}`)).body.item.parameterReferences)
        .toContainEqual(expect.objectContaining({ definitionId: "pdef_kb_batch_8_0" }));
      expect((await request(auth, "POST", `${path}/pdef_kb_batch_8_1/accept`)).status).toBe(409);
    }
    const audits = await db.query<{ metadata: unknown }>(
      "select metadata from audit_events where kind = 'knowledge-reference-suggestions-rescan' and target_id = $1", [ORG_A]
    );
    expect(audits.rows).toEqual([
      { metadata: { enqueued: Number(count.rows[0].count), initiator: "user" } },
      { metadata: { enqueued: Number(count.rows[0].count), initiator: "user" } }
    ]);
    const before = await request(auth, "GET", "/api/v1/knowledge/index/status");
    await db.query(`create function k1340_refuse_rescan_audit() returns trigger language plpgsql as $$
      begin
        if new.kind = 'knowledge-reference-suggestions-rescan' then raise exception 'audit unavailable'; end if;
        return new;
      end $$`);
    await db.query("create trigger k1340_refuse_rescan_audit before insert on audit_events for each row execute function k1340_refuse_rescan_audit()");
    try {
      expect((await request(auth, "POST", rescan)).status).toBe(500);
      expect((await request(auth, "GET", "/api/v1/knowledge/index/status")).body).toEqual(before.body);
    } finally {
      await db.query("drop trigger k1340_refuse_rescan_audit on audit_events");
      await db.query("drop function k1340_refuse_rescan_audit()");
      scans.mockRestore();
    }
  });

  it("backfills undetected heads once across replicas without resetting running workers", async () => {
    const records: Array<{ id: string; context: AuthContext; archived: boolean }> = [];
    for (const [context, status] of [[auth, "draft"], [auth, "published"], [authB, "draft"], [auth, "archived"]] as const) {
      const created = await request(context, "POST", "/api/v1/knowledge/entries", {
        contentForm: "markdown", title: `Legacy ${status}`, tags: [], contentMarkdown: "knowledge_batch_property_10_0"
      });
      expect(created.status).toBe(201);
      const id = created.body.item.id as string;
      if (status !== "draft") await request(context, "POST", `/api/v1/knowledge/entries/${id}/publish`);
      if (status === "archived") await request(context, "POST", `/api/v1/knowledge/entries/${id}/archive`);
      records.push({ id, context, archived: status === "archived" });
    }
    const noMatches = await createEntry(auth, "Legacy without matches", false);
    const running = await createEntry(auth, "Already processing", false);
    const queued = await createEntry(auth, "Already queued", false);
    await drainSuggestions();
    // Model the pre-feature deployment: indexing succeeded but detection never ran.
    const ids = [...records.map((record) => record.id), noMatches, running, queued];
    await db.query("delete from knowledge_reference_suggestions where entry_id = any($1::uuid[])", [ids]);
    await db.query("update knowledge_entries set reference_suggestions_detected_at = null where id = any($1::uuid[])", [ids]);
    await db.query("update knowledge_index_status set status = 'processing', started_at = now() where entry_id = $1", [running]);
    await db.query("update knowledge_index_status set status = 'pending' where entry_id = $1", [queued]);
    const { ensureKnowledgeReferenceSuggestions } = await import("./indexing/referenceSuggestionsEnsure");
    const indexBefore = await db.query("select * from knowledge_index_status order by entry_id");
    const chunksBefore = await db.query("select * from knowledge_chunks order by id");
    const results = await Promise.all([ensureKnowledgeReferenceSuggestions(db), ensureKnowledgeReferenceSuggestions(db)]);
    expect(results.reduce((total, result) => total + result.enqueued, 0)).toBe(6);
    expect((await db.query("select * from knowledge_index_status order by entry_id")).rows).toEqual(indexBefore.rows);
    expect((await db.query("select * from knowledge_chunks order by id")).rows).toEqual(chunksBefore.rows);
    expect((await db.query("select status from knowledge_index_status where entry_id = $1", [running])).rows).toEqual([{ status: "processing" }]);
    await drainSuggestions();
    for (const record of records) {
      const result = await request(record.context, "GET", `/api/v1/knowledge/entries/${record.id}/reference-suggestions`);
      expect(result.body.items).toEqual(record.archived ? [] : [expect.objectContaining({ definitionId: "pdef_kb_batch_10_0" })]);
    }
    // Completing the already claimed worker also completes detection for its head.
    await db.query("update knowledge_index_status set status = 'pending' where entry_id = $1", [running]);
    await drainSuggestions();
    expect(await ensureKnowledgeReferenceSuggestions(db)).toEqual({ enqueued: 0 });
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${noMatches}/reference-suggestions`)).body.items).toEqual([]);
  });

  it("lists pending counts and filters only entries the caller governs, before pagination", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "k1341 counts", tags: [], contentMarkdown: "knowledge_batch_property_8_0"
    });
    const id = created.body.item.id as string;
    await request(auth, "POST", `/api/v1/knowledge/entries/${id}/publish`);
    await drainSuggestions();
    const owner = { ...auth, permissions: auth.permissions.filter((p) => p !== "knowledge:manage") };
    const reader = { ...owner, user: { ...owner.user, id: REFERENCE_CREATOR } };
    const list = (context: AuthContext, query = "") => request(context, "GET", `/api/v1/knowledge/entries?q=k1341%20counts${query}`);
    expect((await list(owner)).body.items).toEqual([expect.objectContaining({ id, pendingSuggestionCount: 1 })]);
    expect((await list(reader)).body.items[0]).not.toHaveProperty("pendingSuggestionCount");
    const readOnlyOwner = { ...owner, permissions: ["knowledge:view"] as BackendPermission[] };
    expect((await list(readOnlyOwner)).body.items[0]).not.toHaveProperty("pendingSuggestionCount");
    expect((await list(readOnlyOwner, "&pendingSuggestions=true")).body.items).toEqual([]);
    expect((await list(reader, "&pendingSuggestions=true")).body.items).toEqual([]);
    expect((await list(owner, "&pendingSuggestions=true&limit=1")).body.items).toHaveLength(1);
    expect((await list(auth, "&pendingSuggestions=true")).body.items).toHaveLength(1);
    expect((await list(authB, "&pendingSuggestions=true")).body.items).toEqual([]);
    await request(auth, "POST", `/api/v1/knowledge/entries/${id}/archive`);
    expect((await list(owner)).body.items[0].pendingSuggestionCount).toBe(0);
    expect((await list(owner, "&pendingSuggestions=true")).body.items).toEqual([]);
    expect((await list(auth, "&pendingSuggestions=true")).body.items).toEqual([]);
    expect((await db.query("select status from knowledge_reference_suggestions where entry_id = $1", [id])).rows).toEqual([{ status: "pending" }]);
    await request(auth, "POST", `/api/v1/knowledge/entries/${id}/restore`);
    await drainSuggestions();
    await request(owner, "POST", `/api/v1/knowledge/entries/${id}/reference-suggestions/pdef_kb_batch_8_0/accept`);
    expect((await list(owner)).body.items[0].pendingSuggestionCount).toBe(0);
    expect((await list(owner, "&pendingSuggestions=true")).body.items).toEqual([]);
  });

  it("batch accepts per entry with identical suggestion audits, mixed permissions and atomic entry rollback", async () => {
    const owner = { ...auth, permissions: auth.permissions.filter((p) => p !== "knowledge:manage") };
    const other = { ...owner, user: { ...owner.user, id: REFERENCE_CREATOR } };
    const ids: string[] = [];
    for (const [context, title] of [[owner, "k1341 first"], [other, "k1341 refused"], [authB, "k1341 foreign"], [owner, "k1341 broken"], [owner, "k1341 last"]] as const) {
      const created = await request(context, "POST", "/api/v1/knowledge/entries", {
        contentForm: "markdown", title, tags: [], contentMarkdown: "knowledge_batch_property_9_0 knowledge_batch_property_9_1"
      });
      ids.push(created.body.item.id);
      await request(context, "POST", `/api/v1/knowledge/entries/${created.body.item.id}/publish`);
    }
    await drainSuggestions();
    await db.query(`create function k1341_fail_accept() returns trigger language plpgsql as $$
      begin if new.kind = 'knowledge-definition-reference-add' and new.metadata->>'definitionId' = 'pdef_kb_batch_9_1'
        and exists (select 1 from knowledge_entries where id::text = new.target_id and title = 'k1341 broken')
        then raise exception 'private failure'; end if; return new; end $$`);
    await db.query("create trigger k1341_fail_accept before insert on audit_events for each row execute function k1341_fail_accept()");
    try {
      const result = await request(owner, "POST", "/api/v1/knowledge/entries/batch", { action: "accept_suggestions", entryIds: ids });
      expect(result.status).toBe(200);
      expect(result.body.results.map((r: any) => [r.status, r.error?.code ?? null])).toEqual([
        ["succeeded", null], ["refused", "FORBIDDEN"], ["refused", "NOT_FOUND"], ["failed", "INTERNAL_ERROR"], ["succeeded", null]
      ]);
      expect(result.body.results[3].error.message).toBe("Internal server error.");
      expect(result.body.summaryError).toBeNull();
      for (const index of [0, 4]) {
        expect((await request(owner, "GET", `/api/v1/knowledge/entries/${ids[index]}`)).body.item.parameterReferences).toHaveLength(2);
        expect((await request(owner, "GET", `/api/v1/knowledge/entries/${ids[index]}/reference-suggestions`)).body.items).toEqual([]);
      }
      expect((await request(owner, "GET", `/api/v1/knowledge/entries/${ids[3]}`)).body.item.parameterReferences).toEqual([]);
      expect((await request(owner, "GET", `/api/v1/knowledge/entries/${ids[3]}/reference-suggestions`)).body.items).toHaveLength(2);
      const audits = await db.query<{ metadata: { fromSuggestion: boolean } }>(
        "select metadata from audit_events where kind = 'knowledge-definition-reference-add' and target_id = any($1::text[])", [ids]);
      expect(audits.rows).toHaveLength(4);
      expect(audits.rows.every((r) => r.metadata.fromSuggestion)).toBe(true);
      const summaries = await db.query<{ metadata: { results: unknown[] } }>(
        "select metadata from audit_events where kind = 'knowledge-batch' and action = 'accept_suggestions' and organization_id = $1", [ORG_A]);
      expect(summaries.rows).toHaveLength(1);
      expect(summaries.rows[0].metadata.results).toHaveLength(5);
      const reader = { ...owner, permissions: ["knowledge:view"] as BackendPermission[] };
      expect((await request(reader, "POST", "/api/v1/knowledge/entries/batch", { action: "accept_suggestions", entryIds: [ids[0]] })).body.results[0].status).toBe("refused");
      const manager = { ...auth, permissions: auth.permissions.filter((p) => p !== "knowledge:edit") };
      expect((await request(manager, "POST", "/api/v1/knowledge/entries/batch", { action: "accept_suggestions", entryIds: [ids[1]] })).body.results[0].status).toBe("succeeded");
    } finally {
      await db.query("drop trigger k1341_fail_accept on audit_events");
      await db.query("drop function k1341_fail_accept()");
    }
  });

  it.each([
    new Error("Catalog read unavailable"),
    new ApiError("UNAUTHENTICATED", "Catalog authentication unavailable"),
    new ApiError("FORBIDDEN", "Catalog access unavailable")
  ])("retains pending evidence and no detected stamp on catalog failure: %s", async (failure) => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Failure preserves evidence", tags: [], contentMarkdown: "knowledge_batch_property_7_0"
    });
    const id = created.body.item.id as string;
    await drainSuggestions();
    const before = await db.query("select * from knowledge_reference_suggestions where entry_id = $1", [id]);
    expect(before.rows).toHaveLength(1);
    await request(auth, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 1, contentMarkdown: "The old key is absent now"
    });
    await db.query("update knowledge_entries set reference_suggestions_detected_at = null where id = $1", [id]);
    const catalogRead = vi.spyOn(catalogApi, "listCatalogDefinitionsForKnowledgeOrganization").mockRejectedValue(failure);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await drainSuggestions();
      expect(catalogRead).toHaveBeenCalledWith(db, ORG_A, expect.any(String));
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("Detection failed"), expect.objectContaining({ entryId: id, error: failure }));
      expect((await db.query("select * from knowledge_reference_suggestions where entry_id = $1", [id])).rows).toEqual(before.rows);
      expect((await db.query("select reference_suggestions_detected_at from knowledge_entries where id = $1", [id])).rows)
        .toEqual([{ reference_suggestions_detected_at: null }]);
      expect((await request(auth, "GET", "/api/v1/knowledge/index/status")).body.items)
        .toContainEqual(expect.objectContaining({ entryId: id, status: "succeeded" }));
    } finally {
      catalogRead.mockRestore();
      warning.mockRestore();
    }
  });

  it("keeps an entry indexed and searchable without suggestions when the catalog read fails", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Non-fatal suggestion detection", tags: [],
      contentMarkdown: "suggestionfailureindexprobe knowledge_batch_property_7_0"
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id as string;
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/publish`)).status).toBe(200);
    const catalogRead = vi.spyOn(catalogApi, "listCatalogDefinitionsForKnowledgeOrganization")
      .mockRejectedValue(new Error("Catalog read unavailable"));
    try {
      await drainSuggestions();
      expect(catalogRead).toHaveBeenCalled();
      const health = await request(auth, "GET", "/api/v1/knowledge/index/status");
      expect(health.status).toBe(200);
      expect(health.body.items).toContainEqual(expect.objectContaining({
        entryId: id, status: "succeeded", error: null, chunkCount: expect.any(Number)
      }));
      expect(health.body.items.find((item: { entryId: string }) => item.entryId === id).chunkCount).toBeGreaterThan(0);
      const search = await request(auth, "GET", "/api/v1/knowledge/search?q=suggestionfailureindexprobe");
      expect(search.status).toBe(200);
      expect(search.body.items).toContainEqual(expect.objectContaining({ entryId: id }));
      expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");
    } finally {
      catalogRead.mockRestore();
    }
    const suggestions = await request(auth, "GET", `/api/v1/knowledge/entries/${id}/reference-suggestions`);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.items).toEqual([]);
  });

  it("detects without an active author, owner, or parameter permission on the author", async () => {
    const id = await createEntry(auth, "Manager maintained suggestions", false);
    const manager = { ...auth, user: { ...auth.user, id: REFERENCE_CREATOR } };
    const revised = await request(manager, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 1, contentMarkdown: "knowledge_batch_property_6_0"
    });
    expect(revised.status).toBe(200);
    await db.query("update users set is_active = false where id = any($1::text[])", [[USER_A, REFERENCE_CREATOR]]);
    try {
      await drainSuggestions();
      const result = await request(manager, "GET", `/api/v1/knowledge/entries/${id}/reference-suggestions`);
      expect(result.status).toBe(200);
      expect(result.body.items).toEqual([expect.objectContaining({ definitionId: "pdef_kb_batch_6_0" })]);
    } finally {
      await db.query("update users set is_active = true where id = any($1::text[])", [[USER_A, REFERENCE_CREATOR]]);
    }
  });

  it("matches case-sensitive whole tokens without a cap, skips short keys, display names, retired and existing references", async () => {
    const key = "knowledge_batch_property_1_0";
    const blocked = [..."Az09_,.+?#-"].flatMap((adjacent) => [`${adjacent}${key}`, `${key}${adjacent}`]);
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Token evidence", tags: [],
      contentMarkdown: [blocked.join(" "), key.toUpperCase(), "abc Knowledge batch property 2-0 knowledge_retired_property",
        ...Array.from({ length: 125 }, () => `(${key})`), "knowledge_batch_property_1_1"].join("\n")
    });
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    await request(auth, "PUT", `/api/v1/knowledge/entries/${id}/definition-references/pdef_kb_batch_1_1`);
    const pool = getRootPostgresPool(db)!;
    const before = await pool.query("select id from audit_events where target_id = $1 order by id", [id]);
    await drainSuggestions();
    const found = await request(auth, "GET", path);
    expect(found.status).toBe(200);
    expect(found.body.items).toEqual([expect.objectContaining({
      definitionId: "pdef_kb_batch_1_0", mentionCount: 125, snippet: expect.stringContaining(`(${key})`), page: null
    })]);
    expect((await pool.query("select id from audit_events where target_id = $1 order by id", [id])).rows).toEqual(before.rows);
    expect((await request({ ...auth, permissions: ["knowledge:view", "knowledge:manage"] }, "GET", path)).status).toBe(403);
    expect((await request({ ...auth, permissions: ["knowledge:view", "knowledge:manage"] }, "POST", `${path}/pdef_kb_batch_1_0/accept`)).status).toBe(403);
  });

  it("keeps ambiguity, deprecated labels and dismissal memory while auditing only governed decisions", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Ambiguous evidence", tags: [], contentMarkdown: "ambiguous_key ambiguous_key"
    });
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    await request(auth, "POST", `/api/v1/knowledge/entries/${id}/publish`);
    await drainSuggestions();
    const items = (await request(auth, "GET", path)).body.items;
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(expect.objectContaining({ definitionId: "pdef_kb_batch_29_0", lifecycle: "deprecated" }));
    const relatedPath = "/api/v1/knowledge/related-to-definition?definitionId=pdef_kb_batch_28_0";
    expect((await request(auth, "GET", relatedPath)).body.items).toEqual([]);
    const reader = { ...auth, user: { ...auth.user, id: REFERENCE_CREATOR }, permissions: ["knowledge:view"] as BackendPermission[] };
    expect((await request(reader, "GET", path)).status).toBe(403);
    for (const action of ["accept", "dismiss"]) {
      expect((await request(reader, "POST", `${path}/pdef_kb_batch_28_0/${action}`)).status).toBe(403);
      expect((await request(authB, "POST", `${path}/pdef_kb_batch_28_0/${action}`)).status).toBe(404);
    }
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_28_0/accept`)).status).toBe(200);
    expect((await request(auth, "GET", relatedPath)).body.items.map((item: { entryId: string }) => item.entryId)).toContain(id);
    expect((await request(auth, "GET", path)).body.items).toEqual([expect.objectContaining({ definitionId: "pdef_kb_batch_29_0" })]);
    await request(auth, "POST", `${path}/pdef_kb_batch_28_0/accept`);
    await request(auth, "POST", `${path}/pdef_kb_batch_29_0/dismiss`);
    await request(auth, "POST", `${path}/pdef_kb_batch_29_0/dismiss`);
    await request(auth, "PATCH", `/api/v1/knowledge/entries/${id}`, {
      expectedHeadRevisionNumber: 1, contentMarkdown: "ambiguous_key ambiguous_key ambiguous_key"
    });
    await drainSuggestions();
    expect((await request(auth, "GET", path)).body.items).toEqual([]);
    const pool = getRootPostgresPool(db)!;
    const audits = await pool.query<{ kind: string; metadata: Record<string, unknown> }>(
      "select kind, metadata from audit_events where target_id = $1 and kind in ('knowledge-definition-reference-add', 'knowledge-reference-suggestion-dismiss') order by kind", [id]
    );
    expect(audits.rows).toEqual([
      { kind: "knowledge-definition-reference-add", metadata: expect.objectContaining({ definitionId: "pdef_kb_batch_28_0", fromSuggestion: true }) },
      { kind: "knowledge-reference-suggestion-dismiss", metadata: expect.objectContaining({ definitionId: "pdef_kb_batch_29_0" }) }
    ]);
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_29_0/accept`)).status).toBe(409);
  });

  it("refuses archived decisions and never exposes evidence across organizations", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Private organization evidence", tags: [], contentMarkdown: "knowledge_batch_property_3_0"
    });
    const id = created.body.item.id as string;
    await drainSuggestions();
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    expect((await request(authB, "GET", path)).status).toBe(404);
    const other = await createEntry(authB, "Other organization evidence", false);
    expect((await request(authB, "GET", `/api/v1/knowledge/entries/${other}/reference-suggestions`)).body.items).toEqual([]);
    // A previously detected definition can retire before the governor acts.
    await db.query(
      `insert into knowledge_reference_suggestions
       (organization_id, entry_id, definition_id, property_key, mention_count, snippet, detected_revision_id)
       values ($1,$2,$3,'knowledge_retired_property',1,'historical detection',$4)`,
      [ORG_A, id, retiredDefinitionId, created.body.item.headRevisionId]
    );
    expect((await request(auth, "POST", `${path}/${retiredDefinitionId}/accept`)).status).toBe(409);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${id}`)).body.item.parameterReferences).toEqual([]);
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/publish`)).status).toBe(200);
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${id}/archive`)).status).toBe(200);
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_3_0/accept`)).status).toBe(400);
    expect((await request(auth, "POST", `${path}/pdef_kb_batch_3_0/dismiss`)).status).toBe(400);
  });

  it("rolls back both acceptance and dismissal when their audit cannot be written", async () => {
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "Atomic suggestion", tags: [], contentMarkdown: "knowledge_batch_property_4_0"
    });
    const id = created.body.item.id as string;
    const path = `/api/v1/knowledge/entries/${id}/reference-suggestions`;
    await drainSuggestions();
    await db.query(`create function k1339_refuse_audit() returns trigger language plpgsql as $$
      begin
        if new.kind in ('knowledge-definition-reference-add','knowledge-reference-suggestion-dismiss')
          and new.target_id in (select id::text from knowledge_entries where title = 'Atomic suggestion')
        then raise exception 'audit unavailable'; end if;
        return new;
      end $$`);
    await db.query("create trigger k1339_refuse_audit before insert on audit_events for each row execute function k1339_refuse_audit()");
    try {
      for (const action of ["accept", "dismiss"]) {
        expect((await request(auth, "POST", `${path}/pdef_kb_batch_4_0/${action}`)).status).toBe(500);
        expect((await request(auth, "GET", path)).body.items).toHaveLength(1);
        expect((await request(auth, "GET", `/api/v1/knowledge/entries/${id}`)).body.item.parameterReferences).toEqual([]);
      }
    } finally {
      await db.query("drop trigger k1339_refuse_audit on audit_events");
      await db.query("drop function k1339_refuse_audit()");
    }
  });

  it("detects property keys in an extracted draft PDF and stores its revision and snippet", async () => {
    const sample = await readFile(new URL("./testing/fixtures/sample.pdf", import.meta.url));
    const key = "knowledge_batch_property_5_0";
    const bytes = Buffer.from(sample.toString().replace(/WiseEff knowledge pdf fixture: thermal derating case/, (text) => key.padEnd(text.length)));
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", {
      contentForm: "file", title: "PDF suggestions", tags: [],
      file: { fileName: "suggestions.pdf", contentType: "application/pdf", contentBase64: bytes.toString("base64") }
    });
    expect(created.status).toBe(201);
    expect(created.body.item.file.extractionStatus).toBe("succeeded");
    await drainSuggestions();
    const result = await request(auth, "GET", `/api/v1/knowledge/entries/${created.body.item.id}/reference-suggestions`);
    expect(result.status).toBe(200);
    expect(result.body.items).toEqual([expect.objectContaining({
      definitionId: "pdef_kb_batch_5_0", propertyKey: key, mentionCount: 1,
      snippet: expect.stringContaining(key), page: 1, detectedRevisionId: created.body.item.headRevisionId
    })]);
    // The shared snapshot reads the PDF extraction's real page-offset column.
    await db.query("update knowledge_files set extracted_text = 'first page ' || extracted_text, page_offsets = array[0, 11] where id = $1 and organization_id = $2", [created.body.item.file.id, ORG_A]);
    const revised = await request(auth, "PATCH", `/api/v1/knowledge/entries/${created.body.item.id}`, {
      expectedHeadRevisionNumber: 1, title: "PDF suggestions with page metadata"
    });
    expect(revised.status).toBe(200);
    await drainSuggestions();
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${created.body.item.id}/reference-suggestions`)).body.items)
      .toEqual([expect.objectContaining({ page: 2, detectedRevisionId: revised.body.item.headRevisionId })]);
  });

  it("returns only published definition-related knowledge and requires knowledge:view", async () => {
    const published = await createEntry(auth, "Published debugging knowledge");
    const draft = await createEntry(auth, "Draft debugging knowledge", false);
    const archived = await createEntry(auth, "Archived debugging knowledge");
    for (const entryId of [published, draft, archived]) {
      const added = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`);
      expect(added.status).toBe(200);
    }
    expect((await request(auth, "POST", `/api/v1/knowledge/entries/${archived}/archive`)).status).toBe(200);
    const path = `/api/v1/knowledge/related-to-definition?definitionId=${activeDefinitionId}`;
    const related = await request(auth, "GET", path);
    expect(related.status).toBe(200);
    const ids = related.body.items.map((item: { entryId: string }) => item.entryId);
    expect(ids).toContain(published);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(archived);
    expect((await request({ ...auth, permissions: ["parameter:view"] }, "GET", path)).status).toBe(403);
  });

  it("offers only governable non-archived entries and enforces governance on the shared reference API", async () => {
    const owner = { ...auth, permissions: auth.permissions.filter((p) => p !== "knowledge:manage") };
    const other = { ...owner, user: { ...owner.user, id: REFERENCE_CREATOR } };
    const own = await createEntry(owner, "k1333 own draft", false);
    const foreign = await createEntry(other, "k1333 other published");
    const archived = await createEntry(owner, "k1333 archived");
    const outside = await createEntry(authB, "k1333 other organization");
    expect((await request(owner, "POST", `/api/v1/knowledge/entries/${archived}/archive`)).status).toBe(200);
    const path = "/api/v1/knowledge/entries?governable=true&q=k1333";
    expect((await request(owner, "GET", path)).body.items.map((e: { id: string }) => e.id)).toEqual([own]);
    const managerIds = (await request(auth, "GET", path)).body.items.map((e: { id: string }) => e.id);
    expect(managerIds.sort()).toEqual([own, foreign].sort());
    expect((await request({ ...owner, permissions: ["knowledge:view"] }, "GET", path)).status).toBe(403);
    const link = (id: string) => `/api/v1/knowledge/entries/${id}/definition-references/${activeDefinitionId}`;
    expect((await request(owner, "PUT", link(foreign))).status).toBe(403);
    expect((await request(owner, "PUT", link(archived))).status).toBe(400);
    expect((await request(owner, "PUT", link(outside))).status).toBe(404);
    expect((await request(owner, "PUT", link(own))).status).toBe(200);
    expect((await request(auth, "PUT", link(foreign))).status).toBe(200);
    const related = await request(owner, "GET", `/api/v1/knowledge/related-to-definition?definitionId=${activeDefinitionId}`);
    expect(related.body.items.map((e: { entryId: string }) => e.entryId)).not.toContain(own);
    expect(related.body.items.map((e: { entryId: string }) => e.entryId)).toContain(foreign);
  });

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
    const history = await installLegacyReferenceFixture(pool, archiveRoot, catalogRelease);
    await pool.query(`insert into knowledge_parameter_references
      (id,organization_id,entry_id,parameter_spec_id,created_by_user_id) values ($1,$2,$3,$4,$5)`,
    [randomUUID(), ORG_A, entryId, history.specId, USER_A]);
    const document = createKnowledgeTools({ db }).find((tool) => tool.name === "knowledge.getDocument")!;
    const readDocument = () => document.run({ auth, requestId: "kb903-legacy-read", sessionId: "kb903" }, { entryId });
    const reference = { kind: "legacy-spec", specId: history.specId };
    const unmapped = await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`);
    expect(unmapped.status).toBe(200);
    expect(unmapped.body.item.parameterReferences).toContainEqual(expect.objectContaining({ ...reference, mappingStatus: "unmapped" }));
    expect((await readDocument()).data.referencedParameters).toContainEqual(expect.objectContaining({ ...reference, mappingStatus: "unmapped" }));

    await history.archive(entryId);
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
      (select jsonb_agg(to_jsonb(a) order by id) from audit_events a) as audits
    `)).rows;
    const before = { knowledge: await snapshot(), history: await history.snapshot() };
    const failure = new Error("simulated legacy lookup PostgreSQL transport failure");
    const injected = vi.spyOn(legacyApi, "lookupLegacyIdentifier").mockRejectedValue(failure);
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
    expect({ knowledge: await snapshot(), history: await history.snapshot() }).toEqual(before);
    // Returned owner failures must cross the actual shared lookup boundary;
    // this simulates a MappingFailure, not a corrupted PostgreSQL record.
    const lookupOwner = legacyApi.lookupLegacyIdentifier;
    const returnedFailure = vi.spyOn(legacyApi, "lookupLegacyIdentifier").mockImplementation((input) =>
      lookupOwner({ ...input, lookup: async () => ({ ok: false, error: {
        code: "PCAT-MAP-WRITE-FAILED", detail: "private mapping failure details"
      } }) }));
    try {
      for (const path of [`/api/v1/knowledge/entries/${entryId}`, "/api/v1/knowledge/entries"]) {
        const failed = await request(auth, "GET", path);
        expect(failed.status).toBe(500);
        expect(failed.body).toMatchObject({ error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: {} } });
        expect(failed.body.item).toBeUndefined();
        expect(JSON.stringify(failed.body)).not.toContain("private mapping failure details");
      }
      await expect(readDocument()).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "Internal server error.", details: {} });
      expect((await request(authB, "GET", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(404);
      expect((await request({ ...auth, roles: [], permissions: [] }, "GET", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(403);
    } finally { returnedFailure.mockRestore(); }
    expect({ knowledge: await snapshot(), history: await history.snapshot() }).toEqual(before);
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
    const entryA = await createEntry(auth, "Org A related entry wp8tenantalpha");
    const entryB = await createEntry(authB, "Org B related entry");
    const addedA = await request(auth, "PUT", `/api/v1/knowledge/entries/${entryA}/definition-references/${activeDefinitionId}`);
    expect(addedA.status).toBe(200);
    const searchQuery = new URLSearchParams({ search: activeDefinitionId, limit: "25" });
    const catalogB = await request(authB, "GET", `/api/v2/catalog/definitions?${searchQuery}`);
    expect(catalogB.status).toBe(200);
    expect(catalogB.body.items).toContainEqual(expect.objectContaining({ id: activeDefinitionId }));
    const definitionB = await request(authB, "GET", `/api/v2/catalog/definitions/${activeDefinitionId}`);
    expect(definitionB.status).toBe(200);
    expect(JSON.stringify(definitionB.body)).not.toContain(entryA);
    expect(JSON.stringify(definitionB.body)).not.toContain(ORG_A);
    const beforeSelectionB = await request(authB, "GET", `/api/v1/knowledge/related-to-definition?definitionId=${activeDefinitionId}`);
    expect(beforeSelectionB.status).toBe(200);
    expect(beforeSelectionB.body.items).toEqual([]);
    const hiddenA = await request(authB, "GET", `/api/v1/knowledge/entries/${entryA}`);
    expect(hiddenA.status).toBe(404);
    for (const path of [
      "/api/v1/knowledge/entries?q=wp8tenantalpha",
      "/api/v1/knowledge/search?q=wp8tenantalpha"
    ]) {
      const visibleEntries = await request(auth, "GET", path);
      expect(visibleEntries.status).toBe(200);
      expect(visibleEntries.body.items).toContainEqual(expect.objectContaining(
        path.startsWith("/api/v1/knowledge/search") ? { entryId: entryA } : { id: entryA }
      ));
      const hiddenEntries = await request(authB, "GET", path);
      expect(hiddenEntries.status).toBe(200);
      expect(hiddenEntries.body.items).toEqual([]);
    }
    const addedB = await request(authB, "PUT", `/api/v1/knowledge/entries/${entryB}/definition-references/${activeDefinitionId}`);
    expect(addedB.status).toBe(200);
    expect(addedB.body.item.parameterReferences).toEqual([expect.objectContaining({
      kind: "definition", definitionId: activeDefinitionId, availability: "current"
    })]);

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
    expect(relatedB.body.items.map((item: { entryId: string }) => item.entryId)).toEqual([entryB]);
    expect(relatedB.body.items.map((item: { entryId: string }) => item.entryId)).toContain(entryB);
    expect(relatedB.body.items.map((item: { entryId: string }) => item.entryId)).not.toContain(entryA);

    const detailB = await request(authB, "GET", `/api/v1/knowledge/entries/${entryB}`);
    expect(detailB.status).toBe(200);
    expect(detailB.body.item.parameterReferences).toEqual(addedB.body.item.parameterReferences);
    expect(JSON.stringify(detailB.body)).not.toContain(entryA);
    expect(JSON.stringify(detailB.body)).not.toContain("pdef_unavailable_private_label");
    const document = createKnowledgeTools({ db }).find((tool) => tool.name === "knowledge.getDocument")!;
    const projectedB = await document.run({ auth: authB, requestId: "kb903-org-b-detail", sessionId: "kb903" }, { entryId: entryB });
    expect(projectedB.data.referencedParameters).toContainEqual(expect.objectContaining({
      kind: "definition", definitionId: activeDefinitionId
    }));
    expect(JSON.stringify(projectedB.data)).not.toContain(entryA);
    expect(JSON.stringify(projectedB.data)).not.toContain("pdef_unavailable_private_label");

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

  it("deletes a human file draft and its revisions once under concurrent requests, retaining shared files, definitions and audit", async () => {
    const bytes = await readFile(new URL("./testing/fixtures/sample.pdf", import.meta.url));
    const input = {
      contentForm: "file",
      title: "Direct draft deletion",
      tags: [],
      file: { fileName: "shared.pdf", contentType: "application/pdf", contentBase64: bytes.toString("base64") }
    };
    const created = await request(auth, "POST", "/api/v1/knowledge/entries", input);
    expect(created.status).toBe(201);
    const entryId = created.body.item.id as string;
    const storageKey = created.body.item.file.storageKey as string;
    const shared = await request(auth, "POST", "/api/v1/knowledge/entries", { ...input, title: "Retained shared file entry" });
    expect(shared.status).toBe(201);
    expect(shared.body.item.file.storageKey).not.toBe(storageKey);
    const pool = getRootPostgresPool(db)!;
    // New uploads own separate objects. Preserve coverage for legacy shared keys
    // by explicitly creating the older, valid metadata state.
    await pool.query("update knowledge_files set storage_key = $1 where entry_id = $2 and organization_id = $3", [storageKey, shared.body.item.id, ORG_A]);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${shared.body.item.id}`)).body.item.file.storageKey).toBe(storageKey);
    expect((await request(auth, "PATCH", `/api/v1/knowledge/entries/${entryId}`, {
      expectedHeadRevisionNumber: 1, title: "Direct draft deletion revised"
    })).status).toBe(200);
    expect((await request(auth, "PUT", `/api/v1/knowledge/entries/${entryId}/definition-references/${activeDefinitionId}`)).status).toBe(200);

    const editor = { ...auth, permissions: auth.permissions.filter((permission) => permission !== "knowledge:manage") };
    expect((await request(editor, "DELETE", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(403);
    expect((await request(authB, "DELETE", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(404);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`)).body.item.status).toBe("draft");

    const results = await Promise.all([
      request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}`),
      request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}`)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 404]);
    expect((await request(auth, "DELETE", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(404);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}`)).status).toBe(404);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}/revisions`)).status).toBe(404);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${entryId}/file/content`)).status).toBe(404);
    expect((await request(auth, "GET", `/api/v1/knowledge/entries/${shared.body.item.id}`)).body.item.file.storageKey).toBe(storageKey);
    expect(await objectStore.get(storageKey)).toEqual(bytes);
    const retainedDefinition = await request(auth, "GET", `/api/v2/catalog/definitions/${activeDefinitionId}`);
    expect(retainedDefinition.status).toBe(200);
    expect(retainedDefinition.body.item.id).toBe(activeDefinitionId);

    const counts = await pool.query<{
      revisions: number; files: number; references: number; deletion_audits: number;
    }>(
      `select
        (select count(*)::int from knowledge_revisions where entry_id = $1) as revisions,
        (select count(*)::int from knowledge_files where entry_id = $1) as files,
        (select count(*)::int from knowledge_definition_references where entry_id = $1) as references,
        (select count(*)::int from audit_events where target_id = $1::text and kind = 'knowledge-entry-delete') as deletion_audits`,
      [entryId]
    );
    expect(counts.rows[0]).toEqual({ revisions: 0, files: 0, references: 0, deletion_audits: 1 });
    const deletionAudit = await pool.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where target_id = $1 and kind = 'knowledge-entry-delete'", [entryId]
    );
    expect(deletionAudit.rows[0].metadata).toMatchObject({ status: "draft", headRevisionNumber: 2, parameterReferenceCount: 1 });
  });
});
