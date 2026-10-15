import { describe, expect, it } from "vitest";
import { createMockProductFeedbackRepository } from "./mockProductFeedbackRepository";

describe("createMockProductFeedbackRepository drafts", () => {
  it("persists and clears legacy notes through the progress journal", async () => {
    const repo = createMockProductFeedbackRepository();
    const feedback = await repo.submit({ pagePath: "/feedback", pageTitle: "我的反馈", feedbackType: "experience", description: "问题", files: [] });
    const noted = await repo.update(feedback.id, { adminNote: "  排查记录  " });
    expect(noted.adminNote).toBe("排查记录");
    expect(noted.progressEvents?.at(-1)?.internalMessage).toBe("排查记录");
    const cleared = await repo.update(feedback.id, { adminNote: null });
    expect(cleared.adminNote).toBeNull();
    expect(cleared.progressEvents?.at(-1)?.internalMessage).toBe("处理备注已清空");
    expect((await repo.get(feedback.id))?.adminNote).toBeNull();
    expect(cleared.progressEvents?.some((event) => event.internalMessage === "排查记录")).toBe(true);
  });

  it("rejects reopening active feedback without changing its journal", async () => {
    const repo = createMockProductFeedbackRepository();
    const feedback = await repo.submit({ pagePath: "/feedback", pageTitle: "我的反馈", feedbackType: "experience", description: "问题", files: [] });
    for (const status of ["open", "in_progress"] as const) {
      if (status === "in_progress") await repo.update(feedback.id, { status });
      const before = await repo.get(feedback.id);
      await expect(repo.replyToMine!(feedback.id, { message: "追问", files: [], reopen: true })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(await repo.get(feedback.id)).toEqual(before);
    }
  });

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
