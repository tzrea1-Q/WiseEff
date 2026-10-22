import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import type { LogDeletionPreview, LogDeletionStatus } from "../../../src/domain/logs/deletionPreview";
import type { LogRecordDto } from "./types";
import { registerLogRoutes } from "./routes";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("failed log owner deletion over HTTP and PostgreSQL", () => {
  it("checks ownership and current state under the erasure fence, audits atomically, and retries only the owner's receipt", async () => {
    const ephemeral = await createEphemeralTestDatabase("ownerdelete");
    const db = createPostgresDatabase(ephemeral.url);
    const token = `acu2owner${randomBytes(4).toString("hex")}`;
    const owner = makeTestAuthContext({ organizationId: "owner-org", userId: "owner", roles: [], permissions: ["logs:view", "logs:upload"] });
    const peer = makeTestAuthContext({ organizationId: "owner-org", userId: "peer", roles: [], permissions: ["logs:view", "logs:upload"] });
    const foreign = makeTestAuthContext({ organizationId: "foreign-org", userId: "foreign", roles: [], permissions: ["logs:view", "logs:upload"] });
    const admin = makeTestAuthContext({ organizationId: "owner-org", userId: "admin", roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:admin-domains"] });
    let api: ReturnType<typeof createPostgresDatabase> | undefined;
    try {
      await seedCoreGraph(db, { organization: { id: "owner-org" }, users: [{ id: "owner" }, { id: "peer" }, { id: "admin" }] });
      await seedCoreGraph(db, { organization: { id: "foreign-org" }, users: [{ id: "foreign" }] });
      await db.query("insert into user_role_bindings(id,organization_id,user_id,role_id) values('owner-admin','owner-org','admin','admin')");
      api = createPostgresDatabase((await provisionPublicationRuntimeLogins(ephemeral.url, { mode: "lab", runToken: token })).apiUrl);
      expect((await api.query("select rolsuper from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false });
      let auth = owner;
      const router = createRouter(), store = createMemoryObjectStore();
      registerLogRoutes(router, { db: api, objectStore: store, getCurrentAuthContext: () => auth });
      const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path,
        { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      const uploaded = await request<{ log: LogRecordDto }>("/api/v1/log-files", "POST", {
        fileName: "owner.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO owner log\n").toString("base64") });
      expect(uploaded.status).toBe(201);
      const id = uploaded.body.log.id, path = `/api/v1/logs/${id}`;
      const remove = (version = "a".repeat(64)) => request<{ item: LogDeletionStatus }>(path, "DELETE", { version });
      expect((await request(`${path}/deletion-preview`)).status).toBe(403);
      expect((await remove()).status).toBe(403);
      await db.query("update log_records set status='failed',failure_reason='分析已取消' where id=$1", [id]);
      await db.query("update log_analysis_runs set status='failed' where log_record_id=$1", [id]);
      await db.query("update jobs set status='failed' where kind='log-analysis' and target_id in (select id from log_analysis_runs where log_record_id=$1)", [id]);
      expect((await request<{ item: LogRecordDto }>(path)).body.item.canDelete).toBe(true);
      expect((await request<{ items: LogRecordDto[] }>("/api/v1/logs")).body.items.find((log) => log.id === id)?.canDelete).toBe(true);
      const preview = (await request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`)).body.item;
      for (const other of [peer, foreign]) {
        auth = other;
        expect((await request(`${path}/deletion-preview`)).status).toBe(403);
        expect((await remove(preview.version)).status).toBe(403);
      }
      auth = owner;
      await db.query("update log_records set status='complete' where id=$1", [id]);
      expect((await request<{ item: LogRecordDto }>(path)).body.item.canDelete).toBe(false);
      expect((await remove(preview.version)).status).toBe(403);
      auth = admin;
      expect((await request(`${path}/deletion-preview`)).status).toBe(200);
      auth = owner;
      await db.query("update log_records set status='failed' where id=$1", [id]);
      await db.query("update users set is_active=false where id='owner'");
      expect((await remove(preview.version)).status).toBe(403);
      await db.query("update users set is_active=true where id='owner'");
      const current = (await request<{ item: LogDeletionPreview }>(`${path}/deletion-preview`)).body.item;
      await db.query("create function reject_owner_purge_audit() returns trigger language plpgsql as $$ begin if new.kind='log-purged' then raise exception 'audit unavailable'; end if; return new; end $$");
      await db.query("create trigger reject_owner_purge_audit before insert on audit_events for each row execute function reject_owner_purge_audit()");
      const objectCount = store.entries.size;
      expect((await remove(current.version)).status).toBe(500);
      expect((await db.query("select id from log_records where id=$1", [id])).rows).toHaveLength(1);
      expect(store.entries.size).toBe(objectCount);
      await db.query("drop trigger reject_owner_purge_audit on audit_events");
      const deleteObject = store.delete!;
      store.delete = async () => { throw new Error("object store unavailable"); };
      const erased = await remove(current.version);
      expect(erased.status).toBe(200);
      expect(erased.body.item.objects).toBe("pending");
      const pending = () => request<{ items: LogDeletionStatus[] }>("/api/v1/logs/deletions");
      // Other receipts ensure listing is scoped by both organization and actor.
      await db.query("insert into parameter_catalog.log_erasures(organization_id,log_id,preview_version,erased_by,run_ids,job_ids,pending_object_refs) values('owner-org','peer-erasure',$1,'peer','{}','{}','{peer-object}'),('foreign-org','foreign-erasure',$1,'foreign','{}','{}','{foreign-object}'),('foreign-org','moved-owner-erasure',$1,'owner','{}','{}','{old-owner-object}')", [current.version]);
      const ownPending = await pending();
      expect(ownPending.status, ownPending.bodyText).toBe(200);
      expect(ownPending.body.items).toEqual([erased.body.item]);
      for (const other of [peer, foreign]) {
        auth = other;
        const listed = await pending();
        expect(listed.status).toBe(200);
        expect(listed.body.items.map((item) => item.logId)).toEqual([other === peer ? "peer-erasure" : "foreign-erasure"]);
        expect((await request(`${path}/deletion-status`)).status).toBe(403);
        expect((await remove(current.version)).status).toBe(403);
      }
      auth = admin;
      expect((await pending()).body.items.map((item) => item.logId).sort()).toEqual([id, "peer-erasure"].sort());
      expect((await remove(current.version)).body.item.objects).toBe("pending");
      auth = owner;
      await db.query("update users set is_active=false where id='owner'");
      expect((await pending()).status).toBe(403);
      await db.query("update users set is_active=true where id='owner'");
      auth = { ...owner, organization: foreign.organization };
      expect((await pending()).status).toBe(403);
      auth = owner;
      expect((await request(`${path}/deletion-status`)).status).toBe(200);
      store.delete = deleteObject;
      expect((await remove(current.version)).body.item.objects).toBe("complete");
      expect((await pending()).body.items).toEqual([]);
      expect(store.entries.size).toBe(0);
      expect((await db.query("select id from log_records where id=$1", [id])).rows).toHaveLength(0);
      const events = (await db.query("select actor_user_id from audit_events where kind='log-purged' and target_id=$1", [id])).rows;
      expect(events).toEqual([{ actor_user_id: owner.user.id }]);
    } finally {
      await api?.close();
      await dropLabRuntimeLogins(ephemeral.url, token);
      await db.close();
      await ephemeral.drop();
    }
  }, 120_000);
});
