import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { getAuthContext } from "../auth/repository";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { createLocalObjectStore } from "../logs/objectStore";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createEvidenceIngest } from "../parameter-governance/evidence";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "../../../src/domain/parameters/projectDeletionPreview";

const home = "workbench-home", target = "workbench-target", secret = "operating-workbench-test-only";
const token = (userId: string, organizationId = home) => {
  const payload = Buffer.from(JSON.stringify({ iss: "workbench-scope", sub: userId, org: organizationId, exp: 9_999_999_999 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};

describe("Operating Organization configuration workbench over real HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: ReturnType<typeof createPostgresDatabase>;
  let directory: string, server: ReturnType<typeof createWiseEffServer>, store: ReturnType<typeof createLocalObjectStore>;
  const auth = { mode: "production" as const, verifier: createTokenVerifier({ issuer: "workbench-scope", secret }) };
  const scope = (path: string) => `${path}${path.includes("?") ? "&" : "?"}organizationId=${target}`;
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token("platform"), headers: Record<string, string> = {}) => requestJson<T>(server, path, {
    method, headers: { Authorization: `Bearer ${bearer}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("operatingworkbench"); db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-operating-workbench-"));
    setParameterIdentityMode("semantic");
    await seedCoreGraph(db, { organization: { id: home, name: "Home" }, users: [{ id: "platform" }, { id: "ordinary-admin" }], projects: [{ id: "home-project" }] });
    await seedCoreGraph(db, { organization: { id: target, name: "Target" }, users: [{ id: "target-admin" }], projects: [{ id: "target-project" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('platform-role','platform',$1,'platform-admin'),('ordinary-role','ordinary-admin',$1,'admin'),('target-role','target-admin',$2,'admin')`, [home, target]);
    await installConfigurationSourceFixture(db, await getAuthContext(db, "target-admin"), { subjectId: "csub_operating_workbench", schemaId: "wiseeff.operating.workbench" });
    store = createLocalObjectStore(directory);
    server = createWiseEffServer({ db, objectStore: store, env: { AUTH_PROVIDER: "hmac" }, auth });
  });
  afterAll(async () => { setParameterIdentityMode(null); await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it("uploads, registers, reads raw source and exports only the target configuration with the real actor", async () => {
    const fileRoute = scope("/api/v1/projects/target-project/parameter-files");
    const upload = await request<{ item: { id: string }; version: { id: string } }>(fileRoute, "POST", { fileName: "settings.json", contentBase64: Buffer.from('{"limit":12}').toString("base64") });
    expect(upload.status).toBe(201);
    const { item: file, version } = upload.body;
    const config = await request<{ item: { id: string } }>(scope("/api/v1/projects/target-project/config-sets"), "POST", { name: "Release" });
    expect(config.status).toBe(201);
    expect((await request(scope(`/api/v1/projects/target-project/config-sets/${config.body.item.id}/files`), "POST", { fileId: file.id, role: "base", sortOrder: 0 })).status).toBe(201);
    const registration = await request(scope(`/api/v2/projects/target-project/parameter-files/${file.id}/configuration-instances`), "POST", {
      configSetId: config.body.item.id, fileVersionId: version.id, configurationSchemaId: "wiseeff.operating.workbench", rootPointer: "",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }]
    });
    expect(registration.status).toBe(201);
    const bindings = await request<{ items: Array<{ id: string }> }>(scope("/api/v2/projects/target-project/parameter-bindings"));
    expect(bindings.status, bindings.bodyText).toBe(200);
    expect(bindings.body.items).toHaveLength(1);
    const bindingExport = await request(scope(`/api/v2/projects/target-project/parameter-bindings/${bindings.body.items[0]!.id}/export`));
    expect(bindingExport.status, bindingExport.bodyText).toBe(200);
    const raw = scope(`/api/v1/projects/target-project/parameter-files/${file.id}/versions/${version.id}/content`);
    expect(await request(raw)).toMatchObject({ status: 200, body: { limit: 12 } });
    expect((await request(raw, "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    expect((await request(`/api/v1/projects/target-project/parameter-files/${file.id}/versions/${version.id}/content`)).status).toBe(404);
    const exported = await request<{ files: Array<{ name: string; content: string }> }>(scope(`/api/v1/projects/target-project/config-sets/${config.body.item.id}/export`));
    expect(exported.status).toBe(200);
    expect(exported.body.files).toContainEqual(expect.objectContaining({ name: "settings.json", content: expect.stringContaining('"limit"') }));
    const audit = await request<{ items: Array<Record<string, unknown>> }>(scope("/api/v1/audit-events"));
    expect(audit.status).toBe(200);
    expect((await request(scope("/api/v1/audit-events"), "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    expect(audit.body.items).toContainEqual(expect.objectContaining({ actorUserId: "platform", organizationId: target, metadata: expect.objectContaining({ actorHomeOrganizationId: home, operatingOrganizationId: target }) }));
  });
  it("lets the real platform administrator retire and restore target registrations while keeping the Catalog shared", async () => {
    const list = await request<{ items: Array<{ id: string; catalogReleaseId: string }> }>(`/api/v2/organizations/${target}/subject-registrations`);
    expect(list.status, list.bodyText).toBe(200);
    const registration = list.body.items[0]!;
    const subjectPath = "/api/v2/catalog/subjects/csub_operating_workbench";
    const projected = await request<{ item: { registration: { status: string } } }>(scope(subjectPath));
    expect(projected.status, projected.bodyText).toBe(200);
    expect(projected.body.item.registration.status).toBe("active");
    expect((await request<{ item: { registration: { status: string } } }>(subjectPath)).body.item.registration.status).toBe("unregistered");
    expect((await request(scope(subjectPath), "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    const definitionPath = "/api/v2/catalog/definitions/pdef_acme_power_iin_max";
    type DefinitionProjection = { registration: { status: string }; usageSummary: unknown } & Record<string, unknown>;
    const targetDefinition = await request<{ item: DefinitionProjection }>(scope(definitionPath));
    const homeDefinition = await request<{ item: DefinitionProjection }>(definitionPath);
    expect(targetDefinition.status, targetDefinition.bodyText).toBe(200);
    expect(homeDefinition.status, homeDefinition.bodyText).toBe(200);
    const { registration: targetRegistration, usageSummary: targetUsage, ...targetShared } = targetDefinition.body.item;
    const { registration: homeRegistration, usageSummary: homeUsage, ...homeShared } = homeDefinition.body.item;
    expect(targetShared).toEqual(homeShared);
    expect(targetRegistration.status).toBe("active");
    expect(homeRegistration.status).toBe("unregistered");
    expect(targetUsage).not.toEqual(homeUsage);
    expect((await request(scope(definitionPath), "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    expect(targetDefinition.headers.get("etag")).toBeNull();
    const registry = await request<{ item: { modules: Array<{ id: string }> } }>(scope("/api/v2/parameter-modules"));
    expect(registry.status, registry.bodyText).toBe(200);
    const targetModules = await db.query<{ id: string }>("select id from parameter_modules where organization_id=$1", [target]);
    expect(registry.body.item.modules.map((item) => item.id)).toEqual(expect.arrayContaining(targetModules.rows.map((item) => item.id)));
    expect((await request(scope("/api/v2/parameter-modules"), "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    const discovery = await request(`/api/v2/organizations/${target}/driver-compatible-discovery`);
    expect(discovery.status, discovery.bodyText).toBe(200);
    const base = `/api/v2/organizations/${target}/subject-registrations/${registration.id}`;
    const detail = await request(base);
    const headers = { "X-WiseEff-Catalog-Release": registration.catalogReleaseId, "Idempotency-Key": "operating-retire", "If-Match": detail.headers.get("etag")! };
    const denied = await request(`${base}/retire`, "POST", { reason: "Target organization cleanup" }, token("ordinary-admin"), headers);
    expect(denied.status, denied.bodyText).toBe(403);
    await db.query(`create function public.refuse_operating_registration_audit() returns trigger language plpgsql as $$
      begin raise exception using errcode='23514',message='Injected registration audit failure'; end $$;
      create trigger refuse_operating_registration_audit before insert on public.audit_events
        for each row when (new.kind='parameter-catalog-registration') execute function public.refuse_operating_registration_audit()`);
    try {
      const failed = await request(`${base}/retire`, "POST", { reason: "Target organization cleanup" }, token("platform"), headers);
      expect(failed.status).toBe(500);
      expect((await db.query("select status from parameter_catalog.organization_subject_registrations where id=$1", [registration.id])).rows).toEqual([{ status: "active" }]);
      expect((await db.query("select idempotency_key from parameter_catalog.governance_command_idempotency where organization_id=$1 and idempotency_key='operating-retire'", [target])).rows).toEqual([]);
    } finally {
      await db.query("drop trigger refuse_operating_registration_audit on public.audit_events; drop function public.refuse_operating_registration_audit()");
    }
    const retired = await request<{ item: { status: string; organizationId: string } }>(`${base}/retire`, "POST", { reason: "Target organization cleanup" }, token("platform"), headers);
    expect(retired.status, retired.bodyText).toBe(200);
    expect(retired.body.item).toMatchObject({ status: "retired", organizationId: target });
    const restored = await request<{ item: { status: string } }>(`${base}/restore`, "POST", { reason: "Continue target work" }, token("platform"), { ...headers, "If-Match": retired.headers.get("etag")!, "Idempotency-Key": "operating-restore" });
    expect(restored.status, restored.bodyText).toBe(200);
    expect(restored.body.item.status).toBe("active");
    expect((await request(`${base}/restore`, "POST", { reason: "Continue target work" }, token("platform"), { ...headers, "If-Match": retired.headers.get("etag")!, "Idempotency-Key": "operating-restore" })).status).toBe(200);
    const registrationAudits = await request<{ items: Array<Record<string, unknown>> }>(scope("/api/v1/audit-events?kind=parameter-catalog-registration"));
    expect(registrationAudits.body.items).toHaveLength(2);
    expect(registrationAudits.body.items).toEqual(expect.arrayContaining(["retire", "restore"].map((action) => expect.objectContaining({
      actorUserId: "platform", organizationId: target, action: `registration-${action}`,
      metadata: expect.objectContaining({ actorHomeOrganizationId: home, operatingOrganizationId: target })
    }))));
    expect((await db.query("select id from parameter_catalog.catalog_subjects where id='csub_operating_workbench'")).rows).toEqual([{ id: "csub_operating_workbench" }]);
  });

  it("resolves target discovery with the actual platform actor and does not duplicate its audit on replay", async () => {
    const pool = getRootPostgresPool(db)!;
    const pin = (await captureCurrentCatalogPin(pool))!;
    const evidence = await createEvidenceIngest(pool).ingest({ organizationId: target, sourceIdentity: "operating-target-evidence",
      catalogReleaseId: pin.id, matcherRevision: "operating-matcher-1", matcherOutput: { status: "unknown" },
      evidence: { propertyKey: "operating-unrecognized" }, provenance: null });
    expect(evidence.ok).toBe(true);
    const base = `/api/v2/organizations/${target}/parameter-review-items`;
    const list = await request<{ items: Array<{ id: string }> }>(base);
    expect(list.status, list.bodyText).toBe(200);
    const item = list.body.items[0]!;
    const detail = await request(`${base}/${item.id}`);
    expect(detail.status, detail.bodyText).toBe(200);
    const headers = { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": "target-discovery-resolution", "If-Match": detail.headers.get("etag")! };
    const body = { resolution: { type: "mark-out-of-scope" }, reason: "Outside this target organization" };
    expect((await request(`${base}/${item.id}/resolve`, "POST", body, token("ordinary-admin"), headers)).status).toBe(403);
    const resolved = await request(`${base}/${item.id}/resolve`, "POST", body, token("platform"), headers);
    expect(resolved.status, resolved.bodyText).toBe(200);
    expect((await request(`${base}/${item.id}/resolve`, "POST", body, token("platform"), headers)).status).toBe(200);
    const rows = await db.query<{ actor_user_id: string; metadata: Record<string, unknown> }>(
      "select actor_user_id,metadata from audit_events where organization_id=$1 and target_id=$2 and action='review-item-resolved'", [target, item.id]);
    expect(rows.rows).toEqual([{ actor_user_id: "platform", metadata: expect.objectContaining({ actorHomeOrganizationId: home, operatingOrganizationId: target }) }]);
    expect((await db.query("select accountable_principal_id from parameter_catalog.parameter_review_resolutions where review_item_id=$1", [item.id])).rows).toEqual([{ accountable_principal_id: "platform" }]);
  });

  it("keeps a target deletion receipt available after project deletion and retries failed object cleanup without borrowing an identity", async () => {
    expect((await request(scope("/api/v1/parameters/admin/projects"), "POST", { id: "purge-project", name: "Purge", code: "PURGE" })).status).toBe(201);
    expect((await request(scope("/api/v1/projects/purge-project/parameter-files"), "POST", { fileName: "obsolete.json", contentBase64: Buffer.from('{"limit":7}').toString("base64") })).status).toBe(201);
    const base = "/api/v1/parameters/admin/projects/purge-project";
    const preview = await request<{ item: ProjectDeletionPreview }>(scope(`${base}/deletion-preview`));
    expect(preview.status).toBe(200);
    expect((await request(scope(`${base}/deletion-preview`), "GET", undefined, token("ordinary-admin"))).status).toBe(403);
    const catalogBefore = await db.query("select id from parameter_catalog.catalog_subjects order by id");
    server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth, objectStore: { ...store, delete: async () => { throw new Error("Object store temporarily unavailable"); } } });
    try {
      const purged = await request<{ item: ProjectDeletionStatus }>(scope(`${base}/purge`), "POST", { stateDigest: preview.body.item.stateDigest });
      expect(purged.status).toBe(200);
      expect(purged.body.item).toMatchObject({ database: "deleted", objects: "pending" });
      expect((await request<{ item: ProjectDeletionStatus }>(scope(`${base}/deletion-status`))).body.item).toMatchObject({ database: "deleted", objects: "pending" });
      const receipts = await request<{ items: ProjectDeletionStatus[] }>(scope("/api/v1/parameters/admin/project-deletions"));
      expect(receipts.body.items).toContainEqual(expect.objectContaining({ projectId: "purge-project" }));
    } finally { server = createWiseEffServer({ db, objectStore: store, env: { AUTH_PROVIDER: "hmac" }, auth }); }
    const retried = await request<{ item: ProjectDeletionStatus }>(scope(`${base}/purge`), "POST", { stateDigest: preview.body.item.stateDigest });
    expect(retried.status).toBe(200);
    expect(retried.body.item).toMatchObject({ database: "deleted", objects: "complete", pendingObjects: 0 });
    expect((await db.query("select id from parameter_catalog.catalog_subjects order by id")).rows).toEqual(catalogBefore.rows);
    expect((await db.query("select id from projects order by id")).rows).toEqual([{ id: "home-project" }, { id: "target-project" }]);
  });
});
