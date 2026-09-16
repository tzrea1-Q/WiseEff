import { describe, expect, it } from "vitest";
import { createMockProductFeedbackRepository } from "./mockProductFeedbackRepository";

describe("createMockProductFeedbackRepository drafts", () => {
  it("supports draft creation, editing, deleting, and submitting", async () => {
    const repo = createMockProductFeedbackRepository();

    // 1. createDraft creates item with submittedAt: null and empty description allowed
    const draft = await repo.createDraft!({
      pagePath: "/settings",
      pageTitle: "Settings",
      feedbackType: "feature",
      description: "",
      files: [new File(["dummy"], "shot1.png", { type: "image/png" })]
    });

    expect(draft.id).toBeDefined();
    expect(draft.submittedAt).toBeNull();
    expect(draft.description).toBe("");
    expect(draft.attachments).toHaveLength(1);

    // Draft does NOT appear in admin list or get
    const adminList = await repo.list();
    expect(adminList.items.map((i) => i.id)).not.toContain(draft.id);
    const adminGet = await repo.get(draft.id);
    expect(adminGet).toBeNull();

    // Draft appears in listMine and getMine
    const mineList = await repo.listMine!();
    expect(mineList.items.map((i) => i.id)).toContain(draft.id);
    const myDraft = await repo.getMine!(draft.id);
    expect(myDraft?.id).toBe(draft.id);

    // 2. saveDraft updates fields and attachments
    const saved = await repo.saveDraft!(draft.id, {
      description: "Working on draft description",
      retainedAttachmentIds: [],
      newFiles: [new File(["new"], "shot2.png", { type: "image/png" })]
    });
    expect(saved.description).toBe("Working on draft description");
    expect(saved.attachments).toHaveLength(1);
    expect(saved.attachments[0].fileName).toBe("shot2.png");

    // 3. submitDraft rejects empty description
    await expect(
      repo.submitDraft!(draft.id, { description: "   " })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // 4. submitDraft formally submits the draft
    const submitted = await repo.submitDraft!(draft.id, { description: "Ready for review" });
    expect(submitted.status).toBe("open");
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted.progressEvents).toHaveLength(1);
    expect(submitted.progressEvents![0].kind).toBe("submitted");

    // Now appears in admin list
    const adminListAfter = await repo.list();
    expect(adminListAfter.items.map((i) => i.id)).toContain(draft.id);

    // 5. Draft operations on submitted feedback fail
    await expect(
      repo.saveDraft!(draft.id, { description: "illegal edit" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      repo.deleteDraft!(draft.id)
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      repo.submitDraft!(draft.id)
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // 6. deleteDraft deletes an actual draft
    const draft2 = await repo.createDraft!({ description: "temporary" });
    const delResult = await repo.deleteDraft!(draft2.id);
    expect(delResult).toEqual({ ok: true });
    expect(await repo.getMine!(draft2.id)).toBeNull();
  });
});
