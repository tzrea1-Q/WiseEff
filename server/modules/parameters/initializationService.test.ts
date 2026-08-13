/**
 * Behavior-level coverage for the project parameter initialization lifecycle:
 * draft upsert, submit, admin approve/reject, the submit lock, and audit
 * trail rows against a real database. Asserts returned DTOs and subsequent
 * reads — never SQL text or mocked repository calls.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { getProjectInitializationStatus } from "./initializationRepository";
import {
  approveReview,
  assertProjectAllowsParameterSubmit,
  rejectReview,
  submitDraft,
  upsertDraft
} from "./initializationService";
import type { UpsertInitializationDraftInput } from "./initializationTypes";

const databaseAvailable = await isTestDatabaseAvailable();

function adminAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "admin-1",
    organizationId: "org-1",
    name: "Admin",
    organizationName: "ChargeLab",
    roles: [{ projectId: null, roleId: "admin" }]
  });
}

function creatorAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    name: "Creator",
    title: "Engineer",
    organizationName: "ChargeLab",
    roles: [{ projectId: "project-new", roleId: "hardware-user" }]
  });
}

function emptyDraftInput(overrides: Partial<UpsertInitializationDraftInput> = {}): UpsertInitializationDraftInput {
  return {
    projectId: "project-new",
    projectName: "Nova",
    projectCode: "NOVA",
    ownerUserId: "user-1",
    sourceProjectIds: [],
    primarySourceProjectId: null,
    supplementSourceProjectIds: [],
    selectedModuleIds: [],
    selectedRisks: [],
    selectedSourceBindingIds: [],
    bindingSnapshots: [],
    emptyLibrary: true,
    notes: "",
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("initializationService", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "admin-1", name: "Admin", email: "admin@example.com" },
        { id: "user-1", name: "Creator", email: "creator@example.com", title: "Engineer" }
      ],
      projects: [{ id: "project-new", name: "Nova", code: "NOVA" }]
    });
    // New projects start uninitialized; the seed helper defaults to the steady state.
    await db.query(`update projects set initialization_status = 'not_initialized' where id = 'project-new'`);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function projectStatus() {
    return getProjectInitializationStatus(db, { organizationId: "org-1", projectId: "project-new" });
  }

  async function auditKinds(): Promise<string[]> {
    const result = await db.query<{ kind: string }>(
      `select kind from audit_events where organization_id = 'org-1' order by id`
    );
    return result.rows.map((row) => row.kind);
  }

  async function materializedBindingCount(): Promise<number> {
    const result = await db.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where organization_id = 'org-1'`
    );
    return Number(result.rows[0].count);
  }

  it("empty submit then approve reaches initialized without materializing bindings", async () => {
    await upsertDraft(db, creatorAuth(), emptyDraftInput());

    const submitted = await submitDraft(db, creatorAuth(), { projectId: "project-new" });
    expect(submitted.status).toBe("pending");
    expect(submitted.submittedByUserId).toBe("user-1");
    await expect(projectStatus()).resolves.toBe("initialization_pending_review");
    expect(await auditKinds()).toContain("project-initialization-submitted");

    const approved = await approveReview(db, adminAuth(), { reviewId: submitted.id });
    expect(approved.status).toBe("approved");
    expect(approved.reviewedByUserId).toBe("admin-1");
    await expect(projectStatus()).resolves.toBe("initialized");
    // Empty-library approval must not materialize any binding or config revision.
    await expect(materializedBindingCount()).resolves.toBe(0);
    const revisions = await db.query<{ count: string }>(
      `select count(*)::text as count from dts_config_revisions where organization_id = 'org-1'`
    );
    expect(Number(revisions.rows[0].count)).toBe(0);
    expect(await auditKinds()).toContain("project-initialization-approved");
  });

  it("reject keeps the draft and sets initialization_rejected", async () => {
    const draft = await upsertDraft(db, creatorAuth(), emptyDraftInput());
    const submitted = await submitDraft(db, creatorAuth(), { projectId: "project-new" });

    const rejected = await rejectReview(db, adminAuth(), {
      reviewId: submitted.id,
      reason: "Incomplete sources"
    });

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Incomplete sources");
    await expect(projectStatus()).resolves.toBe("initialization_rejected");
    // The draft row stays editable after reject.
    const draftRows = await db.query<{ id: string }>(
      `select id from project_parameter_initialization_drafts where organization_id = 'org-1' and project_id = 'project-new'`
    );
    expect(draftRows.rows).toEqual([{ id: draft.id }]);
    expect(await auditKinds()).toContain("project-initialization-rejected");
  });

  it("forbids double-approve of a non-pending review", async () => {
    await upsertDraft(db, creatorAuth(), emptyDraftInput());
    const submitted = await submitDraft(db, creatorAuth(), { projectId: "project-new" });
    await approveReview(db, adminAuth(), { reviewId: submitted.id });

    await expect(approveReview(db, adminAuth(), { reviewId: submitted.id })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409
    } satisfies Partial<ApiError>);
    await expect(materializedBindingCount()).resolves.toBe(0);
  });

  it("forbids non-admin approve", async () => {
    await expect(approveReview(db, creatorAuth(), { reviewId: "review-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    } satisfies Partial<ApiError>);
  });

  it("assertProjectAllowsParameterSubmit blocks while initialization review is pending", async () => {
    await upsertDraft(db, creatorAuth(), emptyDraftInput());
    await submitDraft(db, creatorAuth(), { projectId: "project-new" });

    await expect(assertProjectAllowsParameterSubmit(db, "org-1", "project-new")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409
    } satisfies Partial<ApiError>);
  });

  it("upsertDraft sets initialization_draft for an empty library and persists the draft", async () => {
    const draft = await upsertDraft(db, creatorAuth(), emptyDraftInput());

    expect(draft.emptyLibrary).toBe(true);
    expect(draft).toMatchObject({
      projectId: "project-new",
      projectName: "Nova",
      projectCode: "NOVA",
      ownerUserId: "user-1",
      createdByUserId: "user-1"
    });
    await expect(projectStatus()).resolves.toBe("initialization_draft");

    // A second save updates the same draft row in place.
    const updated = await upsertDraft(db, creatorAuth(), emptyDraftInput({ notes: "second pass" }));
    expect(updated.id).toBe(draft.id);
    expect(updated.notes).toBe("second pass");
  });
});
