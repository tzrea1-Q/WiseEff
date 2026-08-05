import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable, QueryResult } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("./initializationRepository", () => ({
  getProjectInitializationStatus: vi.fn(),
  setProjectInitializationStatus: vi.fn(),
  getDraftByProject: vi.fn(),
  upsertDraft: vi.fn(),
  insertReview: vi.fn(),
  listPendingReviews: vi.fn(),
  getReviewById: vi.fn(),
  markReviewApproved: vi.fn(),
  markReviewRejected: vi.fn(),
  getBindingLogicalNodeId: vi.fn(),
  listSourceBindingCandidates: vi.fn()
}));

vi.mock("../parameter-topology/bindingService", () => ({
  createOrReuseBinding: vi.fn(),
  upsertBindingRevisionValues: vi.fn()
}));

vi.mock("../parameter-files/configSetRepository", () => ({
  getConfigSetByProjectAndName: vi.fn()
}));

vi.mock("../parameter-topology/repository", () => ({
  getLatestConfigRevision: vi.fn(),
  insertConfigRevision: vi.fn(),
  nextConfigRevisionNumber: vi.fn()
}));

import { createAuditEvent } from "../audit/repository";
import { createOrReuseBinding, upsertBindingRevisionValues } from "../parameter-topology/bindingService";
import { getConfigSetByProjectAndName } from "../parameter-files/configSetRepository";
import { getLatestConfigRevision, insertConfigRevision, nextConfigRevisionNumber } from "../parameter-topology/repository";
import * as repo from "./initializationRepository";
import {
  approveReview,
  assertProjectAllowsParameterSubmit,
  rejectReview,
  submitDraft,
  upsertDraft
} from "./initializationService";
import type { InitializationDraftDto, InitializationReviewDto } from "./initializationTypes";

const mockedAudit = vi.mocked(createAuditEvent);
const mockedCreateBinding = vi.mocked(createOrReuseBinding);
const mockedUpsertRevision = vi.mocked(upsertBindingRevisionValues);
const mockedGetConfigSet = vi.mocked(getConfigSetByProjectAndName);
const mockedGetLatestRevision = vi.mocked(getLatestConfigRevision);
const mockedInsertRevision = vi.mocked(insertConfigRevision);
const mockedNextRevisionNumber = vi.mocked(nextConfigRevisionNumber);

function createFakeDb(): Database {
  const tx: Queryable = {
    query: async <Row,>(): Promise<QueryResult<Row>> => ({ rows: [], rowCount: 0 })
  };
  return {
    query: tx.query,
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "admin-1",
      organizationId: "org-1",
      name: "Admin",
      email: "admin@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["admin:access", "parameter:edit", "parameter:view"],
    ...overrides
  };
}

function creatorAuth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Creator",
      email: "creator@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-new", roleId: "hardware-user" }],
    permissions: ["parameter:view", "parameter:edit"]
  };
}

function emptyDraft(overrides: Partial<InitializationDraftDto> = {}): InitializationDraftDto {
  return {
    id: "draft-1",
    organizationId: "org-1",
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
    createdByUserId: "user-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides
  };
}

function pendingReview(overrides: Partial<InitializationReviewDto> = {}): InitializationReviewDto {
  return {
    id: "review-1",
    draftId: "draft-1",
    organizationId: "org-1",
    projectId: "project-new",
    status: "pending",
    submittedByUserId: "user-1",
    submittedAt: "2026-08-05T01:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getProjectInitializationStatus).mockResolvedValue("not_initialized");
  vi.mocked(repo.setProjectInitializationStatus).mockResolvedValue(undefined);
  vi.mocked(repo.getDraftByProject).mockResolvedValue(null);
  vi.mocked(repo.upsertDraft).mockImplementation(async (_db, input) =>
    emptyDraft({
      id: input.id,
      projectId: input.draft.projectId,
      emptyLibrary: input.draft.emptyLibrary,
      bindingSnapshots: input.draft.bindingSnapshots,
      sourceProjectIds: input.draft.sourceProjectIds,
      primarySourceProjectId: input.draft.primarySourceProjectId
    })
  );
  vi.mocked(repo.insertReview).mockResolvedValue(pendingReview());
  vi.mocked(repo.getReviewById).mockResolvedValue(pendingReview());
  vi.mocked(repo.markReviewApproved).mockResolvedValue({
    ...pendingReview(),
    status: "approved",
    reviewedByUserId: "admin-1",
    reviewedAt: "2026-08-05T02:00:00.000Z"
  });
  vi.mocked(repo.markReviewRejected).mockResolvedValue({
    ...pendingReview(),
    status: "rejected",
    reviewedByUserId: "admin-1",
    reviewedAt: "2026-08-05T02:00:00.000Z",
    rejectionReason: "Incomplete sources"
  });
  vi.mocked(repo.getBindingLogicalNodeId).mockResolvedValue(null);
  mockedGetConfigSet.mockResolvedValue({
    id: "cs-default",
    organizationId: "org-1",
    projectId: "project-new",
    name: "default",
    description: null,
    derivedFromId: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  });
  mockedGetLatestRevision.mockResolvedValue(null);
  mockedNextRevisionNumber.mockResolvedValue(1);
  mockedInsertRevision.mockResolvedValue({
    id: "rev-1",
    organizationId: "org-1",
    projectId: "project-new",
    configSetId: "cs-default",
    revisionNumber: 1,
    status: "draft",
    createdByUserId: "admin-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    entryFile: null,
    includeSearchPaths: [],
    overlayOrder: [],
    manifestState: "complete"
  } as never);
});

describe("initializationService", () => {
  it("empty submit then approve reaches initialized without materializing bindings", async () => {
    const db = createFakeDb();
    const draft = emptyDraft({ emptyLibrary: true, bindingSnapshots: [] });
    vi.mocked(repo.getDraftByProject).mockResolvedValue(draft);

    const submitted = await submitDraft(db, creatorAuth(), { projectId: "project-new" });
    expect(submitted.status).toBe("pending");
    expect(repo.setProjectInitializationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "project-new", status: "initialization_pending_review" })
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "project-initialization-submitted" })
    );

    const approved = await approveReview(db, adminAuth(), { reviewId: "review-1" });
    expect(approved.status).toBe("approved");
    expect(repo.setProjectInitializationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "project-new", status: "initialized" })
    );
    expect(mockedCreateBinding).not.toHaveBeenCalled();
    expect(mockedUpsertRevision).not.toHaveBeenCalled();
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "project-initialization-approved" })
    );
  });

  it("reject keeps draft and sets initialization_rejected", async () => {
    const db = createFakeDb();
    vi.mocked(repo.getDraftByProject).mockResolvedValue(emptyDraft());

    const rejected = await rejectReview(db, adminAuth(), {
      reviewId: "review-1",
      reason: "Incomplete sources"
    });

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Incomplete sources");
    expect(repo.setProjectInitializationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "initialization_rejected" })
    );
    expect(repo.getDraftByProject).toHaveBeenCalled();
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "project-initialization-rejected" })
    );
  });

  it("forbids double-approve of a non-pending review", async () => {
    const db = createFakeDb();
    vi.mocked(repo.getReviewById).mockResolvedValue({
      ...pendingReview(),
      status: "approved"
    });

    await expect(approveReview(db, adminAuth(), { reviewId: "review-1" })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409
    } satisfies Partial<ApiError>);
    expect(mockedCreateBinding).not.toHaveBeenCalled();
  });

  it("forbids non-admin approve", async () => {
    const db = createFakeDb();
    await expect(approveReview(db, creatorAuth(), { reviewId: "review-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    } satisfies Partial<ApiError>);
  });

  it("assertProjectAllowsParameterSubmit blocks when pending review", async () => {
    const db = createFakeDb();
    vi.mocked(repo.getProjectInitializationStatus).mockResolvedValue("initialization_pending_review");

    await expect(
      assertProjectAllowsParameterSubmit(db, "org-1", "project-new")
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409
    } satisfies Partial<ApiError>);
  });

  it("upsertDraft sets initialization_draft for empty library", async () => {
    const db = createFakeDb();
    const draft = await upsertDraft(db, creatorAuth(), {
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
      notes: ""
    });

    expect(draft.emptyLibrary).toBe(true);
    expect(repo.setProjectInitializationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "initialization_draft" })
    );
  });
});
