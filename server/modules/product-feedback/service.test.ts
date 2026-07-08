import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore, StoredObject } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createProductFeedback,
  getProductFeedback,
  getProductFeedbackAttachmentContent,
  listProductFeedback,
  updateProductFeedback
} from "./service";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => {
      const result = await fn(tx);
      transactions.push([...txCalls]);
      return result;
    }
  };

  return { calls, txCalls, transactions, db };
}

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: [],
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

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "feedback-1",
    organization_id: "org-1",
    submitter_user_id: "user-1",
    page_path: "/parameters",
    page_title: "Project Parameters",
    feedback_type: "experience",
    description: "The buttons are hard to scan.",
    status: "open",
    admin_note: null,
    created_at: "2026-07-08T09:00:00.000Z",
    updated_at: "2026-07-08T09:00:00.000Z",
    ...overrides
  };
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment-1",
    feedback_id: "feedback-1",
    organization_id: "org-1",
    storage_key: "org-1/checksum-shot.png",
    file_name: "shot.png",
    content_type: "image/png",
    size_bytes: 1024,
    checksum: "checksum",
    sort_order: 0,
    created_at: "2026-07-08T09:00:01.000Z",
    ...overrides
  };
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

describe("product feedback service", () => {
  it("rejects inactive submit before storing attachments", async () => {
    const { db } = createFakeDb();
    const { objectStore, put } = makeObjectStore();

    await expect(
      createProductFeedback(
        db,
        objectStore,
        auth({ user: { ...auth().user, isActive: false } }),
        createInput({ attachments: [attachmentInput("shot.png")] })
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Forbidden.", 403, { reason: "inactive" }));
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects non-admin list, get, patch, and attachment content", async () => {
    const { db } = createFakeDb();
    const { objectStore } = makeObjectStore();
    const user = auth();

    await expect(listProductFeedback(db, user, {})).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" })
    );
    await expect(getProductFeedback(db, user, "feedback-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" })
    );
    await expect(updateProductFeedback(db, user, "feedback-1", { status: "in_progress" })).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" })
    );
    await expect(getProductFeedbackAttachmentContent(db, objectStore, user, "feedback-1", "attachment-1")).rejects.toMatchObject(
      new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" })
    );
  });

  it("creates feedback with two images, stores attachments, and writes product feedback audit", async () => {
    const { db, txCalls } = createFakeDb([
      [feedbackRow()],
      [
        attachmentRow({ id: "attachment-1", file_name: "shot-1.png", storage_key: "org-1/stored-shot-1.png", checksum: "checksum-shot-1.png" }),
        attachmentRow({
          id: "attachment-2",
          file_name: "shot-2.png",
          storage_key: "org-1/stored-shot-2.png",
          checksum: "checksum-shot-2.png",
          sort_order: 1
        })
      ],
      []
    ]);
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
    expect(txCalls.find((call) => call.text.includes("insert into product_feedback_attachments"))?.values).toEqual(
      expect.arrayContaining(["org-1/stored-shot-1.png", "checksum-shot-1.png", "org-1/stored-shot-2.png", "checksum-shot-2.png"])
    );
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("product-feedback");
    expect(auditCall?.values).toContain("product-feedback-create");
    expect(auditCall?.values).toContain("product-feedback");
    expect(auditCall?.values).toContain("feedback-1");
    expect(auditCall?.values[12]).toBe("request-feedback-create-1");
    expect(feedback.attachments).toHaveLength(2);
  });

  it("rejects a single attachment over 5MB", async () => {
    const { db } = createFakeDb();
    const { objectStore, put } = makeObjectStore();

    await expect(
      createProductFeedback(db, objectStore, auth(), createInput({ attachments: [attachmentInput("huge.png", 5 * 1024 * 1024 + 1)] }))
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Attachment exceeds the 5MB per-image limit.", 400));
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects total attachments over 15MB", async () => {
    const { db } = createFakeDb();
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
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit.", 400));
    expect(put).not.toHaveBeenCalled();
  });

  it("allows open to in_progress and rejects skip or closed updates", async () => {
    const openDb = createFakeDb([[feedbackRow({ status: "open" })], [], [feedbackRow({ status: "in_progress" })], []]);

    const updated = await updateProductFeedback(openDb.db, adminAuth(), "feedback-1", { status: "in_progress", adminNote: "" });

    expect(updated.status).toBe("in_progress");
    expect(openDb.txCalls.find((call) => call.text.includes("update product_feedback"))?.values).toEqual([
      "org-1",
      "feedback-1",
      "in_progress",
      null
    ]);

    const skipDb = createFakeDb([[feedbackRow({ status: "open" })], []]);
    await expect(updateProductFeedback(skipDb.db, adminAuth(), "feedback-1", { status: "closed" })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Illegal product feedback status transition: open -> closed.", 400)
    );

    const closedDb = createFakeDb([[feedbackRow({ status: "closed" })], []]);
    await expect(updateProductFeedback(closedDb.db, adminAuth(), "feedback-1", { adminNote: "Already handled." })).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.", 400)
    );
  });

  it("returns NOT_FOUND for missing or cross-org feedback get", async () => {
    const { db } = createFakeDb([[]]);

    await expect(getProductFeedback(db, adminAuth(), "missing")).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Product feedback was not found.", 404, { feedbackId: "missing" })
    );
  });

  it("writes update audit events", async () => {
    const { db, txCalls } = createFakeDb([[feedbackRow({ status: "in_progress" })], [], [feedbackRow({ status: "closed" })], []]);

    await updateProductFeedback(
      db,
      adminAuth(),
      "feedback-1",
      {
        status: "closed",
        adminNote: "Fixed in the next release."
      },
      { requestId: "request-feedback-update-1" }
    );

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("product-feedback");
    expect(auditCall?.values).toContain("product-feedback-update");
    expect(auditCall?.values).toContain("product-feedback");
    expect(auditCall?.values).toContain("feedback-1");
    expect(auditCall?.values[12]).toBe("request-feedback-update-1");
  });
});
