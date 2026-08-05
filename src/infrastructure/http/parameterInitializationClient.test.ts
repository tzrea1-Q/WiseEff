import { describe, expect, it, vi } from "vitest";
import { createHttpParameterInitializationRepository } from "./parameterInitializationClient";

describe("createHttpParameterInitializationRepository", () => {
  it("gets project initialization status and draft", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "not_initialized",
      draft: null
    });
    const repo = createHttpParameterInitializationRepository({ get } as never);

    const result = await repo.getInitialization("nova");

    expect(get).toHaveBeenCalledWith("/api/v1/parameters/projects/nova/initialization");
    expect(result).toEqual({ status: "not_initialized", draft: null });
  });

  it("upserts draft, previews snapshots, and submits review", async () => {
    const put = vi.fn().mockResolvedValue({ item: { id: "draft-1", projectId: "nova" } });
    const post = vi.fn().mockResolvedValueOnce({ items: [{ id: "snap-1" }] }).mockResolvedValueOnce({
      item: { id: "review-1", status: "pending" }
    });
    const repo = createHttpParameterInitializationRepository({ put, post } as never);

    const draft = await repo.upsertDraft({
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
      notes: ""
    });
    expect(put).toHaveBeenCalledWith(
      "/api/v1/parameters/projects/nova/initialization/draft",
      expect.objectContaining({ emptyLibrary: true, projectName: "Nova" })
    );
    expect(draft.id).toBe("draft-1");

    const items = await repo.previewSnapshot({
      projectId: "nova",
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: ["borealis"]
    });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/parameters/projects/nova/initialization/preview",
      expect.objectContaining({
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["borealis"]
      })
    );
    expect(items).toEqual([{ id: "snap-1" }]);

    const review = await repo.submit("nova");
    expect(post).toHaveBeenCalledWith("/api/v1/parameters/projects/nova/initialization/submit", {});
    expect(review.id).toBe("review-1");
  });

  it("lists pending reviews and approves or rejects them", async () => {
    const get = vi.fn().mockResolvedValue({ items: [{ id: "review-1", status: "pending" }] });
    const post = vi
      .fn()
      .mockResolvedValueOnce({ item: { id: "review-1", status: "approved" } })
      .mockResolvedValueOnce({ item: { id: "review-2", status: "rejected", rejectionReason: "incomplete" } });
    const repo = createHttpParameterInitializationRepository({ get, post } as never);

    const pending = await repo.listPendingReviews();
    expect(get).toHaveBeenCalledWith("/api/v1/parameters/admin/initialization-reviews");
    expect(pending).toEqual([{ id: "review-1", status: "pending" }]);

    const approved = await repo.approve("review-1");
    expect(post).toHaveBeenCalledWith("/api/v1/parameters/admin/initialization-reviews/review-1/approve", {});
    expect(approved.status).toBe("approved");

    const rejected = await repo.reject("review-2", "incomplete");
    expect(post).toHaveBeenCalledWith("/api/v1/parameters/admin/initialization-reviews/review-2/reject", {
      reason: "incomplete"
    });
    expect(rejected.status).toBe("rejected");
  });
});
