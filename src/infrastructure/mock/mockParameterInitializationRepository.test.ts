import { describe, expect, it } from "vitest";
import type { UpsertInitializationDraftInput } from "@/application/ports/ParameterInitializationRepository";
import { createMockParameterInitializationRepository } from "./mockParameterInitializationRepository";

function emptyDraftInput(overrides: Partial<UpsertInitializationDraftInput> = {}): UpsertInitializationDraftInput {
  return {
    projectId: "nova",
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

describe("createMockParameterInitializationRepository", () => {
  it("approves an empty-library draft and marks the project initialized", async () => {
    const repo = createMockParameterInitializationRepository({
      statuses: { nova: "not_initialized" }
    });

    await repo.upsertDraft(emptyDraftInput());
    const before = await repo.getInitialization("nova");
    expect(before.status).toBe("initialization_draft");
    expect(before.draft?.emptyLibrary).toBe(true);

    const review = await repo.submit("nova");
    expect(review.status).toBe("pending");
    expect((await repo.getInitialization("nova")).status).toBe("initialization_pending_review");

    const approved = await repo.approve(review.id);
    expect(approved.status).toBe("approved");

    const after = await repo.getInitialization("nova");
    expect(after.status).toBe("initialized");
    expect(after.draft?.bindingSnapshots).toEqual([]);
  });

  it("rejects a pending review and keeps the draft editable", async () => {
    const repo = createMockParameterInitializationRepository({
      statuses: { nova: "not_initialized" }
    });

    await repo.upsertDraft(emptyDraftInput());
    const review = await repo.submit("nova");
    const rejected = await repo.reject(review.id, "missing owner");

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("missing owner");
    expect((await repo.getInitialization("nova")).status).toBe("initialization_rejected");

    const revised = await repo.upsertDraft(emptyDraftInput({ notes: "fixed" }));
    expect(revised.notes).toBe("fixed");
    expect((await repo.getInitialization("nova")).status).toBe("initialization_draft");
  });
});
