import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { getFeedbackById, insertAttachments, insertFeedback, listFeedback, updateFeedback } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

// product_feedback ids are uuid columns; these are the file's stable "feedback-1"-style
// fixture ids spelled as uuid literals (…f001 = feedback-1, …a001 = attachment-1).
const FEEDBACK_1 = "00000000-0000-4000-8000-00000000f001";
const FEEDBACK_2 = "00000000-0000-4000-8000-00000000f002";
const FEEDBACK_3 = "00000000-0000-4000-8000-00000000f003";
const FEEDBACK_FOREIGN = "00000000-0000-4000-8000-00000000f099";
const ATTACHMENT_1 = "00000000-0000-4000-8000-00000000a001";
const ATTACHMENT_2 = "00000000-0000-4000-8000-00000000a002";

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
      permissions: ["logs:view"]
    }),
    ...overrides
  };
}

function otherOrgAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-2",
    organizationId: "org-2",
    organizationName: "OtherOrg",
    roleId: "software-user",
    permissions: ["logs:view"]
  });
}

function feedbackInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pagePath: "/logs",
    pageTitle: "Logs",
    feedbackType: "experience" as const,
    description: "The log review workflow is hard to scan.",
    ...overrides
  };
}

function attachmentInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    storageKey: "org-1/feedback/screenshot.png",
    fileName: "screenshot.png",
    contentType: "image/png" as const,
    sizeBytes: 4096,
    checksum: "checksum-1",
    sortOrder: 0,
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("product feedback repository", () => {
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

  async function seedOtherOrg() {
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "OtherOrg" },
      users: [{ id: "user-2", name: "Renn Ito", email: "renn@example.com" }]
    });
  }

  /** created_at is frozen at transaction now(); recency-based tests pin explicit timestamps. */
  async function setCreatedAt(feedbackId: string, createdAt: string) {
    await db.query("update product_feedback set created_at = $2 where id = $1", [feedbackId, createdAt]);
  }

  it("insertFeedback inserts a core feedback row scoped to the authenticated organization and user", async () => {
    const feedback = await insertFeedback(db, auth(), {
      id: FEEDBACK_1,
      pagePath: "/logs",
      pageTitle: "Logs",
      feedbackType: "experience",
      description: "The log review workflow is hard to scan."
    });

    expect(feedback).toMatchObject({
      id: FEEDBACK_1,
      organizationId: "org-1",
      submitterUserId: "user-1",
      pagePath: "/logs",
      pageTitle: "Logs",
      feedbackType: "experience",
      description: "The log review workflow is hard to scan.",
      status: "open",
      adminNote: null
    });

    const reloaded = await getFeedbackById(db, auth(), FEEDBACK_1);
    expect(reloaded).toMatchObject({
      id: FEEDBACK_1,
      organizationId: "org-1",
      submitterUserId: "user-1",
      status: "open",
      attachments: []
    });
  });

  it("insertAttachments inserts attachment metadata scoped to the authenticated organization", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));

    const attachments = await insertAttachments(db, auth(), FEEDBACK_1, [
      {
        id: ATTACHMENT_1,
        storageKey: "org-1/feedback/screenshot.png",
        fileName: "screenshot.png",
        contentType: "image/png",
        sizeBytes: 4096,
        checksum: "checksum-1",
        sortOrder: 0
      }
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id: ATTACHMENT_1,
      feedbackId: FEEDBACK_1,
      organizationId: "org-1",
      storageKey: "org-1/feedback/screenshot.png",
      fileName: "screenshot.png",
      contentType: "image/png",
      sizeBytes: 4096,
      checksum: "checksum-1",
      sortOrder: 0
    });

    // Org scoping is enforced by the insert itself: a caller from another organization
    // cannot attach to this feedback, and nothing is persisted for the attempt.
    await seedOtherOrg();
    const foreign = await insertAttachments(db, otherOrgAuth(), FEEDBACK_1, [
      attachmentInput(ATTACHMENT_2, { fileName: "foreign.png" })
    ]);
    expect(foreign).toEqual([]);

    const stored = await getFeedbackById(db, auth(), FEEDBACK_1);
    expect(stored?.attachments.map((attachment) => attachment.id)).toEqual([ATTACHMENT_1]);
  });

  it("getFeedbackById returns null when the feedback is missing or belongs to another organization", async () => {
    const missing = await getFeedbackById(db, auth(), FEEDBACK_1);
    expect(missing).toBeNull();

    await seedOtherOrg();
    await insertFeedback(db, otherOrgAuth(), feedbackInput(FEEDBACK_FOREIGN));

    const crossOrg = await getFeedbackById(db, auth(), FEEDBACK_FOREIGN);
    expect(crossOrg).toBeNull();
    await expect(getFeedbackById(db, otherOrgAuth(), FEEDBACK_FOREIGN)).resolves.toMatchObject({
      id: FEEDBACK_FOREIGN
    });
  });

  it("getFeedbackById joins attachments ordered by sort_order", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));
    // Insert out of sort order to prove the read orders by sort_order, not insertion order.
    await insertAttachments(db, auth(), FEEDBACK_1, [
      attachmentInput(ATTACHMENT_2, { fileName: "screenshot-2.png", sortOrder: 1 }),
      attachmentInput(ATTACHMENT_1, { sortOrder: 0 })
    ]);

    const feedback = await getFeedbackById(db, auth(), FEEDBACK_1);

    expect(feedback).toMatchObject({
      id: FEEDBACK_1,
      attachments: [
        { id: ATTACHMENT_1, sortOrder: 0 },
        { id: ATTACHMENT_2, sortOrder: 1 }
      ]
    });
  });

  it("listFeedback fetches one extra row and omits nextCursor when the page is not full", async () => {
    // The one row matching every filter below.
    await insertFeedback(
      db,
      auth(),
      feedbackInput(FEEDBACK_2, {
        feedbackType: "data",
        description: "Please let us export the run table."
      })
    );
    await setCreatedAt(FEEDBACK_2, "2026-07-08T08:00:00.000Z");
    // Decoys, one per filter: wrong status, wrong type, no "export" text, wrong page path,
    // created before createdFrom, and created after the cursor row.
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d001", {
      feedbackType: "data",
      description: "Closed export request."
    }));
    await db.query("update product_feedback set status = 'closed' where id = $1", [
      "00000000-0000-4000-8000-00000000d001"
    ]);
    await setCreatedAt("00000000-0000-4000-8000-00000000d001", "2026-07-08T07:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d002", {
      feedbackType: "experience",
      description: "Export flow feels slow."
    }));
    await setCreatedAt("00000000-0000-4000-8000-00000000d002", "2026-07-08T07:10:00.000Z");
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d003", {
      feedbackType: "data",
      description: "No matching keyword here."
    }));
    await setCreatedAt("00000000-0000-4000-8000-00000000d003", "2026-07-08T07:20:00.000Z");
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d004", {
      feedbackType: "data",
      description: "Export from the wrong page.",
      pagePath: "/parameters"
    }));
    await setCreatedAt("00000000-0000-4000-8000-00000000d004", "2026-07-08T07:30:00.000Z");
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d005", {
      feedbackType: "data",
      description: "Export request from June."
    }));
    await setCreatedAt("00000000-0000-4000-8000-00000000d005", "2026-06-30T10:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput("00000000-0000-4000-8000-00000000d006", {
      feedbackType: "data",
      description: "Export request newer than the cursor."
    }));
    await setCreatedAt("00000000-0000-4000-8000-00000000d006", "2026-07-08T10:00:00.000Z");

    const result = await listFeedback(db, auth(), {
      status: "open",
      feedbackType: "data",
      q: "export",
      pagePath: "/logs",
      createdFrom: "2026-07-01T00:00:00.000Z",
      createdTo: "2026-07-08T23:59:59.000Z",
      cursor: { createdAt: "2026-07-08T09:00:00.000Z", id: FEEDBACK_1 },
      limit: 20
    });

    expect(result.items.map((item) => item.id)).toEqual([FEEDBACK_2]);
    expect(result.nextCursor).toBeNull();
  });

  it("listFeedback omits nextCursor when rows exactly match the limit", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_2));
    await setCreatedAt(FEEDBACK_2, "2026-07-08T09:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));
    await setCreatedAt(FEEDBACK_1, "2026-07-08T08:00:00.000Z");

    const result = await listFeedback(db, auth(), { limit: 2 });

    expect(result.items.map((item) => item.id)).toEqual([FEEDBACK_2, FEEDBACK_1]);
    expect(result.nextCursor).toBeNull();
  });

  it("listFeedback returns nextCursor only when more rows exist and slices the extra row", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_3));
    await setCreatedAt(FEEDBACK_3, "2026-07-08T10:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_2));
    await setCreatedAt(FEEDBACK_2, "2026-07-08T09:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));
    await setCreatedAt(FEEDBACK_1, "2026-07-08T08:00:00.000Z");

    const result = await listFeedback(db, auth(), { limit: 2 });

    expect(result.items.map((item) => item.id)).toEqual([FEEDBACK_3, FEEDBACK_2]);
    expect(result.nextCursor).toEqual({ createdAt: "2026-07-08T09:00:00.000Z", id: FEEDBACK_2 });

    const nextPage = await listFeedback(db, auth(), { limit: 2, cursor: result.nextCursor! });
    expect(nextPage.items.map((item) => item.id)).toEqual([FEEDBACK_1]);
    expect(nextPage.nextCursor).toBeNull();
  });

  it("listFeedback hydrates attachments for each feedback row", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_2));
    await setCreatedAt(FEEDBACK_2, "2026-07-08T09:00:00.000Z");
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));
    await setCreatedAt(FEEDBACK_1, "2026-07-08T08:00:00.000Z");
    await insertAttachments(db, auth(), FEEDBACK_2, [
      attachmentInput(ATTACHMENT_2, { fileName: "screenshot-2.png" })
    ]);
    await insertAttachments(db, auth(), FEEDBACK_1, [attachmentInput(ATTACHMENT_1)]);

    const result = await listFeedback(db, auth(), { limit: 10 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].attachments).toHaveLength(1);
    expect(result.items[0].attachments[0].id).toBe(ATTACHMENT_2);
    expect(result.items[1].attachments[0].id).toBe(ATTACHMENT_1);
  });

  it("updateFeedback updates status and admin note with organization scoping", async () => {
    await insertFeedback(db, auth(), feedbackInput(FEEDBACK_1));

    const feedback = await updateFeedback(db, auth(), FEEDBACK_1, {
      status: "in_progress",
      adminNote: "Triaged by support."
    });

    expect(feedback).toMatchObject({
      id: FEEDBACK_1,
      status: "in_progress",
      adminNote: "Triaged by support."
    });
    await expect(getFeedbackById(db, auth(), FEEDBACK_1)).resolves.toMatchObject({
      status: "in_progress",
      adminNote: "Triaged by support."
    });

    // A caller from another organization cannot update the row, and the row is untouched.
    await seedOtherOrg();
    const foreign = await updateFeedback(db, otherOrgAuth(), FEEDBACK_1, {
      status: "closed",
      adminNote: "Hijacked."
    });
    expect(foreign).toBeNull();
    await expect(getFeedbackById(db, auth(), FEEDBACK_1)).resolves.toMatchObject({
      status: "in_progress",
      adminNote: "Triaged by support."
    });
  });
});
