import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext, type TestAuthContextOverrides } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
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

  return { objectStore: { put, get, delete: deleteFn } as ObjectStore, get, put, deleteFn };
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
    expect(put.mock.calls[0][0]).toMatchObject({ organizationId: "org-1", fileName: "shot-1.png", contentType: "image/png" });
    expect(put.mock.calls[0][0].bytes.byteLength).toBe(8);
    expect(put.mock.calls[1][0].bytes.byteLength).toBe(16);

    // The insert's RETURNING order is not guaranteed; sortOrder carries the contract.
    expect(feedback.attachments).toHaveLength(2);
    const bySortOrder = [...feedback.attachments].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(bySortOrder[0]).toMatchObject({
      storageKey: "org-1/stored-shot-1.png",
      checksum: "checksum-shot-1.png",
      sortOrder: 0
    });
    expect(bySortOrder[1]).toMatchObject({
      storageKey: "org-1/stored-shot-2.png",
      checksum: "checksum-shot-2.png",
      sortOrder: 1
    });

    const stored = await db.query<{ storage_key: string; checksum: string; sort_order: number }>(
      "select storage_key, checksum, sort_order from product_feedback_attachments where organization_id = $1 and feedback_id = $2 order by sort_order asc",
      ["org-1", feedback.id]
    );
    expect(stored.rows).toEqual([
      { storage_key: "org-1/stored-shot-1.png", checksum: "checksum-shot-1.png", sort_order: 0 },
      { storage_key: "org-1/stored-shot-2.png", checksum: "checksum-shot-2.png", sort_order: 1 }
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

  it("allows open to in_progress and rejects skip or closed updates", async () => {
    const { objectStore } = makeObjectStore();
    const open = await createProductFeedback(db, objectStore, auth(), createInput());

    const updated = await updateProductFeedback(db, adminAuth(), open.id, { status: "in_progress", adminNote: null });
    expect(updated.status).toBe("in_progress");
    expect(updated.adminNote).toBeNull();
    await expect(getProductFeedback(db, adminAuth(), open.id)).resolves.toMatchObject({
      status: "in_progress",
      adminNote: null
    });

    // open -> closed skips in_progress and is refused; the row stays open.
    const skipped = await createProductFeedback(db, objectStore, auth(), createInput());
    await expect(updateProductFeedback(db, adminAuth(), skipped.id, { status: "closed" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Illegal product feedback status transition: open -> closed.")
    );
    await expect(getProductFeedback(db, adminAuth(), skipped.id)).resolves.toMatchObject({ status: "open" });

    // A closed row cannot be updated further, even to change the admin note.
    await updateProductFeedback(db, adminAuth(), updated.id, { status: "closed" });
    await expect(updateProductFeedback(db, adminAuth(), updated.id, { adminNote: "Already handled." })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.")
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
        adminNote: "Fixed in the next release."
      },
      { requestId: "request-feedback-update-1" }
    );

    const audit = (await auditEvents()).find((event) => event.trace_id === "request-feedback-update-1");
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
    expect(deleteFn).toHaveBeenCalledTimes(1); // discarded initial.png cleaned up
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
    expect(deleteFn).toHaveBeenCalledTimes(1);

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
    const lastAudit = progressAudits.at(-1);
    expect(lastAudit).toMatchObject({
      kind: "product-feedback-progress",
      action: "update",
      target_type: "product-feedback",
      target_id: submitted.id
    });
    // Audit metadata must not store full message text — only boolean flags
    expect(lastAudit?.metadata).not.toHaveProperty("publicMessage");
    expect(lastAudit?.metadata).toMatchObject({ hasPublicMessage: true });
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

