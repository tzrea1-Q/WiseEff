import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { installKnowledgeDefinitionLifecycleFixture } from "../../testing/parameterCatalog";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { catalogDefinitionListResponseSchema, catalogDefinitionResponseSchema, catalogSubjectResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";

it("enforces current definition lifecycle and pagination on the real API role while retaining exact history", async () => {
  const database = await createEphemeralTestDatabase("libraryvisible");
  const admin = new pg.Pool({ connectionString: database.url });
  const token = `lib${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let api: ReturnType<typeof createPostgresDatabase> | undefined;
  try {
    const fixture = await installKnowledgeDefinitionLifecycleFixture(admin);
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query("select session_user, current_user, rolsuper from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ session_user: runtime.apiRole, current_user: runtime.apiRole, rolsuper: false });
    const organizationId = `org-${randomUUID()}`;
    const userId = `reader-${randomUUID()}`;
    await admin.query("insert into public.organizations(id,name) values ($1,'Library')", [organizationId]);
    await admin.query("insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Reader','Reader',true)", [userId, organizationId]);
    await admin.query("insert into public.user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'admin')", [randomUUID(), userId, organizationId]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () => makeTestAuthContext({ userId, organizationId }) } } });
    const get = (path: string) => requestJson(app, `/api/v2/catalog${path}`);
    const first = catalogDefinitionListResponseSchema.parse((await get(`/definitions?view=library&search=${fixture.searchTerm}&limit=1`)).body);
    expect(first.totalCount).toBe(fixture.searchableDefinitionCount);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = catalogDefinitionListResponseSchema.parse((await get(`/definitions?view=library&search=${fixture.searchTerm}&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).body);
    expect(second.totalCount).toBe(fixture.searchableDefinitionCount);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const seen = new Set([first.items[0]!.id, second.items[0]!.id]);
    let next = second.nextCursor;
    while (next) {
      const page = catalogDefinitionListResponseSchema.parse((await get(`/definitions?view=library&search=${fixture.searchTerm}&limit=1&cursor=${encodeURIComponent(next)}`)).body);
      expect(page.totalCount).toBe(fixture.searchableDefinitionCount);
      expect(page.items).toHaveLength(1);
      expect(seen.has(page.items[0]!.id)).toBe(false);
      seen.add(page.items[0]!.id);
      next = page.nextCursor;
    }
    expect(seen.size).toBe(fixture.searchableDefinitionCount);
    const retired = await get(`/definitions?view=library&lifecycle=retired&search=knowledge_retired_property`);
    expect(retired.status).toBe(200);
    expect(catalogDefinitionListResponseSchema.parse(retired.body)).toMatchObject({ totalCount: 0, items: [] });
    expect((await get(`/definitions/${fixture.retiredDefinitionId}?view=library`)).status).toBe(404);
    expect((await get(`/definitions/${fixture.retiredDefinitionId}/revisions?view=library`)).status).toBe(404);
    expect((await get(`/definitions/${fixture.retiredDefinitionId}`)).status).toBe(200);
    const subject = catalogSubjectResponseSchema.parse((await get("/subjects/csub_acme_power?view=library")).body);
    expect(subject.item.definitionCounts.retired).toBe(0);
    const advanced = await fixture.advanceToDeprecated();
    const deprecated = await get(`/definitions/${fixture.activeDefinitionId}?view=library&catalogReleaseId=${fixture.pin.id}`);
    expect(deprecated.status).toBe(200);
    expect(catalogDefinitionResponseSchema.parse(deprecated.body).item).toMatchObject({ lifecycle: "deprecated", currentRevision: { id: advanced.revisionId } });
    const deprecatedList = catalogDefinitionListResponseSchema.parse((await get("/definitions?view=library&lifecycle=deprecated")).body);
    expect(deprecatedList.items.some((item) => item.id === fixture.activeDefinitionId)).toBe(true);
    expect((await get(`/definitions/${fixture.activeDefinitionId}/revisions/${fixture.initialRevisionId}?view=library`)).status).toBe(200);
  } finally {
    await api?.close();
    expect((await dropLabRuntimeLogins(database.url, token)).failed).toEqual([]);
    await admin.end();
    await database.drop();
  }
}, 120_000);
