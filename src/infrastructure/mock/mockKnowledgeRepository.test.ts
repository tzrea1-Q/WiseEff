import { describe, expect, it } from "vitest";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { createMockKnowledgeRepository } from "./mockKnowledgeRepository";

describe("createMockKnowledgeRepository", () => {
  it("serves fixture entries covering draft, published, archived, and failed extraction", async () => {
    const repository = createMockKnowledgeRepository();
    const { items } = await repository.list();

    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.some((entry) => entry.status === "draft")).toBe(true);
    expect(items.some((entry) => entry.status === "published")).toBe(true);
    expect(items.some((entry) => entry.status === "archived")).toBe(true);
    expect(items.some((entry) => entry.file?.extractionStatus === "failed")).toBe(true);
  });

  it("creates a markdown draft with revision 1 and lifecycle transitions", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "新条目", tags: ["t"], contentMarkdown: "内容" });

    expect(entry.status).toBe("draft");
    expect(entry.headRevisionNumber).toBe(1);

    const published = await repository.publish(entry.id);
    expect(published.status).toBe("published");
    const archived = await repository.archive(entry.id);
    expect(archived.status).toBe("archived");
    const restored = await repository.restore(entry.id);
    expect(restored.status).toBe("published");
  });

  it("searches published entries only", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "检索目标草稿", tags: [], contentMarkdown: "唯一关键词甲乙丙" });

    expect(await repository.search("唯一关键词甲乙丙")).toHaveLength(0);
    await repository.publish(entry.id);
    const results = await repository.search("唯一关键词甲乙丙");
    expect(results.map((item) => item.entryId)).toContain(entry.id);
  });

  it("appends immutable revisions on update and rejects stale saves", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "并发条目", tags: [], contentMarkdown: "v1" });

    const updated = await repository.update(entry.id, { expectedHeadRevisionNumber: 1, contentMarkdown: "v2" });
    expect(updated.headRevisionNumber).toBe(2);

    await expect(
      repository.update(entry.id, { expectedHeadRevisionNumber: 1, contentMarkdown: "stale" })
    ).rejects.toBeInstanceOf(KnowledgeRevisionConflictError);

    const revisions = await repository.listRevisions(entry.id);
    expect(revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(revisions.find((revision) => revision.revisionNumber === 1)?.contentMarkdown).toBe("v1");
  });

  it("restores a prior revision as a new revision", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "恢复条目", tags: [], contentMarkdown: "v1" });
    await repository.update(entry.id, { expectedHeadRevisionNumber: 1, contentMarkdown: "v2" });

    const revisions = await repository.listRevisions(entry.id);
    const first = revisions.find((revision) => revision.revisionNumber === 1)!;
    const restored = await repository.restoreRevision(entry.id, first.id, 2);

    expect(restored.headRevisionNumber).toBe(3);
    expect(restored.contentMarkdown).toBe("v1");
    const afterRestore = await repository.listRevisions(entry.id);
    expect(afterRestore.find((revision) => revision.revisionNumber === 3)?.restoredFromRevisionId).toBe(first.id);
  });

  it("creates file entries with visible extraction status", async () => {
    const repository = createMockKnowledgeRepository();
    const good = await repository.createFile({
      title: "文本文件",
      tags: [],
      file: new File(["hello"], "notes.txt", { type: "text/plain" })
    });
    expect(good.file?.extractionStatus).toBe("succeeded");

    const legacy = await repository.createFile({
      title: "旧文档",
      tags: [],
      file: new File(["binary"], "legacy.doc", { type: "application/msword" })
    });
    expect(legacy.file?.extractionStatus).toBe("failed");
    expect(legacy.file?.extractionError).toContain(".docx");
  });

  it("hides other users' drafts without manage capability", async () => {
    const repository = createMockKnowledgeRepository({ userId: "someone-else", canManage: false });
    const { items } = await repository.list();
    expect(items.some((entry) => entry.status === "draft" && entry.createdByUserId !== "someone-else")).toBe(false);
  });

  it("hard deletes entries with revisions", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "待删除", tags: [], contentMarkdown: "x" });
    await repository.hardDelete(entry.id);
    expect(await repository.get(entry.id)).toBeNull();
  });
});
