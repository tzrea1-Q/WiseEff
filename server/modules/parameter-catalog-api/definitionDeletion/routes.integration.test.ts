import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { requestJson } from "../../../test/testClient";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createDefinitionDeletionFixture, DELETION_ACTORS, DELETION_ORGANIZATIONS } from "../../../testing/parameterCatalog/definitionDeletion";
import { X_DEFINITION_ID, Y_DEFINITION_ID } from "../../catalog-kernel/runtime/catalogChain.fixture";
import { createSourceBackedBindingService } from "../../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { ParameterDefinitionId } from "../../parameter-catalog-contract/index";
import { archiveDigestOf, type ArchivedPlaneDocument } from "../../parameter-bindings/seedInitialization/archive";
import { catalogDefinitionDeletedResponseSchema, catalogDefinitionDeletionPreviewResponseSchema } from "../../contracts/dtoSchemas/parameterDefinitionDeletion";
import type { ObjectStore } from "../../logs/objectStore";
import { connect } from "../../catalog-kernel/install/publicationTestHarness";
import { enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { integerContent } from "../../catalog-publication/builder/predecessorHarness";
import { CATALOG_RELEASE_HEADER, catalogPublicationJobResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

type ErrorBody = { error: { code: string; details: { reason?: string } } };
const hash = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("permanent definition deletion through the authenticated API LOGIN", () => {
  let fixture: Awaited<ReturnType<typeof createDefinitionDeletionFixture>>;
  let pendingPublicationId: string;
  let originalApproval: unknown[];
  const path = (id: string) => `/api/v2/catalog/definitions/${id}`;
  const request = (actor: keyof typeof DELETION_ACTORS, method: string, url: string, body?: unknown, objectStore?: ObjectStore) => {
    const server = createWiseEffServer({ db: fixture.api, objectStore: objectStore ?? fixture.storage,
      auth: { mode: "production", verifier: { verify: async authorization => {
        const userId = typeof authorization === "string" ? authorization.slice("Bearer ".length) : "";
        if (!(Object.values(DELETION_ACTORS) as string[]).includes(userId)) throw new Error("Unknown fixture identity");
        return makeTestAuthContext({ userId, organizationId: userId === DELETION_ACTORS.other ? DELETION_ORGANIZATIONS[1] : DELETION_ORGANIZATIONS[0], roleId: "software-user" });
      } } } });
    return requestJson<unknown>(server, url, { method, headers: { authorization: `Bearer ${DELETION_ACTORS[actor]}`,
      ...(url.includes("/publication") ? { [CATALOG_RELEASE_HEADER]: fixture.chain.pinC.id } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const preview = async (id: string, store?: ObjectStore) => {
    const response = await request("platform", "GET", `${path(id)}/deletion-preview`, undefined, store);
    expect(response.status, response.bodyText).toBe(200);
    return catalogDefinitionDeletionPreviewResponseSchema.parse(response.body).item;
  };
  const objects = async () => {
    const names = (await readdir(fixture.directory, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
    return Promise.all(names.map(async name => [name, hash(await readFile(name))]));
  };
  const auditRows = (id: string) => fixture.root.query(`select id,organization_id,actor_user_id,actor_type,severity,metadata
    from audit_events where action='definition-erased' and target_id=$1 order by id`, [id]);

  beforeAll(async () => {
    fixture = await createDefinitionDeletionFixture("definition_delete_http");
    expect((await fixture.api.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
  }, 120_000);
  afterAll(async () => { await fixture?.close(); });

  it.each(["admin", "other", "member", "project", "inactive"] as const)("refuses %s for both preview and deletion before exposing global data", async actor => {
    const before = await fixture.root.query("select count(*) from parameter_catalog.parameter_definitions");
    expect((await request(actor, "GET", `${path(X_DEFINITION_ID)}/deletion-preview`)).status).toBe(403);
    expect((await request(actor, "DELETE", path(X_DEFINITION_ID), { previewToken: "not-authorized" })).status).toBe(403);
    expect((await request(actor, "GET", "/api/v2/catalog/definition-erasures")).status).toBe(403);
    expect((await request(actor, "POST", `/api/v2/catalog/definition-erasures/${X_DEFINITION_ID}/retry-cleanup`)).status).toBe(403);
    expect((await fixture.root.query("select count(*) from parameter_catalog.parameter_definitions")).rows).toEqual(before.rows);
    expect((await auditRows(X_DEFINITION_ID)).rows).toEqual([]);
  });

  it("requires a valid confirmation body and previews both organizations without mutation", async () => {
    expect((await request("platform", "DELETE", path(X_DEFINITION_ID), {})).status).toBe(400);
    const before = await objects();
    const impact = await preview(X_DEFINITION_ID);
    expect(impact.affected).toMatchObject({ organizations: 2, projects: 2, bindings: 2, revisions: 2 });
    expect(impact.affected.values).toBeGreaterThanOrEqual(2);
    expect(impact.originalFilesRetained).toBe(true);
    expect(await objects()).toEqual(before);
    expect((await auditRows(X_DEFINITION_ID)).rows).toEqual([]);
  });

  it("queues a real approved publication whose artifact still contains the erasable definition", async () => {
    const client = await connect(fixture.database.url);
    try {
      await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: true }, DELETION_ACTORS.admin);
    } finally { await client.end(); }
    const candidate = await request("admin", "POST", "/api/v2/catalog/publication-candidates", { changeSet: [{
      op: "create-definition", subjectId: "csub_acme_power", propertyKey: "survives_erasure",
      content: integerContent("Surviving parameter", "This pending definition remains after maintenance.")
    }] });
    expect(candidate.status, candidate.bodyText).toBe(201);
    const candidateId = (candidate.body as { item: { id: string } }).item.id;
    const published = await request("admin", "POST", `/api/v2/catalog/publication-candidates/${candidateId}/publish`, { idempotencyKey: "erasure-maintenance-notice" });
    expect(published.status, published.bodyText).toBe(201);
    pendingPublicationId = catalogPublicationJobResponseSchema.parse(published.body).item.id;
    originalApproval = (await fixture.root.query("select id,artifact_digest,expected_base_release_digest from catalog_publication.publication_authorizations where candidate_id=$1 and event_kind='approve'", [candidateId])).rows;
    expect(originalApproval).toHaveLength(1);
  });

  it("rejects stale confirmation when a new project value appears, then erases only the selected definition", async () => {
    const stale = await preview(X_DEFINITION_ID);
    const owner = fixture.owners[0]!;
    const definitionId = ParameterDefinitionId(X_DEFINITION_ID);
    const definition = fixture.snapshot.getDefinitionById(definitionId);
    if (definition.status !== "found") throw new Error("Definition fixture unavailable");
    const extra = await createSourceBackedBindingService(fixture.pool, { objectStore: fixture.storage }).stabilize({
      snapshot: fixture.snapshot, organizationId: owner.organizationId, projectId: owner.projectId,
      logicalNodeId: "delete_extra_x", registrationId: owner.registrationId, definitionId,
      effectiveRevisionId: definition.definition.selectedRevision.id, expectedEffectiveRevisionId: null,
    });
    expect(extra.ok).toBe(true);
    const rejected = await request("platform", "DELETE", path(X_DEFINITION_ID), { previewToken: stale.previewToken });
    expect(rejected.status, rejected.bodyText).toBe(409);
    expect((rejected.body as ErrorBody).error.details.reason).toBe("definition-erasure-preview-stale");
    const impact = await preview(X_DEFINITION_ID);
    expect(impact.affected.bindings).toBe(3);
    const beforeObjects = await objects();
    const beforeOther = await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID]);
    const removed = await request("platform", "DELETE", path(X_DEFINITION_ID), { previewToken: impact.previewToken });
    expect(removed.status, removed.bodyText).toBe(200);
    expect(catalogDefinitionDeletedResponseSchema.parse(removed.body).item).toMatchObject({ definitionId: X_DEFINITION_ID, deleted: true });
    expect((await fixture.root.query("select id from parameter_catalog.project_parameter_bindings where definition_id=$1", [X_DEFINITION_ID])).rows).toEqual([]);
    expect((await fixture.root.query("select id from parameter_catalog.project_parameter_values where definition_id=$1", [X_DEFINITION_ID])).rows).toEqual([]);
    expect((await fixture.root.query("select id from parameter_catalog.definition_revisions where definition_id=$1", [X_DEFINITION_ID])).rows).toEqual([]);
    expect((await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID])).rows).toEqual(beforeOther.rows);
    expect(await objects()).toEqual(beforeObjects);
    const audit = await auditRows(X_DEFINITION_ID);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ organization_id: null, actor_user_id: DELETION_ACTORS.platform, actor_type: "user", severity: "High" });
    expect((await request("platform", "GET", `${path(X_DEFINITION_ID)}/deletion-preview`)).status).toBe(404);
    const publication = await request("admin", "GET", `/api/v2/catalog/publications/${pendingPublicationId}`);
    expect(publication.status, publication.bodyText).toBe(200);
    const job = catalogPublicationJobResponseSchema.parse(publication.body).item;
    expect(job.status).toBe("cancelled");
    expect(job.maintenanceRewrites).toHaveLength(1);
    expect(job.maintenanceRewrites?.[0]).toMatchObject({ kind: "definition-erasure", originalApprovalRetained: true });
    expect(job.maintenanceRewrites?.[0]?.previousArtifactDigest).not.toBe(job.maintenanceRewrites?.[0]?.currentArtifactDigest);
    expect((await fixture.root.query("select id,artifact_digest,expected_base_release_digest from catalog_publication.publication_authorizations where candidate_id=$1 and event_kind='approve'", [job.candidateId])).rows).toEqual(originalApproval);
    expect((await fixture.root.query("select id from catalog_publication.publication_authorizations where candidate_id=$1 and event_kind='revoke'", [job.candidateId])).rows).toHaveLength(1);
  });

  let originalArchiveRef: string;
  it("does not let the runtime writer claim a historical unscoped receipt", async () => {
    await fixture.root.query("insert into parameter_catalog.definition_erasures(definition_id,erased_by,audit_event_id) values('historical-unscoped','missing-user','historical-audit')");
    expect((await fixture.api.query("select to_regprocedure('parameter_catalog.scope_definition_erasure(text,text)') as routine")).rows)
      .toEqual([{ routine: null }]);
    await expect(fixture.api.query("update parameter_catalog.definition_erasures set organization_id=$1 where definition_id='historical-unscoped'",
      [DELETION_ORGANIZATIONS[0]])).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.root.query("select organization_id from parameter_catalog.definition_erasures where definition_id='historical-unscoped'")).rows)
      .toEqual([{ organization_id: null }]);
  });
  it("rolls back deletion and sanitized archive staging when the same-transaction platform audit fails", async () => {
    const rows = await fixture.root.query(`select value.* from parameter_catalog.project_parameter_values value
      join parameter_catalog.project_parameter_bindings binding on binding.id=value.binding_id
      where value.definition_id=$1 and binding.organization_id=$2`, [Y_DEFINITION_ID, DELETION_ORGANIZATIONS[0]]);
    const document: ArchivedPlaneDocument = { schemaVersion: "project-parameter-plane-archive/v2", organizationId: DELETION_ORGANIZATIONS[0], projectId: "erase-project-0",
      capturedAt: "2026-10-20T00:00:00Z", truncated: false, counts: { canonical_values: rows.rows.length }, relations: { canonical_values: rows.rows }, objects: {} };
    const bytes = Buffer.from(JSON.stringify(document));
    const stored = await fixture.storage.put({ organizationId: DELETION_ORGANIZATIONS[0], fileName: "before-purge.json", contentType: "application/json", bytes });
    originalArchiveRef = stored.storageKey;
    const contentDigest = hash(bytes);
    await fixture.root.query(`insert into project_parameter_plane_archives
      (id,organization_id,project_id,scope,object_ref,content_digest,archive_digest,counts,created_by)
      values('delete-archive',$1,'erase-project-0','legacy-parameter-plane',$2,$3,$4,$5::jsonb,$6)`,
    [DELETION_ORGANIZATIONS[0], stored.storageKey, contentDigest, archiveDigestOf({ scope: "legacy-parameter-plane", counts: document.counts, contentDigest }), JSON.stringify(document.counts), DELETION_ACTORS.platform]);
    const impact = await preview(Y_DEFINITION_ID);
    const beforeObjects = await objects();
    await fixture.root.query(`create function public.reject_definition_delete_audit() returns trigger language plpgsql as $$
      begin if new.action='definition-erased' then raise exception 'Injected audit failure'; end if; return new; end; $$`);
    await fixture.root.query("create trigger reject_definition_delete_audit before insert on audit_events for each row execute function public.reject_definition_delete_audit()");
    try {
      expect((await request("platform", "DELETE", path(Y_DEFINITION_ID), { previewToken: impact.previewToken })).status).toBe(500);
    } finally {
      await fixture.root.query("drop trigger reject_definition_delete_audit on audit_events");
      await fixture.root.query("drop function public.reject_definition_delete_audit()");
    }
    expect((await fixture.root.query("select id from parameter_catalog.parameter_definitions where id=$1", [Y_DEFINITION_ID])).rows).toHaveLength(1);
    expect((await fixture.root.query("select definition_id from parameter_catalog.definition_erasures where definition_id=$1", [Y_DEFINITION_ID])).rows).toEqual([]);
    expect((await auditRows(Y_DEFINITION_ID)).rows).toEqual([]);
    expect(await objects()).toEqual(beforeObjects);
  });

  it("shares pending cleanup with another administrator, isolates organizations and retries without a preview", async () => {
    let failures = 1;
    const storage: ObjectStore = { ...fixture.storage, delete: async key => {
      if (key === originalArchiveRef && failures-- > 0) throw new Error("Injected object-store outage");
      await fixture.storage.delete!(key);
    } };
    const impact = await preview(Y_DEFINITION_ID, storage);
    const first = await request("platform", "DELETE", path(Y_DEFINITION_ID), { previewToken: impact.previewToken }, storage);
    expect(first.status, first.bodyText).toBe(409);
    expect((first.body as ErrorBody).error.details.reason).toBe("definition-erasure-cleanup-pending");
    expect((await fixture.root.query("select id from parameter_catalog.parameter_definitions where id=$1", [Y_DEFINITION_ID])).rows).toEqual([]);
    await fixture.root.query("update user_role_bindings set role_id='platform-admin' where user_id in ($1,$2) and project_id is null",
      [DELETION_ACTORS.admin, DELETION_ACTORS.other]);
    const list = await request("admin", "GET", "/api/v2/catalog/definition-erasures");
    expect(list.status, list.bodyText).toBe(200);
    expect(list.body).toMatchObject({ items: [{ definitionId: Y_DEFINITION_ID, deletedAt: expect.any(String), pendingObjectCount: 1 }] });
    expect((await request("other", "GET", "/api/v2/catalog/definition-erasures")).body).toEqual({ items: [] });
    const cleanupPath = `/api/v2/catalog/definition-erasures/${Y_DEFINITION_ID}/retry-cleanup`;
    expect((await request("other", "POST", cleanupPath, undefined, storage)).status).toBe(404);
    expect((await request("admin", "POST", `/api/v2/catalog/definition-erasures/not-deleted/retry-cleanup`)).status).toBe(404);
    await fixture.root.query(`create function public.reject_cleanup_audit() returns trigger language plpgsql as $$
      begin if new.action='definition-cleanup-retried' then raise exception 'Injected audit failure'; end if; return new; end; $$`);
    await fixture.root.query("create trigger reject_cleanup_audit before insert on audit_events for each row execute function public.reject_cleanup_audit()");
    try {
      expect((await request("admin", "POST", cleanupPath, undefined, storage)).status).toBe(500);
      await expect(fixture.storage.get(originalArchiveRef)).resolves.toBeDefined();
    } finally {
      await fixture.root.query("drop trigger reject_cleanup_audit on audit_events");
      await fixture.root.query("drop function public.reject_cleanup_audit()");
    }
    const retry = await request("admin", "POST", cleanupPath, undefined, storage);
    expect(retry.status, retry.bodyText).toBe(200);
    const again = await request("admin", "POST", cleanupPath, undefined, storage);
    expect(again.status, again.bodyText).toBe(200);
    const originalDeleteReplay = await request("platform", "DELETE", path(Y_DEFINITION_ID), { previewToken: impact.previewToken }, storage);
    expect(originalDeleteReplay.status, originalDeleteReplay.bodyText).toBe(200);
    expect((await request("platform", "GET", "/api/v2/catalog/definition-erasures")).body).toEqual({ items: [] });
    const cleanupAudits = await fixture.root.query("select actor_user_id,metadata from audit_events where action='definition-cleanup-retried' and target_id=$1 and organization_id is null", [Y_DEFINITION_ID]);
    expect(cleanupAudits.rows).toHaveLength(2);
    expect(cleanupAudits.rows[0]).toMatchObject({ actor_user_id: DELETION_ACTORS.admin });
    expect((await auditRows(Y_DEFINITION_ID)).rows).toHaveLength(1);
    expect((await fixture.root.query<{ pending_object_refs: string[] }>("select pending_object_refs from parameter_catalog.definition_erasures where definition_id=$1", [Y_DEFINITION_ID])).rows[0]?.pending_object_refs).toEqual([]);
    await expect(fixture.storage.get(originalArchiveRef)).rejects.toThrow();
  });
});
