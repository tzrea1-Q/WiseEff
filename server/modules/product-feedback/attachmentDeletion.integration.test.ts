import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerProductFeedbackRoutes } from "./routes";
import { registerKnowledgeRoutes } from "../knowledge/routes";
import type { ProductFeedbackUserDto } from "./types";

const available = await isTestDatabaseAvailable();
const owner = makeTestAuthContext({ organizationId: "delete-org", userId: "delete-owner", roleId: "hardware-user" });
const admin = makeTestAuthContext({ organizationId: owner.organization.id, userId: "delete-admin" });
const image = (fileName: string) => ({ fileName, contentType: "image/png", contentBase64: Buffer.from("image").toString("base64") });
type Response = { item: ProductFeedbackUserDto; pendingAttachmentCleanupCount: number };
async function fixture() {
  const ephemeral = await createEphemeralTestDatabase("fbdelete"), db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: owner.organization.id }, users: [{ id: owner.user.id }, { id: admin.user.id }, { id: "other-uploader" }] });
  const store = createMemoryObjectStore(), router = createRouter(); let auth = owner;
  registerProductFeedbackRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth });
  registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth });
  const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const create = (count = 2) => request<Response>("/api/v1/product-feedback", "POST", { pagePath: "/settings", pageTitle: "Settings", feedbackType: "experience", description: "Preserve the conversation", attachments: Array.from({ length: count }, (_, i) => image(`private-${i}.png`)) });
  return { db, store, request, create, setAuth: (value: typeof owner) => { auth = value; }, close: async () => { await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("submitted feedback attachment deletion over real HTTP and PostgreSQL", () => {
  it("rechecks an authorized download after slow object IO so a completed deletion cannot return its bytes", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let reading: Promise<unknown> | undefined;
    try {
      const feedback = (await h.create(1)).body.item, attachment = feedback.attachments[0], get = h.store.get;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
      h.store.get = async (key) => { const bytes = await get(key); entered(); await held; return bytes; };
      reading = h.request(`/api/v1/product-feedback/mine/${feedback.id}/attachments/${attachment.id}/content`);
      await started;
      expect((await h.request(`/api/v1/product-feedback/${feedback.id}/attachments/${attachment.id}`, "DELETE")).status).toBe(200);
      release(); expect((await reading as { status: number }).status).toBe(404);
    } finally { release(); await reading?.catch(() => undefined); await h.close(); }
  }, 120_000);
  it("does not erase a concurrent knowledge upload using a historical feedback display name and identical bytes", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let uploading: Promise<unknown> | undefined;
    try {
      const feedback = (await h.create(1)).body.item, attachment = feedback.attachments[0];
      const legacy = await h.store.put({ organizationId: owner.organization.id, fileName: "shared.pdf", contentType: "application/pdf", bytes: Buffer.from("image") });
      await h.db.query("update product_feedback_attachments set storage_key=$2 where id=$1", [attachment.id, legacy.storageKey]);
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; }), put = h.store.put;
      h.store.put = async (input) => { const stored = await put(input); entered(); await held; return stored; };
      h.setAuth(admin);
      uploading = h.request<{ item: { id: string; file: { fileName: string; storageKey: string } } }>("/api/v1/knowledge/entries", "POST", { contentForm: "file", title: "Independent file", tags: [], file: { fileName: "shared.pdf", contentType: "application/pdf", contentBase64: Buffer.from("image").toString("base64") } });
      await started;
      expect((await h.request(`/api/v1/product-feedback/${feedback.id}/attachments/${attachment.id}`, "DELETE")).status).toBe(200);
      release();
      const result = await uploading as { status: number; body: { item: { id: string; file: { fileName: string; storageKey: string } } } };
      expect(result.status).toBe(201); expect(result.body.item.file.fileName).toBe("shared.pdf");
      expect(result.body.item.file.storageKey).not.toBe(legacy.storageKey);
      expect((await h.request(`/api/v1/knowledge/entries/${result.body.item.id}/file/content`)).status).toBe(200);
    } finally { release(); await uploading?.catch(() => undefined); await h.close(); }
  }, 120_000);
  it("removes only the owner's target and keeps its real message marker, denies old downloads, and audits repeated deletes once", async () => {
    const h = await fixture();
    try {
      const created = (await h.create()).body.item;
      const before = (await h.request<Response>(`/api/v1/product-feedback/mine/${created.id}`)).body.item, attachment = before.attachments[0], path = `/api/v1/product-feedback/${before.id}/attachments/${attachment.id}`;
      expect(attachment.canDelete).toBe(true);
      const removed = await h.request<Response>(path, "DELETE"); expect(removed.status).toBe(200);
      const marker = removed.body.item.attachments.find((item) => item.id === attachment.id)!;
      expect(marker).toMatchObject({ messageId: attachment.messageId, uploadedByUserId: owner.user.id, storageKey: "", checksum: "", fileName: "已删除附件", cleanupPending: false });
      expect(marker.deletedAt).toBeTruthy(); expect(removed.body.item.progressEvents).toEqual(before.progressEvents);
      expect(removed.body.item.attachments.find((item) => item.id !== attachment.id)).toEqual(before.attachments[1]);
      expect(h.store.entries.has(attachment.storageKey)).toBe(false);
      expect((await h.request(`${path.replace("/product-feedback/", "/product-feedback/mine/")}/content`)).status).toBe(404);
      h.setAuth(admin); expect((await h.request(`${path}/content`)).status).toBe(404);
      expect((await h.request<Response>(path, "DELETE")).body.item.attachments.find((item) => item.id === attachment.id)?.deletedAt).toBe(marker.deletedAt);
      const audit = await h.db.query<{ metadata: unknown }>("select metadata from audit_events where kind='product-feedback-attachment-delete' and target_id=$1", [attachment.id]);
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows)).not.toContain(attachment.storageKey); expect(JSON.stringify(audit.rows)).not.toContain(attachment.fileName);
    } finally { await h.close(); }
  }, 120_000);

  it("refuses unrelated users and organizations, restricts known uploader ownership, and permits a current organization administrator", async () => {
    const h = await fixture();
    try {
      expect((await h.request("/api/v1/product-feedback/not-a-uuid/attachments/not-a-uuid", "DELETE")).status).toBe(400);
      const before = (await h.create(1)).body.item, attachment = before.attachments[0], path = `/api/v1/product-feedback/${before.id}/attachments/${attachment.id}`;
      h.setAuth(makeTestAuthContext({ organizationId: owner.organization.id, userId: "other-uploader", roleId: "hardware-user" }));
      expect((await h.request(path, "DELETE")).status).toBe(404);
      h.setAuth(makeTestAuthContext({ organizationId: "other-org", userId: "other-admin" }));
      expect((await h.request(path, "DELETE")).status).toBe(404);
      await h.db.query("update product_feedback_attachments set uploaded_by_user_id='other-uploader' where id=$1", [attachment.id]);
      h.setAuth(owner); expect((await h.request(path, "DELETE")).status).toBe(403);
      expect((await h.request<Response>(`/api/v1/product-feedback/mine/${before.id}`)).body.item.attachments[0].canDelete).toBe(false);
      h.setAuth(admin); expect((await h.request(path, "DELETE")).status).toBe(200);
      expect(h.store.entries.size).toBe(0);
    } finally { await h.close(); }
  }, 120_000);

  it("keeps unknown historical attribution honest while the proven feedback owner or administrator deletes it", async () => {
    const h = await fixture();
    try {
      const before = (await h.create()).body.item;
      await h.db.query("update product_feedback_attachments set message_id=null,uploaded_by_user_id=null where feedback_id=$1", [before.id]);
      const path = `/api/v1/product-feedback/${before.id}/attachments/`;
      const removed = await h.request<Response>(`${path}${before.attachments[0].id}`, "DELETE");
      expect(removed.status).toBe(200); expect(removed.body.item.attachments.find((item) => item.id === before.attachments[0].id)).toMatchObject({ messageId: null, uploadedByUserId: null });
      await h.db.query("update product_feedback set submitter_user_id=null where id=$1", [before.id]);
      expect((await h.request(`${path}${before.attachments[1].id}`, "DELETE")).status).toBe(404);
      h.setAuth(admin); expect((await h.request(`${path}${before.attachments[1].id}`, "DELETE")).status).toBe(200);
    } finally { await h.close(); }
  }, 120_000);

  it("retains shared bytes and the other feedback's download", async () => {
    const h = await fixture();
    try {
      const first = (await h.create(1)).body.item, second = (await h.create(1)).body.item, key = first.attachments[0].storageKey;
      await h.db.query("update product_feedback_attachments set storage_key=$2 where id=$1", [second.attachments[0].id, key]);
      const removed = await h.request<Response>(`/api/v1/product-feedback/${first.id}/attachments/${first.attachments[0].id}`, "DELETE");
      expect(removed.status).toBe(200); expect(removed.body.item.attachments[0].cleanupPending).toBe(false);
      expect(await h.store.get(key)).toBeDefined();
      expect((await h.request(`/api/v1/product-feedback/mine/${second.id}/attachments/${second.attachments[0].id}/content`)).status).toBe(200);
    } finally { await h.close(); }
  }, 120_000);

  it("persists a visible pending marker after object failure, excludes it from upload cleanup, and lets an administrator retry only that target", async () => {
    const h = await fixture();
    try {
      const before = (await h.create(1)).body.item, attachment = before.attachments[0], path = `/api/v1/product-feedback/${before.id}/attachments/${attachment.id}`, remove = h.store.delete!;
      h.store.delete = async () => { throw new Error("storage unavailable"); };
      const removed = await h.request<Response>(path, "DELETE"); expect(removed.status).toBe(200);
      expect(removed.body.item.attachments[0]).toMatchObject({ deletedAt: expect.any(String), cleanupPending: true });
      h.store.delete = remove;
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).status).toBe(200);
      expect(h.store.entries.has(attachment.storageKey)).toBe(true);
      await h.db.query("insert into product_feedback_attachment_uploads(id,organization_id,uploaded_by_user_id,object_keys) values($1,$2,$3,$4)", [randomUUID(), owner.organization.id, admin.user.id, ["unrelated-pending-object"]]);
      h.setAuth(admin);
      const retry = await h.request<Response>(path, "DELETE"); expect(retry.status).toBe(200); expect(retry.body.item.attachments[0].cleanupPending).toBe(false);
      expect(h.store.entries.has(attachment.storageKey)).toBe(false);
      expect((await h.db.query("select id from product_feedback_attachment_uploads where object_keys=ARRAY['unrelated-pending-object']")).rows).toHaveLength(1);
      expect((await h.db.query("select id from audit_events where kind='product-feedback-attachment-delete'")).rows).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("rolls back the reference, marker and receipt together when the delete audit fails", async () => {
    const h = await fixture();
    try {
      const before = (await h.create(1)).body.item;
      await h.db.query("create function reject_attachment_delete() returns trigger language plpgsql as $$ begin if new.kind='product-feedback-attachment-delete' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_attachment_delete before insert on audit_events for each row execute function reject_attachment_delete()");
      expect((await h.request(`/api/v1/product-feedback/${before.id}/attachments/${before.attachments[0].id}`, "DELETE")).status).toBe(500);
      expect((await h.request<Response>(`/api/v1/product-feedback/mine/${before.id}`)).body.item.attachments).toEqual(before.attachments);
      expect((await h.db.query("select id from product_feedback_attachment_deletions")).rows).toHaveLength(0);
      expect((await h.db.query("select id from product_feedback_attachment_uploads")).rows).toHaveLength(0);
      expect(h.store.entries.size).toBe(1);
    } finally { await h.close(); }
  }, 120_000);

  it("serializes duplicate deletes with a simultaneous reply without losing its new images or original message", async () => {
    const h = await fixture();
    try {
      const before = (await h.create(1)).body.item, path = `/api/v1/product-feedback/${before.id}/attachments/${before.attachments[0].id}`;
      const results = await Promise.all([h.request(path, "DELETE"), h.request(path, "DELETE"), h.request(`/api/v1/product-feedback/mine/${before.id}/replies`, "POST", { message: "Concurrent evidence", attachments: [image("new.png")] })]);
      expect(results.map((result) => result.status)).toEqual([200,200,201]);
      const read = (await h.request<Response>(`/api/v1/product-feedback/mine/${before.id}`)).body.item;
      expect(read.progressEvents).toHaveLength(2); expect(read.attachments.filter((item) => item.deletedAt)).toHaveLength(1);
      const reply = read.progressEvents.find((event) => event.publicMessage === "Concurrent evidence")!;
      expect(read.attachments.find((item) => item.fileName === "new.png")).toMatchObject({ messageId: reply.id, uploadedByUserId: owner.user.id, deletedAt: null });
      expect((await h.db.query("select id from audit_events where kind='product-feedback-attachment-delete'")).rows).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("leaves cleanup pending during a concurrent new shared reference, then retains its committed bytes on retry", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let writing: Promise<unknown> | undefined;
    try {
      const first = (await h.create(1)).body.item, second = (await h.create(0)).body.item, attachment = first.attachments[0];
      let entered!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
      const sharedId = randomUUID();
      writing = h.db.transaction(async (tx) => {
        await tx.query(`insert into product_feedback_attachments(id,organization_id,feedback_id,storage_key,file_name,content_type,size_bytes,checksum,sort_order,uploaded_by_user_id)
          values($1,$2,$3,$4,'shared.png','image/png',5,'fixture',0,$5)`, [sharedId, owner.organization.id, second.id, attachment.storageKey, owner.user.id]);
        entered(); await held;
      });
      await started;
      const path = `/api/v1/product-feedback/${first.id}/attachments/${attachment.id}`;
      const removed = await h.request<Response>(path, "DELETE"); expect(removed.status).toBe(200); expect(removed.body.item.attachments[0].cleanupPending).toBe(true);
      expect(h.store.entries.has(attachment.storageKey)).toBe(true);
      release(); await writing;
      expect((await h.request<Response>(path, "DELETE")).body.item.attachments[0].cleanupPending).toBe(false);
      expect((await h.request(`/api/v1/product-feedback/mine/${second.id}/attachments/${sharedId}/content`)).status).toBe(200);
    } finally { release(); await writing?.catch(() => undefined); await h.close(); }
  }, 120_000);
});
