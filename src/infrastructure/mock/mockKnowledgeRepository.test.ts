import { describe, expect, it } from "vitest";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type { LogRecord } from "@/domain/prototype/types";
import { createMockKnowledgeRepository } from "./mockKnowledgeRepository";

function makeLogRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    id: "log-auth",
    reportId: "RPT-9091",
    fileName: "usb_pd_negotiation.log",
    source: "PD Negotiation",
    fileSizeMB: 12.6,
    status: "Complete",
    stage: "report",
    confidence: 88,
    conclusion: "PD 协商在 9V/3A 档位稳定完成,未出现握手重试。",
    impact: "charger-adapter-b",
    evidence: [],
    suggestedActions: [],
    severity: "Info",
    rawLines: [],
    capturedAt: "09:18:19",
    updatedAt: "3 小时前",
    updatedAtIso: "2026-08-12T06:00:00.000Z",
    submittedBy: "L. Chen",
    ...overrides
  };
}

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

  it("searches published entries only and reports FTS-only retrieval", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "检索目标草稿", tags: [], contentMarkdown: "唯一关键词甲乙丙" });

    expect((await repository.search("唯一关键词甲乙丙")).items).toHaveLength(0);
    await repository.publish(entry.id);
    const response = await repository.search("唯一关键词甲乙丙");
    expect(response.items.map((item) => item.entryId)).toContain(entry.id);
    expect(response.retrieval).toEqual({ mode: "fts_only", vectorAvailable: false, embeddingConfigured: false });
  });

  it("recommends related published entries for a completed log and reports FTS-only retrieval", async () => {
    const log = makeLogRecord();
    const repository = createMockKnowledgeRepository({ getLogRecord: () => log });

    const response = await repository.relatedToLog(log.id);
    expect(response.retrieval).toEqual({ mode: "fts_only", vectorAvailable: false, embeddingConfigured: false });
    expect(response.items.map((item) => item.entryId)).toContain("mock-kb-8");
    const citation = response.items.find((item) => item.entryId === "mock-kb-8");
    expect(citation).toMatchObject({ title: "PD 快充协议兼容性排查手册", revisionId: "mock-kb-8-r1" });
    // Unrelated published fixtures stay out instead of padding the list.
    expect(response.items.map((item) => item.entryId)).not.toContain("mock-kb-1");
  });

  it("never recommends drafts or archived entries; publishing makes a related entry appear", async () => {
    const log = makeLogRecord();
    const repository = createMockKnowledgeRepository({ getLogRecord: () => log });

    const draft = await repository.createMarkdown({
      title: "PD 协商稳定完成案例",
      tags: [],
      contentMarkdown: "PD 协商在 9V/3A 档位稳定完成,未出现握手重试。补充:留意 SourceCap 档位。"
    });
    const before = await repository.relatedToLog(log.id);
    expect(before.items.map((item) => item.entryId)).not.toContain(draft.id);

    await repository.publish(draft.id);
    const afterPublish = await repository.relatedToLog(log.id);
    expect(afterPublish.items.map((item) => item.entryId)).toContain(draft.id);

    await repository.archive(draft.id);
    const afterArchive = await repository.relatedToLog(log.id);
    expect(afterArchive.items.map((item) => item.entryId)).not.toContain(draft.id);
  });

  it("rejects related-knowledge lookups for logs that are not complete", async () => {
    const repository = createMockKnowledgeRepository({
      getLogRecord: () => makeLogRecord({ status: "Processing" })
    });
    await expect(repository.relatedToLog("log-auth")).rejects.toThrow(/已完成/);
  });

  it("simulates index health with a failed row, retry, and rebuild (port-shape parity)", async () => {
    const repository = createMockKnowledgeRepository();

    const health = await repository.getIndexHealth();
    expect(health.retrieval.mode).toBe("fts_only");
    expect(health.items.length).toBeGreaterThan(0);
    const failed = health.items.find((item) => item.status === "failed");
    expect(failed?.error).toBeTruthy();

    await repository.retryEntryIndex(failed!.entryId);
    const afterRetry = await repository.getIndexHealth();
    expect(afterRetry.items.find((item) => item.entryId === failed!.entryId)?.status).toBe("pending");

    const rebuild = await repository.rebuildIndex();
    expect(rebuild.enqueued).toBeGreaterThan(0);
    const afterRebuild = await repository.getIndexHealth();
    expect(afterRebuild.items.every((item) => item.entryStatus !== "published" || item.status === "pending")).toBe(true);
  });

  it("denies index governance without manage capability", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    await expect(repository.getIndexHealth()).rejects.toThrow(/knowledge:manage/);
    await expect(repository.rebuildIndex()).rejects.toThrow(/knowledge:manage/);
  });

  it("publishing adds an entry to the simulated index; hard delete removes it", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "索引条目", tags: [], contentMarkdown: "内容" });
    await repository.publish(entry.id);

    const health = await repository.getIndexHealth();
    expect(health.items.some((item) => item.entryId === entry.id && item.status === "succeeded")).toBe(true);

    await repository.hardDelete(entry.id);
    const afterDelete = await repository.getIndexHealth();
    expect(afterDelete.items.some((item) => item.entryId === entry.id)).toBe(false);
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
