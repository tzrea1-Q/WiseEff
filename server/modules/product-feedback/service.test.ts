import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  createProductFeedback,
  getProductFeedback,
  getProductFeedbackAttachmentContent,
  listProductFeedback,
  updateProductFeedback
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

// product_feedback ids are uuid columns; absent-row probes need well-formed uuid literals.
const MISSING_FEEDBACK_ID = "00000000-0000-4000-8000-00000000f404";

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      organizationName: "ChargeLab",
      roles: [{ projectId: "project-1", roleId: "software-user" }],
      permissions: []
    }),
    ...overrides
  };
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

  return { objectStore: { put, get } as ObjectStore, get, put };
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
});
