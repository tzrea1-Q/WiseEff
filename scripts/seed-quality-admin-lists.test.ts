import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../server/shared/database/client";
import { createLocalObjectStore } from "../server/modules/logs/objectStore";
import { createKnowledgeEntry, listKnowledgeEntries, publishKnowledgeEntry } from "../server/modules/knowledge/service";
import { createProductFeedback, listProductFeedback } from "../server/modules/product-feedback/service";
import { seedQualityAdminLists } from "./seed-quality-admin-lists";

vi.mock("../server/modules/knowledge/service", () => ({
  createKnowledgeEntry: vi.fn(), listKnowledgeEntries: vi.fn(), publishKnowledgeEntry: vi.fn()
}));
vi.mock("../server/modules/product-feedback/service", () => ({
  createProductFeedback: vi.fn(), listProductFeedback: vi.fn()
}));

const db: Database = { query: vi.fn(), transaction: vi.fn() };
const store = createLocalObjectStore("/private/tmp/wiseeff-quality-admin-lists-test");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listKnowledgeEntries).mockResolvedValue([]);
  vi.mocked(listProductFeedback).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(createKnowledgeEntry).mockResolvedValue({ id: "knowledge-1" } as Awaited<ReturnType<typeof createKnowledgeEntry>>);
});

describe("quality admin list seed", () => {
  it("creates and publishes markdown knowledge and submits feedback through the domain services", async () => {
    await seedQualityAdminLists(db, store);
    expect(listKnowledgeEntries).toHaveBeenCalledWith(db, expect.objectContaining({
      organization: { id: "org-chargelab", name: "ChargeLab" }
    }), { status: "published", limit: 1 });
    expect(createKnowledgeEntry).toHaveBeenCalledWith(db, store, expect.anything(), expect.anything(),
      expect.objectContaining({ contentForm: "markdown", title: "质量检查：参数调试经验", contentMarkdown: expect.any(String) }));
    expect(publishKnowledgeEntry).toHaveBeenCalledWith(db, expect.anything(), "knowledge-1");
    expect(createProductFeedback).toHaveBeenCalledWith(db, store, expect.anything(),
      expect.objectContaining({ pagePath: "/knowledge", description: "质量检查：知识条目筛选与查看体验", attachments: [] }));
  });

  it("reuses populated lists instead of duplicating fixtures", async () => {
    vi.mocked(listKnowledgeEntries).mockResolvedValue([{ id: "published-entry" }] as Awaited<ReturnType<typeof listKnowledgeEntries>>);
    vi.mocked(listProductFeedback).mockResolvedValue({ items: [{ id: "submitted-feedback" }], nextCursor: null } as Awaited<ReturnType<typeof listProductFeedback>>);
    await seedQualityAdminLists(db, store);
    expect(createKnowledgeEntry).not.toHaveBeenCalled();
    expect(publishKnowledgeEntry).not.toHaveBeenCalled();
    expect(createProductFeedback).not.toHaveBeenCalled();
  });

  it("fails the seed when publication fails instead of accepting an empty published list", async () => {
    vi.mocked(publishKnowledgeEntry).mockRejectedValue(new Error("publish failed"));
    await expect(seedQualityAdminLists(db, store)).rejects.toThrow("publish failed");
    expect(createProductFeedback).not.toHaveBeenCalled();
  });
});
