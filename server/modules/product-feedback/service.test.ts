import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import { createPostgresDatabase, type Database } from "../../shared/database/client";
import { cleanupFeedbackAttachmentUploads } from "./attachmentUploads";
import { makeTestAuthContext, type TestAuthContextOverrides } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  appendProductFeedbackProgress,
  createProductFeedback,
  createProductFeedbackDraft,
  deleteProductFeedbackDraft,
  getMyProductFeedback,
  getMyProductFeedbackAttachmentContent,
  getProductFeedback,
  getProductFeedbackAttachmentContent,
  getProductFeedbackStats,
  listMyProductFeedback,
  listProductFeedback,
  listProductFeedbackAssignees,
  replyToProductFeedback,
  saveProductFeedbackDraft,
  submitProductFeedbackDraft,
  updateProductFeedback
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

// product_feedback ids are uuid columns; absent-row probes need well-formed uuid literals.
const MISSING_FEEDBACK_ID = "00000000-0000-4000-8000-00000000f404";

function auth(overrides: TestAuthContextOverrides & { user?: { isActive?: boolean; id?: string; name?: string; email?: string } } = {}): AuthContext {
  const isActive = overrides.user?.isActive ?? overrides.isActive;
  const userId = overrides.user?.id ?? overrides.userId ?? "user-1";
  const name = overrides.user?.name ?? overrides.name ?? "Riley Chen";
  const email = overrides.user?.email ?? overrides.email ?? "riley@example.com";
  return makeTestAuthContext({
    userId,
    organizationId: "org-1",
    name,
    email,
    title: "Software User",
    organizationName: "ChargeLab",
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: [],
    isActive,
    ...overrides
  });
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return auth({
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["admin:access"],
    ...overrides
  });
}

function attachmentInput(fileName: string, sizeBytes = 4) {
  return {
    fileName,
    contentType: "image/png" as const,
    contentBase64: Buffer.alloc(sizeBytes, 1).toString("base64")
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    pagePath: "/parameters",
    pageTitle: "Project Parameters",
    feedbackType: "experience" as const,
    description: "The buttons are hard to scan.",
    attachments: [],
    ...overrides
  };
}

function makeObjectStore() {
  const put = vi.fn(async (input: Parameters<ObjectStore["put"]>[0]): Promise<StoredObject> => {
    return {
      storageKey: `${input.organizationId}/stored-${input.fileName}`,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.bytes.byteLength,
      checksumSha256: `checksum-${input.fileName}`
    };
  });
  const get = vi.fn(async () => Buffer.from("stored-image"));
  const deleteFn = vi.fn(async () => {});

  return { objectStore: { planKey: input => `${input.organizationId}/stored-${input.fileName}`, put, get, delete: deleteFn } as ObjectStore, get, put, deleteFn };
}

describe.skipIf(!databaseAvailable)("product feedback service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function feedbackCount(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from product_feedback where organization_id = $1",
      ["org-1"]
    );
    return Number(result.rows[0].count);
  }

  async function auditEvents(): Promise<
    Array<{ kind: string; action: string; target_type: string | null; target_id: string | null; trace_id: string; app: string; metadata: Record<string, unknown> }>
  > {
    const result = await db.query<{
      kind: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      trace_id: string;
      app: string;
      metadata: Record<string, unknown>;
    }>(
      "select kind, action, target_type, target_id, trace_id, app, metadata from audit_events where organization_id = $1 order by created_at asc, id asc",
      ["org-1"]
    );
    return result.rows;
  }

  it("rejects inactive submit before storing attachments", async () => {
    const { objectStore, put } = makeObjectStore();

    await expect(
      createProductFeedback(
        db,
        objectStore,
        auth({ user: { ...auth().user, isActive: false } }),
        createInput({ attachments: [attachmentInput("shot.png")] })
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", { reason: "inactive" }));
    expect(put).not.toHaveBeenCalled();
    expect(await feedbackCount()).toBe(0);
  });

  it("rejects non-admin list, get, patch, and attachment content", async () => {
    const { objectStore } = makeObjectStore();
    const user = auth();

    await expect(listProductFeedback(db, user, {})).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" })
    );
    await expect(getProductFeedback(db, user, "feedback-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" })
    );
    await expect(updateProductFeedback(db, user, "feedback-1", { status: "in_progress" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" })
    );
    await expect(getProductFeedbackAttachmentContent(db, objectStore, user, "feedback-1", "attachment-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" })
    );
  });

  it("creates feedback with two images, stores attachments, and writes product feedback audit", async () => {
    const { objectStore, put } = makeObjectStore();

    const feedback = await createProductFeedback(
      db,
      objectStore,
      auth(),
      createInput({
        attachments: [attachmentInput("shot-1.png", 8), attachmentInput("shot-2.png", 16)]
      }),
      { requestId: "request-feedback-create-1" }
    );

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][0]).toMatchObject({ organizationId: "org-1", fileName: expect.stringMatching(/^feedback-[a-f0-9-]{36}\.png$/), contentType: "image/png" });
    const names = put.mock.calls.map(([input]) => input.fileName);
    expect(new Set(names).size).toBe(2);
    expect(put.mock.calls[0][0].bytes.byteLength).toBe(8);
    expect(put.mock.calls[1][0].bytes.byteLength).toBe(16);

    // The insert's RETURNING order is not guaranteed; sortOrder carries the contract.
    expect(feedback.attachments).toHaveLength(2);
    const bySortOrder = [...feedback.attachments].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(bySortOrder[0]).toMatchObject({
      storageKey: `org-1/stored-${names[0]}`,
      checksum: `checksum-${names[0]}`,
      fileName: "shot-1.png",
      sortOrder: 0
    });
    expect(bySortOrder[1]).toMatchObject({
      storageKey: `org-1/stored-${names[1]}`,
      checksum: `checksum-${names[1]}`,
      fileName: "shot-2.png",
      sortOrder: 1
    });

    const stored = await db.query<{ storage_key: string; checksum: string; sort_order: number }>(
      "select storage_key, checksum, sort_order from product_feedback_attachments where organization_id = $1 and feedback_id = $2 order by sort_order asc",
      ["org-1", feedback.id]
    );
    expect(stored.rows).toEqual([
      { storage_key: `org-1/stored-${names[0]}`, checksum: `checksum-${names[0]}`, sort_order: 0 },
      { storage_key: `org-1/stored-${names[1]}`, checksum: `checksum-${names[1]}`, sort_order: 1 }
    ]);

    const audit = (await auditEvents()).find((event) => event.kind === "product-feedback-create");
    expect(audit).toMatchObject({
      app: "product-feedback",
      kind: "product-feedback-create",
      action: "create",
      target_type: "product-feedback",
      target_id: feedback.id,
      trace_id: "request-feedback-create-1"
    });
    expect(audit?.metadata).toMatchObject({ attachmentCount: 2, pagePath: "/parameters", status: "open" });
  });

  it("rejects a single attachment over 5MB", async () => {
    const { objectStore, put } = makeObjectStore();

    await expect(
      createProductFeedback(db, objectStore, auth(), createInput({ attachments: [attachmentInput("huge.png", 5 * 1024 * 1024 + 1)] }))
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Attachment exceeds the 5MB per-image limit."));
    expect(put).not.toHaveBeenCalled();
    expect(await feedbackCount()).toBe(0);
  });

  it("rejects total attachments over 15MB", async () => {
    const { objectStore, put } = makeObjectStore();

    await expect(
      createProductFeedback(
        db,
        objectStore,
        auth(),
        createInput({
          attachments: [
            attachmentInput("one.png", 4 * 1024 * 1024),
            attachmentInput("two.png", 4 * 1024 * 1024),
            attachmentInput("three.png", 4 * 1024 * 1024),
            attachmentInput("four.png", 4 * 1024 * 1024)
          ]
        })
      )
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit."));
    expect(put).not.toHaveBeenCalled();
    expect(await feedbackCount()).toBe(0);
  });

  it("records legacy status updates and requires a resolution and public explanation for closing", async () => {
    const { objectStore } = makeObjectStore();
    const open = await createProductFeedback(db, objectStore, auth(), createInput());

    const updated = await updateProductFeedback(db, adminAuth(), open.id, { status: "in_progress", adminNote: null });
    expect(updated.status).toBe("in_progress");
    expect(updated.adminNote).toBeNull();
    expect(updated.progressEvents).toContainEqual(expect.objectContaining({ fromStatus: "open", toStatus: "in_progress", author: "team" }));
    await expect(getProductFeedback(db, adminAuth(), open.id)).resolves.toMatchObject({
      status: "in_progress",
      adminNote: null
    });

    // Closing cannot bypass the shared resolution contract.
    const skipped = await createProductFeedback(db, objectStore, auth(), createInput());
    await expect(updateProductFeedback(db, adminAuth(), skipped.id, { status: "closed" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Resolution code is required when closing feedback.")
    );
    await expect(getProductFeedback(db, adminAuth(), skipped.id)).resolves.toMatchObject({ status: "open" });

    // A closed row cannot be updated further, even to change the admin note.
    await updateProductFeedback(db, adminAuth(), updated.id, {
      status: "closed", resolutionCode: "completed", publicMessage: "Verified and closed."
    });
    await expect(updateProductFeedback(db, adminAuth(), updated.id, { adminNote: "Already handled." })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated without reopening.")
    );
  });

  it("returns NOT_FOUND for missing or cross-org feedback get", async () => {
    await expect(getProductFeedback(db, adminAuth(), MISSING_FEEDBACK_ID)).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: MISSING_FEEDBACK_ID })
    );

    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "OtherOrg" },
      users: [{ id: "user-2", name: "Renn Ito", email: "renn@example.com" }]
    });
    const otherOrgAuth = makeTestAuthContext({
      userId: "user-2",
      organizationId: "org-2",
      organizationName: "OtherOrg",
      roleId: "software-user",
      permissions: []
    });
    const { objectStore } = makeObjectStore();
    const foreign = await createProductFeedback(db, objectStore, otherOrgAuth, createInput());

    await expect(getProductFeedback(db, adminAuth(), foreign.id)).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: foreign.id })
    );
  });

  it("writes update audit events", async () => {
    const { objectStore } = makeObjectStore();
    const open = await createProductFeedback(db, objectStore, auth(), createInput());
    await updateProductFeedback(db, adminAuth(), open.id, { status: "in_progress" });

    await updateProductFeedback(
      db,
      adminAuth(),
      open.id,
      {
        status: "closed",
        resolutionCode: "completed",
        publicMessage: "Fixed in the next release.",
        adminNote: "Fixed in the next release."
      },
      { requestId: "request-feedback-update-1" }
    );

    const audit = (await auditEvents()).find((event) => event.trace_id === "request-feedback-update-1" && event.kind === "product-feedback-update");
    expect(audit).toMatchObject({
      app: "product-feedback",
      kind: "product-feedback-update",
      action: "update",
      target_type: "product-feedback",
      target_id: open.id,
      trace_id: "request-feedback-update-1"
    });
    expect(audit?.metadata).toMatchObject({ previousStatus: "in_progress", nextStatus: "closed" });
  });

  it("listMyProductFeedback and getMyProductFeedback enforce user authentication and isolation", async () => {
    const { objectStore } = makeObjectStore();
    const created = await createProductFeedback(
      db,
      objectStore,
      auth(),
      createInput({
        attachments: [attachmentInput("user-shot.png")]
      })
    );

    // Active user can list and view their own feedback
    const myList = await listMyProductFeedback(db, auth());
    expect(myList.items).toHaveLength(1);
    expect(myList.items[0].id).toBe(created.id);
    expect((myList.items[0] as any).adminNote).toBeUndefined();

    const detail = await getMyProductFeedback(db, auth(), created.id);
    expect(detail.id).toBe(created.id);
    expect(detail.attachments).toHaveLength(1);
    expect((detail as any).adminNote).toBeUndefined();

    // Attachment content works for owner
    const attachmentContent = await getMyProductFeedbackAttachmentContent(
      db,
      objectStore,
      auth(),
      created.id,
      detail.attachments[0].id
    );
    expect(attachmentContent.bytes.toString()).toBe("stored-image");

    // Inactive user cannot access
    const inactiveAuth = auth({ isActive: false });
    await expect(listMyProductFeedback(db, inactiveAuth)).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", { reason: "inactive" })
    );

    // Another user in the same org cannot access
    const colleagueAuth = auth({ userId: "user-colleague", email: "colleague@example.com" });
    await expect(getMyProductFeedback(db, colleagueAuth, created.id)).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: created.id })
    );

    await expect(
      getMyProductFeedbackAttachmentContent(db, objectStore, colleagueAuth, created.id, detail.attachments[0].id)
    ).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: created.id })
    );
  });

  it("draft lifecycle: create, update with attachment delta, delete, and submit with audit", async () => {
    const { objectStore, put, deleteFn } = makeObjectStore();

    // 1. Create draft allows empty description and saves without audit events
    const draft = await createProductFeedbackDraft(
      db,
      objectStore,
      auth(),
      {
        pagePath: "/dashboard",
        pageTitle: "Dashboard",
        feedbackType: "experience",
        description: "",
        attachments: [attachmentInput("initial.png")]
      }
    );
    expect(draft.id).toBeDefined();
    expect(draft.submittedAt).toBeNull();
    expect(draft.description).toBe("");
    expect(draft.attachments).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);

    // No audit event emitted during draft creation
    expect(await auditEvents()).toHaveLength(0);

    // Admin cannot view or update draft
    await expect(getProductFeedback(db, adminAuth(), draft.id)).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: draft.id })
    );
    await expect(updateProductFeedback(db, adminAuth(), draft.id, { status: "in_progress" })).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: draft.id })
    );

    // 2. Save draft: delta attachments (discard initial.png, add new-1.png and new-2.png)
    const saved = await saveProductFeedbackDraft(
      db,
      objectStore,
      auth(),
      draft.id,
      {
        description: "Draft text in progress",
        retainedAttachmentIds: [], // discard initial
        newAttachments: [attachmentInput("new-1.png"), attachmentInput("new-2.png")]
      }
    );
    expect(saved.description).toBe("Draft text in progress");
    expect(saved.attachments).toHaveLength(2);
    expect(deleteFn).toHaveBeenCalledWith(draft.attachments[0].storageKey);
    expect(await auditEvents()).toHaveLength(0); // still no audit event

    // 3. Draft submission requires non-empty description
    await expect(
      submitProductFeedbackDraft(db, auth(), draft.id, { description: "   " })
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Description is required to submit feedback.")
    );

    // 4. Formal submission succeeds, updates status to open, creates progress event, emits product-feedback-submit audit
    const submitted = await submitProductFeedbackDraft(
      db,
      auth(),
      draft.id,
      { description: "Final clear description." }
    );
    expect(submitted.status).toBe("open");
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.description).toBe("Final clear description.");
    expect(submitted.progressEvents).toHaveLength(1);
    expect(submitted.progressEvents[0].kind).toBe("submitted");

    // Exactly one audit event emitted for submission
    const events = await auditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "product-feedback-submit",
      action: "create",
      target_type: "product-feedback",
      target_id: draft.id
    });

    // 5. Calling draft endpoints on already submitted feedback is rejected with 400 VALIDATION_FAILED
    await expect(
      saveProductFeedbackDraft(db, objectStore, auth(), draft.id, { description: "attempt to edit after submit" })
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Submitted feedback cannot be edited as draft.", { feedbackId: draft.id })
    );

    await expect(
      deleteProductFeedbackDraft(db, objectStore, auth(), draft.id)
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Submitted feedback cannot be deleted as draft.", { feedbackId: draft.id })
    );

    await expect(
      submitProductFeedbackDraft(db, auth(), draft.id)
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Product feedback has already been submitted.", { feedbackId: draft.id })
    );

    // 6. Delete an actual draft
    const draft2 = await createProductFeedbackDraft(
      db,
      objectStore,
      auth(),
      { attachments: [attachmentInput("discard-me.png")] }
    );
    expect(draft2.id).toBeDefined();
    deleteFn.mockClear();

    const deleteResult = await deleteProductFeedbackDraft(db, objectStore, auth(), draft2.id);
    expect(deleteResult).toEqual({ ok: true });
    expect(deleteFn).not.toHaveBeenCalled();

    await expect(getMyProductFeedback(db, auth(), draft2.id)).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: draft2.id })
    );
  });

  it("appendProductFeedbackProgress: full state machine lifecycle, internal message isolation, and audit", async () => {
    const { objectStore } = makeObjectStore();
    const submitted = await createProductFeedback(db, objectStore, auth(), createInput());
    expect(submitted.status).toBe("open");

    // open -> in_progress
    const inProgress = await appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
      toStatus: "in_progress",
      internalMessage: "Assigned to backend team"
    });
    expect(inProgress.status).toBe("in_progress");
    // Events: [submitted, status_changed(open->in_progress)] — order by created_at,id
    expect(inProgress.progressEvents).toHaveLength(2);
    const evt1 = inProgress.progressEvents.find((e) => e.kind === "status_changed");
    expect(evt1).toBeDefined();
    expect(evt1?.fromStatus).toBe("open");
    expect(evt1?.toStatus).toBe("in_progress");

    // Internal message must NOT appear in user-visible DTO
    const userView = await getMyProductFeedback(db, auth(), submitted.id);
    const userEvent = userView.progressEvents[0];
    expect("internalMessage" in userEvent).toBe(false);

    // in_progress -> resolved requires resolutionCode and publicMessage
    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, { toStatus: "resolved" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Resolution code is required when resolving feedback."));

    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, { toStatus: "resolved", resolutionCode: "completed" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Public message is required when resolving feedback."));

    // in_progress -> resolved with all required fields
    const resolved = await appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
      toStatus: "resolved",
      resolutionCode: "completed",
      publicMessage: "Fixed in v2.5.1"
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionCode).toBe("completed");
    // Events: [submitted, open->in_progress, in_progress->resolved]
    expect(resolved.progressEvents).toHaveLength(3);
    // latestPublicProgress reflects the most recent public message across all events
    expect(resolved.latestPublicProgress).toBeTruthy();

    // resolved -> in_progress (reopen) requires explanation
    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, { toStatus: "in_progress" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "An explanation is required when reopening feedback."));

    const reopened = await appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
      toStatus: "in_progress",
      publicMessage: "User reports issue persists"
    });
    expect(reopened.status).toBe("in_progress");
    // Check reopened event exists (order may vary within same ms)
    expect(reopened.progressEvents.some((e) => e.kind === "reopened")).toBe(true);

    // in_progress -> closed requires resolutionCode
    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, { toStatus: "closed" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Resolution code is required when closing feedback."));

    const closed = await appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
      toStatus: "closed",
      resolutionCode: "duplicate",
      publicMessage: "Tracked in the original feedback.",
      internalMessage: "Dupe of #123"
    });
    expect(closed.status).toBe("closed");

    // closed -> appending without reopening is rejected
    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, { internalMessage: "post-close note" })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated without reopening."));

    // closed -> in_progress (reopen from closed)
    const reopenedFromClosed = await appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
      toStatus: "in_progress",
      publicMessage: "Reopened after further investigation"
    });
    expect(reopenedFromClosed.status).toBe("in_progress");
    expect(reopenedFromClosed.progressEvents.some((e) => e.kind === "reopened")).toBe(true);

    // Audit events recorded for all transitions
    const events = await auditEvents();
    const progressAudits = events.filter((e) => e.kind === "product-feedback-progress");
    expect(progressAudits.length).toBeGreaterThanOrEqual(5);
    for (const audit of progressAudits) {
      expect(audit).toMatchObject({
        kind: "product-feedback-progress",
        action: "update",
        target_type: "product-feedback",
        target_id: submitted.id
      });
      // Audit metadata must not store full message text — only boolean flags
      expect(audit.metadata).not.toHaveProperty("publicMessage");
      expect(audit.metadata).not.toHaveProperty("internalMessage");
    }
    const reopenAudit = progressAudits.find(
      (e) => (e.metadata as Record<string, unknown>).previousStatus === "closed"
    );
    expect(reopenAudit).toBeDefined();
    expect(reopenAudit?.metadata).toMatchObject({
      hasPublicMessage: true,
      nextStatus: "in_progress"
    });
  });

  it("appendProductFeedbackProgress: illegal transitions rejected", async () => {
    const { objectStore } = makeObjectStore();
    const submitted = await createProductFeedback(db, objectStore, auth(), createInput());

    // open -> resolved is not a direct transition
    await expect(
      appendProductFeedbackProgress(db, adminAuth(), submitted.id, {
        toStatus: "resolved",
        resolutionCode: "completed",
        publicMessage: "skip"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("open -> resolved") });

    // Non-admin cannot call appendProgress
    await expect(
      appendProductFeedbackProgress(db, auth(), submitted.id, { toStatus: "in_progress" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters my feedback on the server, separates drafts, and follows the filtered cursor", async () => {
    const { objectStore } = makeObjectStore();
    for (let i = 0; i < 52; i++) {
      await createProductFeedback(db, objectStore, auth(), createInput({ description: `Findable issue ${i}` }));
    }
    const draft = await createProductFeedbackDraft(db, objectStore, auth(), { description: "Findable draft" });
    const page = await listMyProductFeedback(db, auth(), { q: "Findable", status: "open", limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    const next = await listMyProductFeedback(db, auth(), { q: "Findable", status: "open", limit: 50, cursor: page.nextCursor! });
    expect(next.items).toHaveLength(2);
    expect(new Set([...page.items, ...next.items].map((item) => item.id)).size).toBe(52);
    expect((await listMyProductFeedback(db, auth(), { status: "draft", q: "Findable" })).items.map((item) => item.id)).toEqual([draft.id]);
    expect((await listMyProductFeedback(db, auth(), { q: "does-not-exist" })).items).toEqual([]);
    expect((await listMyProductFeedback(db, auth({ userId: "another-user" }), { q: "Findable" })).items).toEqual([]);
  });

  it("assigns only active administrators from the same organization and stores triage fields", async () => {
    const { objectStore } = makeObjectStore();
    await seedCoreGraph(db, {
      organization: { id: "org-1" }, users: [
        { id: "admin-1", name: "Admin One", email: "admin1@example.com" },
        { id: "inactive-admin", name: "Inactive", email: "inactive@example.com", isActive: false }
      ]
    });
    await seedCoreGraph(db, { organization: { id: "org-2" }, users: [{ id: "foreign-admin", email: "foreign@example.com" }] });
    for (const [id, org] of [["admin-1", "org-1"], ["inactive-admin", "org-1"], ["foreign-admin", "org-2"]]) {
      await db.query("insert into user_role_bindings (id, user_id, organization_id, role_id) values ($1, $1, $2, 'admin')", [id, org]);
    }
    const choices = await listProductFeedbackAssignees(db, adminAuth());
    expect(choices.items).toEqual([{ id: "admin-1", name: "Admin One", username: null }]);
    await expect(listProductFeedbackAssignees(db, auth())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const item = await createProductFeedback(db, objectStore, auth(), createInput());
    for (const id of ["user-1", "inactive-admin", "foreign-admin", "missing"]) {
      await expect(updateProductFeedback(db, adminAuth(), item.id, { assigneeUserId: id })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    const updated = await updateProductFeedback(db, adminAuth(), item.id, { priority: "high", assigneeUserId: "admin-1" });
    expect(updated).toMatchObject({ priority: "high", assigneeUserId: "admin-1", assignee: { id: "admin-1", name: "Admin One" } });
    expect((await listProductFeedback(db, adminAuth())).items[0].assigneeUserId).toBe("admin-1");
    expect(await updateProductFeedback(db, adminAuth(), item.id, { assigneeUserId: null })).toMatchObject({ assigneeUserId: null, assignee: null });
    expect(await getMyProductFeedback(db, auth(), item.id)).not.toHaveProperty("assigneeUserId");
  });

  it("notifies on public admin progress and status changes while keeping internal notes private", async () => {
    const { objectStore } = makeObjectStore();
    const item = await createProductFeedback(db, objectStore, auth(), createInput());
    await updateProductFeedback(db, adminAuth(), item.id, { adminNote: "private triage" });
    expect((await getMyProductFeedback(db, auth(), item.id)).progressEvents).toHaveLength(1);
    expect((await db.query("select * from user_notifications where organization_id = 'org-1'")).rows).toHaveLength(0);
    await updateProductFeedback(db, adminAuth(), item.id, { status: "in_progress" });
    await appendProductFeedbackProgress(db, adminAuth(), item.id, { publicMessage: "We have a fix", internalMessage: "private debug details" });
    const events = (await getMyProductFeedback(db, auth(), item.id)).progressEvents;
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.publicMessage === "We have a fix")).toMatchObject({ author: "team" });
    expect(JSON.stringify(events)).not.toContain("private");
    expect(JSON.stringify(events)).not.toContain("actorUserId");
    const notifications = (await db.query<{ action_url: string; body: string }>("select action_url, body from user_notifications where organization_id = 'org-1' order by created_at, id")).rows;
    expect(notifications).toHaveLength(2);
    expect(notifications.every((notification) => notification.action_url === `/feedback?id=${item.id}`)).toBe(true);
    expect(JSON.stringify(notifications)).not.toContain("private");
  });

  it("allows submitter replies, additive evidence and explicit reopening while preserving tenancy and privacy", async () => {
    const { objectStore, put } = makeObjectStore();
    const item = await createProductFeedback(db, objectStore, auth(), createInput({ attachments: [attachmentInput("first.png")] }));
    const replied = await replyToProductFeedback(db, objectStore, auth(), item.id, { message: "More details", attachments: [attachmentInput("second.png")] });
    expect(replied.attachments).toHaveLength(2);
    expect(replied.progressEvents).toContainEqual(expect.objectContaining({ publicMessage: "More details", author: "submitter" }));
    expect(JSON.stringify(replied.progressEvents)).not.toContain("actorUserId");
    const stranger = auth({ userId: "stranger" });
    await expect(replyToProductFeedback(db, objectStore, stranger, item.id, { message: "No access" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(replyToProductFeedback(db, objectStore, auth({ organizationId: "org-2" }), item.id, { message: "No access" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const draft = await createProductFeedbackDraft(db, objectStore, auth(), { description: "Draft" });
    await expect(replyToProductFeedback(db, objectStore, auth(), draft.id, { message: "Draft reply" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, { message: " " })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, { message: "Already open", reopen: true })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await updateProductFeedback(db, adminAuth(), item.id, { status: "closed", resolutionCode: "completed", publicMessage: "Verified" });
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, { message: "Still broken" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const reopened = await replyToProductFeedback(db, objectStore, auth(), item.id, { message: "Still broken", reopen: true });
    expect(reopened).toMatchObject({ status: "in_progress", resolutionCode: null });
    expect(reopened.progressEvents).toContainEqual(expect.objectContaining({ kind: "reopened", publicMessage: "Still broken", author: "submitter" }));
    expect(put).toHaveBeenCalledTimes(2);
    expect((await auditEvents()).some((event) => event.kind === "product-feedback-reply")).toBe(true);
  });

  it("enforces each reply's count and byte limits before storing any new file", async () => {
    const { objectStore, put } = makeObjectStore();
    const item = await createProductFeedback(db, objectStore, auth(), createInput({ attachments: [attachmentInput("first.png")] }));
    put.mockClear();
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, {
      message: "More", attachments: Array.from({ length: 6 }, (_, index) => attachmentInput(`shot-${index}.png`))
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, {
      message: "More", attachments: [attachmentInput("large.png", 5 * 1024 * 1024 + 1)]
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await db.query("update product_feedback_attachments set size_bytes = $1 where feedback_id = $2", [15 * 1024 * 1024, item.id]);
    await expect(replyToProductFeedback(db, objectStore, auth(), item.id, {
      message: "More", attachments: Array.from({ length: 4 }, (_, index) => attachmentInput(`large-total-${index}.png`, 4 * 1024 * 1024))
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(put).not.toHaveBeenCalled();
    expect((await getMyProductFeedback(db, auth(), item.id)).progressEvents).toHaveLength(1);
  });

  it("rejects clearing closed notes and preserves historical notes in the private journal when edited", async () => {
    const { objectStore } = makeObjectStore();
    const item = await createProductFeedback(db, objectStore, auth(), createInput());
    // Simulate a legacy note written after the original migration backfill.
    await db.query("update product_feedback set admin_note = 'Legacy investigation' where id = $1", [item.id]);
    const cleared = await updateProductFeedback(db, adminAuth(), item.id, { adminNote: null });
    expect(cleared.adminNote).toBeNull();
    expect(cleared.progressEvents).toContainEqual(expect.objectContaining({ kind: "legacy_note", internalMessage: "Legacy investigation" }));
    expect(cleared.progressEvents).toContainEqual(expect.objectContaining({ kind: "progress", internalMessage: "处理备注已清空" }));
    expect(JSON.stringify((await getMyProductFeedback(db, auth(), item.id)).progressEvents)).not.toContain("Legacy investigation");
    await updateProductFeedback(db, adminAuth(), item.id, { status: "closed", resolutionCode: "completed", publicMessage: "Done", adminNote: "Final private note" });
    for (const adminNote of [null, "", " ", "replacement"]) {
      await expect(updateProductFeedback(db, adminAuth(), item.id, { adminNote })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect(await updateProductFeedback(db, adminAuth(), item.id, { priority: "low" })).toMatchObject({ status: "closed", priority: "low", adminNote: "Final private note" });
    const reopened = await updateProductFeedback(db, adminAuth(), item.id, { status: "in_progress", publicMessage: "Need another check", adminNote: null });
    expect(reopened.status).toBe("in_progress");
    expect(reopened.progressEvents).toContainEqual(expect.objectContaining({ internalMessage: "Final private note" }));
  });

  it("detaches draft images without deleting content shared by submitted feedback", async () => {
    const { objectStore, deleteFn } = makeObjectStore();
    const image = attachmentInput("shared.png");
    const submitted = await createProductFeedback(db, objectStore, auth(), createInput({ attachments: [image] }));
    const draft = await createProductFeedbackDraft(db, objectStore, auth(), { attachments: [image] });
    // Historical content-addressed images can share a key; new uploads have
    // unique physical names but must still preserve these old references.
    await db.query("update product_feedback_attachments set storage_key=$2 where id=$1", [draft.attachments[0].id, submitted.attachments[0].storageKey]);
    await saveProductFeedbackDraft(db, objectStore, auth(), draft.id, { retainedAttachmentIds: [] });
    expect((await getMyProductFeedback(db, auth(), draft.id)).attachments).toEqual([]);
    const draft2 = await createProductFeedbackDraft(db, objectStore, auth(), { attachments: [image] });
    await deleteProductFeedbackDraft(db, objectStore, auth(), draft2.id);
    expect(deleteFn).not.toHaveBeenCalled();
    await expect(getMyProductFeedbackAttachmentContent(db, objectStore, auth(), submitted.id, submitted.attachments[0].id)).resolves.toMatchObject({ bytes: Buffer.from("stored-image") });
  });

  it("serializes concurrent replies without imposing a lifetime attachment limit", async () => {
    const isolated = await createEphemeralTestDatabase("fbreply");
    const concurrentDb = createPostgresDatabase(isolated.url);
    try {
      await seedCoreGraph(concurrentDb, { organization: { id: "org-1" }, users: [{ id: "user-1", email: "riley@example.com" }] });
      const { objectStore } = makeObjectStore();
      const item = await createProductFeedback(concurrentDb, objectStore, auth(), createInput({
        attachments: Array.from({ length: 4 }, (_, index) => attachmentInput(`original-${index}.png`))
      }));
      const replies = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => replyToProductFeedback(
        concurrentDb, objectStore, auth(), item.id,
        { message: `Concurrent reply ${index}`, attachments: [attachmentInput(`extra-${index}.png`)] }
      )));
      const rejected = replies.filter((reply) => reply.status === "rejected");
      expect(rejected.map(reply => reply.reason)).toEqual([]);
      expect(replies.filter((reply) => reply.status === "fulfilled")).toHaveLength(8);
      const final = await getMyProductFeedback(concurrentDb, auth(), item.id);
      expect(final.attachments).toHaveLength(12);
      expect(final.progressEvents).toHaveLength(9);
      expect(new Set(final.attachments.filter((attachment) => attachment.fileName.startsWith("extra-")).map((attachment) => attachment.messageId)).size).toBe(8);
    } finally {
      await concurrentDb.close();
      await isolated.drop();
    }
  });

  it("keeps an admitted reply's upload receipt while another reply cleans up before its transaction starts", async () => {
    const isolated = await createEphemeralTestDatabase("fbadmission"), concurrentDb = createPostgresDatabase(isolated.url);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let admitted!: () => void;
    const started = new Promise<void>(resolve => { admitted = resolve; });
    try {
      await seedCoreGraph(concurrentDb, { organization: { id: "org-1" }, users: [{ id: "user-1" }] });
      const { objectStore } = makeObjectStore();
      const item = await createProductFeedback(concurrentDb, objectStore, auth(), createInput());
      const delayedDb: Database = { query: concurrentDb.query, transaction: async (fn, options) => {
        admitted(); await held; return concurrentDb.transaction(fn, options);
      } };
      const pending = replyToProductFeedback(delayedDb, objectStore, auth(), item.id, {
        message: "Waiting for a transaction", attachments: [attachmentInput("delayed.png")]
      }).then(result => ({ result }), error => ({ error }));
      await started;
      try {
        await replyToProductFeedback(concurrentDb, objectStore, auth(), item.id, { message: "Already completed", attachments: [attachmentInput("completed.png")] });
      } finally { release(); }
      expect(await pending).toMatchObject({ result: { id: item.id } });
      const final = await getMyProductFeedback(concurrentDb, auth(), item.id);
      expect(final.progressEvents).toHaveLength(3); expect(final.attachments).toHaveLength(2);
    } finally { release(); await concurrentDb.close(); await isolated.drop(); }
  });

  it("reclaims expired upload admissions and immediately eligible failed receipts while retaining a fresh admission", async () => {
    const { objectStore, deleteFn } = makeObjectStore();
    await db.query(`insert into product_feedback_attachment_uploads(id,organization_id,uploaded_by_user_id,object_keys,in_flight,created_at) values
      ('00000000-0000-4000-8000-000000000241','org-1','user-1',ARRAY['expired-admission'],true,now()-interval '6 minutes'),
      ('00000000-0000-4000-8000-000000000242','org-1','user-1',ARRAY['fresh-admission'],true,now()),
      ('00000000-0000-4000-8000-000000000243','org-1','user-1',ARRAY['failed-admission'],false,now())`);
    await cleanupFeedbackAttachmentUploads(db, objectStore, auth());
    expect(deleteFn.mock.calls).toEqual([["expired-admission"],["failed-admission"]]);
    expect((await db.query("select object_keys from product_feedback_attachment_uploads")).rows).toEqual([{ object_keys: ["fresh-admission"] }]);
  });

  it("protects active object IO with its row lock after the admission expiry", async () => {
    const isolated = await createEphemeralTestDatabase("fbactive"), concurrentDb = createPostgresDatabase(isolated.url);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    let pending: Promise<unknown> | undefined;
    try {
      await seedCoreGraph(concurrentDb, { organization: { id: "org-1" }, users: [{ id: "user-1" }] });
      const { objectStore, deleteFn } = makeObjectStore();
      const item = await createProductFeedback(concurrentDb, objectStore, auth(), createInput());
      let first = true;
      const expiredAdmission: Database = { query: concurrentDb.query, transaction: async (fn, options) => {
        if (first) {
          first = false;
          await concurrentDb.query("update product_feedback_attachment_uploads set created_at=now()-interval '6 minutes' where in_flight");
        }
        return concurrentDb.transaction(fn, options);
      } };
      pending = replyToProductFeedback(expiredAdmission, { ...objectStore, put: async input => {
        entered(); await held; return objectStore.put(input);
      } }, auth(), item.id, { message: "Slow object IO", attachments: [attachmentInput("slow.png")] });
      await started;
      await cleanupFeedbackAttachmentUploads(concurrentDb, objectStore, auth());
      expect(deleteFn).not.toHaveBeenCalled();
      expect((await concurrentDb.query("select id from product_feedback_attachment_uploads")).rows).toHaveLength(1);
      release(); await pending;
      expect((await getMyProductFeedback(concurrentDb, auth(), item.id)).attachments).toHaveLength(1);
    } finally { release(); await pending; await concurrentDb.close(); await isolated.drop(); }
  });

  it("requires a public explanation when closing via progress or legacy PATCH and when reopening", async () => {
    const { objectStore } = makeObjectStore();
    const item = await createProductFeedback(db, objectStore, auth(), createInput());
    await expect(updateProductFeedback(db, adminAuth(), item.id, { status: "closed", resolutionCode: "invalid" })).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("Public message") });
    await expect(appendProductFeedbackProgress(db, adminAuth(), item.id, { toStatus: "closed", resolutionCode: "invalid", internalMessage: "private" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await appendProductFeedbackProgress(db, adminAuth(), item.id, { toStatus: "closed", resolutionCode: "invalid", publicMessage: "Not enough information" });
    await expect(appendProductFeedbackProgress(db, adminAuth(), item.id, { toStatus: "in_progress", internalMessage: "private" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("getProductFeedbackStats: counts by status", async () => {
    const { objectStore } = makeObjectStore();
    const f1 = await createProductFeedback(db, objectStore, auth(), createInput());
    const f2 = await createProductFeedback(db, objectStore, auth(), createInput());
    await createProductFeedback(db, objectStore, auth(), createInput());

    await appendProductFeedbackProgress(db, adminAuth(), f1.id, { toStatus: "in_progress" });
    await appendProductFeedbackProgress(db, adminAuth(), f2.id, { toStatus: "in_progress" });
    await appendProductFeedbackProgress(db, adminAuth(), f2.id, {
      toStatus: "resolved",
      resolutionCode: "completed",
      publicMessage: "Done"
    });

    const stats = await getProductFeedbackStats(db, adminAuth());
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.resolved).toBe(1);
    expect(stats.closed).toBe(0);
  });
});

