import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { countLegacyProjectBindings, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installLegacyBindingReadFixture } from "../../testing/parameterCatalog/legacyBindingRead";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { parameterListResponseSchema } from "../contracts/dtoSchemas";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLocalObjectStore } from "../logs/objectStore";
import { listCatalogBindingRowsForProject, loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createProject } from "../projects/repository";

const organizationId = "org-1075-compatibility-list";
const projectId = "project-1075-compatibility-list";
const otherProjectId = "project-1075-compatibility-other";
const foreignProjectId = "project-1075-compatibility-foreign";
const adminId = "admin-1075-compatibility-list";
const readerId = "reader-1075-compatibility-list";
const foreignReaderId = "reader-1081-foreign";
const definitionId = "pdef_acme_power_iin_max";
const schemaId = "wiseeff.1075.list";
const admin = makeTestAuthContext({ userId: adminId, organizationId });
const legacyReadIds = {
  mappedId: "10810000-0000-4000-8000-000000000001",
  unmappedId: "10810000-0000-4000-8000-000000000002",
  deniedId: "10810000-0000-4000-8000-000000000003",
  nonBindingId: "10810000-0000-4000-8000-000000000004",
  unmappedInaccessibleId: "10810000-0000-4000-8000-000000000006"
};

describe("#1075 canonical v1 compatibility list", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let bindingId: string;
  let otherBindingId: string;
  let boundModuleId: string;
  let rootModuleId: string;
  let retained: Awaited<ReturnType<typeof installLegacyBindingReadFixture>>;

  beforeEach(() => setParameterIdentityMode("semantic"));

  beforeAll(async () => {
    setParameterIdentityMode("semantic");
    database = await createEphemeralTestDatabase("canonicalcompatlist");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-t1075-compatibility-list-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Compatibility list')", [organizationId]);
    await db.query(`insert into users(id,organization_id,name,title,is_active) values
      ($1,$3,'Compatibility admin','Admin',true),($2,$3,'Compatibility reader','Software',true)`,
    [adminId, readerId, organizationId]);
    await createProject(db, { organizationId, id: projectId, name: "Canonical only", code: "COMPAT1075" });
    await createProject(db, { organizationId, id: otherProjectId, name: "Other canonical", code: "OTHER1075" });
    await db.query("insert into organizations(id,name) values ($1,'Foreign compatibility')", ["org-1075-foreign"]);
    await createProject(db, { organizationId: "org-1075-foreign", id: foreignProjectId, name: "Foreign", code: "FOREIGN1075" });
    await db.query(`insert into users(id,organization_id,name,title,is_active)
      values ($1,'org-1075-foreign','Foreign reader','Software',true)`, [foreignReaderId]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
      values ('1081-foreign-reader',$1,'org-1075-foreign',$2,'software-user')`, [foreignReaderId, foreignProjectId]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values
      ('1075-compat-admin',$1,$3,null,'admin'),('1075-compat-reader',$2,$3,$4,'software-user')`,
    [adminId, readerId, organizationId, projectId]);
    const module = await installConfigurationSourceFixture(db, admin, { subjectId: "csub_1075_compatibility_list", schemaId });
    rootModuleId = module.id;
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Canonical compatibility list requires a published Catalog fixture");
    const identities: string[] = [];
    for (const [index, sourceProjectId] of [projectId, otherProjectId].entries()) {
      const configSet = await createConfigSet(db, admin, { projectId: sourceProjectId, name: "Compatibility JSON" });
      const uploaded = await uploadProjectParameterFile(db, storage, admin, {
        projectId: sourceProjectId, fileName: "settings.json", bytes: Buffer.from(`{"limit":${36.5 + index}}\n`)
      });
      await addConfigSetFile(db, admin, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: sourceProjectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: schemaId, rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `1075-compatibility-source-${index}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      expect(registered.bindings).toHaveLength(1);
      identities.push(registered.bindings[0]!.id);
    }
    [bindingId, otherBindingId] = identities;
    expect(bindingId).toMatch(/^pbind_/);
    expect(await countLegacyProjectBindings(db, { organizationId, projectIds: [projectId, otherProjectId] })).toBe(0);
    boundModuleId = (await listCatalogBindingRowsForProject(db, admin, { projectId }))[0]!.moduleId;
    retained = await installLegacyBindingReadFixture(db, {
      organizationId, moduleId: boundModuleId, projectId, otherProjectId, bindingId, otherBindingId, ...legacyReadIds
    });
  }, 60_000);

  afterAll(async () => {
    setParameterIdentityMode(null);
    await db?.close();
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function observeReads<Result>(operation: () => Promise<Result>) {
    const queries = vi.spyOn(pg.Client.prototype, "query");
    try {
      const result = await operation();
      const reads = queries.mock.calls.map(([query, values]) => ({
        text: typeof query === "string" ? query : query.text,
        values: Array.isArray(values) ? values : []
      }));
      const legacyReads = queries.mock.calls.flatMap(([query]) => {
        const text = typeof query === "string" ? query : query.text;
        return [...text.matchAll(/\b(?:from|join)\s+(?:public\.)?(parameter_specs|parameter_spec_versions|dts_property_specs|project_parameter_bindings|project_parameter_binding_revisions|parameter_definitions|project_parameter_values)\b/gi)]
          .map((match) => match[1]);
      });
      return { result, legacyReads, reads };
    } finally {
      queries.mockRestore();
    }
  }

  it("the assembled canonical source returns the source-owner-created Binding without legacy reads", async () => {
    const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db, objectStore: storage }),
      `/api/v2/projects/${projectId}/parameter-bindings`,
      { headers: { "X-WiseEff-User": readerId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.items).toEqual([expect.objectContaining({ id: bindingId, definitionId, projectId, propertyKey: "iin_max", rawValue: "36.5\n" })]);
    expect(legacyReads).toEqual([]);
  });

  it("the assembled v1 compatibility list returns pbind rows and never reads legacy spec truth", async () => {
    const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db, objectStore: storage }),
      `/api/v1/parameters?projectId=${projectId}`,
      { headers: { "X-WiseEff-User": readerId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect(parameterListResponseSchema.parse(result.body)).toEqual(result.body);
    expect.soft(result.body.items).toEqual([expect.objectContaining({
      id: bindingId, projectId, currentValue: "36.5\n", modulePath: ["Configuration"]
    })]);
    expect.soft(legacyReads).toEqual([]);
  });

  it("the unfiltered assembled v1 compatibility list resolves canonical identity without legacy reads", async () => {
    const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db, objectStore: storage }),
      "/api/v1/parameters",
      { headers: { "X-WiseEff-User": readerId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect.soft(result.body.items).toEqual([expect.objectContaining({ id: bindingId, definitionId })]);
    expect.soft(legacyReads).toEqual([]);
  });

  it("#1081 list, detail and history round-trip the canonical Binding and Project value pins", async () => {
    const server = createWiseEffServer({ db, objectStore: storage });
    const headers = { "X-WiseEff-User": readerId };
    const list = await requestJson<{ items: Array<Record<string, unknown>> }>(
      server, `/api/v1/parameters?projectId=${projectId}`, { headers }
    );
    expect(list.status, list.bodyText).toBe(200);
    const listed = list.body.items[0]!;
    expect(listed.id).toMatch(/^pbind_/);
    const { result: detail, legacyReads: detailReads } = await observeReads(() =>
      requestJson<{ item: Record<string, unknown> }>(server, `/api/v1/parameters/${listed.id}`, { headers })
    );
    expect(detail.status, detail.bodyText).toBe(200);
    expect(detail.body.item).toEqual(listed);
    expect(detail.body.item.sourceFileId).toEqual(expect.any(String));
    expect(detail.body.item.sourceOccurrenceId).toEqual(expect.any(String));
    expect(detailReads).toEqual([]);
    const canonicalHistory = await requestJson<{ items: Array<Record<string, unknown>> }>(
      server, `/api/v2/projects/${projectId}/parameter-bindings/${listed.id}/change-history`, { headers }
    );
    expect(canonicalHistory.status, canonicalHistory.bodyText).toBe(200);
    expect(canonicalHistory.body.items.length).toBeGreaterThan(0);
    const { result: history, legacyReads: historyReads } = await observeReads(() =>
      requestJson<{ items: Array<Record<string, unknown>> }>(server, `/api/v1/parameters/${listed.id}/history`, { headers })
    );
    expect(history.status, history.bodyText).toBe(200);
    expect(history.body).toEqual(canonicalHistory.body);
    expect(history.body.items).toContainEqual(expect.objectContaining({
      bindingId: listed.id, definitionId, newCurrentValueId: listed.currentValueId,
      newDefinitionRevisionId: listed.effectiveRevisionId
    }));
    expect(historyReads).toEqual([]);
  });

  it("#1081 refuses cross-project detail and history before reading values", async () => {
    const server = createWiseEffServer({ db, objectStore: storage });
    for (const suffix of ["", "/history"]) {
      const { result, reads } = await observeReads(() => requestJson(
        server, `/api/v1/parameters/${otherBindingId}${suffix}`, { headers: { "X-WiseEff-User": readerId } }
      ));
      expect.soft(result.status, result.bodyText).toBe(403);
      expect.soft(reads.filter(({ text }) => /(?:from|join) parameter_catalog\.(?:project_parameter_values|binding_history_events)/.test(text))).toEqual([]);
    }
  });

  it("#1081 missing and cross-tenant canonical identities stay hidden on both reads", async () => {
    const server = createWiseEffServer({ db, objectStore: storage });
    for (const [parameterId, userId] of [["pbind_missing", readerId], [bindingId, foreignReaderId]]) {
      for (const suffix of ["", "/history"]) {
        const { result, legacyReads } = await observeReads(() => requestJson(server,
          `/api/v1/parameters/${parameterId}${suffix}`, { headers: { "X-WiseEff-User": userId } }
        ));
        expect(result.status, result.bodyText).toBe(404);
        expect(result.bodyText).not.toContain("36.5");
        expect(legacyReads).toEqual([]);
      }
    }
  });

  it("#1081 old UUIDs require an exact typed Binding mapping, ignoring another source kind with the same UUID", async () => {
    const { mappedId, unmappedId, deniedId, nonBindingId } = legacyReadIds;
    const server = createWiseEffServer({ db, objectStore: storage });
    const headers = { "X-WiseEff-User": readerId };
    for (const suffix of ["", "/history"]) {
      const canonical = await requestJson(server, `/api/v1/parameters/${bindingId}${suffix}`, { headers });
      const { result: mapped, legacyReads } = await observeReads(() => requestJson(server, `/api/v1/parameters/${mappedId}${suffix}`, { headers }));
      expect.soft(mapped.status, mapped.bodyText).toBe(200);
      expect.soft(mapped.body).toEqual(canonical.body);
      expect.soft(legacyReads).toEqual([]);
      const unmapped = await requestJson(server, `/api/v1/parameters/${unmappedId}${suffix}`, { headers });
      expect.soft(unmapped.status, unmapped.bodyText).toBe(410);
      expect.soft(unmapped.body).toMatchObject({ error: { code: "GONE", details: { successor: "/api/v2/catalog", retryable: false } } });
      expect.soft(unmapped.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
      expect.soft(unmapped.bodyText).not.toContain("legacy-value-never-returned");
      for (const id of [nonBindingId, "10810000-0000-4000-8000-000000000005"]) {
        const refused = await requestJson(server, `/api/v1/parameters/${id}${suffix}`, { headers });
        expect.soft(refused.status, refused.bodyText).toBe(410);
        expect.soft(refused.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
        expect.soft(refused.bodyText).not.toContain("legacy-value-never-returned");
      }
      const { result: denied, reads: deniedReads } = await observeReads(() => requestJson(server, `/api/v1/parameters/${deniedId}${suffix}`, { headers }));
      expect.soft(denied.status, denied.bodyText).toBe(403);
      expect.soft(deniedReads.filter(({ text }) => /(?:from|join) parameter_catalog\.(?:project_parameter_values|binding_history_events)/.test(text))).toEqual([]);
      const foreign = await requestJson(server, `/api/v1/parameters/${mappedId}${suffix}`, { headers: { "X-WiseEff-User": foreignReaderId } });
      expect.soft(foreign.status, foreign.bodyText).toBe(410);
      expect.soft(foreign.bodyText).not.toContain(bindingId);
    }
    expect(await retained.readRetainedValue())
      .toEqual([{ raw_value: "legacy-value-never-returned" }]);
  });

  it("#1081 unmapped UUIDs in inaccessible projects return historical 410 before project scope", async () => {
    const unmappedId = legacyReadIds.unmappedInaccessibleId;
    const server = createWiseEffServer({ db, objectStore: storage });
    for (const suffix of ["", "/history"]) {
      const { result, reads } = await observeReads(() => requestJson(
        server, `/api/v1/parameters/${unmappedId}${suffix}`, { headers: { "X-WiseEff-User": readerId } }
      ));
      expect.soft(result.status, result.bodyText).toBe(410);
      expect.soft(result.body).toMatchObject({ error: { code: "GONE", details: { successor: "/api/v2/catalog", retryable: false } } });
      expect.soft(result.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
      expect.soft(reads.filter(({ text }) => /(?:from|join) parameter_catalog\.(?:project_parameter_values|binding_history_events)/.test(text))).toEqual([]);
    }
  });

  it("an organization-wide reader lists both actual projects and applies the global limit", async () => {
    for (const [suffix, expectedIds] of [["", [bindingId, otherBindingId]], ["?limit=1", [bindingId]]] as const) {
      const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
        createWiseEffServer({ db, objectStore: storage }), `/api/v1/parameters${suffix}`,
        { headers: { "X-WiseEff-User": adminId } }
      ));
      expect(result.status, result.bodyText).toBe(200);
      expect(result.body.items.map((item) => item.id)).toEqual(expectedIds);
      expect(legacyReads).toEqual([]);
    }
  });

  it("marks unsupported canonical compatibility metadata explicitly unavailable", async () => {
    const result = await requestJson<{ items: Array<Record<string, unknown>> }>(
      createWiseEffServer({ db, objectStore: storage }), `/api/v1/parameters?projectId=${projectId}`,
      { headers: { "X-WiseEff-User": readerId } }
    );
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.items).toEqual([expect.objectContaining({
      id: bindingId, recommendedValue: null, range: null, unit: null, risk: null,
      updatedAt: null, updatedAtTs: null, history: null,
      metadataAvailability: { status: "unavailable", reason: "canonical-compatibility-metadata-unavailable" }
    })]);
  });

  it("bounds canonical value materialization and does not visit later projects once limit is met", async () => {
    const { result, reads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db, objectStore: storage }), "/api/v1/parameters?limit=1",
      { headers: { "X-WiseEff-User": adminId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.items.map((item) => item.id)).toEqual([bindingId]);
    expect(reads.filter(({ text }) => /order by created_at asc, id asc/.test(text))).toHaveLength(1);
    expect(reads.filter(({ text, values }) =>
      /from parameter_catalog\.current_project_parameter_bindings/.test(text) && values.includes(otherProjectId)
    )).toEqual([]);
  });

  it.each([
    [otherProjectId, 403],
    [foreignProjectId, 404]
  ])("refuses the unauthorized project %s with %s", async (requestedProjectId, status) => {
    const { result, legacyReads } = await observeReads(() => requestJson(
      createWiseEffServer({ db, objectStore: storage }), `/api/v1/parameters?projectId=${requestedProjectId}`,
      { headers: { "X-WiseEff-User": readerId } }
    ));
    expect(result.status, result.bodyText).toBe(status);
    expect(legacyReads).toEqual([]);
  });

  it.each([
    ["q=IIN_MAX", true],
    ["q=INPUT%20CURRENT", true],
    ["q=unrelated", false],
    ["risk=Low", false],
    ["risk=High", false],
    ["risk=High&risk=Low", false],
    ["module=Configuration", true],
    ["module=unrelated", false]
  ])("preserves the canonical compatibility filter %s", async (query, matches) => {
    const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db, objectStore: storage }), `/api/v1/parameters?projectId=${projectId}&${query}`,
      { headers: { "X-WiseEff-User": readerId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.items.map((item) => item.id)).toEqual(matches ? [bindingId] : []);
    expect(legacyReads).toEqual([]);
  });

  it("preserves exact module and subtree selection without a legacy Binding projection", async () => {
    for (const [moduleId, includeDescendants, matches] of [
      [boundModuleId, false, true],
      [rootModuleId, true, true],
      [rootModuleId, false, rootModuleId === boundModuleId],
      ["module-outside-organization", true, false]
    ] as const) {
      const { result, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string }> }>(
        createWiseEffServer({ db, objectStore: storage }),
        `/api/v1/parameters?projectId=${projectId}&moduleId=${moduleId}&includeDescendants=${includeDescendants}`,
        { headers: { "X-WiseEff-User": readerId } }
      ));
      expect(result.status, result.bodyText).toBe(200);
      expect(result.body.items.map((item) => item.id)).toEqual(matches ? [bindingId] : []);
      expect(legacyReads).toEqual([]);
    }
  });

  it("batches exact source locators and respects project-local limits before value materialization", async () => {
    const limitedProjectId = "project-1075-compatibility-batched";
    await createProject(db, { organizationId, id: limitedProjectId, name: "Batched canonical", code: "BATCH1075" });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Batched compatibility fixture requires a published Catalog");
    const ids: string[] = [];
    const fileIds: string[] = [];
    for (const index of [0, 1, 2]) {
      const configSet = await createConfigSet(db, admin, { projectId: limitedProjectId, name: `Batched JSON ${index}` });
      const uploaded = await uploadProjectParameterFile(db, storage, admin, {
        projectId: limitedProjectId, fileName: `settings-${index}.json`, bytes: Buffer.from(`{"limit":${40 + index}}\n`)
      });
      fileIds.push(uploaded.file.id);
      await addConfigSetFile(db, admin, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId: limitedProjectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: schemaId, rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `1075-batched-source-${index}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      ids.push(registered.bindings[0]!.id);
    }
    const { result, reads, legacyReads } = await observeReads(() => requestJson<{ items: Array<{ id: string; sourceFileId: string }> }>(
      createWiseEffServer({ db, objectStore: storage }), `/api/v1/parameters?projectId=${limitedProjectId}&limit=2`,
      { headers: { "X-WiseEff-User": adminId } }
    ));
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.items.map((item) => item.id)).toEqual([...ids].sort().slice(0, 2));
    for (const item of result.body.items) expect(item.sourceFileId).toBe(fileIds[ids.indexOf(item.id)]);
    expect.soft(reads.filter(({ text }) => /order by created_at asc, id asc/.test(text))).toHaveLength(2);
    expect.soft(reads.filter(({ text }) => /as node_locator/.test(text) && /source_pin/.test(text))).toHaveLength(1);
    expect(legacyReads).toEqual([]);
  });
});
