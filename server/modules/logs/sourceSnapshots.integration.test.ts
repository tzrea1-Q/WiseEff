import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { resolveRouteBodyLimit } from "../../app";
import { archiveSourceSnapshot, uploadSourceSnapshot, type SourceSnapshotDto } from "./sourceSnapshots";
import { createLogSkill, getLogSkill, listLogSkills } from "./skillsService";

const available = await isTestDatabaseAvailable();
const auth = (organizationId = "source-org") => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:admin-domains"] });
const context = { requestId: "source-request" };
type Skill = Awaited<ReturnType<typeof getLogSkill>>;

describe.skipIf(!available)("source snapshot governance over PostgreSQL", () => {
  it("isolates metadata/defaults, keeps published revisions immutable, and atomically audits upload/archive", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourcesnapshots");
    const db = createPostgresDatabase(ephemeral.url);
    const objectStore = createMemoryObjectStore();
    try {
      for (const id of ["source-org", "other-source-org"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      const skill = await createLogSkill(db, auth(), { name: "Source skill" }, createUserInvocation(auth()), context);
      const otherSkill = await createLogSkill(db, auth(), { name: "Sibling skill" }, createUserInvocation(auth()), context);
      let currentAuth = auth();
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, skillBudgetCaps: { stepBudget: 4, tokenBudget: 5000 }, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(
        createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit }), path,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const upload = (path: string, label: string, name = "source.zip") => {
        const boundary = "wiseeff-source-test";
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="versionLabel"\r\n\r\n${label}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/zip\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        return requestJson<{ item: SourceSnapshotDto }>(createHttpServer(router, { maxBodyBytes: resolveRouteBodyLimit }), path,
          { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
      };
      const base = `/api/v1/log-skills/${skill.id}/source-snapshots`;
      const zip = new JSZip(); zip.file("main.c", "int source_probe(void) { return 0; }\n");
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      const uploaded = await upload(base, "v1");
      expect(uploaded.status).toBe(201);
      const id = uploaded.body.item.id;
      expect(uploaded.body.item).toMatchObject({ status: "queued", versionLabel: "v1", filesProcessed: 0 });
      const foreignSkill = await createLogSkill(db, auth("other-source-org"), { name: "Foreign source skill" },
        createUserInvocation(auth("other-source-org")), context);
      for (const [snapshotId, organizationId, skillId, label, status] of [
        ["ready-source-v2", "source-org", skill.id, "v2.4.0", "ready"],
        ["ready-source-v1", "source-org", skill.id, "v1.0.0", "ready"],
        ["indexing-source", "source-org", skill.id, "indexing-version", "indexing"],
        ["failed-source", "source-org", skill.id, "failed-version", "failed"],
        ["archived-source", "source-org", skill.id, "archived-version", "archived"],
        ["sibling-source", "source-org", otherSkill.id, "sibling-version", "ready"],
        ["foreign-source", "other-source-org", foreignSkill.id, "foreign-version", "ready"]
      ]) await db.query(`insert into log_source_snapshots (id, organization_id, skill_id, version_label, storage_key, file_name, status)
        values ($1,$2,$3,$4,$1,'source.zip',$5)`, [snapshotId, organizationId, skillId, label, status]);
      // Uploaders and viewers need only ready labels, never the snapshot metadata exposed to administrators.
      const summaries = await listLogSkills(db, { ...auth(), permissions: ["logs:view", "logs:upload"] });
      expect(summaries.items.find((item) => item.id === skill.id)?.readySourceVersions).toEqual(["v1.0.0", "v2.4.0"]);
      expect(summaries.items.find((item) => item.id === otherSkill.id)?.readySourceVersions).toEqual(["sibling-version"]);
      expect(JSON.stringify(summaries)).not.toMatch(/foreign-version|indexing-version|failed-version|archived-version|ready-source-v2|storage_key/);
      expect(summaries.items.some((item) => item.id === foreignSkill.id)).toBe(false);
      expect((await listLogSkills(db, { ...auth(), permissions: ["logs:view"] })).items
        .find((item) => item.id === skill.id)?.readySourceVersions).toEqual(["v1.0.0", "v2.4.0"]);
      await expect(listLogSkills(db, { ...auth(), permissions: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const versionsPath = `/api/v1/log-skills/${skill.id}/source-versions`;
      currentAuth = { ...auth(), permissions: ["logs:upload"] };
      expect((await request<{ items: string[] }>(versionsPath)).body).toEqual({ items: ["v1.0.0", "v2.4.0"] });
      expect((await request(`/api/v1/log-skills/${foreignSkill.id}/source-versions`)).status).toBe(404);
      expect((await request(base)).status).toBe(403);
      currentAuth = { ...auth(), permissions: ["logs:view"] };
      expect((await request<{ items: string[] }>(versionsPath)).body).toEqual({ items: ["v1.0.0", "v2.4.0"] });
      currentAuth = { ...auth(), permissions: [] };
      expect((await request(versionsPath)).status).toBe(403);
      currentAuth = { ...auth(), user: { ...auth().user, isActive: false }, permissions: ["logs:upload"] };
      expect((await request(versionsPath)).status).toBe(403);
      currentAuth = auth();
      await db.query(`delete from log_source_snapshots where id <> $1`, [id]);
      expect((await upload(base, "v1")).status).toBe(409);
      expect(await request(`${base}/${id}/default`, "POST")).toMatchObject({
        status: 200, body: { item: { budgetCaps: { stepBudget: 4, tokenBudget: 5000 } } }
      });
      const afterDefault = await getLogSkill(db, auth(), skill.id);
      expect(afterDefault.currentRevision).toEqual(skill.currentRevision);
      expect(afterDefault.draft?.spec.defaultSourceSnapshotId).toBe(id);
      const copied = await createLogSkill(db, auth(), { name: "Copied source skill", startingPoint: { copyFromSkillId: skill.id } }, createUserInvocation(auth()), context);
      expect(copied.currentRevision.spec).toEqual(Object.fromEntries(Object.entries(afterDefault.draft!.spec).filter(([key]) => key !== "defaultSourceSnapshotId")));
      expect(copied.currentRevision.spec.defaultSourceSnapshotId).toBeUndefined();
      // Saving a default by hand has the same ownership and archive validation.
      expect((await request(`/api/v1/log-skills/${otherSkill.id}/draft`, "PUT", {
        spec: { schemaVersion: "skill/v1", defaultSourceSnapshotId: id },
        basePublishedRevisionId: otherSkill.currentRevision.id, baseDraftRevisionId: null
      })).status).toBe(404);
      currentAuth = auth("other-source-org");
      expect((await request(base)).status).toBe(404);
      expect((await request(`${base}/${id}/default`, "POST")).status).toBe(404);
      expect((await request(`${base}/${id}/archive`, "POST")).status).toBe(404);
      expect((await db.query(`select id from log_source_files where organization_id=$1 and snapshot_id=$2`, [currentAuth.organization.id, id])).rows).toEqual([]);
      expect((await db.query(`select id from log_source_chunks where organization_id=$1 and snapshot_id=$2`, [currentAuth.organization.id, id])).rows).toEqual([]);
      currentAuth = { ...auth(), permissions: ["logs:view"] };
      expect((await request<{ items: SourceSnapshotDto[] }>(base)).body.items).toHaveLength(1);
      for (const suffix of ["default", "archive"]) expect((await request(`${base}/${id}/${suffix}`, "POST")).status).toBe(403);
      expect((await upload(base, "v1")).status).toBe(403);
      currentAuth = auth();
      // Force the actual audit INSERT to fail inside the domain transaction.
      await db.query(`create function reject_source_test_audit() returns trigger language plpgsql as $$
        begin raise exception 'audit unavailable'; end $$`);
      await db.query(`create trigger reject_source_test_audit before insert on audit_events
        for each row when (new.kind in ('log-source-snapshot-upload', 'log-source-snapshot-archive'))
        execute function reject_source_test_audit()`);
      const beforeObjects = objectStore.entries.size;
      await expect(uploadSourceSnapshot(db, objectStore, auth(), skill.id,
        { versionLabel: "rollback", fileName: "source.zip", bytes }, createUserInvocation(auth()), context)).rejects.toThrow("audit unavailable");
      expect((await db.query(`select id from log_source_snapshots where version_label='rollback'`)).rows).toEqual([]);
      expect(objectStore.entries.size).toBe(beforeObjects);
      await expect(archiveSourceSnapshot(db, auth(), skill.id, id, createUserInvocation(auth()), context)).rejects.toThrow("audit unavailable");
      await db.query(`drop trigger reject_source_test_audit on audit_events`);
      await db.query(`drop function reject_source_test_audit()`);
      expect((await request<{ items: SourceSnapshotDto[] }>(base)).body.items[0].status).toBe("queued");
      expect((await request(`${base}/${id}/archive`, "POST")).status).toBe(200);
      expect((await request(`${base}/${id}/default`, "POST")).status).toBe(409);
      const saved = await request<{ item: { id: string } }>(`/api/v1/log-skills/${skill.id}/draft`, "PUT", {
        spec: { ...afterDefault.draft!.spec, description: "Unrelated edit after archival" },
        basePublishedRevisionId: skill.currentRevision.id, baseDraftRevisionId: afterDefault.draft!.id
      });
      expect(saved.status).toBe(200);
      expect((await request(`/api/v1/log-skills/${skill.id}/publish`, "POST", { draftRevisionId: saved.body.item.id })).status).toBe(200);
      expect((await upload(base, "v1")).status).toBe(201);
      expect((await db.query<{ kind: string }>(`select kind from audit_events where target_id=$1 order by kind`, [id])).rows.map((r) => r.kind))
        .toEqual(["log-source-snapshot-archive", "log-source-snapshot-default", "log-source-snapshot-upload"]);
      expect(resolveRouteBodyLimit({ method: "POST", path: base })).toBe(100 * 1024 * 1024 + 64 * 1024);
      expect((await upload(base, " ")).status).toBe(400);
      expect((await upload(base, "v2", "../bad.zip")).status).toBe(400);
      expect((await request(base, "POST", { contentBase64: "AA==" })).status).toBe(400);
      const latest = await request<{ item: Skill }>(`/api/v1/log-skills/${skill.id}`);
      expect(latest.body.item.currentRevision.id).toBe(saved.body.item.id);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
