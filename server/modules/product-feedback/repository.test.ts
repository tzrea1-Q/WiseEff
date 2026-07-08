import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { getFeedbackById, insertAttachments, insertFeedback, listFeedback, updateFeedback } from "./repository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];

  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      const next = results.shift() ?? [];
      const rows = typeof next === "function" ? next(call) : next;
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { calls, db };
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
    permissions: ["logs:view"],
    ...overrides
  };
}

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "feedback-1",
    organization_id: "org-1",
    submitter_user_id: "user-1",
    page_path: "/logs",
    page_title: "Logs",
    feedback_type: "experience",
    description: "The log review workflow is hard to scan.",
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
    storage_key: "org-1/feedback/screenshot.png",
    file_name: "screenshot.png",
    content_type: "image/png",
    size_bytes: 4096,
    checksum: "checksum-1",
    sort_order: 0,
    created_at: "2026-07-08T09:01:00.000Z",
    ...overrides
  };
}

describe("product feedback repository", () => {
  it("insertFeedback inserts a core feedback row scoped to the authenticated organization and user", async () => {
    const { db, calls } = createFakeDb([[feedbackRow()]]);

    const feedback = await insertFeedback(db, auth(), {
      id: "feedback-1",
      pagePath: "/logs",
      pageTitle: "Logs",
      feedbackType: "experience",
      description: "The log review workflow is hard to scan."
    });

    expect(calls[0].text).toContain("insert into product_feedback");
    expect(calls[0].values).toEqual([
      "feedback-1",
      "org-1",
      "user-1",
      "/logs",
      "Logs",
      "experience",
      "The log review workflow is hard to scan."
    ]);
    expect(feedback).toMatchObject({ id: "feedback-1", organizationId: "org-1", submitterUserId: "user-1" });
  });

  it("insertAttachments inserts attachment metadata scoped to the authenticated organization", async () => {
    const { db, calls } = createFakeDb([[attachmentRow()]]);

    const attachments = await insertAttachments(db, auth(), "feedback-1", [
      {
        id: "attachment-1",
        storageKey: "org-1/feedback/screenshot.png",
        fileName: "screenshot.png",
        contentType: "image/png",
        sizeBytes: 4096,
        checksum: "checksum-1",
        sortOrder: 0
      }
    ]);

    expect(calls[0].text).toContain("insert into product_feedback_attachments");
    expect(calls[0].text).toContain("inner join product_feedback");
    expect(calls[0].values).toEqual([
      "attachment-1",
      "feedback-1",
      "org-1",
      "org-1/feedback/screenshot.png",
      "screenshot.png",
      "image/png",
      4096,
      "checksum-1",
      0
    ]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ id: "attachment-1", feedbackId: "feedback-1", sortOrder: 0 });
  });

  it("getFeedbackById returns null when the feedback is missing or belongs to another organization", async () => {
    const { db, calls } = createFakeDb([[]]);

    const feedback = await getFeedbackById(db, auth(), "feedback-1");

    expect(calls[0].text).toContain("from product_feedback");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].values).toEqual(["org-1", "feedback-1"]);
    expect(feedback).toBeNull();
  });

  it("getFeedbackById joins attachments ordered by sort_order", async () => {
    const { db, calls } = createFakeDb([
      [feedbackRow()],
      [attachmentRow({ id: "attachment-1", sort_order: 0 }), attachmentRow({ id: "attachment-2", sort_order: 1 })]
    ]);

    const feedback = await getFeedbackById(db, auth(), "feedback-1");

    expect(calls[1].text).toContain("from product_feedback_attachments");
    expect(calls[1].text).toContain("order by sort_order asc");
    expect(calls[1].values).toEqual(["org-1", "feedback-1"]);
    expect(feedback).toMatchObject({
      id: "feedback-1",
      attachments: [
        { id: "attachment-1", sortOrder: 0 },
        { id: "attachment-2", sortOrder: 1 }
      ]
    });
  });

  it("listFeedback fetches one extra row and omits nextCursor when the page is not full", async () => {
    const { db, calls } = createFakeDb([[feedbackRow({ id: "feedback-2" })]]);

    const result = await listFeedback(db, auth(), {
      status: "open",
      feedbackType: "data",
      q: "export",
      pagePath: "/logs",
      createdFrom: "2026-07-01T00:00:00.000Z",
      createdTo: "2026-07-08T23:59:59.000Z",
      cursor: { createdAt: "2026-07-08T09:00:00.000Z", id: "feedback-1" },
      limit: 20
    });

    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("status = $2");
    expect(calls[0].text).toContain("feedback_type = $3");
    expect(calls[0].text).toContain("(description ilike $4 or page_path ilike $4 or page_title ilike $4)");
    expect(calls[0].text).toContain("page_path like $5");
    expect(calls[0].text).toContain("created_at >= $6");
    expect(calls[0].text).toContain("created_at <= $7");
    expect(calls[0].text).toContain("(created_at, id) < ($8, $9)");
    expect(calls[0].text).toContain("order by created_at desc, id desc");
    expect(calls[0].text).toContain("limit $10");
    expect(calls[0].values).toEqual([
      "org-1",
      "open",
      "data",
      "%export%",
      "/logs%",
      "2026-07-01T00:00:00.000Z",
      "2026-07-08T23:59:59.000Z",
      "2026-07-08T09:00:00.000Z",
      "feedback-1",
      21
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("listFeedback omits nextCursor when rows exactly match the limit", async () => {
    const { db } = createFakeDb([
      [
        feedbackRow({ id: "feedback-2", created_at: "2026-07-08T09:00:00.000Z" }),
        feedbackRow({ id: "feedback-1", created_at: "2026-07-08T08:00:00.000Z" })
      ]
    ]);

    const result = await listFeedback(db, auth(), { limit: 2 });

    expect(result.items.map((item) => item.id)).toEqual(["feedback-2", "feedback-1"]);
    expect(result.nextCursor).toBeNull();
  });

  it("listFeedback returns nextCursor only when more rows exist and slices the extra row", async () => {
    const { db } = createFakeDb([
      [
        feedbackRow({ id: "feedback-3", created_at: "2026-07-08T10:00:00.000Z" }),
        feedbackRow({ id: "feedback-2", created_at: "2026-07-08T09:00:00.000Z" }),
        feedbackRow({ id: "feedback-1", created_at: "2026-07-08T08:00:00.000Z" })
      ]
    ]);

    const result = await listFeedback(db, auth(), { limit: 2 });

    expect(result.items.map((item) => item.id)).toEqual(["feedback-3", "feedback-2"]);
    expect(result.nextCursor).toEqual({ createdAt: "2026-07-08T09:00:00.000Z", id: "feedback-2" });
  });

  it("updateFeedback updates status and admin note with organization scoping", async () => {
    const { db, calls } = createFakeDb([[feedbackRow({ status: "in_progress", admin_note: "Triaged by support." })]]);

    const feedback = await updateFeedback(db, auth(), "feedback-1", {
      status: "in_progress",
      adminNote: "Triaged by support."
    });

    expect(calls[0].text).toContain("update product_feedback");
    expect(calls[0].text).toContain("status = $3");
    expect(calls[0].text).toContain("admin_note = $4");
    expect(calls[0].text).toContain("updated_at = now()");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-1", "feedback-1", "in_progress", "Triaged by support."]);
    expect(feedback).toMatchObject({ id: "feedback-1", status: "in_progress", adminNote: "Triaged by support." });
  });
});
