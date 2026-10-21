import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createS3ObjectStore } from "../logs/s3ObjectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerProductFeedbackRoutes } from "./routes";
import type { ProductFeedbackUserDto } from "./types";

const available = await isTestDatabaseAvailable();
const owner = makeTestAuthContext({ organizationId: "quota-org", userId: "quota-owner" });
const image = (name: string, size = 10) => ({ fileName: name, contentType: "image/png", contentBase64: Buffer.alloc(size, 1).toString("base64") });

async function fixture() {
  const ephemeral = await createEphemeralTestDatabase("fbquota"), db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: owner.organization.id }, users: [{ id: owner.user.id }] });
  const store = createMemoryObjectStore(), router = createRouter();
  let auth = owner;
  registerProductFeedbackRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth });
  const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const create = (count = 5) => request<{ item: ProductFeedbackUserDto }>("/api/v1/product-feedback", "POST", {
    pagePath: "/settings", pageTitle: "Settings", feedbackType: "experience", description: "Initial report", attachments: Array.from({ length: count }, (_, i) => image(`initial-${i}.png`)) });
  return { db, store, request, create, setAuth: (value: typeof owner) => { auth = value; }, close: async () => { await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("per-message feedback attachments over real HTTP and PostgreSQL", () => {
  it("scopes cleanup to the server-validated normalized active organization and uploader when the persisted home organization differs", async () => {
    const h = await fixture();
    try {
      const homeFeedback = await h.create(0), activeOrganizationId = "quota-active-org", otherUploader = "quota-other-uploader";
      await seedCoreGraph(h.db, { organization: { id: activeOrganizationId }, users: [{ id: otherUploader }] });
      const keys: string[] = [];
      for (const [organizationId, uploadedByUserId] of [[activeOrganizationId, owner.user.id], [owner.organization.id, owner.user.id], [activeOrganizationId, otherUploader]]) {
        const object = await h.store.put({ organizationId, fileName: `${randomUUID()}.png`, contentType: "image/png", bytes: Buffer.from("pending") });
        keys.push(object.storageKey);
        await h.db.query("insert into product_feedback_attachment_uploads(id,organization_id,uploaded_by_user_id,object_keys) values($1,$2,$3,$4)", [randomUUID(), organizationId, uploadedByUserId, [object.storageKey]]);
      }
      const activeAuth = makeTestAuthContext({ organizationId: activeOrganizationId, userId: owner.user.id, roleId: "platform-admin" });
      // TrustedInvocationContext requires the principal to name its active organization;
      // the persisted user's home organization remains unchanged.
      expect((await h.db.query<{ organization_id: string }>("select organization_id from users where id=$1", [owner.user.id])).rows[0].organization_id).toBe(owner.organization.id);
      h.setAuth(activeAuth);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(1);
      expect((await h.create(0)).status).toBe(201);
      // A successful mutation also cleans this caller's pending uploads only.
      expect(h.store.entries.has(keys[0])).toBe(false);
      expect(h.store.entries.has(keys[1])).toBe(true);
      expect(h.store.entries.has(keys[2])).toBe(true);
      expect((await h.request(`/api/v1/product-feedback/mine/${homeFeedback.body.item.id}`)).status).toBe(404);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(0);
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).body).toEqual({ pendingAttachmentCleanupCount: 0 });
      h.setAuth(owner);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(1);
    } finally { await h.close(); }
  }, 120_000);
  it("identifies a deployment object-size or capacity restriction separately from this reply's count and byte allowance", async () => {
    const h = await fixture();
    try {
      const created = await h.create(0);
      for (const [status, code, message] of [[413, "EntityTooLarge", "部署对象存储的单对象大小限制"], [507, "InsufficientStorage", "部署存储空间或配额不足"]] as const) {
        h.store.put = createS3ObjectStore({ endpoint: "http://127.0.0.1:1", bucket: "feedback-test", accessKeyId: "fixture", secretAccessKey: "fixture",
          fetchImpl: async () => new Response(`<Error><Code>${code}</Code></Error>`, { status }) }).put;
        const response = await h.request<{ error: { message: string; details: { reason: string } } }>(`/api/v1/product-feedback/mine/${created.body.item.id}/replies`, "POST", { message: "Under the application allowance", attachments: [image("small.png")] });
        expect(response.status).toBe(500); expect(response.body.error.message).toContain(message);
        expect(response.body.error.details.reason).toBe("deployment-storage-limit");
        expect(h.store.entries.size).toBe(0);
      }
    } finally { await h.close(); }
  }, 120_000);

  it("rolls back a persistence failure with its partial uploads while preserving an existing shared legacy key", async () => {
    const h = await fixture();
    try {
      const kept = await h.create(1), key = kept.body.item.attachments[0].storageKey;
      const draft = await h.request<{ item: ProductFeedbackUserDto }>("/api/v1/product-feedback/drafts", "POST", { description: "Legacy shared", attachments: [image("legacy.png")] });
      const unused = draft.body.item.attachments[0].storageKey;
      await h.db.query("update product_feedback_attachments set storage_key=$2 where id=$1", [draft.body.item.attachments[0].id, key]);
      await h.store.delete!(unused);
      expect((await h.request(`/api/v1/product-feedback/drafts/${draft.body.item.id}`, "PATCH", { retainedAttachmentIds: [] })).status).toBe(200);
      expect(await h.store.get(key)).toBeDefined();
      await h.db.query("create function reject_feedback_reply_audit() returns trigger language plpgsql as $$ begin if new.kind='product-feedback-reply' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_feedback_reply_audit before insert on audit_events for each row execute function reject_feedback_reply_audit()");
      expect((await h.request(`/api/v1/product-feedback/mine/${kept.body.item.id}/replies`, "POST", { message: "Rollback", attachments: [image("not-committed.png")] })).status).toBe(500);
      expect(h.store.entries.size).toBe(1); expect(await h.store.get(key)).toBeDefined();
      expect((await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/mine/${kept.body.item.id}`)).body.item.progressEvents).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);
  it("enforces each request's count, individual and decoded total bytes before any object write", async () => {
    const h = await fixture();
    try {
      const created = await h.create(), path = `/api/v1/product-feedback/mine/${created.body.item.id}`;
      const before = h.store.entries.size;
      for (const attachments of [Array.from({ length: 6 }, (_, i) => image(`extra-${i}.png`)), [image("large.png", 5 * 1024 * 1024 + 1)],
        Array.from({ length: 4 }, (_, i) => image(`total-${i}.png`, 4 * 1024 * 1024)), [{ ...image("text.txt"), contentType: "text/plain" }], [{ ...image("invalid.png"), contentBase64: "not-base64" }]]) {
        expect((await h.request(`${path}/replies`, "POST", { message: "Rejected", attachments })).status).toBe(400);
        expect(h.store.entries.size).toBe(before);
      }
      const reply = await h.request<{ item: ProductFeedbackUserDto }>(`${path}/replies`, "POST", { message: "15MiB allowed independently", attachments: Array.from({ length: 3 }, (_, i) => image(`allowed-${i}.png`, 5 * 1024 * 1024)) });
      expect(reply.status).toBe(201); expect(reply.body.item.attachments).toHaveLength(8);
    } finally { await h.close(); }
  }, 120_000);

  it("persists simultaneous and repeated replies with distinct message ownership and no lifetime cap", async () => {
    const h = await fixture();
    try {
      const created = await h.create(), path = `/api/v1/product-feedback/mine/${created.body.item.id}`;
      const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => h.request(`${path}/replies`, "POST", {
        message: `Concurrent ${index}`, attachments: Array.from({ length: 5 }, (_, i) => image(`reply-${index}-${i}.png`)) })));
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
      const input = { message: "Repeated request", attachments: [image("repeat.png")] };
      expect((await h.request(`${path}/replies`, "POST", input)).status).toBe(201);
      expect((await h.request(`${path}/replies`, "POST", input)).status).toBe(201);
      const read = (await h.request<{ item: ProductFeedbackUserDto }>(path)).body.item;
      expect(read.attachments).toHaveLength(27); expect(read.progressEvents).toHaveLength(7);
      for (const event of read.progressEvents.filter((event) => event.publicMessage?.startsWith("Concurrent"))) {
        expect(read.attachments.filter((attachment) => attachment.messageId === event.id)).toHaveLength(5);
      }
      const repeated = read.progressEvents.filter((event) => event.publicMessage === "Repeated request");
      expect(new Set(repeated.map((event) => event.id)).size).toBe(2);
      expect(h.store.entries.size).toBe(27);
    } finally { await h.close(); }
  }, 120_000);

  it("retains unknown historical attribution and links new draft images only to the actual submission", async () => {
    const h = await fixture();
    try {
      const created = await h.create(1), id = created.body.item.id;
      await h.db.query("update product_feedback_attachments set message_id=null,uploaded_by_user_id=null where feedback_id=$1", [id]);
      const history = (await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/mine/${id}`)).body.item;
      expect(history.attachments[0]).toMatchObject({ messageId: null, uploadedByUserId: null });
      const draft = await h.request<{ item: ProductFeedbackUserDto }>("/api/v1/product-feedback/drafts", "POST", { description: "Draft images", attachments: [image("draft.png")] });
      expect(draft.status).toBe(201); expect(draft.body.item.attachments[0]).toMatchObject({ messageId: null, uploadedByUserId: owner.user.id });
      const submitted = await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/drafts/${draft.body.item.id}/submit`, "POST", {});
      expect(submitted.status).toBe(200);
      expect(submitted.body.item.attachments[0]).toMatchObject({ messageId: submitted.body.item.progressEvents[0].id, uploadedByUserId: owner.user.id });
      expect((await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/mine/${id}`)).body.item.attachments[0]).toMatchObject({ messageId: null, uploadedByUserId: null });
    } finally { await h.close(); }
  }, 120_000);

  it("serializes additions to an unsubmitted draft without letting concurrent saves overfill its initial allowance", async () => {
    const h = await fixture();
    try {
      const draft = await h.request<{ item: ProductFeedbackUserDto }>("/api/v1/product-feedback/drafts", "POST", { description: "Initial draft", attachments: [image("first.png")] });
      const path = `/api/v1/product-feedback/drafts/${draft.body.item.id}`;
      const saved = await Promise.all(Array.from({ length: 2 }, (_, group) => h.request(path, "PATCH", { newAttachments: Array.from({ length: 4 }, (_, i) => image(`draft-${group}-${i}.png`)) })));
      expect(saved.map((item) => item.status).sort()).toEqual([200, 400]);
      expect((await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/mine/${draft.body.item.id}`)).body.item.attachments).toHaveLength(5);
      expect(h.store.entries.size).toBe(5);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(0);
    } finally { await h.close(); }
  }, 120_000);
  it("reports a durable visible cleanup count after storage and cleanup both fail, isolated by uploader and organization", async () => {
    const h = await fixture();
    try {
      const kept = await h.create(1), originalKey = kept.body.item.attachments[0].storageKey;
      const put = h.store.put, remove = h.store.delete!;
      h.store.put = async (input) => { await put(input); throw Object.assign(new Error("quota"), { code: "EDQUOT" }); };
      h.store.delete = async () => { throw new Error("cleanup offline"); };
      const failed = await h.request<{ error: { message: string; details: { reason: string } } }>(`/api/v1/product-feedback/mine/${kept.body.item.id}/replies`, "POST", { message: "Not committed", attachments: [image("failed.png")] });
      expect(failed.status).toBe(500); expect(failed.body.error.message).toContain("部署存储空间或配额不足");
      expect(failed.body.error.details.reason).toBe("deployment-storage-limit");
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(1);
      const stranger = makeTestAuthContext({ organizationId: owner.organization.id, userId: "quota-stranger" });
      await seedCoreGraph(h.db, { organization: { id: stranger.organization.id }, users: [{ id: stranger.user.id }] });
      h.setAuth(stranger);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(0);
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).body).toEqual({ pendingAttachmentCleanupCount: 0 });
      h.setAuth(makeTestAuthContext({ organizationId: "foreign-org", userId: "foreign-uploader" }));
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).body).toEqual({ pendingAttachmentCleanupCount: 0 });
      h.setAuth(owner); h.store.delete = remove; h.store.put = put;
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).body).toEqual({ pendingAttachmentCleanupCount: 0 });
      expect(h.store.entries.size).toBe(1); expect(await h.store.get(originalKey)).toBeDefined();
      const record = await h.request<{ item: ProductFeedbackUserDto }>(`/api/v1/product-feedback/mine/${kept.body.item.id}`);
      expect(record.body.item.progressEvents).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("skips a real in-flight upload during cleanup and persists its message once IO settles", async () => {
    const h = await fixture(); let release: () => void = () => undefined; let request: Promise<unknown> | undefined;
    try {
      const created = await h.create(0), path = `/api/v1/product-feedback/mine/${created.body.item.id}`;
      let entered!: () => void;
      const writing = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; }), put = h.store.put;
      h.store.put = async (input) => { entered(); await held; return put(input); };
      request = h.request(`${path}/replies`, "POST", { message: "Active upload", attachments: [image("active.png")] });
      await writing;
      expect((await h.request("/api/v1/product-feedback/mine/attachment-cleanup", "POST", {})).body).toEqual({ pendingAttachmentCleanupCount: 1 });
      release(); expect((await request as { status: number }).status).toBe(201);
      expect((await h.request<{ pendingAttachmentCleanupCount: number }>("/api/v1/product-feedback/mine")).body.pendingAttachmentCleanupCount).toBe(0);
      expect(h.store.entries.size).toBe(1);
      expect((await h.request<{ item: ProductFeedbackUserDto }>(path)).body.item.attachments).toHaveLength(1);
    } finally { release(); await request?.catch(() => undefined); await h.close(); }
  }, 120_000);
  it("rolls back a failed reply and removes partial storage writes before a normal retry", async () => {
    const h = await fixture();
    try {
      const created = await h.create(0), path = `/api/v1/product-feedback/mine/${created.body.item.id}`;
      const put = h.store.put; let writes = 0;
      h.store.put = async (input) => { const item = await put(input); if (++writes === 2) throw Object.assign(new Error("storage full"), { code: "ENOSPC" }); return item; };
      const failed = await h.request(`${path}/replies`, "POST", { message: "Failed evidence", attachments: [image("first.png"), image("second.png")] });
      expect(failed.status).toBe(500);
      expect((await h.request<{ item: ProductFeedbackUserDto }>(path)).body.item.progressEvents).toHaveLength(1);
      expect(h.store.entries.size).toBe(0);
      h.store.put = put;
      const retry = await h.request<{ item: ProductFeedbackUserDto }>(`${path}/replies`, "POST", { message: "Retry evidence", attachments: [image("first.png"), image("second.png")] });
      expect(retry.status).toBe(201); expect(retry.body.item.attachments).toHaveLength(2);
    } finally { await h.close(); }
  }, 120_000);
  it("accepts five new images after five initial images and reads each under its actual persisted message", async () => {
    const h = await fixture();
    try {
      const created = await h.create(); expect(created.status).toBe(201);
      const id = created.body.item.id, path = `/api/v1/product-feedback/mine/${id}`;
      const replied = await h.request<{ item: ProductFeedbackUserDto }>(`${path}/replies`, "POST", {
        message: "Additional evidence", attachments: Array.from({ length: 5 }, (_, i) => image(`reply-${i}.png`)) });
      expect(replied.status).toBe(201);
      const read = await h.request<{ item: ProductFeedbackUserDto }>(path);
      expect(read.status).toBe(200); expect(read.body.item.attachments).toHaveLength(10);
      const submitted = read.body.item.progressEvents.find((event) => event.kind === "submitted")!;
      const reply = read.body.item.progressEvents.find((event) => event.publicMessage === "Additional evidence")!;
      expect(read.body.item.attachments.filter((item) => item.fileName.startsWith("initial"))).toEqual(Array(5).fill(expect.objectContaining({ messageId: submitted.id, uploadedByUserId: owner.user.id })));
      expect(read.body.item.attachments.filter((item) => item.fileName.startsWith("reply"))).toEqual(Array(5).fill(expect.objectContaining({ messageId: reply.id, uploadedByUserId: owner.user.id })));
    } finally { await h.close(); }
  }, 120_000);
});
